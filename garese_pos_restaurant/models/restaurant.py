from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError


# Fields of a table shown on the floor plan of the Point of Sale
GP_PLAN_FIELDS = {
    'gp_unavailable', 'gp_reserved_at', 'gp_reserved_name', 'gp_reserved_guests', 'gp_waiter_id',
}


class RestaurantFloor(models.Model):
    _inherit = 'restaurant.floor'

    # `background_image` already exists on the standard model (unused by the
    # standard Point of Sale): this lighter flag avoids sending the picture
    # itself with the Point of Sale data.
    gp_has_background = fields.Boolean(string='Has a Floor Plan Picture', compute='_compute_gp_has_background')

    @api.depends('background_image')
    def _compute_gp_has_background(self):
        for floor in self.with_context(bin_size=True):
            floor.gp_has_background = bool(floor.background_image)


class RestaurantTable(models.Model):
    _inherit = 'restaurant.table'

    gp_unavailable = fields.Boolean(
        string='Out of Service',
        help="The table cannot be used for now (out of order, privatised area...). "
             "It is shown in grey on the floor plan.")
    gp_reserved_at = fields.Datetime(string='Reserved For')
    gp_reserved_name = fields.Char(string='Reservation Name')
    gp_reserved_guests = fields.Integer(string='Reserved Guests')
    gp_waiter_id = fields.Many2one(
        'garese.pos.waiter', string='Assigned Waiter', ondelete='set null',
        help="Waiter in charge of this table: proposed on every new order of the table.")

    def write(self, vals):
        res = super().write(vals)
        # Whoever changes the state of a table (Point of Sale or back office),
        # every register showing the floor plan is told about it.
        if GP_PLAN_FIELDS.intersection(vals):
            self._gp_notify()
        return res

    # ------------------------------------------------------------------
    # Called from the Point of Sale. Waiters only have read access on the
    # tables, hence the sudo(), limited to these few fields.
    # ------------------------------------------------------------------
    def _gp_check_pos_user(self):
        if not self.env.user.has_group('point_of_sale.group_pos_user'):
            raise AccessError(_("Only Point of Sale users can change the state of a table."))

    def _gp_notify(self):
        """Push the new state to every Point of Sale showing these tables."""
        self.env['pos.order'].sudo().send_table_count_notification(self)

    def gp_set_unavailable(self, unavailable):
        self._gp_check_pos_user()
        self.sudo().write({'gp_unavailable': bool(unavailable)})
        return True

    def gp_set_waiter(self, waiter_id):
        """Waiter in charge of the table, also set on its open orders."""
        self._gp_check_pos_user()
        waiter = self.env['garese.pos.waiter'].browse(waiter_id or []).exists()
        # orders first: writing on the table sends the new state to the registers
        self.env['pos.order'].sudo().search([
            ('state', '=', 'draft'), ('table_id', 'in', self.ids),
        ]).write({'gp_waiter_id': waiter.id})
        self.sudo().write({'gp_waiter_id': waiter.id})
        return True

    def gp_set_reservation(self, name, reserved_at, guests=0):
        """:param reserved_at: UTC datetime string, as sent by the Point of Sale."""
        self.ensure_one()
        self._gp_check_pos_user()
        name = (name or '').strip()
        if not name:
            raise UserError(_("Enter the name of the reservation."))
        self.sudo().write({
            'gp_reserved_name': name,
            'gp_reserved_at': fields.Datetime.to_datetime(reserved_at),
            'gp_reserved_guests': max(int(guests or 0), 0),
        })
        return True

    def gp_clear_reservation(self):
        self._gp_check_pos_user()
        self.sudo().write({
            'gp_reserved_name': False,
            'gp_reserved_at': False,
            'gp_reserved_guests': 0,
        })
        return True
