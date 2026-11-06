/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { Navbar } from "@point_of_sale/app/navbar/navbar";
import { FloorScreen } from "@pos_restaurant/app/floor_screen/floor_screen";

patch(Navbar.prototype, {
    get gpOnFloorPlan() {
        return (
            this.pos.config.module_pos_restaurant &&
            this.pos.mainScreen.component === FloorScreen &&
            !this.pos.tempScreen &&
            !this.pos.isEditMode
        );
    },
    /** On the floor plan, the search of the top bar looks for a table. */
    get gpShowSearch() {
        return super.gpShowSearch || (!this.ui.isSmall && this.gpOnFloorPlan);
    },
    get gpSearchPlaceholder() {
        return this.gpOnFloorPlan ? _t("Search a table...") : super.gpSearchPlaceholder;
    },
    get gpSearchModel() {
        return this.gpOnFloorPlan ? [this.pos, "gpTableSearch"] : super.gpSearchModel;
    },
});
