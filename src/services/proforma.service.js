// src/services/proforma.service.js
const { requireModule } = require('./auth.service');
const venteService = require('./vente.service');

// CORRECTIF (audit — bug n°5) : un produit/service "au vol" créé pendant la
// construction d'un devis est provisoire tant que le devis n'est pas validé.
// Cette fonction est appelée à la validation du devis pour le "confirmer"
// (le rendre permanent, au même titre qu'un produit créé directement).
async function confirmerLignesProvisoires(store, lignes) {
  for (const l of lignes || []) {
    if (l.kind === 'produit' && l.produitId) {
      const produit = await store.get('produits', l.produitId);
      if (produit && produit.provisoire) {
        await store.update('produits', produit.id, { provisoire: false });
      }
    } else if (l.kind === 'service' && l.serviceId) {
      const service = await store.get('services', l.serviceId);
      if (service && service.provisoire) {
        await store.update('services', service.id, { provisoire: false });
      }
    }
  }
}

// CORRECTIF (audit — bug n°5) : appelée quand un devis est supprimé sans
// avoir été validé. Supprime les produits/services encore `provisoire`
// créés par CE devis, à condition qu'ils ne soient référencés nulle part
// ailleurs (autre devis encore ouvert, vente réelle) — un produit provisoire
// réutilisé entre-temps dans un autre document ne doit pas disparaître sous
// les pieds de ce document-là.
async function nettoyerLignesProvisoires(store, proformaId, lignes) {
  const [autresProformas, ventes] = await Promise.all([
    store.list('proformas', (p) => p.id !== proformaId),
    store.list('ventes')
  ]);
  const estEncoreReference = (kind, id) => {
    const dansUnAutreDocument = (doc) => (doc.lignes || []).some((l) => l.kind === kind && (kind === 'produit' ? l.produitId === id : l.serviceId === id));
    return autresProformas.some(dansUnAutreDocument) || ventes.some(dansUnAutreDocument);
  };
  for (const l of lignes || []) {
    if (l.kind === 'produit' && l.produitId) {
      const produit = await store.get('produits', l.produitId);
      if (produit && produit.provisoire && !estEncoreReference('produit', produit.id)) {
        await store.removeWhere('mouvementsStock', (m) => m.produitId === produit.id);
        await store.remove('produits', produit.id);
      }
    } else if (l.kind === 'service' && l.serviceId) {
      const service = await store.get('services', l.serviceId);
      if (service && service.provisoire && !estEncoreReference('service', service.id)) {
        await store.remove('services', service.id);
      }
    }
  }
}

