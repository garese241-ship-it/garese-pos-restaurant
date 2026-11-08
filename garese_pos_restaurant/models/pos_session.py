from odoo import models


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _loader_params_restaurant_floor(self):
        params = super()._loader_params_restaurant_floor()
        params['search_params']['fields'] += ['gp_has_background', 'write_date']
        return params

    def _loader_params_restaurant_table(self):
        params = super()._loader_params_restaurant_table()
        params['search_params']['fields'] += [
            'gp_unavailable', 'gp_reserved_at', 'gp_reserved_name', 'gp_reserved_guests',
        ]
        return params
