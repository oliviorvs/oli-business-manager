// src/services/ecritureComptable.service.js
//
// PHASE 3 — GÉNÉRATEUR D'ÉCRITURES COMPTABLES
// ============================================================
// Transforme les transactions déjà enregistrées dans l'application (ventes,
// achats, dépenses, encaissements/règlements ultérieurs) en écritures
// comptables en partie double (une ligne au débit, une ou plusieurs au
// crédit, pour un même montant total), en s'appuyant sur le plan de
// comptes (voir planComptable.service.js) pour savoir sur quel compte
// imputer chaque catégorie interne.
//
// CAS COUVERTS (voir la checklist Phase 3) :
//  - vente comptant / vente à crédit / vente à crédit avec encaissement
//    partiel dès la création
//  - encaissement ultérieur d'une vente à crédit (via ventes:payer)
//  - achat comptant / achat à crédit / achat à crédit avec paiement
//    partiel dès la création
//  - règlement fournisseur ultérieur d'un achat à crédit (via achats:payer)
//  - dépense
//
// Les ventes/achats ANNULÉS sont exclus (même logique que les autres
// rapports, voir rapport.service.js) : une transaction annulée ne doit
// jamais générer d'écriture, ses éventuelles écritures de trésorerie
// d'origine étant sans objet une fois annulées.
//
// IMPORTANT — MODE DE PAIEMENT DES ACHATS : achats.service.js ne stocke pas
// de `modePaiement` (contrairement aux ventes et aux dépenses). Faute de
// cette information, tout règlement d'achat (comptant ou ultérieur) est
// imputé par défaut sur le compte "Caisse" — à corriger manuellement dans
// le tableur exporté si le règlement a en réalité transité par la banque.
const { requireModule } = require('./auth.service');
const planComptableService = require('./planComptable.service');
const { debutJourUTC, finJourUTC } = require('../../utils/helpers');

function compteDe(comptesByCategorie, cle, libelleSecours) {
  const c = comptesByCategorie.get(cle);
  if (c) return { numero: c.numeroCompte, intitule: c.intitule };
  // Compte non configuré (ex. nouvelle catégorie de dépense créée après le
  // dernier passage sur l'écran Plan de comptes) : on ne bloque jamais la
  // génération du journal pour autant — on signale clairement la ligne
  // pour que l'utilisateur configure le compte manquant avant l'export réel.
  return { numero: '(à configurer)', intitule: libelleSecours };
}

function compteTresorerieVente(comptesByCategorie, modePaiement) {
  // CONVENTION : "espèces" est imputé en Caisse, tout autre mode de
  // paiement (mobile money, carte, virement, mixte) en Banque.
  return modePaiement === 'especes'
    ? compteDe(comptesByCategorie, 'caisse', 'Caisse')
    : compteDe(comptesByCategorie, 'banque', 'Banque');
}

function dateEnBornes(dateStr, start, end) {
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

// CORRECTIF IMPORTANT : v.montantPaye / a.montantPaye reflètent le montant
// CUMULÉ payé à ce jour (mis à jour aussi bien à la création qu'à chaque
// paiement ultérieur via ventes:payer/achats:payer — voir ces services).
// Utiliser directement ce champ pour construire l'écriture de facturation
// ferait donc DOUBLE EMPLOI avec les paiements ultérieurs, déjà comptabilisés
// séparément plus bas (sections "encaissements/règlements ultérieurs") :
// un règlement reçu après la création serait alors débité une fois dans
// l'écriture de vente/achat (via ce champ déjà mis à jour) ET une seconde
// fois dans son écriture d'encaissement dédiée.
//
// Le montant réellement encaissé/décaissé AU MOMENT DE LA CRÉATION est
// retrouvé via l'unique écriture de trésorerie posée par vente.service.js
// (description exacte "Encaissement vente") ou achat.service.js
// (description exacte "Paiement fournisseur") au moment de l'insertion —
// à distinguer des règlements ultérieurs, qui portent un descriptif
// "Règlement client — …" / "Règlement fournisseur — …".
// CORRECTIF PERF (audit) : cette fonction était auparavant un `.find()`
// relançant un scan linéaire de la totalité de `opsTresorerie` pour CHAQUE
// vente puis pour CHAQUE achat de la période — un coût O(ventes ×
// opsTresorerie + achats × opsTresorerie). Sur un volume proche du réel
// (5 000 ventes / 5 000 opérations de trésorerie), mesuré à ~120 ms rien que
// pour la boucle ventes ; le tout est répété une seconde fois pour les
// achats, et s'aggrave avec le nombre d'opérations de trésorerie (règlements
// ultérieurs, dépenses...), qui dépasse en pratique le nombre de ventes.
// Ce coût s'ajoutait intégralement à chaque appel de rapports:generer
// (type exportComptable) et rapports:exporterComptableXlsx, y compris sous
// store.withReadCache() — le cache de lecture n'accélère que les
// store.list(), pas cette recherche en O(n×m) faite ensuite en JS pur.
// Remplacé par un index construit UNE SEULE FOIS (Map clé composite ->
// montant), ramenant chaque lookup à O(1) — mesuré à ~10 ms sur le même jeu
// de données, soit tout le calcul en une fraction du temps précédent.
function indexerMontantsInitiaux(opsTresorerie) {
  const index = new Map();
  for (const o of opsTresorerie) {
    index.set(`${o.categorie}|${o.reference}|${o.description}`, o.montant);
  }
  return index;
}

function montantInitial(indexOps, categorie, descriptionExacte, numero) {
  return indexOps.get(`${categorie}|${numero}|${descriptionExacte}`) || 0;
}

// Construit une écriture (un groupe de lignes en partie double équilibré)
// à partir d'une liste de lignes { compte: {numero, intitule}, debit, credit }.
function ecriture({ date, journal, piece, libelle, lignes }) {
  return { date, journal, piece, libelle, lignes: lignes.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0) };
}

