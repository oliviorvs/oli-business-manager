// src/services/depense.service.js
const { requireAuth } = require('./auth.service');
const { validate } = require('../validators/schemas');

module.exports = {
  async list(store) {
    requireAuth();
    return (await store.list('depenses')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async create(store, payload, userEmail) {
    const s = requireAuth();
    if (s.role === 'caissier') throw new Error('Accès refusé pour votre rôle à ce module : depenses');
    // SÉCURITÉ : sans cette validation, un montant négatif/non numérique
    // pouvait générer une "sortie" de trésorerie négative (= une entrée
    // d'argent déguisée) totalement invisible dans les contrôles usuels.
    const errors = validate('depense', payload || {});
    if (errors.length) throw new Error(errors.join(' ; '));
    const rec = await store.insert('depenses', {
      date: payload.date || new Date().toISOString(),
      categorie: payload.categorie,
      montant: Number(payload.montant),
      modePaiement: payload.modePaiement || 'especes',
      justificatif: payload.justificatif || '',
      commentaire: payload.commentaire || ''
    });
    await store.insert('operationsTresorerie', { type: 'sortie', categorie: rec.categorie, montant: rec.montant, reference: rec.id, description: rec.commentaire });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_depense', cible: rec.id });
    return rec;
  },

  async delete(store, id, userEmail, role) {
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer une dépense');
    const rec = await store.get('depenses', id);
    if (!rec) throw new Error('Dépense introuvable');
    // CORRECTIF (audit — nouvelle passe, bug n°3) : create() pose toujours une
    // écriture 'sortie' dans operationsTresorerie (reference: rec.id). delete()
    // ne la retirait jamais, laissant une sortie de caisse "fantôme" pour
    // toujours après suppression de la dépense — solde de trésorerie, dashboard
    // et rapports restaient faussés sans trace visible du pourquoi. On retire
    // désormais l'opération de trésorerie liée dans la même transaction que
    // la suppression, comme vente.service.js#supprimer / achat.service.js le
    // font déjà pour les ventes/achats.
    await store.transaction((tx) => {
      tx.removeWhere('operationsTresorerie', (o) => o.reference === rec.id);
      tx.remove('depenses', id);
      tx.logJournal({ utilisateur: userEmail, action: 'suppression_depense', cible: id });
    });
    return true;
  }
};