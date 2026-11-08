{
    'name': 'GARESE POS - Restaurant',
    'version': '17.0.1.2.0',
    'category': 'Sales/Point of Sale',
    'summary': 'Floor plan for restaurants: table status colors, timers, '
               'reservations, active tables, merge / move / free a table',
    'description': """
GARESE POS - Restaurant
=======================
Redesigned floor plan for the Odoo Point of Sale in restaurant mode, on top of
GARESE POS and of the standard Restaurant application.

* Rooms panel with table counts, "all tables" view, status filters
* Tables colored by status: free, occupied (items to send to the kitchen),
  service in progress, reserved, unavailable - with elapsed time and guests
* Active tables panel with amount and elapsed time, legend
* Plan / list views, zoom, floor background picture
* New order, merge tables, move a table, free a table, show the bill
* Simple reservations (name, time, guests) and unavailable tables
""",
    'author': 'GARESE',
    'website': 'https://www.facebook.com/profile.php?id=61567181736290',
    'license': 'OPL-1',
    'depends': ['garese_pos', 'pos_restaurant'],
    'data': [
        'views/restaurant_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'garese_pos_restaurant/static/src/app/**/*',
            'garese_pos_restaurant/static/src/scss/garese_pos_restaurant.scss',
        ],
    },
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': False,
    # Installed automatically as soon as GARESE POS and Restaurant are both there.
    'auto_install': True,
}
