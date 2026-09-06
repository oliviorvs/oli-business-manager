// src/services/utilisateur.service.js
const { hashPassword, genererMotDePasseTemporaire } = require('../../utils/helpers');
const { validate, isValidEmail } = require('../validators/schemas');
const { requireAuth } = require('./auth.service');

const ROLES_VALIDES = ['admin', 'gestionnaire', 'caissier'];

// CORRECTIF (audit — bug n°12) : chaque autre service du projet applique son
// propre contrôle d'accès EN INTERNE, en plus de tout contrôle fait côté
// main.js (défense en profondeur, principe déjà justifié à plusieurs
// reprises ailleurs dans le projet). utilisateur.service.js était la seule
// exception : create/update/resetPassword/delete ne faisaient aucun appel à
// requireAuth()/vérification de rôle en interne — toute la protection
// reposait uniquement sur les contrôles faits dans src/main.js. Le jour où
// un nouveau canal IPC serait ajouté (ou un handler existant refactoré) sans
// reproduire scrupuleusement le contrôle de rôle, plus rien ne l'empêcherait.
// Ce petit utilitaire centralise le contrôle "admin requis" pour ce module.
function requireAdmin() {
  const s = requireAuth();
  if (s.role !== 'admin') throw new Error('Accès réservé aux administrateurs');
  return s;
}

// SÉCURITÉ / DISPONIBILITÉ : vérifie qu'il restera au moins un compte admin
// actif après avoir retiré (désactivé, rétrogradé ou supprimé) le compte
// `id`. Sans ce garde-fou, un administrateur pouvait désactiver ou
// supprimer tous les autres comptes admin (l'auto-suppression/
// auto-désactivation était déjà bloquée, mais pas celle des AUTRES admins),
// verrouillant l'application : plus personne ne peut alors gérer les
// utilisateurs, réinitialiser un mot de passe ou consulter le journal, sans
// intervention technique hors application.
async function assurerAuMoinsUnAutreAdminActif(store, idExclu) {
  const utilisateurs = await store.list('utilisateurs');
  const resteUnAdmin = utilisateurs.some((u) => u.id !== idExclu && u.role === 'admin' && u.actif !== false);
  if (!resteUnAdmin) {
    throw new Error('Impossible : il doit toujours rester au moins un compte administrateur actif');
  }
}

