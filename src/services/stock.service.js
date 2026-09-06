// src/services/stock.service.js
const { requireModule } = require('./auth.service');

module.exports = {
  async mouvements(store, produitId) {
    requireModule('stocks');
    const list = await store.list('mouvementsStock', produitId ? (m) => m.produitId === produitId : undefined);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async alertes(store) {
    // CORRECTIF SÉCURITÉ : cet endpoint n'exigeait auparavant aucune session —
    // n'importe quel appel IPC forgé depuis un renderer compromis (ou avant
    // toute connexion) pouvait lire la liste des produits en stock critique
    // sans être authentifié. On aligne ce endpoint sur mouvements() ci-dessus.
    requireModule('stocks');
    // CORRECTIF (audit — profondeur) : `pr.seuilMin || 0` traite à tort un
    // seuil négatif comme la valeur elle-même (`(-5) || 0` vaut -5, pas 0,
    // un nombre négatif étant truthy en JavaScript) — voir la validation
    // ajoutée dans schemas.js#validateProduit pour empêcher qu'un NOUVEAU
    // seuil négatif soit enregistré. Ce garde-fou supplémentaire couvre en
    // plus tout produit dont le seuil serait déjà négatif en base
    // (enregistré avant ce correctif) : un seuil négatif est alors traité
    // comme 0, plutôt que de désactiver silencieusement l'alerte.
    return (await store.list('produits')).filter((pr) => pr.quantite <= Math.max(0, Number(pr.seuilMin) || 0));
  }
};