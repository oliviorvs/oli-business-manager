// src/services/parametre.service.js
const { requireAuth } = require('./auth.service');
const taxService = require('./taxService');

module.exports = {
  // PHASE 7 — SUPPRESSION DE LA COUCHE MÉMOIRE : lecture directe de la
  // ligne `meta` en base (store.getMeta()) au lieu de store.data.meta.
  async get(store) {
    return store.getMeta();
  },

  async update(store, patch, userEmail) {
    const s = requireAuth();
    if (s.role !== 'admin') throw new Error('Seul un administrateur peut modifier les paramètres');
    // CORRECTIF (audit) : tauxTva n'était jamais validé côté serveur — une
    // valeur non numérique était tolérée en silence (elle retombe à 0 partout
    // où elle est utilisée, via `Number(x) || 0`), mais une valeur négative
    // ou aberrante (ex. "1000") était acceptée telle quelle et faussait le
    // détail Total HT / TVA affiché sur les factures (voir
    // renderer/js/components/invoice.js#calculTotaux).
    if (patch && patch.tauxTva !== undefined && patch.tauxTva !== null && String(patch.tauxTva).trim() !== '') {
      const taux = Number(patch.tauxTva);
      if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
        throw new Error('Le taux de TVA doit être un nombre compris entre 0 et 100');
      }
    }
    // SYSTÈME TVA (§2/§16) : validation du taux général de l'entreprise.
    // `vatEnabled` n'a pas besoin d'être validé (simple booléen) ; seul
    // `defaultVatRate` doit être borné 0-100 s'il est fourni. On fusionne
    // avec le taxSettings existant plutôt que d'écraser, pour permettre au
    // renderer d'envoyer un patch partiel (ex. juste { taxSettings: {
    // vatEnabled: false } } en gardant le taux déjà configuré).
    let taxSettingsPatch;
    if (patch && patch.taxSettings) {
      const metaActuelle = await store.getMeta();
      const fusion = Object.assign({}, metaActuelle.taxSettings, patch.taxSettings);
      if (fusion.defaultVatRate !== undefined && fusion.defaultVatRate !== null && String(fusion.defaultVatRate).trim() !== '') {
        fusion.defaultVatRate = taxService.validerTaux(fusion.defaultVatRate, 'Le taux général de TVA');
      }
      fusion.vatEnabled = !!fusion.vatEnabled;
      taxSettingsPatch = fusion;
    }
    const finalPatch = taxSettingsPatch ? Object.assign({}, patch, { taxSettings: taxSettingsPatch }) : patch;
    const meta = await store.updateMeta(finalPatch);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_parametres' });
    return meta;
  }
};
