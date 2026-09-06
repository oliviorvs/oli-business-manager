// src/services/client.service.js
const { requireModule } = require('./auth.service');
const { validate } = require('../validators/schemas');
const { genererCodeSequentiel } = require('../../utils/helpers');

function clientLabel(record, clients) {
  if (record.clientId) { const c = clients.find((x) => x.id === record.clientId); if (c) return (c.nom + ' ' + c.prenom).trim(); }
  if (record.clientNom) return record.clientNom;
  return 'Client comptoir';
}

// SÉCURITÉ / INTÉGRITÉ : détecte les doublons de clients. Le téléphone et l'e-mail sont
// des identifiants forts (une seule personne derrière) : un doublon y est toujours bloqué.
// Le nom+prénom seul peut légitimement se répéter (homonymes) — il n'est bloqué que si
// AUCUNE information distinctive (téléphone/adresse) ne permet de les différencier, ce qui
// indique très probablement une double saisie accidentelle du même client.
async function verifierDoublonClient(store, data, idExclu) {
  const clients = (await store.list('clients')).filter((c) => c.id !== idExclu);
  if (data.numero) {
    const num = String(data.numero).trim().toLowerCase();
    if (clients.some((c) => String(c.numero || '').trim().toLowerCase() === num)) {
      throw new Error(`Le numéro client "${data.numero}" est déjà utilisé`);
    }
  }
  if (data.telephone) {
    const tel = String(data.telephone).replace(/\s+/g, '');
    if (clients.some((c) => c.telephone && String(c.telephone).replace(/\s+/g, '') === tel)) {
      throw new Error(`Le numéro de téléphone "${data.telephone}" est déjà associé à un autre client`);
    }
  }
  if (data.email) {
    const mail = String(data.email).trim().toLowerCase();
    if (clients.some((c) => c.email && String(c.email).trim().toLowerCase() === mail)) {
      throw new Error(`L'e-mail "${data.email}" est déjà associé à un autre client`);
    }
  }
  if (data.nom) {
    const nomNorm = String(data.nom).trim().toLowerCase();
    const prenomNorm = String(data.prenom || '').trim().toLowerCase();
    const adresseNorm = String(data.adresse || '').trim().toLowerCase();
    const doublonExact = clients.find((c) =>
      String(c.nom || '').trim().toLowerCase() === nomNorm &&
      String(c.prenom || '').trim().toLowerCase() === prenomNorm &&
      !data.telephone && !c.telephone &&
      !data.email && !c.email &&
      String(c.adresse || '').trim().toLowerCase() === adresseNorm
    );
    if (doublonExact) {
      const nomComplet = `${data.nom} ${data.prenom || ''}`.trim();
      throw new Error(`Un client "${nomComplet}" existe déjà avec les mêmes informations`);
    }
  }
}

// Génère le prochain numéro client disponible à partir du compteur en base.
// FACTORISATION : cette logique (identique à celle des produits) est
// désormais centralisée dans utils/helpers.js#genererCodeSequentiel — elle
// avance jusqu'à trouver un numéro réellement libre (plutôt que de proposer
// en silence un numéro déjà pris) si le compteur est en retard sur les
// numéros réellement utilisés (base restaurée, numéro saisi manuellement
// plus haut que le compteur, etc.).
async function genererNumeroClient(store) {
  const clients = await store.list('clients');
  return genererCodeSequentiel(store, {
    sequenceKey: 'client',
    prefixe: 'CL',
    longueur: 3,
    existants: clients.map((c) => c.numero)
  });
}

module.exports = {
  // Liste des clients
  async list(store) {
    requireModule('clients');
    return store.list('clients');
  },

  // Création
  async create(store, payload, userEmail) {
    requireModule('clients');
    const errors = validate('client', payload || {});
    if (errors.length) throw new Error(errors.join(' ; '));
    // BUGFIX : le numéro auto-généré doit être déterminé AVANT le contrôle de
    // doublon, sinon celui-ci ne vérifie jamais que le numéro proposé n'est pas
    // déjà pris (ex. compteur désynchronisé après restauration d'une sauvegarde,
    // ou numéro saisi manuellement sur un autre client) — un même numéro pouvait
    // silencieusement être attribué à deux clients différents.
    const numero = payload.numero ? String(payload.numero).trim() : await genererNumeroClient(store);
    const payloadAvecNumero = Object.assign({}, payload, { numero });
    await verifierDoublonClient(store, payloadAvecNumero, null);
    const rec = await store.insert('clients', {
      numero,
      nom: payload.nom,
      prenom: payload.prenom || '',
      telephone: payload.telephone || '',
      adresse: payload.adresse || '',
      email: payload.email || ''
    });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_client', cible: rec.id });
    return rec;
  },

  // Mise à jour
  async update(store, id, patch, userEmail) {
    requireModule('clients');
    const existant = await store.get('clients', id);
    if (!existant) throw new Error('Client introuvable');
    // SÉCURITÉ / INTÉGRITÉ : un patch contenant "numero" vide (champ vidé côté
    // formulaire, ou payload forgé) ne doit jamais effacer le numéro client —
    // ce numéro est un identifiant métier utilisé ailleurs (factures,
    // historique...). On interdit explicitement toute mise à jour vers un
    // numéro vide ; le doublon est déjà couvert plus bas par
    // verifierDoublonClient.
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'numero')) {
      const numeroPatch = patch.numero == null ? '' : String(patch.numero).trim();
      if (!numeroPatch) throw new Error('Le numéro client ne peut pas être vide');
      patch = Object.assign({}, patch, { numero: numeroPatch });
    }
    const fusion = Object.assign({}, existant, patch || {});
    const errors = validate('client', fusion);
    if (errors.length) throw new Error(errors.join(' ; '));
    await verifierDoublonClient(store, fusion, id);
    const r = await store.update('clients', id, patch);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_client', cible: id });
    return r;
  },

  // Suppression (admin uniquement)
  async delete(store, id, userEmail, role) {
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer un client');
    // CORRECTIF (audit — bug n°10) : rien ne bloquait jusqu'ici la suppression
    // d'un client encore référencé par des ventes existantes — l'historique
    // perdait alors silencieusement son lien (une ancienne facture affichait
    // "Client comptoir" après coup, laissant croire à tort à une vente au
    // comptant anonyme). Par cohérence avec produit.service.js/
    // service.service.js, qui bloquent déjà la suppression d'une entité
    // encore référencée par une nomenclature active, on bloque ici aussi.
    const [ventesLiees, prestationsLiees] = await Promise.all([
      store.list('ventes', (v) => v.clientId === id),
      store.list('prestations', (p) => p.clientId === id)
    ]);
    if (ventesLiees.length || prestationsLiees.length) {
      throw new Error('Impossible de supprimer ce client : il est référencé par des ventes ou prestations existantes. Conservez sa fiche pour préserver l\'historique.');
    }
    await store.remove('clients', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_client', cible: id });
    return true;
  },

  // Historique
  async historique(store, clientId) {
    requireModule('clients');
    const ventes = await store.list('ventes', (v) => v.clientId === clientId);
    const prestations = await store.list('prestations', (pr) => pr.clientId === clientId);
    const totalDepense = ventes.filter((v) => v.statut !== 'annulee').reduce((s, v) => s + v.total, 0)
      + prestations.filter((pr) => pr.statut !== 'annulee' && !pr.venteId).reduce((s, v) => s + v.total, 0);
    return { ventes, prestations, totalDepense };
  },

  // Utilité (clientLabel)
  clientLabel
};