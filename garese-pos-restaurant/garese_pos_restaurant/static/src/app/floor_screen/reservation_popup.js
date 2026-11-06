/** @odoo-module */

import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { _t } from "@web/core/l10n/translation";
import { onMounted, useRef, useState } from "@odoo/owl";

const { DateTime } = luxon;

/**
 * Simple reservation of a table: name, date, time and number of guests.
 * payload: { name, at (luxon DateTime), guests } or { remove: true }
 */
export class GpReservationPopup extends AbstractAwaitablePopup {
    static template = "garese_pos_restaurant.GpReservationPopup";
    static defaultProps = {
        confirmText: _t("Reserve"),
        cancelText: _t("Discard"),
        confirmKey: "Enter",
        title: "",
        name: "",
        guests: 2,
        seats: 0,
        at: null,
        canRemove: false,
    };

    setup() {
        super.setup();
        // Default: next full hour.
        const at = this.props.at || DateTime.now().plus({ hours: 1 }).startOf("hour");
        this.state = useState({
            name: this.props.name,
            date: at.toFormat("yyyy-MM-dd"),
            time: at.toFormat("HH:mm"),
            guests: this.props.guests,
            remove: false,
        });
        this.inputRef = useRef("name");
        onMounted(() => this.inputRef.el?.focus());
    }
    get at() {
        const at = DateTime.fromISO(`${this.state.date}T${this.state.time}`);
        return at.isValid ? at : null;
    }
    get isValid() {
        return Boolean(this.state.name.trim() && this.at);
    }
    get tooManyGuests() {
        return this.props.seats > 0 && Number(this.state.guests) > this.props.seats;
    }
    get seatsWarning() {
        return _t("More guests than seats at this table (%s).", this.props.seats);
    }
    changeGuests(delta) {
        this.state.guests = Math.max(1, (parseInt(this.state.guests, 10) || 0) + delta);
    }
    confirm() {
        if (this.isValid) {
            return super.confirm();
        }
    }
    remove() {
        this.state.remove = true;
        return super.confirm();
    }
    getPayload() {
        if (this.state.remove) {
            return { remove: true };
        }
        return {
            name: this.state.name.trim(),
            at: this.at,
            guests: Math.max(0, parseInt(this.state.guests, 10) || 0),
        };
    }
}
