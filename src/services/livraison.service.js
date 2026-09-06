// src/services/livraison.service.js
const { requireModule, requireAuth } = require('./auth.service');
const venteService = require('./vente.service');

module.exports = {
  async list(store) {
    requireModule('ventes');
    return (await store.list('bonsLivraison')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async create(store, payload, userEmail) {
    requireModule('ventes');
    const vente = await store.get('ventes', payload.venteId);
    if (!vente) throw new Error('Vente introuvable');
    // CORRECTIF (audit — bug n°13) : `Number(l.quantiteCommandee) || 0` ne
    // filtre que NaN/0/undefined — une valeur négative (-5) est un nombre
    // valide et TRUTHY en JavaScript, donc `Number(-5) || 0` vaut -5, pas 0.
    // Rien n'empêchait non plus quantiteLivree de dépasser quantiteCommandee.
    // On rejette désormais explicitement les quantités négatives, et on
    // avertit (message d'erreur clair, plutôt qu'un blocage strict qui
    // interdirait une livraison partielle en plusieurs fois légitime) si la
    // quantité livrée dépasse la quantité commandée.
    const lignes = (payload.lignes || []).map((l, index) => {
      const quantiteCommandee = Number(l.quantiteCommandee);
      const quantiteLivree = Number(l.quantiteLivree);
      if (l.quantiteCommandee !== undefined && l.quantiteCommandee !== null && l.quantiteCommandee !== '' && (!Number.isFinite(quantiteCommandee) || quantiteCommandee < 0)) {
        throw new Error(`Ligne ${index + 1} : quantité commandée invalide`);
      }
      if (l.quantiteLivree !== undefined && l.quantiteLivree !== null && l.quantiteLivree !== '' && (!Number.isFinite(quantiteLivree) || quantiteLivree < 0)) {
        throw new Error(`Ligne ${index + 1} : quantité livrée invalide`);
      }
      const qc = Number.isFinite(quantiteCommandee) && quantiteCommandee >= 0 ? quantiteCommandee : 0;
      const ql = Number.isFinite(quantiteLivree) && quantiteLivree >= 0 ? quantiteLivree : 0;
      if (ql > qc) {
        throw new Error(`Ligne ${index + 1} : la quantité livrée (${ql}) ne peut pas dépasser la quantité commandée (${qc})`);
      }
      return {
        designation: String(l.designation || '').trim(),
        details: String(l.details || '').trim(),
        unite: l.unite || 'Unité',
        quantiteCommandee: qc,
        quantiteLivree: ql
      };
    }).filter((l) => l.designation);
    if (!lignes.length) throw new Error('Ajoutez au moins une ligne à livrer');
    const rec = await store.insert('bonsLivraison', {
      numero: await venteService._numeroSequentiel(store, 'bonsLivraison'),
      venteId: vente.id,
      venteNumero: vente.numero,
      clientId: vente.clientId,
      clientNom: vente.clientNom,
      objet: (payload.objet || '').trim(),
      contrat: (payload.contrat || '').trim(),
      termePaiement: (payload.termePaiement || '').trim(),
      dateLivraison: payload.dateLivraison ? new Date(payload.dateLivraison).toISOString() : new Date().toISOString(),
      lignes,
      vendeur: userEmail
    });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_bon_livraison', cible: rec.numero });
    return rec;
  },

  async supprimer(store, id, userEmail) {
    const bl = await store.get('bonsLivraison', id);
    if (!bl) throw new Error('Bon de livraison introuvable');
    await store.remove('bonsLivraison', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_bon_livraison', cible: bl.numero });
    return true;
  }
};
