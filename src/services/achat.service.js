// src/services/achat.service.js
const { requireModule, requireAuth } = require('./auth.service');
const venteService = require('./vente.service'); // pour _numeroSequentiel
const { validate } = require('../validators/schemas');
const taxService = require('./taxService');

module.exports = {
  async list(store) {
    requireModule('achats');
    return store.list('achats');
  },

  async create(store, payload, userEmail) {
    requireModule('achats');
    const errors = validate('achat', payload || {});
    if (errors.length) throw new Error(errors.join(' ; '));
    const fournisseur = await store.get('fournisseurs', payload.fournisseurId);
    if (!fournisseur) throw new Error('Fournisseur introuvable : ' + payload.fournisseurId);
    const meta = await store.getMeta();
    const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 0 };
    let total = 0;
    let totalHT = 0;
    let totalVat = 0;
    const lignesCalculees = [];
    for (const l of payload.lignes) {
      const produit = await store.get('produits', l.produitId);
      if (!produit) throw new Error('Produit introuvable : ' + l.produitId);
      const sousTotalHT = Math.round(Number(l.quantite) * Number(l.prixUnitaire) * 100) / 100;
      const tauxLigne = taxService.getEffectiveVatRate(produit, taxSettings);
      const detail = taxService.calculateLineFromHT(sousTotalHT, tauxLigne);
      total += detail.totalTTC;
      totalHT += detail.totalHT;
      totalVat += detail.vatAmount;
      lignesCalculees.push(Object.assign({}, l, {
        prixUnitaire: Number(l.prixUnitaire),
        quantite: Number(l.quantite),
        sousTotal: detail.totalHT,
        vatRate: detail.vatRate,
        vatAmount: detail.vatAmount,
        totalTTC: detail.totalTTC
      }));
    }
    total = Math.round(total * 100) / 100;
    totalHT = Math.round(totalHT * 100) / 100;
    totalVat = Math.round(totalVat * 100) / 100;
    let montantPayeInitial = 0;
    if (payload.montantPaye !== undefined && payload.montantPaye !== null && payload.montantPaye !== '') {
      const mp = Number(payload.montantPaye);
      if (!Number.isFinite(mp) || mp < 0) throw new Error('Le montant payé doit être un nombre positif ou nul');
      if (Math.round(mp * 100) / 100 > Math.round(total * 100) / 100) {
        throw new Error(`Le montant payé (${mp}) ne peut pas dépasser le total de l'achat (${total})`);
      }
      montantPayeInitial = Math.round(mp * 100) / 100;
    }
    const statutPaiement = montantPayeInitial >= total ? 'paye' : (montantPayeInitial > 0 ? 'partiellement_paye' : 'en_attente');
    const numero = await venteService._numeroSequentiel(store, 'achats');
    const rec = await store.transaction((tx) => {
      const achat = tx.insert('achats', {
        numero,
        fournisseurId: payload.fournisseurId,
        lignes: lignesCalculees,
        statutPaiement,
        statut: 'active',
        montantPaye: montantPayeInitial,
        total,
        // SYSTÈME TVA : agrégats HT/TVA utilisés par ecritureComptable.service.js
        // (ventilation TVA déductible) et rapport.service.js.
        totalHT,
        totalVat
      });
      for (const l of lignesCalculees) {
        const produit = tx.ajusterChamp('produits', l.produitId, 'quantite', Number(l.quantite));
        if (produit) {
          tx.insert('mouvementsStock', { produitId: l.produitId, type: 'entree', quantite: Number(l.quantite), motif: 'Achat ' + achat.numero, utilisateur: userEmail });
        }
      }
      if (achat.montantPaye > 0) {
        tx.insert('operationsTresorerie', { type: 'sortie', categorie: 'Achat de marchandises', montant: achat.montantPaye, reference: achat.numero, description: 'Paiement fournisseur' });
      }
      tx.logJournal({ utilisateur: userEmail, action: 'creation_achat', cible: achat.id });
      return achat;
    });
    return store.get('achats', rec.id);
  },

  async annuler(store, id, userEmail) {
    const achat = await store.get('achats', id);
    if (!achat) throw new Error('Achat introuvable');
    if (achat.statut === 'annulee') throw new Error('Cet achat est déjà annulé');
    await store.transaction((tx) => {
      for (const l of achat.lignes) {
        const produit = tx.ajusterChamp('produits', l.produitId, 'quantite', -Number(l.quantite), {
          validate: (valeurActuelle, nouvelleValeur, p) => {
            if (nouvelleValeur < 0) {
              throw new Error(
                `Impossible d'annuler cet achat : le stock actuel de "${p.designation}" (${valeurActuelle}) ` +
                `est inférieur à la quantité à retirer (${l.quantite}). Une partie de ce stock a probablement déjà été vendue.`
              );
            }
          }
        });
        if (produit) {
          tx.insert('mouvementsStock', { produitId: l.produitId, type: 'sortie', quantite: Number(l.quantite), motif: 'Annulation ' + achat.numero, utilisateur: userEmail });
        }
      }
      if (achat.montantPaye > 0) {
        tx.insert('operationsTresorerie', { type: 'entree', categorie: 'Annulation achat', montant: achat.montantPaye, reference: achat.numero, description: 'Annulation de l\'achat ' + achat.numero });
      }
      tx.update('achats', id, { statut: 'annulee' });
      tx.logJournal({ utilisateur: userEmail, action: 'annulation_achat', cible: id });
    });
    return true;
  },

  async payer(store, id, montant, userEmail) {
    requireModule('achats');
    const achat = await store.get('achats', id);
    if (!achat) throw new Error('Achat introuvable');
    if (achat.statut === 'annulee') throw new Error('Impossible de payer un achat annulé');
    const reste = Math.round((achat.total - achat.montantPaye) * 100) / 100;
    montant = Math.round(Number(montant) * 100) / 100;
    if (!montant || montant <= 0) throw new Error('Montant invalide');
    if (montant > reste) throw new Error('Le montant dépasse le solde restant dû (' + reste + ')');
    const montantPaye = Math.round((achat.montantPaye + montant) * 100) / 100;
    const statutPaiement = montantPaye >= achat.total ? 'paye' : (montantPaye > 0 ? 'partiellement_paye' : 'en_attente');
    await store.transaction((tx) => {
      tx.update('achats', id, { montantPaye, statutPaiement });
      tx.insert('operationsTresorerie', { type: 'sortie', categorie: 'Achat de marchandises', montant, reference: achat.numero, description: 'Règlement fournisseur — ' + achat.numero });
      tx.logJournal({ utilisateur: userEmail, action: 'paiement_achat', cible: id });
    });
    return store.get('achats', id);
  },

  async supprimer(store, id, userEmail) {
    const achat = await store.get('achats', id);
    if (!achat) throw new Error('Achat introuvable');
    if (achat.statut !== 'annulee') throw new Error('Seul un achat déjà annulé peut être supprimé définitivement');
    await store.transaction((tx) => {
      tx.removeWhere('operationsTresorerie', (o) => o.reference === achat.numero);
      tx.remove('achats', id);
      tx.logJournal({ utilisateur: userEmail, action: 'suppression_definitive_achat', cible: achat.numero });
    });
    return true;
  }
};
