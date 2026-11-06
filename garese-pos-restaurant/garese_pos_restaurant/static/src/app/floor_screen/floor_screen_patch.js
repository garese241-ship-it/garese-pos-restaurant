/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { serializeDateTime } from "@web/core/l10n/dates";
import { ConnectionLostError } from "@web/core/network/rpc_service";
import { useService } from "@web/core/utils/hooks";
import { onMounted, onWillUnmount, useState } from "@odoo/owl";
import { FloorScreen } from "@pos_restaurant/app/floor_screen/floor_screen";
import { ConfirmPopup } from "@point_of_sale/app/utils/confirm_popup/confirm_popup";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { SelectionPopup } from "@point_of_sale/app/utils/input_popups/selection_popup";
import { GpReservationPopup } from "@garese_pos_restaurant/app/floor_screen/reservation_popup";
import {
    GP_TABLE_STATUSES,
    gpStatusLabel,
} from "@garese_pos_restaurant/app/store/pos_store_patch";

const GP_ZOOM_MIN = 0.5;
const GP_ZOOM_MAX = 2.5;
const GP_ACTIVE_PREVIEW = 4;

const GP_STATUS_ICONS = {
    free: "fa-check",
    occupied: "fa-cutlery",
    service: "fa-hourglass-half",
    reserved: "fa-calendar-check-o",
    unavailable: "fa-ban",
};

