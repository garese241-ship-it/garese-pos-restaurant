/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import { useState } from "@odoo/owl";
import { Table } from "@pos_restaurant/app/floor_screen/table";

const GP_TABLE_ICONS = {
    occupied: "fa-cutlery",
    service: "fa-hourglass-half",
    reserved: "fa-calendar-check-o",
    unavailable: "fa-ban",
};

patch(Table.prototype, {
    setup() {
        super.setup(...arguments);
        this.ui = useState(useService("ui"));
    },
    /** GARESE tile: large screens, outside of the plan editor. */
    get gpOn() {
        return !this.ui.isSmall && !this.pos.isEditMode;
    },
    get gpInfo() {
        return this.pos.gpTableInfo(this.props.table);
    },
    get gpClass() {
        if (!this.gpOn) {
            return {};
        }
        const table = this.props.table;
        const info = this.gpInfo;
        const size = Math.min(table.width, table.height);
        return {
            "gp-tb": true,
            [`gp-st-${info.status}`]: true,
            "gp-tb-round": table.shape === "round",
            "gp-tb-small": size < 80,
            "gp-tb-dim": !this.pos.gpTableMatches(table, info),
            "gp-tb-source": this.pos.gpFloor.sourceId === table.id,
        };
    },
    get style() {
        if (!this.gpOn) {
            return super.style;
        }
        const table = this.props.table;
        const size = Math.min(table.width, table.height);
        // Text sized on the tile, but kept readable whatever the zoom of the plan.
        const fontSize = (size / 5.8).toFixed(1);
        return (
            `width: ${table.width}px; height: ${table.height}px; ` +
            `top: ${table.position_v}px; left: ${table.position_h}px; ` +
            `font-size: calc(clamp(11px, ${fontSize}px * var(--gp-scale, 1), 16px) / var(--gp-scale, 1));`
        );
    },
    /** Second line of the tile: guests / seats, or the state of an idle table. */
    get gpSub() {
        const info = this.gpInfo;
        if (info.status === "unavailable") {
            return { text: _t("Out of service") };
        }
        if (info.status === "reserved") {
            return { text: _t("Booked") };
        }
        const seats = this.props.table.seats;
        return { seats: info.isBusy ? `${info.guests}/${seats}` : `${seats}` };
    },
    /** Pill of the tile: elapsed time, time of the reservation. */
    get gpMeta() {
        const info = this.gpInfo;
        if (info.isBusy) {
            return info.elapsed;
        }
        // Tiles are small: the time only (the full date is in the tooltip
        // and in the list view).
        if (info.status === "reserved") {
            return info.reservation.time;
        }
        if (info.status === "free" && info.reservation?.isToday && !info.reservation.expired) {
            return _t("Res. %s", info.reservation.time);
        }
        return "";
    },
    /** First name only: the tile is small (the full name is in the tooltip). */
    get gpWaiterShort() {
        return this.gpInfo.waiterName.trim().split(/\s+/)[0];
    },
    get gpIcon() {
        return GP_TABLE_ICONS[this.gpInfo.status] || "";
    },
    get gpTitle() {
        const info = this.gpInfo;
        const parts = [this.props.table.name, info.statusLabel];
        if (info.waiterName) {
            parts.push(info.waiterName);
        }
        if (info.reservation && !info.reservation.expired) {
            parts.push(`${info.reservation.name} (${info.reservation.label})`);
        }
        return parts.join(" - ");
    },
});
