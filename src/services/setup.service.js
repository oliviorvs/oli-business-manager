// src/services/setup.service.js
//
// CONFIGURATION INITIALE (demande client) — premier lancement obligatoire.
// ============================================================
// Avant ce correctif, la base était amorcée avec un compte admin fixe
// (admin@local / admin123, voir l'historique de src/store/store.js) : un
// mot de passe par défaut PUBLIC (visible dans le code source), identique
// sur toutes les installations, qu'il fallait penser à changer soi-même
// après coup. Ce module remplace entièrement cette approche : tant
// qu'aucun utilisateur n'existe en base (premier lancement, ou base
// utilisateurs vidée), l'application affiche un écran de configuration
// obligatoire (voir renderer/js/modules/setup.js) qui demande le nom de
// l'entreprise, le nom de l'administrateur et le mot de passe qu'il
// souhaite utiliser — aucun mot de passe n'est jamais choisi à sa place.
const { hashPassword } = require('../../utils/helpers');
const { isValidEmail } = require('../validators/schemas');
const authService = require('./auth.service');

module.exports = {
  // Utilisé à la fois par le handler IPC 'setup:status' (affichage de
  // l'écran au démarrage) et comme garde-fou dans completeInitialSetup
  // ci-dessous (défense en profondeur : un appel IPC forgé ne doit jamais
  // pouvoir recréer un compte admin ou écraser l'entreprise déjà
  // configurée une fois qu'au moins un utilisateur existe).
  async needsSetup(store) {
    const utilisateurs = await store.list('utilisateurs');
    return utilisateurs.length === 0;
  },

  async completeInitialSetup(store, payload) {
    if (!(await this.needsSetup(store))) {
      throw new Error('La configuration initiale a déjà été effectuée');
    }
    const p = payload || {};
    const entrepriseName = String(p.entrepriseName || '').trim();
    const adminNom = String(p.adminNom || '').trim();
    const adminPrenom = String(p.adminPrenom || '').trim();
    const adminEmail = String(p.adminEmail || '').trim();
    const adminPassword = String(p.adminPassword || '');

    if (!entrepriseName) throw new Error("Le nom de l'entreprise est obligatoire");
    if (!adminNom) throw new Error("Le nom de l'administrateur est obligatoire");
    if (!adminEmail || !isValidEmail(adminEmail)) throw new Error("L'adresse e-mail de l'administrateur n'est pas valide");
    if (!adminPassword || adminPassword.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères');

    const { salt, hash } = hashPassword(adminPassword);
    await store.insert('utilisateurs', {
      nom: adminNom,
      prenom: adminPrenom,
      telephone: '',
      email: adminEmail,
      role: 'admin',
      actif: true,
      salt,
      hash,
      // Choisi explicitement par l'administrateur lui-même ici (contrairement
      // à un mot de passe temporaire généré) : pas de changement forcé à la
      // prochaine connexion.
      doitChangerMotDePasse: false
    });

    // CORRECTIF (demande client) : remplace le nom "OLI Business Manager"
    // et le logo OLI par défaut par ceux de l'entreprise dès la
    // configuration initiale — voir renderer/index.html (écran de connexion
    // et barre supérieure de l'application). Si aucun logo n'est fourni,
    // logoDataUrl est explicitement vidé (au lieu de garder le logo OLI par
    // défaut hérité de DEFAULTS().meta) : l'interface retombe alors sur un
    // badge affichant l'initiale du nom de l'entreprise.
    await store.updateMeta({
      entrepriseName,
      logoDataUrl: p.logoDataUrl || ''
    });
    await store.logJournal({ utilisateur: adminEmail, action: 'configuration_initiale' });

    // Connecte directement la personne qui vient de terminer la
    // configuration, pour lui éviter d'avoir à ressaisir immédiatement les
    // identifiants qu'elle vient tout juste de choisir.
    return authService.login(store, { email: adminEmail, password: adminPassword });
  }
};
