from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    pos_gp_reservation_before = fields.Integer(related='pos_config_id.gp_reservation_before', readonly=False)
    pos_gp_reservation_after = fields.Integer(related='pos_config_id.gp_reservation_after', readonly=False)
