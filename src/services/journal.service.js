// src/services/journal.service.js
const { requireAuth } = require('./auth.service');

module.exports = {
  async list(store, limit = 300) {
    const s = requireAuth();
    if (s.role !== 'admin') throw new Error('Accès refusé pour votre rôle à ce module : journal');
    // CORRECTIF (audit) : store.list('journal') renvoie les lignes triées
    // par rowid ASCENDANT (insertion la plus ancienne en premier — voir
    // store.js#list). `.slice(0, limit)` prenait donc les `limit` entrées
    // les PLUS ANCIENNES de la table (jusqu'à 5000, voir JOURNAL_MAX), et
    // non les plus récentes : dès que le journal dépassait `limit` lignes
    // (300 par défaut), l'écran Journal de l'admin n'affichait plus jamais
    // aucune activité récente — seulement une fenêtre figée près de la plus
    // vieille entrée encore conservée. Corrigé en prenant les `limit`
    // dernières lignes puis en les inversant (plus récente en premier),
    // conforme au libellé "Historique des actions du système" côté
    // renderer (renderer/js/modules/journal.js), qui affiche la liste
    // reçue telle quelle sans la retrier.
    return (await store.list('journal')).slice(-limit).reverse();
  }
};