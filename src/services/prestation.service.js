// src/services/prestation.service.js
const { requireModule, requireAuth } = require('./auth.service');
// CORRECTIF (audit — nouvelle passe, bug n°5) : ventes, achats, proformas et
// bons de livraison sont tous unifiés sur numeroSequentielMensuel (voir bug
// n°6 de CORRECTIFS_AUDIT_3.md), via venteService._numeroSequentiel. Ce
// fichier gardait l'ancien schéma basé sur Date.now(), incohérent avec le
// reste de l'application et théoriquement sujet à collision en cas de
// créations simultanées à la même milliseconde.
const venteService = require('./vente.service');
const taxService = require('./taxService');

module.exports = {
  async list(store) {
    requireModule('services');
    return (await store.list('prestations')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async create(store, payload, userEmail) {
    requireModule('services');
    const service = await store.get('services', payload.serviceId);
    if (!service) throw new Error('Service introuvable');
    const clientId = payload.clientId || null;
    const clientNom = !clientId && payload.clientNom ? String(payload.clientNom).trim() : '';
    // CORRECTIF : le total était calculé à partir de payload.prixUnitaire
    // brut (potentiellement vide/NaN si le champ était laissé vide), alors
    // que le prixUnitaire réellement enregistré retombait déjà sur
    // service.prixDefaut dans ce cas — le montant total ne correspondait donc
    // pas au prix affiché/enregistré. On résout maintenant le prix final une
    // seule fois (saisie manuelle si fournie et valide, sinon prix par
    // défaut du service), et on l'utilise pour le calcul ET l'enregistrement.
    let prixUnitaireFinal = service.prixDefaut;
    if (payload.prixUnitaire !== undefined && payload.prixUnitaire !== null && payload.prixUnitaire !== '') {
      const puSaisi = Number(payload.prixUnitaire);
      if (!Number.isFinite(puSaisi) || puSaisi < 0) throw new Error('Prix unitaire invalide');
      prixUnitaireFinal = puSaisi;
    }
    const quantite = Number(payload.quantite) || 1;
    const remise = Number(payload.remise) || 0;
    if (remise < 0 || remise > 100) throw new Error('Remise invalide (doit être comprise entre 0 et 100)');
    const total = Math.round((quantite * prixUnitaireFinal * (1 - remise / 100)) * 100) / 100;
    // SYSTÈME TVA (§7) : prixUnitaireFinal est désormais HORS TAXE — le
    // total ci-dessus est donc le total HT de la prestation. `total` (le
    // champ enregistré, réutilisé pour la trésorerie) devient le TTC, pour
    // rester l'exact montant encaissé, comme pour les ventes.
    const meta = await store.getMeta();
    const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 0 };
    const tauxPrestation = taxService.getEffectiveVatRate(service, taxSettings);
    const detail = taxService.calculateLineFromHT(total, tauxPrestation);
    const numero = await venteService._numeroSequentiel(store, 'prestations');
    const rec = await store.insert('prestations', {
      numero: 'PS' + numero,
      serviceId: payload.serviceId,
      serviceNom: service.nom,
      details: payload.details ? String(payload.details).trim() : '',
      unite: service.unite || 'Prestation',
      clientId,
      clientNom,
      employe: userEmail,
      quantite,
      prixUnitaire: prixUnitaireFinal,
      remise,
      totalHT: detail.totalHT,
      vatRate: detail.vatRate,
      vatAmount: detail.vatAmount,
      total: detail.totalTTC,
      statut: 'active'
    });
    await store.insert('operationsTresorerie', { type: 'entree', categorie: 'Service : ' + service.nom, montant: rec.total, reference: rec.numero, description: 'Encaissement prestation' });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_prestation', cible: rec.id });
    return rec;
  },

  // CORRECTIF (audit) : aucune prestation autonome ne pouvait être annulée
  // ou supprimée — contrairement aux ventes/achats qui ont les deux. Une
  // prestation enregistrée par erreur (mauvais prix, mauvais client,
  // doublon) ne pouvait jamais être corrigée. Calqué sur le pattern
  // annuler/supprimer de vente.service.js : pas de stock à restituer ici
  // (une prestation n'a pas de ligne "produit"), donc pas de transaction
  // multi-lignes nécessaire — seulement statut + contre-écriture trésorerie.
  async annuler(store, id, userEmail) {
    requireModule('services');
    const prestation = await store.get('prestations', id);
    if (!prestation) throw new Error('Prestation introuvable');
    // Une prestation issue d'une vente (venteId défini) est gérée par
    // l'annulation de la vente elle-même (voir vente.service.js, qui
    // cascade le statut sur ses prestations liées) — l'annuler ici
    // directement désynchroniserait son statut de celui de la vente.
    if (prestation.venteId) throw new Error('Cette prestation est liée à une vente : annulez la vente pour l\'annuler');
    if (prestation.statut === 'annulee') throw new Error('Cette prestation est déjà annulée');
    await store.transaction((tx) => {
      tx.update('prestations', id, { statut: 'annulee' });
      if (prestation.total > 0) {
        tx.insert('operationsTresorerie', { type: 'sortie', categorie: 'Annulation prestation', montant: prestation.total, reference: prestation.numero, description: 'Annulation de la prestation ' + prestation.numero });
      }
      tx.logJournal({ utilisateur: userEmail, action: 'annulation_prestation', cible: id });
    });
    return true;
  },

  async supprimer(store, id, userEmail) {
    const prestation = await store.get('prestations', id);
    if (!prestation) throw new Error('Prestation introuvable');
    if (prestation.venteId) throw new Error('Cette prestation est liée à une vente : supprimez-la via la vente');
    if (prestation.statut !== 'annulee') throw new Error('Seule une prestation déjà annulée peut être supprimée définitivement');
    await store.transaction((tx) => {
      tx.removeWhere('operationsTresorerie', (o) => o.reference === prestation.numero);
      tx.remove('prestations', id);
      tx.logJournal({ utilisateur: userEmail, action: 'suppression_definitive_prestation', cible: prestation.numero });
    });
    return true;
  }
};