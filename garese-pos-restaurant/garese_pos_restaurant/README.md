# GARESE POS - Restaurant (`garese_pos_restaurant`) — Odoo 17.0 — version 17.0.1.1.0

Plan de salle redessiné pour le Point de Vente Odoo 17 en mode Restaurant.
Module **compagnon** : il dépend de `garese_pos` et de l'application standard Restaurant
(`pos_restaurant`) et s'installe automatiquement dès que les deux sont présents. Un point de
vente « boutique » n'est pas concerné.

## Installation

1. Copier les dossiers `garese_pos` (17.0.1.3.0 minimum) et `garese_pos_restaurant` dans les addons.
2. Redémarrer Odoo, « Mettre à jour la liste des applications ».
3. Mettre à jour `garese_pos` (`-u garese_pos`) : `garese_pos_restaurant` s'installe seul si
   Restaurant est installé. Sinon, l'installer depuis Applications.
4. Fermer et rouvrir la session du point de vente.

## Ce que fait le module

| Zone | Contenu |
|---|---|
| Barre supérieure | « Rechercher une table… » (nom de table, salle, nom de réservation) |
| Panneau gauche | Salles avec nombre de tables, « Toutes les tables », filtres Tous / Libres / Occupées / En cours / Réservées / Indisponibles avec compteurs |
| Plan | Tables colorées par état, couverts / places, temps écoulé, heure de réservation ; plan ajusté à l'écran, zoom, pleine largeur, image de fond de la salle |
| Vue Liste | Cartes par table (état, temps, montant, réservation) ; « Toutes les tables » regroupe les salles |
| Barre d'actions | Nouvelle commande, Fusionner des tables, Déplacer une table, Libérer la table, Afficher la facture, Réserver, Indisponible |
| Panneau droit | Tables actives (salle, couverts, temps, montant, À envoyer / En cours), légende |

### États des tables

| Couleur | État | Règle |
|---|---|---|
| Vert | Table libre | aucune commande ouverte |
| Rouge | Table occupée | commande ouverte avec des articles **pas encore envoyés en cuisine** (ou clients installés sans article) |
| Orange | En cours de service | tout a été envoyé en cuisine (bouton « Commander ») |
| Bleu | Table réservée | réservation dont l'heure approche (délai réglable) |
| Gris | Table indisponible | table mise hors service |

L'état est recalculé à chaque changement de commande et diffusé à toutes les caisses du même
plan (bus Odoo), avec une relecture toutes les 2 minutes en secours.

### Actions

Toucher une action, puis la ou les tables (un bandeau guide le serveur ; « Annuler » pour sortir).
Toucher directement une table l'ouvre, comme en standard.

- **Nouvelle commande** : ouvre la table ; si elle a déjà une commande, en ouvre une seconde.
- **Fusionner des tables** : table à vider, puis table qui reçoit. Les lignes gardent leur identité :
  ce qui est déjà parti en cuisine n'est pas renvoyé. Les couverts sont additionnés.
- **Déplacer une table** : change les clients de table (commande ou simple réservation).
- **Libérer la table** : annule la commande sans paiement — **réservé aux responsables** dès que la
  commande contient des articles, avec confirmation. Sert aussi à annuler une réservation ou à
  remettre une table en service.
- **Afficher la facture** : addition de la table (ticket « Addition »), sans quitter le plan.
- **Réserver** : nom, date, heure, couverts. Toucher une table réservée propose d'installer les clients.
- **Indisponible** : bloque ou remet en service une table sans commande.
- **Serveur(se)** (si l'option est activée) : affecte un serveur ou une serveuse à la table.

### Serveur(se) d'une table

Avec l'option « Serveur(se) sur les commandes » de GARESE POS :

- une table peut avoir un(e) serveur(se) attitré(e) (action « Serveur(se) » du plan, ou fiche de la
  table) : il ou elle est repris(e) sur chaque nouvelle commande de la table ;
- avec « Obligatoire avant le paiement », le point de vente demande qui sert la table dès son
  ouverture si elle n'a pas de serveur(se) attitré(e) ;
- le prénom apparaît sur la tuile de la table, le nom complet dans la vue Liste et les tables actives ;
- le panneau de gauche filtre le plan par serveur(se) ; la recherche trouve aussi par nom ;
- changer le serveur d'une table depuis le plan met aussi à jour ses commandes ouvertes.

## Paramétrage

- **Image du plan** : Point de Vente > Configuration > Plans d'étage > salle > « Image du plan de salle ».
  1 pixel de l'image = 1 pixel du plan ; placer ensuite les tables avec « Modifier le plan ».
  Sans image, le plan utilise un fond neutre.
- **Réservations** : Paramètres du point de vente > GARESE POS > « Réservations de tables » :
  blocage de la table X minutes avant l'heure (120 par défaut ; 0 = dès le début de la journée) et
  libération X minutes après si les clients ne viennent pas (60 par défaut ; 0 = jamais).

## Points techniques

- Extensions ciblées de `pos_restaurant.FloorScreen` et `pos_restaurant.Table` ; « Modifier le plan »
  et l'affichage téléphone (`ui.isSmall`) restent ceux d'Odoo.
- Les serveurs n'ont qu'un accès en lecture sur les tables : réservation et disponibilité passent par
  des méthodes dédiées (`gp_set_reservation`, `gp_clear_reservation`, `gp_set_unavailable`).
- La charge utile standard `get_tables_order_count_and_printing_changes` est enrichie (montant,
  couverts, heure de la plus ancienne commande, réservation, disponibilité).
- Toute écriture sur l'état d'une table (réservation, disponibilité, serveur), depuis le point de
  vente comme depuis le back-office, est diffusée aux caisses.
- Le transfert standard depuis l'écran de commande (« Transfert ») est conservé.

Licence OPL-1 — © GARESE.
