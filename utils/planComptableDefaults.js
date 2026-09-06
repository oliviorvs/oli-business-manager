// PHASE 3 — PLAN DE COMPTES : valeurs par défaut (PCG 2005)
// ============================================================

const CATEGORIES_DEPENSE = ['Loyer', 'Électricité', 'Eau', 'Internet', 'Salaires', 'Transport', 'Carburant', 'Achat de marchandises', 'Maintenance', 'Divers'];

const COMPTES_DEPENSE_DEFAUT = {
  'Loyer': { numeroCompte: '613200', intitule: 'Locations' },
  'Électricité': { numeroCompte: '606122', intitule: 'Électricité' },
  'Eau': { numeroCompte: '606121', intitule: 'Eau' },
  'Internet': { numeroCompte: '626000', intitule: 'Frais postaux et de télécommunications' },
  'Salaires': { numeroCompte: '641000', intitule: 'Rémunérations du personnel' },
  'Transport': { numeroCompte: '624000', intitule: 'Transports de biens et transports collectifs du personnel' },
  'Carburant': { numeroCompte: '606020', intitule: 'Carburant' },
  'Achat de marchandises': { numeroCompte: '607000', intitule: 'Achats de marchandises' },
  'Maintenance': { numeroCompte: '615000', intitule: 'Entretien et réparations' },
  'Divers': { numeroCompte: '658000', intitule: 'Charges diverses de gestion courante' }
};

// Comptes "fixes" (hors dépenses), identifiés par une clé technique stable
// (`categorieInterne`) que le générateur d'écritures (voir
// src/services/ecritureComptable.service.js) utilise pour retrouver le bon
// compte, indépendamment du numéro/intitulé réellement choisi par le
// comptable (modifiable depuis l'écran Paramètres > Plan de comptes).
const COMPTES_FIXES_DEFAUT = [
  { categorieInterne: 'ventes_produits', libelle: 'Ventes de produits', numeroCompte: '707000', intitule: 'Ventes de marchandises' },
  { categorieInterne: 'ventes_services', libelle: 'Ventes de services', numeroCompte: '706000', intitule: 'Prestations de services' },
  { categorieInterne: 'achats_marchandises', libelle: 'Achats de marchandises', numeroCompte: '607000', intitule: 'Achats de marchandises' },
  { categorieInterne: 'clients', libelle: 'Clients', numeroCompte: '411000', intitule: 'Clients' },
  { categorieInterne: 'fournisseurs', libelle: 'Fournisseurs', numeroCompte: '401000', intitule: 'Fournisseurs' },
  { categorieInterne: 'caisse', libelle: 'Caisse', numeroCompte: '530000', intitule: 'Caisse' },
  { categorieInterne: 'banque', libelle: 'Banque', numeroCompte: '512000', intitule: 'Banques' },
  // SYSTÈME TVA : comptes de ventilation de la TVA collectée (sur ventes)
  // et déductible (sur achats), utilisés par
  // src/services/ecritureComptable.service.js dès qu'une vente/un achat
  // comporte un montant de TVA (v.totalVat / a.totalVat > 0). Ajoutés
  // automatiquement à toute base existante par
  // planComptable.service.js#_assurerComptesParDefaut, sans jamais toucher
  // un compte déjà personnalisé par l'utilisateur — comme les comptes
  // ci-dessus.
  { categorieInterne: 'tva_collectee', libelle: 'TVA collectée', numeroCompte: '445710', intitule: 'TVA collectée' },
  { categorieInterne: 'tva_deductible', libelle: 'TVA déductible', numeroCompte: '445660', intitule: 'TVA déductible sur autres biens et services' }
];

// Clé technique utilisée pour une catégorie de dépense donnée (préfixe
// "depense:" pour ne jamais entrer en collision avec les clés fixes
// ci-dessus, même si une future catégorie de dépense s'appelait "clients").
function cleDepense(nomCategorie) {
  return 'depense:' + nomCategorie;
}

function listeComptesParDefaut() {
  const comptesDepense = CATEGORIES_DEPENSE.map((nom) => {
    const d = COMPTES_DEPENSE_DEFAUT[nom] || { numeroCompte: '658000', intitule: 'Charges diverses de gestion courante' };
    return { categorieInterne: cleDepense(nom), libelle: 'Dépense — ' + nom, numeroCompte: d.numeroCompte, intitule: d.intitule };
  });
  return COMPTES_FIXES_DEFAUT.concat(comptesDepense).map((c) => Object.assign({ actif: true }, c));
}

module.exports = { CATEGORIES_DEPENSE, cleDepense, listeComptesParDefaut };
