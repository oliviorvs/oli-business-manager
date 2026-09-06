// src/services/helpers.js
const { uid, hashPassword, verifyPassword, money, dateFr, dateOnlyFr, montantEnLettres, numeroSequentielMensuel } = require('../../utils/helpers');

function paginate(array, page = 1, perPage = 50) {
  const start = (page - 1) * perPage;
  const end = start + perPage;
  return {
    data: array.slice(start, end),
    total: array.length,
    page,
    perPage,
    totalPages: Math.ceil(array.length / perPage)
  };
}

// FACTORISATION : cette fonction était dupliquée ici et dans
// vente.service.js. Les deux délèguent désormais à l'unique implémentation
// utils/helpers.js#numeroSequentielMensuel (calculée en UTC).
function numeroSequentiel(store, collection) {
  return numeroSequentielMensuel(store, collection);
}

function construireLignesVente(store, items) {
  // Cette fonction est déjà dans vente.service.js
  // On la réexporte ici pour centraliser
  const venteService = require('./vente.service');
  return venteService._construireLignesVente(store, items);
}

function finaliserVente(store, params) {
  const venteService = require('./vente.service');
  return venteService._finaliserVente(store, params);
}

module.exports = {
  uid,
  hashPassword,
  verifyPassword,
  money,
  dateFr,
  dateOnlyFr,
  montantEnLettres,
  paginate,
  numeroSequentiel,
  construireLignesVente,
  finaliserVente
};