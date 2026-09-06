// src/services/auth.service.js
const { verifyPassword, hashPassword } = require('../../utils/helpers');
const { isValidEmail } = require('../validators/schemas');

let session = null;

// SÉCURITÉ : protection anti-brute-force. Sans cela, un attaquant local (ou un
// script) pouvait tester des mots de passe en boucle sans aucune limite.
// Verrouillage temporaire après plusieurs échecs consécutifs, par e-mail.
const MAX_TENTATIVES = 5;
const DUREE_VERROUILLAGE_MS = 5 * 60 * 1000; // 5 minutes
const tentativesEchouees = new Map(); // email (lowercase) -> { count, lockedUntil }

function verifierVerrouillage(emailLower) {
  const entry = tentativesEchouees.get(emailLower);
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const restant = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    throw new Error(`Trop de tentatives échouées. Réessayez dans ${restant} seconde(s).`);
  }
}

function enregistrerEchec(emailLower) {
  const entry = tentativesEchouees.get(emailLower) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_TENTATIVES) {
    entry.lockedUntil = Date.now() + DUREE_VERROUILLAGE_MS;
    entry.count = 0;
  }
  tentativesEchouees.set(emailLower, entry);
}

function reinitialiserEchecs(emailLower) {
  tentativesEchouees.delete(emailLower);
}

function requireAuth(store) {
  if (!session) throw new Error('Non authentifié');
  return session;
}
// NOTE : requireAuth/requireAuthSession/requireModule/requireAnyModule ne
// touchent jamais le store — ce sont de simples vérifications de la
// session en mémoire — elles restent volontairement synchrones.

// Permissions (ROLE_PERMISSIONS) – on peut les définir ici ou les importer
const ROLE_PERMISSIONS = {
  admin: { all: true },
  gestionnaire: {
    modules: ['dashboard', 'ventes', 'proformas', 'livraisons', 'stocks', 'produits', 'categories', 'achats', 'fournisseurs', 'rapports', 'clients', 'services', 'depenses']
  },
  caissier: {
    modules: ['dashboard', 'ventes', 'services', 'clients']
  }
};

function can(role, moduleName) {
  if (!ROLE_PERMISSIONS[role]) return false;
  if (ROLE_PERMISSIONS[role].all) return true;
  return ROLE_PERMISSIONS[role].modules.includes(moduleName);
}

function requireAuthSession() {
  if (!session) throw new Error('Non authentifié');
  return session;
}

function requireModule(moduleName) {
  const s = requireAuthSession();
  if (!can(s.role, moduleName)) throw new Error("Accès refusé pour votre rôle à ce module : " + moduleName);
  return s;
}

function requireAnyModule(...moduleNames) {
  const s = requireAuthSession();
  if (!moduleNames.some((m) => can(s.role, m))) {
    throw new Error("Accès refusé pour votre rôle à ce module : " + moduleNames[0]);
  }
  return s;
}

module.exports = {
  // Gestion de session
  getSession: () => session,
  setSession: (s) => { session = s; },
  clearSession: () => { session = null; },

  // Login
  async login(store, { email, password }) {
    const emailLower = String(email).toLowerCase();
    verifierVerrouillage(emailLower);
    const user = (await store.list('utilisateurs')).find((u) => u.email.toLowerCase() === emailLower && u.actif !== false);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      enregistrerEchec(emailLower);
      await store.logJournal({ utilisateur: email, action: 'connexion_echouee' });
      throw new Error('Identifiants invalides');
    }
    reinitialiserEchecs(emailLower);
    session = { id: user.id, nom: user.nom, prenom: user.prenom, email: user.email, role: user.role, doitChangerMotDePasse: !!user.doitChangerMotDePasse };
    await store.logJournal({ utilisateur: user.email, action: 'connexion' });
    return session;
  },

  // Logout
  async logout(store) {
    if (session) await store.logJournal({ utilisateur: session.email, action: 'deconnexion' });
    session = null;
    return true;
  },

  // Changement de mot de passe
  async changePassword(store, { ancien, nouveau }) {
    const s = requireAuthSession();
    const user = await store.get('utilisateurs', s.id);
    if (!verifyPassword(ancien, user.salt, user.hash)) throw new Error('Ancien mot de passe incorrect');
    // SÉCURITÉ : sans ce contrôle, un mot de passe vide ou trop court (ex : "a")
    // pouvait être enregistré, affaiblissant le compte.
    if (!nouveau || String(nouveau).length < 8) {
      throw new Error('Le nouveau mot de passe doit contenir au moins 8 caractères');
    }
    const { salt, hash } = hashPassword(nouveau);
    await store.update('utilisateurs', s.id, { salt, hash, doitChangerMotDePasse: false });
    session = Object.assign({}, session, { doitChangerMotDePasse: false });
    return true;
  },

  // Mise à jour du profil
  async updateProfile(store, { nom, prenom, email }) {
    const s = requireAuthSession();
    if (!nom || !email) throw new Error('Le nom et l\'e-mail sont obligatoires');
    if (!isValidEmail(email)) throw new Error('L\'adresse e-mail n\'est pas valide');
    const doublon = (await store.list('utilisateurs')).find((u) => u.id !== s.id && u.email.toLowerCase() === String(email).toLowerCase());
    if (doublon) throw new Error('Cet e-mail est déjà utilisé par un autre compte');
    await store.update('utilisateurs', s.id, { nom, prenom: prenom || '', email });
    await store.logJournal({ utilisateur: email, action: 'modification_profil' });
    session = Object.assign({}, session, { nom, prenom: prenom || '', email });
    return session;
  },

  // Permissions
  can,
  requireAuth: requireAuthSession,
  requireModule,
  requireAnyModule
};