module.exports = {
  async list(store) {
    requireModule('ventes');
    return (await store.list('proformas')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async get(store, id) {
    requireModule('ventes');
    return store.get('proformas', id);
  },

  async create(store, payload, userEmail) {
    requireModule('ventes');
    const items = payload.items || [];
    // CORRECTIF (audit — bug n°5) : un devis (pro-forma) est par définition un
    // document non engageant ; les produits/services "au vol" créés pendant
    // sa construction sont marqués `provisoire: true` — ils ne deviennent
    // permanents qu'à la validation effective du devis (voir #valider) et
    // sont supprimés automatiquement si le devis est supprimé sans avoir été
    // validé (voir #supprimer).
    const { lignes, total, totalHT, totalVat } = await venteService._construireLignesVente(store, items, { provisoire: true, utilisateur: userEmail });
    const clientId = payload.clientId || null;
    const clientNom = !clientId && payload.clientNom ? String(payload.clientNom).trim() : '';
    // CORRECTIF (audit) : un numéro fourni explicitement (payload.numero)
    // n'était jamais vérifié par rapport aux proformas existantes, alors que
    // update() fait déjà ce contrôle — un même numéro pouvait donc être
    // attribué à deux proformas si l'appelant en imposait un manuellement.
    let numero;
    if (payload.numero !== undefined && payload.numero !== null && String(payload.numero).trim()) {
      numero = String(payload.numero).trim();
      const existant = (await store.list('proformas')).find((p) => p.numero === numero);
      if (existant) throw new Error('Ce numéro de proforma est déjà utilisé');
    } else {
      numero = await venteService._numeroSequentiel(store, 'proformas');
    }
    const rec = await store.insert('proformas', {
      numero,
      clientId,
      clientNom,
      objet: (payload.objet || '').trim(),
      modePaiement: payload.modePaiement || 'especes',
      vendeur: userEmail,
      lignes,
      total,
      // SYSTÈME TVA (§7) : voir vente.service.js — figés dès la création du
      // devis, réutilisés tels quels à la validation (#valider ci-dessous),
      // jamais recalculés.
      totalHT: totalHT != null ? totalHT : total,
      totalVat: totalVat != null ? totalVat : 0,
      statut: 'brouillon'
    });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_proforma', cible: rec.numero });
    return rec;
  },

  // NOUVEAU : Mise à jour complète d'une proforma (lignes, client, objet, etc.)
  async update(store, id, payload, userEmail) {
    requireModule('ventes');
    const proforma = await store.get('proformas', id);
    if (!proforma) throw new Error('Facture pro-forma introuvable');
    if (proforma.statut === 'validee') throw new Error('Impossible de modifier une facture pro-forma déjà validée');

    // Reconstruire les lignes si des items sont fournis
    let updateData = {};
    if (payload.items && payload.items.length) {
      // CORRECTIF (audit — bug n°5) : même raisonnement qu'en création — voir
      // le commentaire dans #create.
      const { lignes, total, totalHT, totalVat } = await venteService._construireLignesVente(store, payload.items, { provisoire: true, utilisateur: userEmail });
      updateData.lignes = lignes;
      updateData.total = total;
      updateData.totalHT = totalHT;
      updateData.totalVat = totalVat;
    }

    // Mise à jour des autres champs
    if (payload.clientId !== undefined) {
      updateData.clientId = payload.clientId || null;
      updateData.clientNom = !payload.clientId && payload.clientNom ? String(payload.clientNom).trim() : '';
    }
    if (payload.objet !== undefined) {
      updateData.objet = (payload.objet || '').trim();
    }
    if (payload.modePaiement !== undefined) {
      updateData.modePaiement = payload.modePaiement;
    }
    // CORRECTIF (audit) : payload.numero.trim() plantait (TypeError) si un
    // numéro était fourni sous une forme non-chaîne (ex. un nombre) — on
    // normalise désormais explicitement en chaîne avant d'appeler .trim().
    if (payload.numero !== undefined && payload.numero !== null && String(payload.numero).trim()) {
      const numeroPatch = String(payload.numero).trim();
      // Vérifier que le numéro n'est pas déjà utilisé
      const existant = (await store.list('proformas')).find(p => p.id !== id && p.numero === numeroPatch);
      if (existant) throw new Error('Ce numéro de proforma est déjà utilisé');
      updateData.numero = numeroPatch;
    }

    const rec = await store.update('proformas', id, updateData);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_proforma', cible: rec.numero });
    return rec;
  },

  async modifierClient(store, id, { clientId, clientNom }, userEmail) {
    requireModule('ventes');
    const proforma = await store.get('proformas', id);
    if (!proforma) throw new Error('Facture pro-forma introuvable');
    if (proforma.statut === 'validee') throw new Error('Impossible de modifier une facture pro-forma déjà validée');
    clientId = clientId || null;
    clientNom = !clientId && clientNom ? String(clientNom).trim() : '';
    await store.update('proformas', id, { clientId, clientNom });
    return store.get('proformas', id);
  },

  async valider(store, id, montantPaye, modePaiement, userEmail) {
    requireModule('ventes');
    const proforma = await store.get('proformas', id);
    if (!proforma) throw new Error('Facture pro-forma introuvable');
    if (proforma.statut === 'validee') throw new Error('Cette facture pro-forma est déjà validée');
    const rec = await venteService._finaliserVente(store, {
      lignes: proforma.lignes,
      total: proforma.total,
      // SYSTÈME TVA (§15) : on réutilise les agrégats HT/TVA figés à la
      // création/modification du devis — jamais recalculés à la validation
      // (le devis a pu être créé il y a longtemps, avec un taux depuis
      // changé). Filet de compatibilité pour un devis créé avant
      // l'introduction de ces deux champs.
      totalHT: proforma.totalHT != null ? proforma.totalHT : proforma.total,
      totalVat: proforma.totalVat != null ? proforma.totalVat : 0,
      clientId: proforma.clientId,
      clientNom: proforma.clientNom,
      vendeur: userEmail,
      modePaiement: modePaiement || proforma.modePaiement,
      montantPaye: montantPaye
    });
    // CORRECTIF (audit — bug n°5) : la vente est désormais bien créée — les
    // produits/services "au vol" éventuellement encore `provisoire` de ce
    // devis deviennent définitifs, comme n'importe quel produit vendu.
    await confirmerLignesProvisoires(store, proforma.lignes);
    await store.update('proformas', id, { statut: 'validee', venteId: rec.id, venteNumero: rec.numero, dateValidation: new Date().toISOString() });
    await store.logJournal({ utilisateur: userEmail, action: 'validation_proforma', cible: proforma.numero });
    return rec;
  },

  async supprimer(store, id, userEmail) {
    requireModule('ventes');
    const proforma = await store.get('proformas', id);
    if (!proforma) throw new Error('Facture pro-forma introuvable');
    if (proforma.statut === 'validee') throw new Error('Impossible de supprimer une facture pro-forma déjà validée — elle est liée à une vente réelle');
    // CORRECTIF (audit — bug n°5) : supprime les produits/services "au vol"
    // encore provisoires (jamais validés) créés par ce devis, s'ils ne sont
    // référencés par aucun autre document — évite de polluer durablement le
    // catalogue avec des fiches qui n'ont jamais existé physiquement.
    await nettoyerLignesProvisoires(store, id, proforma.lignes);
    await store.remove('proformas', id);
    await store.logJournal({ utilisateur: userEmail, action: 'suppression_proforma', cible: proforma.numero });
    return true;
  }
};
