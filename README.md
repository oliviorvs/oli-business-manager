# Gestion Entreprise — Application Desktop (Electron)

Application de bureau pour centraliser la gestion des ventes, des services
(impression, photocopie, cybercafé, wifi zone…), des stocks, des achats,
des dépenses et de la trésorerie.

## Installation

Prérequis : [Node.js](https://nodejs.org) 22.12 ou plus récent (installe `npm`).

```bash
cd oli-business-manager
npm install
npm start
```

La base de données est SQLite (`better-sqlite3`),`better-sqlite3` est un module natif : sur un
poste sans compilateur C++ disponible, `npm install` peut nécessiter les
outils de compilation habituels de Node.js (`windows-build-tools` /
Visual Studio Build Tools sous Windows, Xcode Command Line Tools sous
macOS, `build-essential` sous Linux) si un binaire précompilé n'est pas
disponible pour la plateforme cible.


## Modules livrés dans cette version

- Authentification par rôle (Administrateur / Gestionnaire / Caissier)
- **Mon compte** : chaque utilisateur (y compris l'administrateur) peut modifier
  son propre nom, prénom, e-mail et mot de passe depuis la barre latérale
- Tableau de bord avec indicateurs clés et graphiques interactifs Chart.js
  (chiffre d'affaires sur 14 jours, recettes vs dépenses, solde de trésorerie
  sur 6 mois et valeurs détaillées au survol)
- Chart.js est fourni localement dans `vendor/chart.js` et inclus dans les
  exécutables ; il n'est pas téléchargé depuis `node_modules` à l'exécution.
- Clients (fiche, historique des achats/prestations)
- Fournisseurs
- Catégories et produits (avec unité de mesure et seuils d'alerte de stock)
- Mouvements de stock (entrées, sorties, ajustements/inventaire)
- Achats (bon d'achat → mise à jour automatique du stock)
- **Ventes combinées** : une seule facture peut mélanger des produits (avec
  impact sur le stock) et des services/prestations (sans impact stock), en un
  seul encaissement — un client peut par exemple acheter une ramette de
  papier ET une impression dans la même opération
- Facture imprimable
- Services / prestations (impression, photocopie, cybercafé, etc.) — la page
  Services reste disponible pour une prestation rapide isolée
- Dépenses par catégorie
- Trésorerie (recettes − dépenses, par période)
- Rapports (ventes, dépenses, achats, stocks, services, produits, clients,
  fournisseurs, rentabilité) avec export CSV
- Gestion des utilisateurs et des rôles
- **Paramètres** (admin) : coordonnées de l'entreprise, logo, ville, nom du
  gérant — tout ce qui apparaît sur le modèle de facture est modifiable
- Journal d'activité (connexions, créations, modifications, suppressions)
- Sauvegarde / restauration manuelle de la base
- **Thème clair / sombre**
- **Dernier nom d'utilisateur mémorisé**
- **Écran de connexion peaufiné**
- **Facture groupée**
- **Filtre par date sur Services**
- **Montant total filtré affiché**e.
- **Rapport Services simplifié**
- **Journal d'activité plus lisible**
- **Bon de livraison**
- **Factures pro-forma (devis)**
- **Sauvegarde/restauration mise en avant** : nouvelle page dédiée
- **États financiers** : nouveau type de rapport dans Rapports → *État
- **Numérotation des factures et bons d'achat** : format `001-0726`
- **Filtres Ventes / Achats** : par statut (Payé / Impayé / Annulé) et par
  plage de dates.
- **Format d'impression de la facture au choix** : A4 pleine page, ou deux
  copies A5 portrait imprimées côte à côte sur une même page A4
- **Annulation vs suppression définitive**

## Où sont stockées les données ?

Le fichier `db.sqlite` (base SQLite, voir §1) est stocké dans le dossier
utilisateur de l'application (hors du dossier du projet, pour survivre aux
mises à jour de code) :

- Windows : `%APPDATA%\oli-businesss-manager\data\db.sqlite`
- macOS : `~/Library/Application Support/oli-businesss-manager/data/db.sqlite`
- Linux : `~/.config/oli-businesss-manager/data/db.sqlite`

Utilisez le module dédié **Sauvegarde** (menu Administration, accessible à
l'administrateur) pour exporter ou réimporter une copie de sécurité en un
clic ; une copie de secours automatique est créée avant toute
restauration.

## Rôles et permissions

| Module | Administrateur | Gestionnaire | Caissier |
|---|---|---|---|
| Tableau de bord | ✔ | ✔ | ✔ |
| Ventes | ✔ | — | ✔ (création/consultation) |
| Services | ✔ | ✔ | ✔ |
| Clients | ✔ | ✔ | ✔ |
| Produits / Catégories | ✔ | ✔ | — |
| Stocks | ✔ | ✔ | — |
| Achats / Fournisseurs | ✔ | ✔ | — |
| Dépenses | ✔ | ✔ | — |
| Trésorerie | ✔ | — | — |
| Rapports | ✔ | ✔ | — |
| Utilisateurs / Journal / Sauvegarde | ✔ | — | — |

## Construire un exécutable (.exe / .dmg / .AppImage)

```bash
npm run dist
```

Le paquet `electron-builder` doit être installé (`npm install`, déjà listé
dans les dépendances de développement) et nécessite une connexion internet
la première fois pour télécharger les binaires Electron correspondant à
votre plateforme cible.

La base de données utilise `better-sqlite3` 13 et ses binaires Node-API
précompilés. Le rebuild natif d'Electron n'est pas nécessaire.
