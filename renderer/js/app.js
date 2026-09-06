// ============================================================
// app.js — ORCHESTRATEUR
// Initialise l'application, la navigation, et importe les modules.
// Ne contient plus de logique métier : chaque page / fonctionnalité
// vit désormais dans modules/, components/ ou utils/ (voir Arbre_OBM.txt).
// ============================================================

import { state } from './utils/state.js';
import { qs } from './utils/helpers.js';
import { call } from './utils/api.js';
import { ROLE_MODULES } from './utils/constants.js';
import { initModalUI } from './components/modal.js';
import { setupNotifCenter } from './components/toast.js';
import { initAuthUI, setupReadOnlyToggle } from './modules/auth.js';
import { initSetupUI } from './modules/setup.js';
import { appliquerBrandingConnexion, appliquerBrandingApp } from './modules/branding.js';
import {
  allowed,
  renderNav,
  navigate,
  setupGlobalSearch,
  setupKeyboardShortcuts,
  setupGlobalFullscreenToggle
} from './modules/nav.js';

export async function boot() {
  qs('#auth-screen').style.display = 'none';
  qs('#app-shell').classList.add('active');
  qs('#user-name').textContent = (state.session.prenom ? state.session.prenom + ' ' : '') + state.session.nom;
  qs('#user-role').textContent = state.session.role;
  const initiales = ((state.session.prenom || '')[0] || '') + ((state.session.nom || '')[0] || '');
  const avatar = qs('#user-avatar');
  if (avatar) avatar.textContent = (initiales || 'U').toUpperCase();
  renderNav();
  setupReadOnlyToggle();
  setupNotifCenter();
  navigate(allowed('dashboard') ? 'dashboard' : (ROLE_MODULES[state.session.role] || ['dashboard'])[0]);
  // CORRECTIF (demande client) : affiche le nom/logo de l'entreprise dans la
  // barre supérieure à la place du badge "OLI" statique (voir
  // modules/branding.js). 'settings:get' nécessite une session valide, donc
  // ne peut être appelé qu'ici, une fois connecté.
  try { appliquerBrandingApp(await call('settings:get')); } catch (e) { /* pas bloquant pour l'accès à l'application */ }
}

async function init() {
  initModalUI();
  setupGlobalSearch();
  setupKeyboardShortcuts();
  setupGlobalFullscreenToggle();
  // BUGFIX : initAuthUI() ne fait pas qu'attacher le formulaire de connexion
  // — elle attache aussi les boutons de l'app-shell (déconnexion, mon
  // compte, bascule de thème) sur lesquels boot() s'appuie ensuite. Elle
  // doit donc toujours être appelée, y compris quand l'écran de
  // configuration initiale s'affiche d'abord (setup.js appelle boot()
  // directement une fois la configuration terminée, sans repasser par ici).
  initAuthUI();

  // CORRECTIF SÉCURITÉ (demande client) : tant qu'aucun utilisateur n'existe
  // en base (premier lancement de l'application), l'écran de connexion est
  // remplacé par l'écran de configuration initiale obligatoire — voir
  // modules/setup.js et src/services/setup.service.js. L'ancien compte admin
  // avec mot de passe par défaut public ("admin123") n'existe plus.
  const { needsSetup } = await window.api['setup:status']();
  if (needsSetup) {
    qs('#auth-screen').style.display = 'none';
    qs('#setup-screen').classList.add('active');
    initSetupUI();
    return;
  }

  appliquerBrandingConnexion();
  const session = await window.api['auth:session']();
  if (session) { state.session = session; boot(); }
}

init();
