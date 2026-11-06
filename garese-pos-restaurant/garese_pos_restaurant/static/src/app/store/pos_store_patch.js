/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { deserializeDateTime } from "@web/core/l10n/dates";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { PosBus } from "@point_of_sale/app/bus/pos_bus_service";
import { Order } from "@point_of_sale/app/store/models";

const { DateTime } = luxon;

/** Keys of the server payload copied on the tables (see pos.config). */
const GP_TABLE_KEYS = [
    "gp_amount",
    "gp_guests",
    "gp_since",
    "gp_unavailable",
    "gp_reserved_at",
    "gp_reserved_name",
    "gp_reserved_guests",
    "gp_table_waiter_id",
    "gp_order_waiter_id",
];

/** Display order of the statuses (filters and legend). */
export const GP_TABLE_STATUSES = ["free", "occupied", "service", "reserved", "unavailable"];

export function gpStatusLabel(status) {
    return {
        free: _t("Free table"),
        occupied: _t("Occupied table"),
        service: _t("Service in progress"),
        reserved: _t("Reserved table"),
        unavailable: _t("Unavailable table"),
    }[status];
}

/** "45 min", then "1 h 05" */
export function gpFormatElapsed(minutes) {
    if (minutes < 60) {
        return _t("%s min", minutes);
    }
    return _t("%s h %s", Math.floor(minutes / 60), String(minutes % 60).padStart(2, "0"));
}