patch(FloorScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.ui = useState(useService("ui"));
        // size of the plan area and of the background pictures (per floor)
        this.gpView = useState({ width: 0, height: 0, backgrounds: {} });
        this.gpLocked = false;

        const clock = setInterval(() => {
            this.pos.gpNow = Date.now();
        }, 30000);
        // Safety net when the bus notifications do not come through.
        const refresh = setInterval(() => this.pos.gpRefreshTables(), 120000);
        const observer = new ResizeObserver(() => this.gpMeasure());
        onMounted(() => {
            observer.observe(this.floorMapRef.el);
            this.gpMeasure();
        });
        onWillUnmount(() => {
            clearInterval(clock);
            clearInterval(refresh);
            observer.disconnect();
            this.gpCancelMode();
        });
    },
    async onWillStart() {
        await super.onWillStart(...arguments);
        // The orders of the table we come from have just been sent: show
        // the plan with their up-to-date state, without holding the screen
        // back when the server is slow to answer.
        await Promise.race([
            this.pos.gpRefreshTables(),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
    },
    gpMeasure() {
        const el = this.floorMapRef.el;
        if (el && el.clientWidth && el.clientHeight) {
            this.gpView.width = el.clientWidth;
            this.gpView.height = el.clientHeight;
        }
    },

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------
    /** GARESE layout: large screens, outside of the plan editor. */
    get gpActive() {
        return !this.ui.isSmall && !this.pos.isEditMode && this.pos.floors.length > 0;
    },
    get gp() {
        return this.pos.gpFloor;
    },
    get gpClass() {
        return {
            oe_hidden: !this.props.isShown,
            "gp-floor": this.gpActive,
            "gp-floor-full": this.gpActive && this.gp.full,
            "gp-floor-picking": this.gpActive && Boolean(this.gp.mode || this.pos.orderToTransfer),
        };
    },
    /** List of cards instead of the plan ("All tables" is always a list). */
    get gpShowList() {
        return this.gpActive && (this.gp.allFloors || this.pos.floorPlanStyle === "kanban");
    },
    get gpTotalTables() {
        return this.pos.floors.reduce((total, floor) => total + floor.tables.length, 0);
    },
    get gpScopeFloors() {
        if (this.gp.allFloors) {
            return this.pos.floors;
        }
        return this.activeFloor ? [this.activeFloor] : [];
    },
    get gpTitle() {
        return this.gp.allFloors ? _t("All tables") : this.activeFloor?.name || "";
    },
    get gpTitleCount() {
        const count = this.gpScopeFloors.reduce((total, floor) => total + floor.tables.length, 0);
        return _t("(%s tables)", count);
    },
    selectFloor(floor) {
        super.selectFloor(...arguments);
        this.gp.allFloors = false;
    },
    gpSelectAllFloors() {
        this.gp.allFloors = true;
        this.state.selectedTableIds = [];
    },
    gpSetView(view) {
        const style = view === "list" ? "kanban" : "default";
        localStorage.setItem("floorPlanStyle", style);
        this.pos.floorPlanStyle = style;
        if (view === "plan") {
            this.gp.allFloors = false;
        }
    },
    gpToggleFull() {
        this.gp.full = !this.gp.full;
    },

    // ------------------------------------------------------------------
    // Filters, lists
    // ------------------------------------------------------------------
    get gpFilters() {
        const counts = Object.fromEntries(GP_TABLE_STATUSES.map((status) => [status, 0]));
        let total = 0;
        for (const floor of this.gpScopeFloors) {
            for (const table of floor.tables) {
                counts[this.pos.gpTableInfo(table).status] += 1;
                total += 1;
            }
        }
        const labels = {
            free: _t("Vacant"),
            occupied: _t("Occupied"),
            service: _t("In service"),
            reserved: _t("With reservation"),
            unavailable: _t("Unavailable"),
        };
        return [
            { id: "all", label: _t("All states"), count: total },
            ...GP_TABLE_STATUSES.map((status) => ({
                id: status,
                label: labels[status],
                count: counts[status],
            })),
        ];
    },
    gpSetFilter(filter) {
        this.gp.filter = filter;
    },
    get gpLegend() {
        return GP_TABLE_STATUSES.map((status) => ({ id: status, label: gpStatusLabel(status) }));
    },
    gpCard(table) {
        const info = this.pos.gpTableInfo(table);
        return {
            table,
            info,
            icon: GP_STATUS_ICONS[info.status],
            seats: info.isBusy ? `${info.guests}/${table.seats}` : `${table.seats}`,
            amount: info.isBusy ? this.env.utils.formatCurrency(info.amount) : "",
            isSource: this.gp.sourceId === table.id,
        };
    },
    /** Tables of the list view, per floor, after the filter and the search. */
    get gpListGroups() {
        const groups = [];
        for (const floor of this.gpScopeFloors) {
            const cards = floor.tables
                .map((table) => this.gpCard(table))
                .filter((card) => this.pos.gpTableMatches(card.table, card.info))
                .sort((a, b) =>
                    a.table.name.localeCompare(b.table.name, undefined, { numeric: true })
                );
            if (cards.length) {
                groups.push({ floor, cards });
            }
        }
        return groups;
    },
    /** Tables with an open order, every floor, the longest wait first. */
    get gpActiveCards() {
        const cards = [];
        for (const floor of this.pos.floors) {
            for (const table of floor.tables) {
                const card = this.gpCard(table);
                if (card.info.isBusy) {
                    cards.push(card);
                }
            }
        }
        return cards.sort((a, b) => b.info.minutes - a.info.minutes);
    },
    get gpActivePreview() {
        return GP_ACTIVE_PREVIEW;
    },
    gpToggleAllActive() {
        this.gp.showAllActive = !this.gp.showAllActive;
    },
    /** Open the table from the side panel, on its own floor. */
    gpOpenActive(table, ev) {
        return this.onSelectTable(table, ev);
    },

    // ------------------------------------------------------------------
    // Plan: background picture, fit to the screen, zoom
    // ------------------------------------------------------------------
    get gpBackgroundUrl() {
        const floor = this.activeFloor;
        // The picture only makes sense behind the real plan, not behind the
        // grid of the small screens.
        if (!floor || !floor.gp_has_background || this.pos.floorPlanStyle === "kanban") {
            return "";
        }
        const unique = encodeURIComponent(floor.write_date || "");
        return `/web/image/restaurant.floor/${floor.id}/background_image?unique=${unique}`;
    },
    gpOnBackgroundLoad(ev) {
        const img = ev.target;
        if (this.activeFloor && img.naturalWidth) {
            this.gpView.backgrounds[this.activeFloor.id] = {
                width: img.naturalWidth,
                height: img.naturalHeight,
            };
        }
    },
    /** Size of the plan at 100%: the tables (with their margin) and the picture. */
    get gpPlanSize() {
        const tables = this.activeTables || [];
        const background = this.gpView.backgrounds[this.activeFloor?.id];
        if (background) {
            // The picture is the plan: tables are expected to be inside it.
            let width = background.width;
            let height = background.height;
            for (const table of tables) {
                width = Math.max(width, table.position_h + table.width);
                height = Math.max(height, table.position_v + table.height);
            }
            return { width, height };
        }
        if (!tables.length) {
            return { width: 1, height: 1 };
        }
        let left = Infinity;
        let top = Infinity;
        let right = 0;
        let bottom = 0;
        for (const table of tables) {
            left = Math.min(left, table.position_h);
            top = Math.min(top, table.position_v);
            right = Math.max(right, table.position_h + table.width);
            bottom = Math.max(bottom, table.position_v + table.height);
        }
        // same margin on both sides
        const marginX = Math.min(Math.max(left, 16), 60);
        const marginY = Math.min(Math.max(top, 16), 60);
        return { width: right + marginX, height: bottom + marginY };
    },
    /** Scale that shows the whole plan in the available area. */
    get gpFitScale() {
        const { width, height } = this.gpPlanSize;
        if (!this.gpView.width || !this.gpView.height) {
            return 1;
        }
        const fit = Math.min(this.gpView.width / width, this.gpView.height / height);
        return Math.min(Math.max(fit, 0.3), 1.3);
    },
    get gpMapStyle() {
        if (!this.gpActive) {
            return "";
        }
        const { width, height } = this.gpPlanSize;
        const scale = this.gpFitScale * this.gp.zoom;
        const left = Math.max(0, (this.gpView.width - width * scale) / 2);
        const top = Math.max(0, (this.gpView.height - height * scale) / 2);
        return (
            `position: absolute; left: ${left}px; top: ${top}px; ` +
            `width: ${width}px; height: ${height}px; ` +
            `transform: scale(${scale}); transform-origin: 0 0; --gp-scale: ${scale};`
        );
    },
    get gpZoomLabel() {
        return `${Math.round(this.gp.zoom * 100)}%`;
    },
    gpZoom(delta) {
        const zoom = delta ? Math.round((this.gp.zoom + delta) * 10) / 10 : 1;
        this.gp.zoom = Math.min(Math.max(zoom, GP_ZOOM_MIN), GP_ZOOM_MAX);
    },
    // Pinch gesture of the standard plan
    getScale() {
        return this.gpActive ? this.gp.zoom : super.getScale(...arguments);
    },
    setScale(value) {
        if (!this.gpActive) {
            return super.setScale(...arguments);
        }
        if (value > 0) {
            this.gp.zoom = Math.min(Math.max(value, GP_ZOOM_MIN), GP_ZOOM_MAX);
        }
    },

    // ------------------------------------------------------------------
    // Action bar: tap an action, then the table(s)
    // ------------------------------------------------------------------
    get gpActions() {
        const actions = [
            { mode: "new", icon: "fa-plus-circle", label: _t("New order") },
            { mode: "merge", icon: "fa-compress", label: _t("Merge tables") },
            { mode: "move", icon: "fa-exchange", label: _t("Move a table") },
            { mode: "free", icon: "fa-sign-out", label: _t("Free the table") },
            { mode: "bill", icon: "fa-file-text-o", label: _t("Show the bill") },
            { mode: "reserve", icon: "fa-calendar-plus-o", label: _t("Reserve") },
            { mode: "unavailable", icon: "fa-ban", label: _t("Out of service") },
        ];
        if (this.pos.gpUseWaiter) {
            actions.push({ mode: "waiter", icon: "fa-id-badge", label: _t("Waiter") });
        }
        return actions;
    },
    gpSetMode(mode) {
        this.pos.orderToTransfer = null;
        this.gp.sourceId = null;
        this.gp.mode = this.gp.mode === mode ? null : mode;
    },
    gpCancelMode() {
        this.pos.orderToTransfer = null;
        this.gp.sourceId = null;
        this.gp.mode = null;
    },
    get gpHint() {
        if (this.pos.orderToTransfer) {
            return _t("Transfer of the order: tap the destination table.");
        }
        const source = this.gp.sourceId && this.pos.tables_by_id[this.gp.sourceId];
        switch (this.gp.mode) {
            case "new":
                return _t("New order: tap the table.");
            case "merge":
                return source
                    ? _t("Merge %s: tap the table that receives its order.", source.name)
                    : _t("Merge tables: tap the table to empty.");
            case "move":
                return source
                    ? _t("Move %s: tap the new table.", source.name)
                    : _t("Move a table: tap the table of the guests.");
            case "free":
                return _t("Free a table: tap the table.");
            case "bill":
                return _t("Bill: tap the table.");
            case "reserve":
                return _t("Reservation: tap the table to reserve.");
            case "unavailable":
                return _t("Out of service: tap the table to block or to put back in service.");
            case "waiter":
                return _t("Waiter: tap the table to assign.");
        }
        return "";
    },

    // ------------------------------------------------------------------
    // Tap on a table
    // ------------------------------------------------------------------
    async onSelectTable(table, ev) {
        if (!this.gpActive) {
            return super.onSelectTable(...arguments);
        }
        if (this.gpLocked) {
            return;
        }
        this.gpLocked = true;
        try {
            // null: handled here; otherwise open the table the standard way
            const action = await this.gpTableAction(table);
            if (action) {
                await super.onSelectTable(table, ev);
                if (action.after) {
                    await action.after();
                }
                await this.gpAskWaiter(table);
            }
        } finally {
            this.gpLocked = false;
        }
    },
    /** Setting "Waiter required": ask who serves the table as soon as it is opened. */
    async gpAskWaiter(table) {
        const order = this.pos.get_order();
        if (
            order &&
            this.pos.gpUseWaiter &&
            this.pos.config.gp_waiter_required &&
            !order.gp_waiter_id &&
            order.tableId === table.id
        ) {
            await this.pos.gpSelectWaiter(order, {
                title: _t("Who serves table %s?", table.name),
                allowNone: false,
            });
        }
    },
    /** Waiter in charge of a table (and of its open orders). */
    async gpAssignWaiter(table) {
        const waiterId = await this.pos.gpPickWaiter({
            title: _t("Waiter of table %s", table.name),
            selectedId: this.pos.gpTableInfo(table).waiterId,
        });
        if (waiterId !== undefined) {
            await this.gpCallTable(table, "gp_set_waiter", [waiterId]);
        }
    },
    gpSetWaiterFilter(ev) {
        this.gp.waiterId = Number(ev.target.value) || 0;
    },
    gpError(title, body) {
        return this.popup.add(ErrorPopup, { title, body });
    },
    async gpTableAction(table) {
        const info = this.pos.gpTableInfo(table);
        if (this.pos.orderToTransfer) {
            // standard transfer started from the order screen
            if (info.status === "unavailable") {
                await this.gpError(
                    _t("Unavailable table"),
                    _t("Table %s is out of service: choose another table.", table.name)
                );
                return null;
            }
            return {};
        }
        const mode = this.gp.mode;
        if (!mode) {
            return this.gpOpenTable(table, info);
        }
        if (mode === "new") {
            this.gpCancelMode();
            const action = await this.gpOpenTable(table, info);
            if (action && info.isBusy) {
                // the table already has an order: open a second one
                action.after = () => {
                    this.pos.add_new_order();
                    this.pos.showScreen("ProductScreen");
                };
            }
            return action;
        }
        if (mode === "merge" || mode === "move") {
            await this.gpTwoTables(mode, table, info);
            return null;
        }
        this.gpCancelMode();
        try {
            if (mode === "free") {
                await this.gpFree(table, info);
            } else if (mode === "bill") {
                await this.gpBill(table, info);
            } else if (mode === "reserve") {
                await this.gpReserve(table, info);
            } else if (mode === "unavailable") {
                await this.gpToggleUnavailable(table, info);
            } else if (mode === "waiter") {
                await this.gpAssignWaiter(table);
            }
        } catch (error) {
            await this.gpHandleError(error);
        }
        return null;
    },
    async gpHandleError(error) {
        if (error instanceof ConnectionLostError) {
            await this.gpError(
                _t("No connection"),
                _t("This action needs the server. Check the network and try again.")
            );
            return;
        }
        throw error;
    },
    /** Checks before seating guests at a table. */
    async gpOpenTable(table, info) {
        if (info.status === "unavailable") {
            const { confirmed } = await this.popup.add(ConfirmPopup, {
                title: _t("Unavailable table"),
                body: _t("Table %s is out of service. Put it back in service?", table.name),
                confirmText: _t("Put back in service"),
                cancelText: _t("Leave out of service"),
            });
            if (confirmed) {
                await this.gpCallTable(table, "gp_set_unavailable", [false]);
            }
            return null;
        }
        if (info.status === "reserved") {
            const reservation = info.reservation;
            const { confirmed } = await this.popup.add(ConfirmPopup, {
                title: _t("Table %s is reserved", table.name),
                body: _t(
                    "%s - %s - %s guests. Seat the guests now?",
                    reservation.name,
                    reservation.label,
                    reservation.guests
                ),
                confirmText: _t("Seat the guests"),
                cancelText: _t("Not now"),
            });
            if (!confirmed) {
                return null;
            }
            await this.gpCallTable(table, "gp_clear_reservation", []);
            return {
                after: () => {
                    const order = this.pos.get_order();
                    if (order) {
                        if (reservation.guests) {
                            order.setCustomerCount(reservation.guests);
                        }
                        // keeps the table occupied even before the first item
                        order.setBooked(true);
                    }
                },
            };
        }
        return {};
    },
    async gpCallTable(table, method, args) {
        try {
            await this.orm.call("restaurant.table", method, [[table.id], ...args]);
        } catch (error) {
            await this.gpHandleError(error);
            return false;
        }
        await this.pos.gpRefreshTables();
        return true;
    },
    /** Fresh copy of the open orders of the tables, as the server has them. */
    async gpLoadOrders(tables) {
        this.pos.loadingOrderState = true;
        try {
            for (const table of tables) {
                await this.pos._syncTableOrdersFromServer(table.id);
            }
        } finally {
            this.pos.loadingOrderState = false;
        }
    },
    gpOpenOrders(table) {
        return this.pos.getTableOrders(table.id).filter((order) => !order.finalized);
    },

    // --- merge / move -----------------------------------------------------
    async gpTwoTables(mode, table, info) {
        if (!this.gp.sourceId) {
            const movable = info.isBusy || (mode === "move" && info.reservation);
            if (!movable) {
                await this.gpError(
                    _t("Nothing to move"),
                    mode === "merge"
                        ? _t("Table %s has no order to merge.", table.name)
                        : _t("Table %s has no order and no reservation to move.", table.name)
                );
                return;
            }
            this.gp.sourceId = table.id;
            return;
        }
        const source = this.pos.tables_by_id[this.gp.sourceId];
        if (!source || source.id === table.id) {
            // second tap on the same table: unselect it
            this.gp.sourceId = null;
            return;
        }
        this.gpCancelMode();
        try {
            if (mode === "merge") {
                await this.gpMerge(source, table, info);
            } else {
                await this.gpMove(source, table, info);
            }
        } catch (error) {
            await this.gpHandleError(error);
        }
    },
    async gpMerge(source, target, targetInfo) {
        if (!targetInfo.isBusy) {
            await this.gpError(
                _t("Nothing to merge with"),
                _t("Table %s has no order. To change the table of the guests, use 'Move a table'.", target.name)
            );
            return;
        }
        const { confirmed } = await this.popup.add(ConfirmPopup, {
            title: _t("Merge tables"),
            body: _t(
                "The order of table %s is added to the order of table %s, and table %s is freed.",
                source.name,
                target.name,
                source.name
            ),
            confirmText: _t("Merge"),
        });
        if (!confirmed) {
            return;
        }
        await this.gpLoadOrders([source, target]);
        const sourceOrders = this.gpOpenOrders(source);
        const targetOrder = this.gpOpenOrders(target)[0];
        if (!sourceOrders.length || !targetOrder) {
            await this.pos.gpRefreshTables();
            return;
        }
        if ([...sourceOrders, targetOrder].some((order) => order.paymentlines.length)) {
            await this.gpError(
                _t("Payment in progress"),
                _t("One of these orders has a payment in progress: finish or remove it first.")
            );
            return;
        }
        // Rebuild the target order from its data plus the lines of the other
        // orders: lines keep their identity, so what was already sent to the
        // kitchen is not sent again.
        const json = targetOrder.export_as_JSON();
        const sent = { ...(targetOrder.lastOrderPrepaChange || {}) };
        let guests = targetOrder.getCustomerCount() || 0;
        for (const order of sourceOrders) {
            json.lines.push(...order.export_as_JSON().lines);
            Object.assign(sent, order.lastOrderPrepaChange || {});
            guests += order.getCustomerCount() || 0;
        }
        json.last_order_preparation_change = JSON.stringify(sent);
        json.customer_count = guests;

        this.pos.removeOrder(targetOrder, false);
        const merged = this.pos.createReactiveOrder(json);
        this.pos.orders.add(merged);
        merged.setBooked(true);
        for (const order of sourceOrders) {
            this.pos.removeOrder(order);
        }
        await this.pos._syncTableOrdersToServer();
        await this.pos.gpRefreshTables();
    },
    async gpMove(source, target, targetInfo) {
        if (targetInfo.isBusy) {
            await this.gpError(
                _t("Table already occupied"),
                _t("Table %s already has an order. To group both tables, use 'Merge tables'.", target.name)
            );
            return;
        }
        if (targetInfo.status === "unavailable") {
            await this.gpError(
                _t("Unavailable table"),
                _t("Table %s is out of service: choose another table.", target.name)
            );
            return;
        }
        const sourceInfo = this.pos.gpTableInfo(source);
        if (!sourceInfo.isBusy) {
            // only a reservation to move
            const reservation = sourceInfo.reservation;
            if (!reservation) {
                return;
            }
            if (targetInfo.reservation) {
                await this.gpError(
                    _t("Table already reserved"),
                    _t("Table %s already has a reservation.", target.name)
                );
                return;
            }
            const done = await this.gpCallTable(target, "gp_set_reservation", [
                reservation.name,
                serializeDateTime(reservation.at),
                reservation.guests,
            ]);
            if (done) {
                await this.gpCallTable(source, "gp_clear_reservation", []);
            }
            return;
        }
        if (targetInfo.status === "reserved") {
            const { confirmed } = await this.popup.add(ConfirmPopup, {
                title: _t("Table %s is reserved", target.name),
                body: _t(
                    "%s - %s. Seat the guests of table %s here anyway? The reservation is kept.",
                    targetInfo.reservation.name,
                    targetInfo.reservation.label,
                    source.name
                ),
                confirmText: _t("Move here"),
            });
            if (!confirmed) {
                return;
            }
        }
        await this.gpLoadOrders([source]);
        for (const order of this.gpOpenOrders(source)) {
            order.tableId = target.id;
            order.save_to_db();
            this.pos.transferredOrdersSet.add(order);
            this.pos.ordersToUpdateSet.add(order);
        }
        await this.pos._syncTableOrdersToServer();
        await this.pos.gpRefreshTables();
    },

    // --- free ---------------------------------------------------------------
    async gpFree(table, info) {
        if (!info.isBusy) {
            if (info.reservation) {
                const { confirmed } = await this.popup.add(ConfirmPopup, {
                    title: _t("Cancel the reservation"),
                    body: _t(
                        "Cancel the reservation of table %s (%s - %s)?",
                        table.name,
                        info.reservation.name,
                        info.reservation.label
                    ),
                    confirmText: _t("Cancel the reservation"),
                    cancelText: _t("Keep the reservation"),
                });
                if (confirmed) {
                    await this.gpCallTable(table, "gp_clear_reservation", []);
                }
            } else if (table.gp_unavailable) {
                await this.gpCallTable(table, "gp_set_unavailable", [false]);
            } else {
                await this.gpError(_t("Table already free"), _t("Table %s has no order.", table.name));
            }
            return;
        }
        await this.gpLoadOrders([table]);
        const orders = this.gpOpenOrders(table);
        if (!orders.length) {
            await this.pos.gpRefreshTables();
            return;
        }
        if (orders.some((order) => order.paymentlines.length)) {
            await this.gpError(
                _t("Payment in progress"),
                _t("One of these orders has a payment in progress: finish or remove it first.")
            );
            return;
        }
        const hasLines = orders.some((order) => order.orderlines.length);
        if (hasLines && this.pos.get_cashier()?.role !== "manager") {
            await this.gpError(
                _t("Manager required"),
                _t("Only a manager can free a table whose order still has items. Otherwise, collect the payment of the order.")
            );
            return;
        }
        if (hasLines) {
            const amount = orders.reduce((total, order) => total + order.get_total_with_tax(), 0);
            const { confirmed } = await this.popup.add(ConfirmPopup, {
                title: _t("Free table %s", table.name),
                body: _t(
                    "The order of this table (%s) is cancelled without payment. This cannot be undone.",
                    this.env.utils.formatCurrency(amount)
                ),
                confirmText: _t("Cancel the order"),
                cancelText: _t("Keep the order"),
            });
            if (!confirmed) {
                return;
            }
        }
        for (const order of orders) {
            this.pos.removeOrder(order);
        }
        await this.pos._syncTableOrdersToServer();
        await this.pos.gpRefreshTables();
    },

    // --- bill ---------------------------------------------------------------
    async gpBill(table, info) {
        if (!info.isBusy) {
            await this.gpError(_t("No bill"), _t("Table %s has no order.", table.name));
            return;
        }
        await this.pos.setTable(table);
        try {
            const orders = this.gpOpenOrders(table).filter((order) => order.orderlines.length);
            let order = orders[0];
            if (orders.length > 1) {
                const { confirmed, payload } = await this.popup.add(SelectionPopup, {
                    title: _t("Which bill?"),
                    list: orders.map((item) => ({
                        id: item.uid,
                        label: `${item.name} - ${this.env.utils.formatCurrency(
                            item.get_total_with_tax()
                        )}`,
                        item,
                    })),
                });
                order = confirmed ? payload : null;
            } else if (!order) {
                await this.gpError(_t("No bill"), _t("Table %s has no order.", table.name));
            }
            if (order) {
                this.pos.set_order(order);
                await this.pos.showTempScreen("BillScreen");
            }
        } finally {
            await this.pos.unsetTable();
            await this.pos.gpRefreshTables();
        }
    },

    // --- reservation, availability ------------------------------------------
    async gpReserve(table, info) {
        const reservation = info.reservation;
        const { confirmed, payload } = await this.popup.add(GpReservationPopup, {
            title: _t("Reservation of table %s", table.name),
            name: reservation?.name || "",
            guests: reservation?.guests || Math.min(2, table.seats || 2),
            seats: table.seats,
            at: reservation?.at || null,
            canRemove: Boolean(reservation),
            confirmText: reservation ? _t("Save the reservation") : _t("Reserve"),
        });
        if (!confirmed) {
            return;
        }
        if (payload.remove) {
            await this.gpCallTable(table, "gp_clear_reservation", []);
        } else {
            await this.gpCallTable(table, "gp_set_reservation", [
                payload.name,
                serializeDateTime(payload.at),
                payload.guests,
            ]);
        }
    },
    async gpToggleUnavailable(table, info) {
        if (info.isBusy) {
            await this.gpError(
                _t("Occupied table"),
                _t("Table %s has an order in progress: it cannot be put out of service.", table.name)
            );
            return;
        }
        await this.gpCallTable(table, "gp_set_unavailable", [!table.gp_unavailable]);
    },
});
