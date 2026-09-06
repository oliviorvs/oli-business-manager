// src/services/planComptable.service.js
//
// PHASE 3 — PLAN DE COMPTES
// ============================================================
// Gère la table de correspondance "catégorie interne de l'application ->
// compte du Plan Comptable Général (PCG 2005)" utilisée par le générateur
// d'écritures (voir ecritureComptable.service.js) pour savoir sur quel
// compte imputer chaque transaction (vente, achat, dépense, encaissement…).
//
// Les valeurs par défaut (utils/planComptableDefaults.js) sont de simples
// PROPOSITIONS pour une petite structure commerciale — elles doivent être
// relues et validées par un comptable avant tout export réel (voir
// validerParComptable ci-dessous et meta.planComptableValide).
const { requireAuth } = require('./auth.service');
const { listeComptesParDefaut } = require('../../utils/planComptableDefaults');

// Complète une base (neuve ou existante) avec les comptes par défaut qui ne
// sont pas encore présents, sans jamais toucher à un compte déjà personnalisé
// par l'utilisateur (identifié par sa `categorieInterne`, stable dans le
// temps même si numeroCompte/intitule sont modifiés). Sûr à appeler à
// chaque lecture : idempotent, ne crée rien si tout est déjà présent.
async function assurerComptesParDefaut(store) {
  const existants = await store.list('planComptable');
  const clesExistantes = new Set(existants.map((c) => c.categorieInterne));
  const manquants = listeComptesParDefaut().filter((c) => !clesExistantes.has(c.categorieInterne));
  for (const c of manquants) {
    await store.insert('planComptable', c);
  }
  return manquants.length > 0;
}

module.exports = {
  async list(store) {
    // CORRECTIF (audit — bug n°14) : seul `requireAuth()` (n'importe quel
    // utilisateur connecté) protégeait cette lecture — le rôle 'caissier',
    // qui n'a explicitement accès ni à 'rapports' ni à 'tresorerie' (voir
    // ROLE_PERMISSIONS dans auth.service.js), pouvait malgré tout consulter
    // l'intégralité du plan comptable. On aligne la lecture sur le même
    // périmètre que le reste du module comptable/financier (admin/gestionnaire).
    const s = requireAuth();
    if (s.role !== 'admin' && s.role !== 'gestionnaire') throw new Error('Accès refusé pour votre rôle à ce module : planComptable');
    await assurerComptesParDefaut(store);
    return (await store.list('planComptable')).slice().sort((a, b) => String(a.numeroCompte).localeCompare(String(b.numeroCompte)));
  },

  async statutValidation(store) {
    // CORRECTIF (audit — bug n°14) : même restriction que list() ci-dessus.
    const s = requireAuth();
    if (s.role !== 'admin' && s.role !== 'gestionnaire') throw new Error('Accès refusé pour votre rôle à ce module : planComptable');
    const meta = await store.getMeta();
    return {
      valide: !!meta.planComptableValide,
      validePar: meta.planComptableValidePar || '',
      valideDate: meta.planComptableValideDate || null
    };
  },

  async update(store, id, patch, userEmail) {
    const s = requireAuth();
    if (s.role !== 'admin') throw new Error('Seul un administrateur peut modifier le plan de comptes');
    const compte = await store.get('planComptable', id);
    if (!compte) throw new Error('Compte introuvable');
    const numeroCompte = patch.numeroCompte !== undefined ? String(patch.numeroCompte).trim() : compte.numeroCompte;
    const intitule = patch.intitule !== undefined ? String(patch.intitule).trim() : compte.intitule;
    if (!numeroCompte) throw new Error('Le numéro de compte est requis');
    if (!intitule) throw new Error("L'intitulé du compte est requis");
    const safePatch = { numeroCompte, intitule };
    if (patch.actif !== undefined) safePatch.actif = !!patch.actif;
    const rec = await store.update('planComptable', id, safePatch);
    // CORRECTIF LOGIQUE : toute modification d'un compte invalide la
    // validation comptable précédente (voir DEFAULTS().meta plus haut dans
    // store.js) — un plan de comptes modifié après coup n'a plus été relu
    // par le comptable dans son état courant, tant qu'il ne le revalide pas.
    const metaActuelle = await store.getMeta();
    if (metaActuelle.planComptableValide) {
      await store.updateMeta({
        planComptableValide: false,
        planComptableValidePar: '',
        planComptableValideDate: null
      });
    }
    await store.logJournal({ utilisateur: userEmail, action: 'modification_compte_pcg', cible: rec.categorieInterne });
    return rec;
  },

  async validerParComptable(store, { comptableNom }, userEmail) {
    const s = requireAuth();
    if (s.role !== 'admin') throw new Error('Seul un administrateur peut enregistrer la validation du plan de comptes');
    const nom = String(comptableNom || '').trim();
    if (!nom) throw new Error('Le nom du comptable est requis pour enregistrer la validation');
    await store.updateMeta({
      planComptableValide: true,
      planComptableValidePar: nom,
      planComptableValideDate: new Date().toISOString()
    });
    await store.logJournal({ utilisateur: userEmail, action: 'validation_plan_comptable', cible: nom });
    return this.statutValidation(store);
  },

  _assurerComptesParDefaut: assurerComptesParDefaut
};
