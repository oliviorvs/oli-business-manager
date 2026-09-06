// src/services/produit.service.js
const { requireModule, requireAuth, requireAnyModule } = require('./auth.service');
const { uid, genererCodeSequentiel } = require('../../utils/helpers');
const { validate } = require('../validators/schemas');
const { listeCibles } = require('./recette.service');
const taxService = require('./taxService');

// SÉCURITÉ / INTÉGRITÉ : vérifie qu'aucun autre produit n'utilise déjà le même code,
// code-barre ou désignation (comparaison insensible à la casse et aux espaces). Sans
// ce contrôle, rien n'empêchait de créer/modifier un produit en doublon exact d'un
// autre (par la saisie manuelle, pas seulement par import CSV).
async function verifierDoublonProduit(store, data, idExclu) {
  const produits = (await store.list('produits')).filter((p) => p.id !== idExclu);
  if (data.code) {
    const codeNorm = String(data.code).trim().toLowerCase();
    if (produits.some((p) => String(p.code || '').trim().toLowerCase() === codeNorm)) {
      throw new Error(`Le code "${data.code}" est déjà utilisé par un autre produit`);
    }
  }
  if (data.codeBarre) {
    const cbNorm = String(data.codeBarre).trim().toLowerCase();
    if (produits.some((p) => p.codeBarre && String(p.codeBarre).trim().toLowerCase() === cbNorm)) {
      throw new Error(`Le code-barre "${data.codeBarre}" est déjà utilisé par un autre produit`);
    }
  }
  if (data.designation) {
    const desNorm = String(data.designation).trim().toLowerCase();
    if (produits.some((p) => String(p.designation || '').trim().toLowerCase() === desNorm)) {
      throw new Error(`Un produit nommé "${data.designation}" existe déjà`);
    }
  }
}

// Génère le prochain code produit disponible, en sautant tout code déjà
// utilisé. FACTORISATION : cette logique (identique à celle des clients) est
// désormais centralisée dans utils/helpers.js#genererCodeSequentiel.
async function genererCodeProduit(store) {
  const produits = await store.list('produits');
  return genererCodeSequentiel(store, {
    sequenceKey: 'produit',
    prefixe: 'PR',
    longueur: 3,
    existants: produits.map((p) => p.code)
  });
}