module.exports = {
  async list(store) {
    requireAdmin();
    return (await store.list('utilisateurs')).map((u) => ({ id: u.id, nom: u.nom, prenom: u.prenom, telephone: u.telephone, email: u.email, role: u.role, actif: u.actif !== false }));
  },

  async create(store, payload, userEmail) {
    requireAdmin();
    // SÉCURITÉ : sans ces contrôles, un email invalide passait tel quel (impossible
    // ensuite de contacter l'utilisateur ou de lui réinitialiser son mot de passe),
    // et un rôle arbitraire (fautes de frappe, chaîne vide, etc.) créait un compte
    // sans aucune permission (ROLE_PERMISSIONS[role] introuvable) sans avertir l'admin.
    const errors = validate('utilisateur', payload || {});
    if (errors.length) throw new Error(errors.join(' ; '));
    if (payload.password && payload.password.length < 8) {
      throw new Error('Le mot de passe doit contenir au moins 8 caractères');
    }
    if ((await store.list('utilisateurs')).some((u) => u.email.toLowerCase() === String(payload.email).toLowerCase())) throw new Error('Cet e-mail est déjà utilisé');
    // CORRECTIF SÉCURITÉ : 'changeme123' était un mot de passe par défaut fixe
    // et public (visible dans le code source) — équivalent à une absence de
    // mot de passe. On génère désormais un mot de passe temporaire aléatoire
    // quand l'admin n'en saisit pas un, et on oblige son changement à la
    // première connexion.
    const motDePasseGenere = !payload.password;
    const motDePasseInitial = payload.password || genererMotDePasseTemporaire();
    const { salt, hash } = hashPassword(motDePasseInitial);
    const rec = await store.insert('utilisateurs', { nom: payload.nom, prenom: payload.prenom || '', telephone: payload.telephone || '', email: payload.email, role: payload.role, actif: true, salt, hash, doitChangerMotDePasse: true });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_utilisateur', cible: rec.id });
    return {
      id: rec.id, nom: rec.nom, email: rec.email, role: rec.role,
      // Communiqué une seule fois à l'admin pour transmission à l'utilisateur ;
      // jamais stocké en clair ni renvoyé par la suite (voir list() ci-dessus).
      motDePasseTemporaire: motDePasseGenere ? motDePasseInitial : undefined
    };
  },

  async update(store, id, patch, currentUserId, userEmail) {
    requireAdmin();
    if (patch && patch.email) {
      if (!isValidEmail(patch.email)) throw new Error('L\'adresse e-mail n\'est pas valide');
      const doublon = (await store.list('utilisateurs')).find((u) => u.id !== id && u.email.toLowerCase() === String(patch.email).toLowerCase());
      if (doublon) throw new Error('Cet e-mail est déjà utilisé par un autre compte');
    }
    if (patch && patch.role && !ROLES_VALIDES.includes(patch.role)) {
      throw new Error('Rôle invalide');
    }
    if (id === currentUserId) {
      if (patch && patch.actif === false) throw new Error('Vous ne pouvez pas désactiver votre propre compte');
      if (patch && patch.role) {
        const actuel = await store.get('utilisateurs', id);
        if (patch.role !== actuel.role) throw new Error('Vous ne pouvez pas modifier votre propre rôle');
      }
    }
    const cible = await store.get('utilisateurs', id);
    if (cible && cible.role === 'admin' && cible.actif !== false) {
      const vaDesactiver = patch && patch.actif === false;
      const vaRetrograder = patch && patch.role && patch.role !== 'admin';
      if (vaDesactiver || vaRetrograder) {
        await assurerAuMoinsUnAutreAdminActif(store, id);
      }
    }
    const r = await store.update('utilisateurs', id, patch);
    await store.logJournal({ utilisateur: userEmail, action: 'modification_utilisateur', cible: cible ? cible.email : id });
    return r;
  },

  async resetPassword(store, id, newPassword) {
    const s = requireAdmin();
    if (newPassword && newPassword.length < 8) {
      throw new Error('Le mot de passe doit contenir au moins 8 caractères');
    }
    // CORRECTIF SÉCURITÉ : voir create() ci-dessus — même remplacement du
    // mot de passe par défaut prévisible par un mot de passe temporaire
    // aléatoire à usage unique, avec obligation de le changer à la reconnexion.
    const motDePasseGenere = !newPassword;
    const motDePasseFinal = newPassword || genererMotDePasseTemporaire();
    const { salt, hash } = hashPassword(motDePasseFinal);
    const cible = await store.get('utilisateurs', id);
    await store.update('utilisateurs', id, { salt, hash, doitChangerMotDePasse: true });
    // CORRECTIF (audit — nouvelle passe, bug n°6) : cette action sensible
    // (réinitialisation de mot de passe) n'était jamais journalisée, alors que
    // create()/update() du même fichier le font. On ne journalise jamais le
    // mot de passe lui-même, seulement le fait qu'une réinitialisation a eu lieu.
    await store.logJournal({ utilisateur: s.email, action: 'reinitialisation_mot_de_passe', cible: cible ? cible.email : id });
    return { ok: true, motDePasseTemporaire: motDePasseGenere ? motDePasseFinal : undefined };
  },

  async delete(store, id, currentUserId) {
    const s = requireAdmin();
    if (id === currentUserId) throw new Error('Vous ne pouvez pas supprimer votre propre compte');
    const cible = await store.get('utilisateurs', id);
    if (cible && cible.role === 'admin' && cible.actif !== false) {
      await assurerAuMoinsUnAutreAdminActif(store, id);
    }
    await store.remove('utilisateurs', id);
    // CORRECTIF (audit — nouvelle passe, bug n°6) : la suppression d'un compte
    // utilisateur — action sensible — n'était jamais journalisée.
    await store.logJournal({ utilisateur: s.email, action: 'suppression_utilisateur', cible: cible ? cible.email : id });
    return true;
  }
};