patch(PosStore.prototype, {
    async setup() {
        // State of the floor plan, kept when the waiter goes to a table and back.
        this.gpFloor = {
            filter: "all", // "all" or one of GP_TABLE_STATUSES
            allFloors: false, // "All tables" view
            zoom: 1,
            full: false, // side panels hidden
            mode: null, // action waiting for a table: new, merge, move, free, bill, reserve, unavailable
            sourceId: null, // first table of a merge / move
            showAllActive: false,
            waiterId: 0, // only the tables of this waiter (0: all)
        };
        this.gpTableSearch = "";
        this.gpNow = Date.now();
        await super.setup(...arguments);
    },

    // ------------------------------------------------------------------
    // Data pushed by the server
    // ------------------------------------------------------------------
    gpApplyTableData(data) {
        for (const values of data || []) {
            const table = this.tables_by_id?.[values.id];
            if (!table) {
                continue;
            }
            for (const key of GP_TABLE_KEYS) {
                if (key in values) {
                    table[key] = values[key];
                }
            }
        }
    },
    /** Reload the counters of every table (also the fallback when the bus is down). */
    async gpRefreshTables() {
        if (!this.config.module_pos_restaurant) {
            return;
        }
        let data;
        try {
            data = await this.orm.silent.call(
                "pos.config",
                "get_tables_order_count_and_printing_changes",
                [this.config.id]
            );
        } catch {
            // Offline: the plan keeps the last known state.
            return;
        }
        for (const floor of this.floors) {
            floor.changes_count = 0;
        }
        for (const values of data) {
            const table = this.tables_by_id[values.id];
            if (table) {
                table.order_count = values.orders;
                table.changes_count = values.changes;
                table.skip_changes = values.skip_changes;
                table.floor.changes_count += values.changes;
            }
        }
        this.gpApplyTableData(data);
        this.gpNow = Date.now();
    },
    async updateModelsData(models_data) {
        const result = await super.updateModelsData(...arguments);
        if (models_data["restaurant.floor"]) {
            await this.gpRefreshTables();
        }
        return result;
    },

    // ------------------------------------------------------------------
    // State of a table
    // ------------------------------------------------------------------
    /** Orders of the table the server does not know yet (offline, or just typed). */
    gpLocalTableOrders(tableId) {
        return this.getTableOrders(tableId).filter(
            (order) =>
                !order.finalized &&
                !order.server_id &&
                (order.orderlines.length !== 0 || order.paymentlines.length !== 0)
        );
    },
    /**
     * Everything the floor plan shows about a table.
     * status: free | occupied (items not sent to the kitchen yet) | service
     * (everything sent) | reserved | unavailable
     */
    gpTableInfo(table) {
        const now = DateTime.fromMillis(this.gpNow);
        const localOrders = this.gpLocalTableOrders(table.id);
        const orders = (table.order_count || 0) + localOrders.length;
        let amount = table.order_count ? table.gp_amount || 0 : 0;
        let guests = table.order_count ? table.gp_guests || 0 : 0;
        let since = table.order_count && table.gp_since ? deserializeDateTime(table.gp_since) : null;
        let pending = (table.changes_count || 0) > 0;
        // waiter of the open order, else the one in charge of the table
        let waiterId =
            (table.order_count && table.gp_order_waiter_id) || table.gp_table_waiter_id || false;
        for (const order of localOrders) {
            waiterId = order.gp_waiter_id || waiterId;
            amount += order.get_total_with_tax();
            guests += order.getCustomerCount() || 0;
            if (order.date_order && (!since || order.date_order < since)) {
                since = order.date_order;
            }
            pending = pending || order.getOrderChanges().count > 0;
        }
        const minutes = since ? Math.max(0, Math.floor(now.diff(since, "minutes").minutes)) : 0;

        let reservation = null;
        if (table.gp_reserved_at) {
            const at = deserializeDateTime(table.gp_reserved_at);
            const before = this.config.gp_reservation_before;
            const after = this.config.gp_reservation_after;
            const start = before ? at.minus({ minutes: before }) : at.startOf("day");
            const end = after ? at.plus({ minutes: after }) : null;
            const isToday = at.hasSame(now, "day");
            reservation = {
                at,
                name: table.gp_reserved_name || "",
                guests: table.gp_reserved_guests || 0,
                isToday,
                time: at.toLocaleString(DateTime.TIME_SIMPLE),
                label: isToday
                    ? at.toLocaleString(DateTime.TIME_SIMPLE)
                    : at.toLocaleString({
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                      }),
                // the table is held for the guests
                active: now >= start && (!end || now <= end),
                expired: Boolean(end && now > end),
            };
        }

        let status = "free";
        if (orders > 0) {
            // guests seated but nothing ordered yet: still to be served
            status = pending || !amount ? "occupied" : "service";
        } else if (table.gp_unavailable) {
            status = "unavailable";
        } else if (reservation?.active) {
            status = "reserved";
        }
        return {
            status,
            statusLabel: gpStatusLabel(status),
            orders,
            amount,
            guests,
            minutes,
            elapsed: orders > 0 ? gpFormatElapsed(minutes) : "",
            reservation,
            isBusy: orders > 0,
            waiterId,
            waiterName: (this.config.gp_use_waiter && this.gpWaiterName(waiterId)) || "",
        };
    },
    /** Does the table match the status filter and the search of the top bar? */
    gpTableMatches(table, info = this.gpTableInfo(table)) {
        const filter = this.gpFloor.filter;
        if (filter !== "all" && info.status !== filter) {
            return false;
        }
        if (this.gpFloor.waiterId && info.waiterId !== this.gpFloor.waiterId) {
            return false;
        }
        const search = (this.gpTableSearch || "").trim().toLowerCase();
        if (!search) {
            return true;
        }
        return [table.name, table.floor?.name, info.reservation?.name, info.waiterName].some((text) =>
            (text || "").toLowerCase().includes(search)
        );
    },
});

patch(PosBus.prototype, {
    async ws_syncTableCount(data) {
        await super.ws_syncTableCount(...arguments);
        this.pos.gpApplyTableData(data);
        this.pos.gpNow = Date.now();
    },
});

patch(Order.prototype, {
    /** A new order of a table starts with the waiter in charge of the table. */
    gpDefaultWaiterId() {
        return this.pos.table?.gp_table_waiter_id || super.gpDefaultWaiterId(...arguments);
    },
});
