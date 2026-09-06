export const CURRENCY = 'Ar';

// ------------------------- Utilitaires DOM -------------------------
export const ICONS = {
  personne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  carte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  panier: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  calculatrice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><circle cx="8" cy="11" r="0.7" fill="currentColor" stroke="none"/><circle cx="12" cy="11" r="0.7" fill="currentColor" stroke="none"/><circle cx="16" cy="11" r="0.7" fill="currentColor" stroke="none"/><circle cx="8" cy="15" r="0.7" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="0.7" fill="currentColor" stroke="none"/><circle cx="16" cy="15" r="0.7" fill="currentColor" stroke="none"/></svg>',
  panier2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  poubelle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
};
// Entête de section numérotée (icône + titre), utilisée dans les formulaires
// de vente et de facture pro-forma pour reprendre la présentation des
// maquettes fournies (sections « 1. CLIENT », « 2. OBJET », etc.).
export const NOTIF_ICONS = { success: '✓', error: '✕', warn: '!', info: 'i' };
export const VALIDATORS = {
  email: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  positive: (v) => v !== '' && Number(v) > 0,
  nonNegative: (v) => v !== '' && Number(v) >= 0,
  required: (v) => String(v || '').trim().length > 0
};
export const VALIDATION_MESSAGES = {
  email: 'Adresse e-mail invalide',
  positive: 'Doit être un nombre supérieur à 0',
  nonNegative: 'Doit être un nombre positif ou nul',
  required: 'Ce champ est obligatoire'
};
export const PAGE_SIZES = [10, 20, 50];
export const NAV = [
  { group: 'Aperçu', items: [ { key: 'dashboard', label: 'Tableau de bord', icon: '◆', module: 'dashboard' } ] },
  { group: 'Opérations', items: [
    { key: 'ventes', label: 'Ventes', icon: '$', module: 'ventes' },
    { key: 'proformas', label: 'Pro-forma', icon: '≣', module: 'proformas' },
    { key: 'livraisons', label: 'Livraisons', icon: '⇒', module: 'livraisons' },
    { key: 'services', label: 'Services', icon: '✎', module: 'services' },
    { key: 'clients', label: 'Clients', icon: '☺', module: 'clients' }
  ] },
  { group: 'Stocks & Achats', items: [
    { key: 'produits', label: 'Produits', icon: '▣', module: 'produits' },
    { key: 'stocks', label: 'Mouvements de stock', icon: '↕', module: 'stocks' },
    { key: 'achats', label: 'Achats', icon: '⇩', module: 'achats' },
    { key: 'fournisseurs', label: 'Fournisseurs', icon: '⌂', module: 'fournisseurs' },
    // CORRECTIF (audit — bug n°2) : entrée de menu manquante pour l'écran de
    // gestion des nomenclatures. Rattachée au module 'produits' (même
    // permission que le backend, qui appelle requireModule('produits') dans
    // recette.service.js) pour être visible aux mêmes rôles.
    { key: 'recettes', label: 'Nomenclatures', icon: '⚗', module: 'produits' }
  ] },
  { group: 'Finance', items: [
    { key: 'depenses', label: 'Dépenses', icon: '−', module: 'depenses' },
    { key: 'tresorerie', label: 'Trésorerie', icon: '≡', module: 'tresorerie' },
    { key: 'rapports', label: 'Rapports', icon: '▤', module: 'rapports' }
  ] },
  { group: 'Administration', items: [
    // AJOUT (demande client) : "Utilisateurs", "Plan de comptes" et
    // "Sauvegarde" sont désormais regroupés en sections (avec modales pour
    // la modification) à l'intérieur de la page "Paramètres" plutôt que
    // d'occuper chacun une entrée de menu séparée — voir parametres.js.
    { key: 'parametres', label: 'Paramètres', icon: '✦', module: 'parametres' },
    { key: 'journal', label: "Journal d'activité", icon: '▦', module: 'journal' }
  ] }
];

export const ROLE_MODULES = {
  admin: null, // null = accès total
  // CORRECTIF (bug) : 'ventes', 'proformas' et 'livraisons' manquaient ici,
  // ce qui masquait ces entrées de menu au gestionnaire ET faisait échouer
  // les appels correspondants côté serveur (voir ROLE_PERMISSIONS.gestionnaire
  // dans src/services/auth.service.js, à garder synchronisé avec cette liste).
  gestionnaire: ['dashboard', 'ventes', 'proformas', 'livraisons', 'stocks', 'produits', 'achats', 'fournisseurs', 'rapports', 'clients', 'services', 'depenses'],
  // AJOUT (demande client) : "dashboard" ré-autorisé pour le caissier, avec un
  // affichage volontairement restreint (voir renderDashboardCaissier dans
  // dashboard.js). CORRECTIF : "tresorerie" retiré du rôle Caissier (voir
  // aussi auth.service.js#ROLE_PERMISSIONS) — ce module reste réservé à
  // l'administrateur, conformément au tableau des permissions du README.
  caissier: ['dashboard', 'ventes', 'proformas', 'livraisons', 'services', 'clients']
};

export const MODULE_NEW_BTN = {
  ventes: '#btn-new-vente', clients: '#btn-new-client', produits: '#btn-new-p', achats: '#btn-new-achat',
  proformas: '#btn-new-proforma', fournisseurs: '#btn-new-f', stocks: '#btn-new-mv', services: '#btn-new-prestation',
  depenses: '#btn-new-depense', recettes: '#btn-new-recette'
};
export const NUM_UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
export const NUM_DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
export const CATEGORIES_DEPENSE = ['Loyer', 'Électricité', 'Eau', 'Internet', 'Salaires', 'Transport', 'Carburant', 'Achat de marchandises', 'Maintenance', 'Divers'];

export const RAPPORT_TYPES = [
  { key: 'etatFinancier', label: 'État financier' },
  { key: 'ventes', label: 'Ventes' }, { key: 'depenses', label: 'Dépenses' }, { key: 'achats', label: 'Achats' },
  { key: 'stocks', label: 'Stocks' }, { key: 'services', label: 'Services (prestations)' }, { key: 'produits', label: 'Produits' },
  { key: 'clients', label: 'Clients' }, { key: 'fournisseurs', label: 'Fournisseurs' }, { key: 'rentabilite', label: 'Rentabilité' },
  { key: 'servicesEtProduits', label: 'Services et produits vendus (PDF)' },
  { key: 'exportComptable', label: 'Export comptable (journal)' }
];

