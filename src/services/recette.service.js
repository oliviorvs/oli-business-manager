// src/services/recette.service.js
const { requireModule } = require('./auth.service');

// AJOUT (audit) : une même nomenclature (recette) peut désormais s'appliquer
// à PLUSIEURS cibles (plusieurs services et/ou produits) au lieu d'une
// seule. Avant ce correctif, un produit consommé par 3 services différents
// (ex. de l'encre pour "Photocopie N&B", "Photocopie couleur" et
// "Impression") obligeait à créer 3 nomenclatures quasi identiques, une par
// service, en recopiant à chaque fois la même liste de matières premières.
// Le champ `cibleType`/`cibleId` (une seule cible) est remplacé par
// `cibles` : un tableau de { cibleType, cibleId }. Les nomenclatures créées
// avant ce correctif, qui n'ont que `cibleType`/`cibleId`, restent lisibles
// telles quelles grâce à listeCibles() ci-dessous (pas de migration de
// données nécessaire — le store persiste du JSON libre, voir store.js).

// Normalise les cibles d'une nomenclature, quel que soit son format de
// stockage (nouveau tableau `cibles`, ou ancien couple `cibleType`/`cibleId`
// unique conservé sur les enregistrements existants).
function listeCibles(recette) {
  if (Array.isArray(recette.cibles) && recette.cibles.length) return recette.cibles;
  if (recette.cibleType && recette.cibleId) return [{ cibleType: recette.cibleType, cibleId: recette.cibleId }];
  return [];
}

// Une nomenclature "concerne" une cible si celle-ci figure dans sa liste de cibles.
function recetteConcerneCible(recette, cibleType, cibleId) {
  return listeCibles(recette).some((c) => c.cibleType === cibleType && c.cibleId === cibleId);
}

function validerCibles(cibles) {
  if (!Array.isArray(cibles) || !cibles.length) {
    throw new Error('Sélectionnez au moins un produit ou service concerné par cette nomenclature');
  }
  const vues = new Set();
  return cibles.map((c, index) => {
    if (!c || !c.cibleType || !['produit', 'service'].includes(c.cibleType)) {
      throw new Error(`Cible ${index + 1} : le type doit être "produit" ou "service"`);
    }
    if (!c.cibleId) throw new Error(`Cible ${index + 1} : produit ou service requis`);
    const clef = `${c.cibleType}:${c.cibleId}`;
    if (vues.has(clef)) throw new Error(`Cible ${index + 1} : ce produit/service est déjà sélectionné dans cette nomenclature`);
    vues.add(clef);
    return { cibleType: c.cibleType, cibleId: c.cibleId };
  });
}

// Reçoit soit le nouveau format (payload.cibles), soit l'ancien format
// (payload.cibleType/cibleId) pour compatibilité avec un appelant existant.
function extraireCibles(payload) {
  if (payload.cibles !== undefined) return payload.cibles;
  if (payload.cibleType && payload.cibleId) return [{ cibleType: payload.cibleType, cibleId: payload.cibleId }];
  return [];
}

// SÉCURITÉ / INTÉGRITÉ : une seule recette ACTIVE par cible (produit ou
// service), comme le prévoyait déjà la contrainte UNIQUE du guide d'origine
// (unique_active_recipe). Vérifié en JS puisqu'il n'y a pas de contrainte
// UNIQUE exploitable sur un champ JSON. Contrôlé désormais pour CHACUNE des
// cibles de la nomenclature (une même cible ne peut toujours être couverte
// que par une seule nomenclature active, même si celle-ci en couvre
// plusieurs autres par ailleurs).
async function verifierUniciteRecetteActive(store, cibles, idExclu) {
  const actives = await store.list('recettes', (r) => r.actif && r.id !== idExclu);
  for (const cible of cibles) {
    const conflit = actives.find((r) => recetteConcerneCible(r, cible.cibleType, cible.cibleId));
    if (conflit) {
      throw new Error(
        `Une nomenclature active ("${conflit.nom}") existe déjà pour ce produit/service — désactivez-la avant d'en créer une nouvelle`
      );
    }
  }
}

