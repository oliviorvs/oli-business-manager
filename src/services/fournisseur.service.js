// src/services/fournisseur.service.js
const { requireModule } = require('./auth.service');
const { validate } = require('../validators/schemas');

// CORRECTIF (audit — bug n°9) : ce module n'avait, contrairement à
// client.service.js, aucun contrôle de doublon. On applique ici la même
// logique que pour les clients (nom+téléphone/e-mail comme identifiants
// forts), adaptée aux champs disponibles pour un fournisseur.
async function verifierDoublonFournisseur(store, data, idExclu) {
  const fournisseurs = (await store.list('fournisseurs')).filter((f) => f.id !== idExclu);
  if (data.telephone) {
    const tel = String(data.telephone).replace(/\s+/g, '');
    if (fournisseurs.some((f) => f.telephone && String(f.telephone).replace(/\s+/g, '') === tel)) {
      throw new Error(`Le numéro de téléphone "${data.telephone}" est déjà associé à un autre fournisseur`);
    }
  }
  if (data.email) {
    const mail = String(data.email).trim().toLowerCase();
    if (fournisseurs.some((f) => f.email && String(f.email).trim().toLowerCase() === mail)) {
      throw new Error(`L'e-mail "${data.email}" est déjà associé à un autre fournisseur`);
    }
  }
  if (data.nom) {
    const nomNorm = String(data.nom).trim().toLowerCase();
    const doublonExact = fournisseurs.find((f) =>
      String(f.nom || '').trim().toLowerCase() === nomNorm &&
      !data.telephone && !f.telephone &&
      !data.email && !f.email
    );
    if (doublonExact) {
      throw new Error(`Un fournisseur "${data.nom}" existe déjà avec les mêmes informations`);
    }
  }
}

module.exports = {
  async list(store) {
    requireModule('fournisseurs');
    return store.list('fournisseurs');
  },

  async create(store, payload, userEmail) {
    requireModule('fournisseurs');
    // CORRECTIF (audit — bug n°9) : aucun schéma de validation n'existait
    // pour 'fournisseur' — un fournisseur pouvait être créé sans nom, avec un
    // e-mail manifestement invalide, etc. (contrairement à produit, client,
    // vente, achat, utilisateur, depense, qui sont tous validés).
    const errors = validate('fournisseur', payload || {});
    if (errors.length) throw new Error(errors.join(' ; '));
    await verifierDoublonFournisseur(store, payload, null);
    const rec = await store.insert('fournisseurs', payload);
    await store.logJournal({ utilisateur: userEmail, action: 'creation_fournisseur', cible: rec.id });
    return rec;
  },

  async update(store, id, patch, userEmail) {
    requireModule('fournisseurs');
    const existant = await store.get('fournisseurs', id);
    if (!existant) throw new Error('Fournisseur introuvable');
    const fusion = Object.assign({}, existant, patch || {});
    const errors = validate('fournisseur', fusion);
    if (errors.length) throw new Error(errors.join(' ; '));
    await verifierDoublonFournisseur(store, fusion, id);
    const r = await store.update('fournisseurs', id, patch);
    // CORRECTIF (audit — bug n°9) : la modification n'était jusqu'ici jamais
    // journalisée (contrairement à toutes les autres entités du projet) —
    // aucune trace dans le journal d'audit si un RIB ou une adresse de
    // fournisseur était modifié.
    await store.logJournal({ utilisateur: userEmail, action: 'modification_fournisseur', cible: id });
    return r;
  },

  async delete(store, id, userEmail, role) {
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer un fournisseur');
    // CORRECTIF (audit — bug n°10) : même raisonnement que
    // client.service.js#delete — un fournisseur encore référencé par des
    // achats existants ne doit pas pouvoir être supprimé silencieusement.
    const achatsLies = await store.list('achats', (a) => a.fournisseurId === id);
    if (achatsLies.length) {
      throw new Error('Impossible de supprimer ce fournisseur : il est référencé par des achats existants. Conservez sa fiche pour préserver l\'historique.');
    }
    await store.remove('fournisseurs', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_fournisseur', cible: id });
    return true;
  }
};
