// src/services/service.service.js
const { requireModule, requireAuth } = require('./auth.service');
const { listeCibles } = require('./recette.service');
const taxService = require('./taxService');

// SÉCURITÉ / INTÉGRITÉ : détecte les doublons de service par nom (comparaison
// insensible à la casse et aux espaces). Sans ce contrôle, l'ajout manuel
// d'un service — notamment via le bouton « ➕ Nouveau » du formulaire de
// vente/pro-forma — pouvait créer plusieurs fiches service identiques au
// moindre re-saisie du même nom.
async function verifierDoublonService(store, data, idExclu) {
  if (!data.nom) return;
  const services = (await store.list('services')).filter((s) => s.id !== idExclu);
  const nomNorm = String(data.nom).trim().toLowerCase();
  if (services.some((s) => String(s.nom || '').trim().toLowerCase() === nomNorm)) {
    throw new Error(`Un service nommé "${data.nom}" existe déjà`);
  }
}

module.exports = {
  async list(store) {
    // CORRECTIF (audit — nouvelle passe, bug n°9) : voir le même correctif
    // dans categorie.service.js#list — défense en profondeur, le contrôle
    // existe déjà côté main.js (requireAuth() sur 'services:list').
    requireAuth();
    return store.list('services');
  },

  async create(store, payload, userEmail) {
    requireModule('services');
    if (!payload || !payload.nom || !payload.nom.trim()) throw new Error('Le nom du service est obligatoire');
    await verifierDoublonService(store, payload, null);
    // SYSTÈME TVA (§3) : un service suit exactement la même logique qu'un
    // produit — voir produit.service.js#create et taxService.js.
    const rec = await store.insert('services', { nom: payload.nom.trim(), prixDefaut: Number(payload.prixDefaut) || 0, unite: payload.unite || 'Prestation', actif: true, vat: taxService.normaliserVat(payload) });
    // CORRECTIF (audit — nouvelle passe, bug n°6) : create()/update() n'appelaient
    // jamais store.logJournal, contrairement à la quasi-totalité des autres
    // entités (produits, clients, fournisseurs, recettes, catégories…) — seule
    // la suppression de service était journalisée.
    await store.logJournal({ utilisateur: userEmail, action: 'creation_service', cible: rec.id });
    return rec;
  },

  async update(store, id, patch, userEmail) {
    requireModule('services');
    const existant = await store.get('services', id);
    if (!existant) throw new Error('Service introuvable');
    const patchNormalise = Object.assign({}, patch);
    if (patch && (patch.vat || patch.mode !== undefined || patch.rate !== undefined || patch.vatMode !== undefined || patch.vatRate !== undefined)) {
      patchNormalise.vat = taxService.normaliserVat(patch);
    }
    const fusion = Object.assign({}, existant, patchNormalise);
    await verifierDoublonService(store, fusion, id);
    const rec = await store.update('services', id, patchNormalise);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_service', cible: id });
    return rec;
  },

  async delete(store, id, userEmail, role) {
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer un service');
    // CORRECTIF (audit) : produit.service.js#delete empêche déjà la
    // suppression d'un produit encore référencé par une nomenclature (recette)
    // ACTIVE, que ce soit comme article vendu (cible) ou comme matière
    // première (materielId) — voir le commentaire "bug n°6" là-bas. Cette
    // même protection manquait ici pour les services : un service pouvait
    // être supprimé alors qu'il était la cible d'une nomenclature active,
    // laissant celle-ci pointer vers un service inexistant (nomenclature
    // orpheline, non désactivable proprement depuis l'écran Nomenclatures,
    // et affichée comme "(service introuvable)" — voir renderer/js/modules/
    // recettes.js). Un service ne peut jamais être une matière première
    // (materielId, toujours un produit — voir consommation.service.js), donc
    // seule la vérification "cible" est nécessaire ici.
    const recettesLiees = await store.list('recettes', (r) =>
      r.actif && listeCibles(r).some((c) => c.cibleType === 'service' && c.cibleId === id)
    );
    if (recettesLiees.length) {
      throw new Error(
        `Impossible de supprimer ce service : il est utilisé dans ${recettesLiees.length} nomenclature(s) active(s) ` +
        `(${recettesLiees.map((r) => r.nom).join(', ')}). Désactivez ou modifiez ces nomenclatures avant de supprimer le service.`
      );
    }
    await store.remove('services', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_service', cible: id });
    return true;
  }
};