module.exports = {
  async list(store) {
    requireAnyModule('produits', 'ventes');
    return store.list('produits');
  },

  async create(store, payload, userEmail) {
    requireModule('produits');
    const errors = validate('produit', payload || {});
    if (errors.length) throw new Error(errors.join(' ; '));
    // BUGFIX : voir client.service.js#create — le code auto-généré doit être
    // déterminé AVANT le contrôle de doublon, pour être lui-même vérifié.
    const code = payload.code ? String(payload.code).trim() : await genererCodeProduit(store);
    const payloadAvecCode = Object.assign({}, payload, { code });
    await verifierDoublonProduit(store, payloadAvecCode, null);
    const rec = await store.insert('produits', {
      code,
      codeBarre: payload.codeBarre || '',
      designation: payload.designation,
      unite: payload.unite || 'Unité',
      categorieId: payload.categorieId || null,
      description: payload.description || '',
      prixAchat: Number(payload.prixAchat) || 0,
      prixVente: Number(payload.prixVente) || 0,
      // SYSTÈME TVA (§3) : remplace l'ancien champ `tva` (nombre isolé,
      // jamais réellement utilisé par les ventes) par `vat: { mode, rate }`
      // — voir taxService.js#normaliserVat et #getEffectiveVatRate. "prixVente"
      // reste un prix HORS TAXE (§1/§6) : c'est sur cette valeur que la TVA
      // est ensuite calculée au moment de la vente, jamais ici.
      vat: taxService.normaliserVat(payload),
      quantite: Number(payload.quantite) || 0,
      seuilMin: Number(payload.seuilMin) || 0,
      fournisseurId: payload.fournisseurId || null
    });
    if (rec.quantite > 0) {
      await store.insert('mouvementsStock', { produitId: rec.id, type: 'entree', quantite: rec.quantite, motif: 'Stock initial', utilisateur: userEmail });
    }
    await store.logJournal({ utilisateur: userEmail, action: 'creation_produit', cible: rec.id });
    return rec;
  },

  async update(store, id, patch, userEmail) {
    requireModule('produits');
    const existant = await store.get('produits', id);
    if (!existant) throw new Error('Produit introuvable');
    // SYSTÈME TVA : si le patch touche à la configuration TVA (vat, ou les
    // champs bruts vatMode/vatRate/mode/rate envoyés par le formulaire),
    // on la normalise et on la valide AVANT de fusionner — un taux
    // spécifique invalide doit être rejeté ici, pas seulement à la
    // création (§16).
    const patchNormalise = Object.assign({}, patch);
    if (patch && (patch.vat || patch.mode !== undefined || patch.rate !== undefined || patch.vatMode !== undefined || patch.vatRate !== undefined)) {
      patchNormalise.vat = taxService.normaliserVat(patch);
    }
    // On valide l'état résultant (existant + patch) pour ne pas rejeter
    // à tort une mise à jour partielle qui ne touche pas la désignation.
    const fusion = Object.assign({}, existant, patchNormalise);
    const errors = validate('produit', fusion);
    if (errors.length) throw new Error(errors.join(' ; '));
    await verifierDoublonProduit(store, fusion, id);
    const r = await store.update('produits', id, patchNormalise);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_produit', cible: id });
    return r;
  },

  async delete(store, id, userEmail, role) {
    if (role !== 'admin') throw new Error('Seul un administrateur peut supprimer un produit');
    // CORRECTIF (audit — bug n°6) : empêche la suppression d'un produit
    // encore référencé par une nomenclature (recette) ACTIVE — soit comme
    // article vendu (cibleId), soit comme matière première consommée
    // (materielId dans une ligne). Sans ce contrôle, la vente suivante qui
    // déclenche cette recette échouait en pleine écriture avec "Article
    // consommé introuvable dans la recette ...", pour une raison invisible
    // depuis l'écran Ventes (le produit supprimé n'apparaît plus nulle part).
    const recettesLiees = await store.list('recettes', (r) =>
      r.actif && (
        listeCibles(r).some((c) => c.cibleType === 'produit' && c.cibleId === id) ||
        (r.lignes || []).some((l) => l.materielId === id)
      )
    );
    if (recettesLiees.length) {
      throw new Error(
        `Impossible de supprimer ce produit : il est utilisé dans ${recettesLiees.length} nomenclature(s) active(s) ` +
        `(${recettesLiees.map((r) => r.nom).join(', ')}). Désactivez ou modifiez ces nomenclatures avant de supprimer le produit.`
      );
    }
    await store.remove('produits', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_produit', cible: id });
    return true;
  },

  async ajusterStock(store, payload, userEmail) {
    requireModule('stocks');
    const qte = Number(payload.quantite);
    // SÉCURITÉ : sans ce contrôle, une quantité négative sur une "entrée" faisait
    // en réalité baisser le stock (et inversement pour une "sortie"), tout en
    // étant journalisée comme le mouvement opposé de la réalité.
    if (payload.type === 'entree' || payload.type === 'sortie') {
      if (!Number.isFinite(qte) || qte <= 0) throw new Error('La quantité doit être un nombre positif');
    } else if (!Number.isFinite(qte) || qte < 0) {
      throw new Error('La quantité doit être un nombre positif ou nul');
    }
    // CORRECTIF (audit — bug n°2) : cet écran d'ajustement manuel de stock
    // avait exactement le même défaut que achat/vente : un get() suivi d'un
    // update() séparé, avec une fenêtre de concurrence entre les deux où un
    // autre mouvement de stock sur le même produit pouvait s'intercaler.
    // store.ajusterChamp() accepte ici une FONCTION (plutôt qu'un simple
    // delta numérique) car le mode "ajustement / inventaire" fixe une
    // valeur ABSOLUE — cette fonction reçoit la quantité actuelle LUE DANS
    // LA MÊME TRANSACTION que l'écriture, donc jamais périmée.
    const produit = await store.ajusterChamp('produits', payload.produitId, 'quantite', (quantiteActuelle) => {
      if (payload.type === 'entree') return quantiteActuelle + qte;
      if (payload.type === 'sortie') return quantiteActuelle - qte;
      return qte; // ajustement / inventaire : valeur absolue
    }, {
      validate: (valeurActuelle, nouvelleValeur) => {
        if (nouvelleValeur < 0) throw new Error('Stock insuffisant');
      }
    });
    if (!produit) throw new Error('Produit introuvable');
    const mv = await store.insert('mouvementsStock', { produitId: payload.produitId, type: payload.type, quantite: Number(payload.quantite), motif: payload.motif || '', utilisateur: userEmail });
    return mv;
  }
};