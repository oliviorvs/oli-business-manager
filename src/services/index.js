// src/services/index.js
const authService = require('./auth.service');
const clientService = require('./client.service');
const fournisseurService = require('./fournisseur.service');
const categorieService = require('./categorie.service');
const produitService = require('./produit.service');
const stockService = require('./stock.service');
const achatService = require('./achat.service');
const venteService = require('./vente.service');
const proformaService = require('./proforma.service');
const livraisonService = require('./livraison.service');
const serviceService = require('./service.service');
const prestationService = require('./prestation.service');
const depenseService = require('./depense.service');
const tresorerieService = require('./tresorerie.service');
const rapportService = require('./rapport.service');
const utilisateurService = require('./utilisateur.service');
const journalService = require('./journal.service');
const parametreService = require('./parametre.service');
const backupService = require('./backup.service');
const planComptableService = require('./planComptable.service');
const ecritureComptableService = require('./ecritureComptable.service');
const recetteService = require('./recette.service');
const consommationService = require('./consommation.service');
const setupService = require('./setup.service');

module.exports = {
  authService,
  setupService,
  clientService,
  fournisseurService,
  categorieService,
  produitService,
  stockService,
  achatService,
  venteService,
  proformaService,
  livraisonService,
  serviceService,
  prestationService,
  depenseService,
  tresorerieService,
  rapportService,
  utilisateurService,
  journalService,
  parametreService,
  backupService,
  planComptableService,
  ecritureComptableService,
  recetteService,
  consommationService
};