from odoo import fields, models


class PosConfig(models.Model):
    _inherit = 'pos.config'

    gp_reservation_before = fields.Integer(
        string='Hold Reserved Tables (min before)', default=120,
        help="A reserved table is shown as reserved on the floor plan this many "
             "minutes before the time of the reservation. 0: from the beginning of the day.")
    gp_reservation_after = fields.Integer(
        string='Release Reserved Tables (min after)', default=60,
        help="When the guests have not been seated, the table is shown as free again "
             "this many minutes after the time of the reservation. 0: never.")

    _sql_constraints = [
        ('gp_reservation_before_positive', 'CHECK(gp_reservation_before >= 0)',
         'The delay before a reservation cannot be negative.'),
        ('gp_reservation_after_positive', 'CHECK(gp_reservation_after >= 0)',
         'The delay after a reservation cannot be negative.'),
    ]

    def get_tables_order_count_and_printing_changes(self):
        """Standard payload (orders / changes per table, also pushed on the bus
        at every order change) enriched with what the GARESE floor plan shows:
        amount, guests, time of the oldest open order, reservation and
        availability."""
        result = super().get_tables_order_count_and_printing_changes()
        table_ids = [table['id'] for table in result]
        if not table_ids:
            return result

        stats = {
            table.id: (amount, guests, since)
            for table, amount, guests, since in self.env['pos.order']._read_group(
                [('state', '=', 'draft'), ('table_id', 'in', table_ids)],
                ['table_id'],
                ['amount_total:sum', 'customer_count:sum', 'date_order:min'],
            )
        }
        tables = {table.id: table for table in self.env['restaurant.table'].browse(table_ids)}
        # waiter of the (oldest) open order of each table
        order_waiters = {}
        for order in self.env['pos.order'].search([
            ('state', '=', 'draft'), ('table_id', 'in', table_ids), ('gp_waiter_id', '!=', False),
        ], order='id desc'):
            order_waiters[order.table_id.id] = order.gp_waiter_id.id
        for data in result:
            amount, guests, since = stats.get(data['id'], (0.0, 0, False))
            table = tables[data['id']]
            data.update({
                'gp_amount': amount or 0.0,
                'gp_guests': guests or 0,
                'gp_since': fields.Datetime.to_string(since) if since else False,
                'gp_unavailable': table.gp_unavailable,
                'gp_reserved_at': fields.Datetime.to_string(table.gp_reserved_at) if table.gp_reserved_at else False,
                'gp_reserved_name': table.gp_reserved_name or '',
                'gp_reserved_guests': table.gp_reserved_guests,
                'gp_table_waiter_id': table.gp_waiter_id.id or False,
                'gp_order_waiter_id': order_waiters.get(table.id, False),
            })
        return result