async function genererEcritures(store, { debut, fin } = {}) {
  requireModule('rapports');
  // CORRECTIF (audit — nouvelle passe, bug n°1) : `end.setHours(23, 59, 59, 999)`
  // utilisait l'heure LOCALE du poste alors que `start` est interprété en UTC
  // minuit — sur un poste en UTC+3 (Madagascar), l'export comptable en partie
  // double pouvait inclure/exclure des transactions de façon incohérente selon
  // le fuseau. Bornes désormais calées en UTC, comme le reste de l'application.
  const start = debut ? debutJourUTC(new Date(debut)) : new Date(0);
  const end = fin ? finJourUTC(new Date(fin)) : finJourUTC(new Date());

  await planComptableService._assurerComptesParDefaut(store);
  const comptes = await store.list('planComptable');
  const comptesByCategorie = new Map(comptes.map((c) => [c.categorieInterne, c]));

  const [ventesList, achatsList, depensesList, opsTresorerie, clientsList, fournisseursList] = await Promise.all([
    store.list('ventes'),
    store.list('achats'),
    store.list('depenses'),
    store.list('operationsTresorerie'),
    store.list('clients'),
    store.list('fournisseurs')
  ]);
  const ventesByNumero = new Map(ventesList.map((v) => [v.numero, v]));
  const achatsByNumero = new Map(achatsList.map((a) => [a.numero, a]));
  const clientsById = new Map(clientsList.map((c) => [c.id, c]));
  const fournisseursById = new Map(fournisseursList.map((f) => [f.id, f]));
  // CORRECTIF PERF (audit) : index construit une seule fois, voir
  // indexerMontantsInitiaux() ci-dessus.
  const indexMontantsInitiaux = indexerMontantsInitiaux(opsTresorerie);

  const ecritures = [];

  // ---------------------- VENTES (comptant / à crédit) ----------------------
  for (const v of ventesList) {
    if (v.statut === 'annulee') continue;
    if (!dateEnBornes(v.createdAt, start, end)) continue;
    const ventesProduits = Math.round(v.lignes.filter((l) => l.kind === 'produit').reduce((s, l) => s + l.sousTotal, 0) * 100) / 100;
    const ventesServices = Math.round(v.lignes.filter((l) => l.kind === 'service').reduce((s, l) => s + l.sousTotal, 0) * 100) / 100;
    const total = v.total;
    const montantPaye = montantInitial(indexMontantsInitiaux, 'Vente', 'Encaissement vente', v.numero);
    const compteTresorerie = compteTresorerieVente(comptesByCategorie, v.modePaiement);
    const compteClients = compteDe(comptesByCategorie, 'clients', 'Clients');
    const compteVP = compteDe(comptesByCategorie, 'ventes_produits', 'Ventes de produits');
    const compteVS = compteDe(comptesByCategorie, 'ventes_services', 'Ventes de services');
    // SYSTÈME TVA (validé avec l'utilisateur) : la TVA collectée sur les
    // ventes est ventilée sur un compte dédié plutôt que noyée dans les
    // comptes de vente. `ventesProduits`/`ventesServices` ci-dessus sont
    // déjà des sommes de `l.sousTotal`, qui est désormais le HT de chaque
    // ligne (voir vente.service.js) — ils représentent donc déjà le chiffre
    // d'affaires HT sans aucun changement à faire ici. Il ne manque que la
    // ligne de crédit TVA collectée pour équilibrer avec `total` (TTC) au
    // débit. Pour une vente antérieure à ce système (v.totalVat absent),
    // aucune ligne n'est ajoutée — comportement inchangé.
    const compteTvaCollectee = compteDe(comptesByCategorie, 'tva_collectee', 'TVA collectée');
    const clientNom = v.clientId ? (clientsById.get(v.clientId) ? [clientsById.get(v.clientId).nom, clientsById.get(v.clientId).prenom].filter(Boolean).join(' ') : 'Client') : (v.clientNom || 'Vente au comptant');

    const lignesCredit = [];
    if (ventesProduits > 0) lignesCredit.push({ compte: compteVP, credit: ventesProduits });
    if (ventesServices > 0) lignesCredit.push({ compte: compteVS, credit: ventesServices });
    if (v.totalVat > 0) lignesCredit.push({ compte: compteTvaCollectee, credit: Math.round(v.totalVat * 100) / 100 });

    let type, lignesDebit;
    if (montantPaye <= 0) {
      type = 'Vente à crédit';
      lignesDebit = [{ compte: compteClients, debit: total }];
    } else if (Math.round(montantPaye * 100) >= Math.round(total * 100)) {
      type = 'Vente au comptant';
      lignesDebit = [{ compte: compteTresorerie, debit: total }];
    } else {
      type = 'Vente à crédit (encaissement partiel)';
      lignesDebit = [
        { compte: compteTresorerie, debit: Math.round(montantPaye * 100) / 100 },
        { compte: compteClients, debit: Math.round((total - montantPaye) * 100) / 100 }
      ];
    }
    ecritures.push(ecriture({
      date: v.createdAt, journal: 'VE', piece: v.numero,
      libelle: `${type} ${v.numero} — ${clientNom}`,
      lignes: [...lignesDebit, ...lignesCredit]
    }));
  }

  // ---------------------- ENCAISSEMENTS ULTÉRIEURS (ventes:payer) ----------------------
  const compteClientsGeneric = compteDe(comptesByCategorie, 'clients', 'Clients');
  for (const o of opsTresorerie) {
    if (o.categorie !== 'Vente' || !/^Règlement client/.test(o.description || '')) continue;
    if (!dateEnBornes(o.createdAt, start, end)) continue;
    const vente = ventesByNumero.get(o.reference);
    const compteTresorerie = compteTresorerieVente(comptesByCategorie, vente ? vente.modePaiement : 'especes');
    ecritures.push(ecriture({
      date: o.createdAt, journal: 'BQ', piece: o.reference || '',
      libelle: `Encaissement client — ${o.reference || ''}`,
      lignes: [
        { compte: compteTresorerie, debit: o.montant },
        { compte: compteClientsGeneric, credit: o.montant }
      ]
    }));
  }

  // ---------------------- ACHATS (comptant / à crédit) ----------------------
  const compteCaisseAchat = compteDe(comptesByCategorie, 'caisse', 'Caisse'); // voir note en tête de fichier
  const compteFournisseurs = compteDe(comptesByCategorie, 'fournisseurs', 'Fournisseurs');
  const compteAchats = compteDe(comptesByCategorie, 'achats_marchandises', 'Achats de marchandises');
  // SYSTÈME TVA : voir la note équivalente côté ventes ci-dessus.
  const compteTvaDeductible = compteDe(comptesByCategorie, 'tva_deductible', 'TVA déductible');
  for (const a of achatsList) {
    if (a.statut === 'annulee') continue;
    if (!dateEnBornes(a.createdAt, start, end)) continue;
    const total = a.total;
    const montantPaye = montantInitial(indexMontantsInitiaux, 'Achat de marchandises', 'Paiement fournisseur', a.numero);
    const fournisseurNom = fournisseursById.get(a.fournisseurId)?.nom || 'Fournisseur';

    // SYSTÈME TVA : le débit se ventile désormais entre le compte d'achat
    // (HT — a.totalHT) et la TVA déductible (a.totalVat), au lieu d'un
    // unique débit au TTC. Pour un achat antérieur à ce système (a.totalHT
    // absent), on retombe sur l'ancien comportement (débit unique = total).
    const achatHT = a.totalHT != null ? Math.round(a.totalHT * 100) / 100 : total;
    const achatTva = a.totalVat != null ? Math.round(a.totalVat * 100) / 100 : 0;
    const lignesDebit = [{ compte: compteAchats, debit: achatHT }];
    if (achatTva > 0) lignesDebit.push({ compte: compteTvaDeductible, debit: achatTva });

    let type, lignesCredit;
    if (montantPaye <= 0) {
      type = 'Achat à crédit';
      lignesCredit = [{ compte: compteFournisseurs, credit: total }];
    } else if (Math.round(montantPaye * 100) >= Math.round(total * 100)) {
      type = 'Achat au comptant';
      lignesCredit = [{ compte: compteCaisseAchat, credit: total }];
    } else {
      type = 'Achat à crédit (paiement partiel)';
      lignesCredit = [
        { compte: compteCaisseAchat, credit: Math.round(montantPaye * 100) / 100 },
        { compte: compteFournisseurs, credit: Math.round((total - montantPaye) * 100) / 100 }
      ];
    }
    ecritures.push(ecriture({
      date: a.createdAt, journal: 'AC', piece: a.numero,
      libelle: `${type} ${a.numero} — ${fournisseurNom}`,
      lignes: [...lignesDebit, ...lignesCredit]
    }));
  }

  // ---------------------- RÈGLEMENTS FOURNISSEURS ULTÉRIEURS (achats:payer) ----------------------
  for (const o of opsTresorerie) {
    if (o.categorie !== 'Achat de marchandises' || !/^Règlement fournisseur/.test(o.description || '')) continue;
    if (!dateEnBornes(o.createdAt, start, end)) continue;
    ecritures.push(ecriture({
      date: o.createdAt, journal: 'BQ', piece: o.reference || '',
      libelle: `Règlement fournisseur — ${o.reference || ''}`,
      lignes: [
        { compte: compteFournisseurs, debit: o.montant },
        { compte: compteCaisseAchat, credit: o.montant }
      ]
    }));
  }

  // ---------------------- DÉPENSES ----------------------
  for (const d of depensesList) {
    const dateRef = d.date || d.createdAt;
    if (!dateEnBornes(dateRef, start, end)) continue;
    const compteCharge = compteDe(comptesByCategorie, 'depense:' + d.categorie, d.categorie);
    const compteTresorerie = d.modePaiement === 'especes'
      ? compteDe(comptesByCategorie, 'caisse', 'Caisse')
      : compteDe(comptesByCategorie, 'banque', 'Banque');
    ecritures.push(ecriture({
      date: dateRef, journal: 'DE', piece: 'DEP-' + String(d.id).slice(-6).toUpperCase(),
      libelle: `Dépense — ${d.categorie}${d.commentaire ? ' — ' + d.commentaire : ''}`,
      lignes: [
        { compte: compteCharge, debit: d.montant },
        { compte: compteTresorerie, credit: d.montant }
      ]
    }));
  }

  ecritures.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Aplatit en lignes d'export (une ligne de tableau par ligne débit/crédit).
  const lignesExport = [];
  let totalDebit = 0, totalCredit = 0;
  for (const e of ecritures) {
    for (const l of e.lignes) {
      const debit = Math.round((l.debit || 0) * 100) / 100;
      const credit = Math.round((l.credit || 0) * 100) / 100;
      totalDebit += debit;
      totalCredit += credit;
      lignesExport.push({
        date: e.date,
        journal: e.journal,
        piece: e.piece,
        numeroCompte: l.compte.numero,
        intituleCompte: l.compte.intitule,
        libelleEcriture: e.libelle,
        debit,
        credit
      });
    }
  }
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  const meta = await store.getMeta();
  return {
    periode: { debut: debut || null, fin: fin || null },
    validation: {
      valide: !!meta.planComptableValide,
      validePar: meta.planComptableValidePar || '',
      valideDate: meta.planComptableValideDate || null
    },
    planComptableUtilise: comptes.slice().sort((x, y) => String(x.numeroCompte).localeCompare(String(y.numeroCompte))),
    lignes: lignesExport,
    totaux: { debit: totalDebit, credit: totalCredit, equilibre: Math.abs(totalDebit - totalCredit) < 0.01 }
  };
}

module.exports = { generer: genererEcritures };
