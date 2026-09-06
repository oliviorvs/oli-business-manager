// src/services/categorie.service.js
const { requireModule, requireAuth } = require('./auth.service');

module.exports = {
  async list(store) {
    // CORRECTIF (audit — nouvelle passe, bug n°9) : aucun contrôle interne
    // (requireAuth/requireModule) ici, contrairement à client.service.js,
    // produit.service.js, etc. Le contrôle existe bien côté main.js
    // (requireAuth() sur le canal 'categories:list'), donc ce n'est pas une
    // faille actuelle — mais ça rompt le principe de défense en profondeur
    // appliqué partout ailleurs : si un nouveau canal IPC était ajouté par
    // erreur sans reproduire ce contrôle, cette liste deviendrait accessible
    // sans authentification.
    requireAuth();
    return store.list('categories');
  },

  async create(store, payload, userEmail) {
    requireModule('produits');
    const nom = String(payload && payload.nom || '').trim();
    if (!nom) throw new Error('Le nom de la catégorie est requis');
    // CORRECTIF : rien n'empêchait auparavant de créer deux catégories
    // portant le même nom (à la casse/espaces près), ce qui créait des
    // doublons trompeurs dans les listes déroulantes (Produits, rapports…).
    const nomNorm = nom.toLowerCase();
    const doublon = (await store.list('categories')).some((c) => String(c.nom || '').trim().toLowerCase() === nomNorm);
    if (doublon) throw new Error(`Une catégorie nommée "${nom}" existe déjà`);
    const rec = await store.insert('categories', { nom });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_categorie', cible: rec.id });
    return rec;
  },

  async delete(store, id, userEmail, role) {
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer une catégorie');
    // CORRECTIF : supprimer une catégorie encore utilisée par des produits
    // laissait ces produits avec un categorieId pointant vers une catégorie
    // inexistante (fantôme), cassant l'affichage et les filtres par
    // catégorie dans le reste de l'application.
    const utilisee = (await store.list('produits', (p) => p.categorieId === id)).length > 0;
    if (utilisee) {
      throw new Error('Impossible de supprimer cette catégorie : elle est encore utilisée par au moins un produit');
    }
    await store.remove('categories', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_categorie', cible: id });
    return true;
  }
};