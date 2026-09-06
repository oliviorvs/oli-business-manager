// src/services/tresorerie.service.js
const { requireAuth } = require('./auth.service');
const { debutJourUTC, debutMoisUTC, debutAnneeUTC, ajouterJoursUTC } = require('../../utils/helpers');

// CORRECTIF (audit — bug n°7) : ce fichier réimplémentait sa propre logique
// de bornage de période avec les méthodes LOCALES de Date (getDate/setHours/
// setMonth...), alors que ce bug précis (décalage d'un jour ou d'un mois
// selon le fuseau horaire du poste) a déjà été corrigé partout ailleurs dans
// le projet via les utilitaires UTC dédiés (utils/helpers.js, voir le bloc
// "DATES EN UTC"), utilisés notamment par rapport.service.js pour le
// dashboard. On réutilise désormais ces mêmes utilitaires ici, pour que le
// résumé de trésorerie reste cohérent avec le reste de l'application.
//
// CORRECTIF (audit — bug n°7, "bonus") : la branche 'semaine' était la seule
// des quatre à ne pas ramener l'heure à minuit — elle calculait "il y a
// exactement 7 jours, à l'heure actuelle", et glissait donc en continu au
// fil de la journée, contrairement aux trois autres bornes (jour/mois/année),
// ancrées sur une frontière de jour fixe. `ajouterJoursUTC(debutJourUTC(...), -7)`
// ramène désormais bien 'semaine' à minuit UTC, comme les trois autres.
function periodeStart(periode) {
  const now = new Date();
  if (periode === 'jour') return debutJourUTC(now);
  if (periode === 'semaine') return ajouterJoursUTC(debutJourUTC(now), -7);
  if (periode === 'mois') return debutMoisUTC(now);
  if (periode === 'annee') return debutAnneeUTC(now);
  return debutJourUTC(now);
}

module.exports = {
  async resume(store, periode = 'mois') {
    const s = requireAuth();
    if (s.role !== 'admin') throw new Error('Accès refusé pour votre rôle à ce module : tresorerie');
    const start = periodeStart(periode);
    const toutesOpsBrut = await store.list('operationsTresorerie');
    const ops = toutesOpsBrut.filter((o) => new Date(o.createdAt) >= start);
    const recettes = ops.filter((o) => o.type === 'entree').reduce((s, o) => s + o.montant, 0);
    const depenses = ops.filter((o) => o.type === 'sortie').reduce((s, o) => s + o.montant, 0);
    const toutesOps = toutesOpsBrut;
    const soldeInitial = 0;
    const soldeActuel = toutesOps.reduce((s, o) => s + (o.type === 'entree' ? o.montant : -o.montant), soldeInitial);
    return { periode, recettes, depenses, soldeFinal: recettes - depenses, soldeActuel, operations: ops.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) };
  }
};