function validerLigne(ligne, index) {
  if (!ligne.materielId) throw new Error(`Ligne ${index + 1} : article consommé requis`);
  const q = Number(ligne.quantite);
  if (!Number.isFinite(q) || q <= 0) throw new Error(`Ligne ${index + 1} : quantité invalide`);
  if (ligne.pertePourcentage !== undefined && ligne.pertePourcentage !== null && ligne.pertePourcentage !== '') {
    const p = Number(ligne.pertePourcentage);
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error(`Ligne ${index + 1} : pourcentage de perte invalide (0 à 100)`);
  }
}

module.exports = {
  async list(store) {
    requireModule('produits');
    return store.list('recettes');
  },

  async getActiveByCible(store, cibleType, cibleId) {
    requireModule('produits');
    const actives = await store.list('recettes', (r) => r.actif);
    return actives.find((r) => recetteConcerneCible(r, cibleType, cibleId)) || null;
  },

  async create(store, payload, userEmail) {
    requireModule('produits');
    const nom = (payload.nom || '').trim();
    if (!nom) throw new Error('Le nom de la nomenclature est requis');
    const cibles = validerCibles(extraireCibles(payload));
    const lignes = payload.lignes || [];
    lignes.forEach(validerLigne);
    await verifierUniciteRecetteActive(store, cibles, null);
    const rec = await store.insert('recettes', {
      nom,
      cibles,
      description: payload.description || '',
      actif: payload.actif !== undefined ? !!payload.actif : true,
      lignes: lignes.map((l) => ({
        materielId: l.materielId,
        quantite: Number(l.quantite),
        unite: l.unite || '',
        pertePourcentage: Number(l.pertePourcentage) || 0,
        optionnel: !!l.optionnel
      }))
    });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_recette', cible: rec.id });
    return rec;
  },

  async update(store, id, patch, userEmail) {
    requireModule('produits');
    const existante = await store.get('recettes', id);
    if (!existante) throw new Error('Nomenclature introuvable');
    if (patch.lignes) patch.lignes.forEach(validerLigne);

    // Si le patch touche aux cibles (nouveau ou ancien format), on les
    // valide et on normalise le patch vers le nouveau format `cibles`
    // (efface au passage un éventuel `cibleType`/`cibleId` hérité).
    let ciblesPatch;
    if (patch.cibles !== undefined || (patch.cibleType !== undefined && patch.cibleId !== undefined)) {
      ciblesPatch = validerCibles(extraireCibles(patch));
      patch = Object.assign({}, patch, { cibles: ciblesPatch, cibleType: undefined, cibleId: undefined });
    }

    // CORRECTIF (audit — bug n°5, conservé) : le contrôle d'unicité ne se
    // déclenchait auparavant QUE si `patch.actif` était explicitement fourni
    // et vrai. Si on modifiait les cibles d'une nomenclature DÉJÀ active
    // sans renvoyer `actif` dans le même patch, aucune vérification n'était
    // faite pour les nouvelles cibles. On calcule maintenant l'état
    // résultant réel (cibles + actif) et on vérifie dès que la nomenclature
    // EST OU RESTE active pour des cibles qui viennent de changer, ou
    // qu'on l'active explicitement.
    const actifResultant = patch.actif !== undefined ? !!patch.actif : existante.actif;
    const ciblesResultantes = ciblesPatch || listeCibles(existante);
    const ciblesChangees = ciblesPatch !== undefined;
    if (actifResultant && (patch.actif !== undefined || ciblesChangees)) {
      await verifierUniciteRecetteActive(store, ciblesResultantes, id);
    }
    const r = await store.update('recettes', id, patch);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_recette', cible: id });
    return r;
  },

  async delete(store, id, userEmail, role) {
    requireModule('produits');
    // CORRECTIF (audit — bug n°11) : une nomenclature pilote directement le
    // coût matière calculé par consommation.service.js (donc la rentabilité
    // réelle d'un produit/service) — au moins aussi sensible qu'un produit
    // ou un service, dont la suppression est, elle, déjà réservée à l'admin
    // (voir produit.service.js#delete/service.service.js#delete). Sans ce
    // contrôle, un simple 'gestionnaire' pouvait supprimer une nomenclature
    // active sans intervention d'un administrateur.
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer une nomenclature');
    await store.remove('recettes', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_recette', cible: id });
    return true;
  },

  listeCibles,
  recetteConcerneCible
};
