import { boot } from '../app.js';
import { closeModal, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { esc, h, lsGet, lsSet, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export function isReadOnlyModeActive() {
  return state.session && state.session.role === 'caissier' && !!state.readOnlyMode;
}
export function setupReadOnlyToggle() {
  const wrap = qs('#readonly-mode-wrap');
  if (!wrap) return;
  if (state.session && state.session.role === 'caissier') {
    state.readOnlyMode = !!lsGet('readonly-mode', false);
    wrap.innerHTML = `<label class="flex items-center gap-6 fs-12_5" title="Griser les prix et remises dans les formulaires de vente">
      <input type="checkbox" id="readonly-mode-toggle" ${state.readOnlyMode ? 'checked' : ''} />
      Mode lecture seule (prix/remises)
    </label>`;
    qs('#readonly-mode-toggle').addEventListener('change', (e) => {
      state.readOnlyMode = e.target.checked;
      lsSet('readonly-mode', state.readOnlyMode);
      toast(state.readOnlyMode ? 'Mode lecture seule activé' : 'Mode lecture seule désactivé', 'info');
    });
  } else {
    wrap.innerHTML = '';
  }
}

// ------------------------- Pagination réelle des listes -------------------------
// Découpe une liste en pages (10/20/50 lignes) au lieu de tout afficher d'un
// coup ou de tronquer silencieusement (ex. l'ancien "slice(0, 200)" des
// mouvements de stock). La taille de page choisie et la page courante sont
// mémorisées par liste (pageKey) et par utilisateur.
// ------------------------- Thème clair / sombre -------------------------
export function appliquerTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  qsa('.theme-toggle-btn').forEach((btn) => {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre';
  });
}
export function basculerTheme() {
  const actuel = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const suivant = actuel === 'dark' ? 'light' : 'dark';
  appliquerTheme(suivant);
  try { localStorage.setItem('oli-theme', suivant); } catch (e) { /* localStorage indisponible */ }
}
export function openMonCompteForm(options = {}) {
  const { ongletInitial = 'profil', obligatoire = false } = options;
  const s = state.session;
  const body = h(`<div>
    ${obligatoire ? `<div class="alert alert-warning mb-12">Vous utilisez un mot de passe temporaire. Choisissez un nouveau mot de passe pour continuer.</div>` : ''}
    <div class="tabs">
      <div class="tab${ongletInitial === 'profil' ? ' active' : ''}" data-tab="profil">Profil</div>
      <div class="tab${ongletInitial === 'mdp' ? ' active' : ''}" data-tab="mdp">Mot de passe</div>
    </div>
    <div id="tab-profil" class="${ongletInitial === 'profil' ? '' : 'hidden'}">
      <div class="two-col">
        <div class="field"><label>Nom</label><input id="mc-nom" value="${esc(s.nom)}" /></div>
        <div class="field"><label>Prénom</label><input id="mc-prenom" value="${esc(s.prenom || '')}" /></div>
      </div>
      <div class="field"><label>E-mail</label><input id="mc-email" type="email" value="${esc(s.email)}" /></div>
    </div>
    <div id="tab-mdp" class="${ongletInitial === 'mdp' ? '' : 'hidden'}">
      <div class="field"><label>Mot de passe actuel${obligatoire ? ' (temporaire)' : ''}</label><input id="mc-ancien" type="password" /></div>
      <div class="field"><label>Nouveau mot de passe</label><input id="mc-nouveau" type="password" placeholder="8 caractères minimum" /></div>
    </div>
  </div>`);
  qsa('.tab', body).forEach((t) => t.addEventListener('click', () => {
    qsa('.tab', body).forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    qs('#tab-profil', body).style.display = t.dataset.tab === 'profil' ? 'block' : 'none';
    qs('#tab-mdp', body).style.display = t.dataset.tab === 'mdp' ? 'block' : 'none';
  }));
  // CORRECTIF SÉCURITÉ : quand le changement de mot de passe est obligatoire
  // (mot de passe temporaire), aucun bouton "Fermer" n'est proposé et la
  // fermeture par la croix / la touche Échap est neutralisée — l'utilisateur
  // doit définir un nouveau mot de passe avant de pouvoir continuer.
  const boutons = obligatoire
    ? [{ label: 'Enregistrer', cls: 'btn-primary', onClick: null }]
    : [
        { label: 'Fermer', cls: 'btn-ghost', onClick: closeModal },
        { label: 'Enregistrer', cls: 'btn-primary', onClick: null }
      ];
  const enregistrer = async () => {
    const activeTab = qs('.tab.active', body).dataset.tab;
    if (activeTab === 'profil') {
      if (obligatoire) { toast('Changez d\'abord votre mot de passe temporaire', 'error'); return; }
      const nom = qs('#mc-nom', body).value.trim();
      const email = qs('#mc-email', body).value.trim();
      if (!nom || !email) { toast('Le nom et l\'e-mail sont obligatoires', 'error'); return; }
      try {
        const updated = await window.api['auth:updateProfile']({ nom, prenom: qs('#mc-prenom', body).value.trim(), email });
        state.session = updated;
        qs('#user-name').textContent = (updated.prenom ? updated.prenom + ' ' : '') + updated.nom;
        toast('Profil mis à jour', 'success'); closeModal();
      } catch (err) { toast(err.message, 'error'); }
    } else {
      const ancien = qs('#mc-ancien', body).value;
      const nouveau = qs('#mc-nouveau', body).value;
      if (nouveau.length < 8) { toast('8 caractères minimum', 'error'); return; }
      try {
        await window.api['auth:changePassword']({ ancien, nouveau });
        state.session = Object.assign({}, state.session, { doitChangerMotDePasse: false });
        toast('Mot de passe modifié', 'success'); closeModal();
      } catch (err) { toast(err.message, 'error'); }
    }
  };
  boutons.find((b) => b.label === 'Enregistrer').onClick = enregistrer;
  openModal('Mon compte', body, boutons, obligatoire ? { fermetureBloquee: true } : undefined);
}

// ------------------------- Navigation -------------------------

export function initAuthUI() {
qs('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = qs('#login-email').value.trim();
  const password = qs('#login-password').value;
  const errBox = qs('#login-error');
  const submitBtn = qs('#login-submit');
  errBox.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Connexion…';
  try {
    const session = await window.api['auth:login']({ email, password });
    state.session = session;
    try { localStorage.setItem('oli-last-username', email); } catch (e2) { /* localStorage indisponible */ }
    boot();
    // CORRECTIF SÉCURITÉ : force le changement de mot de passe temporaire
    // (compte créé sans mot de passe fourni, réinitialisé par un admin, ou
    // compte admin de seed) avant de laisser l'utilisateur travailler.
    if (session.doitChangerMotDePasse) {
      toast('Mot de passe temporaire : veuillez le changer maintenant', 'info');
      openMonCompteForm({ ongletInitial: 'mdp', obligatoire: true });
    }
  } catch (err) {
    errBox.textContent = err.message || 'Erreur de connexion';
    errBox.style.display = 'block';
  } finally {
    // BUGFIX : le bouton restait bloqué sur "Connexion…" après une déconnexion,
    // empêchant toute reconnexion ultérieure (le succès ne le réactivait jamais).
    submitBtn.disabled = false;
    submitBtn.textContent = 'Se connecter';
  }
});

qs('#login-toggle-pass').addEventListener('click', () => {
  const input = qs('#login-password');
  const btn = qs('#login-toggle-pass');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  btn.textContent = visible ? 'Afficher' : 'Masquer';
});


try {
  const dernierUsername = localStorage.getItem('oli-last-username');
  if (dernierUsername) {
    qs('#login-email').value = dernierUsername;
    qs('#login-password').focus();
  } else {
    qs('#login-email').focus();
  }
} catch (e) {
  qs('#login-email').focus();
}

qs('#btn-theme').classList.add('theme-toggle-btn');
qs('#btn-theme-login').classList.add('theme-toggle-btn');
qs('#btn-theme').addEventListener('click', basculerTheme);
qs('#btn-theme-login').addEventListener('click', basculerTheme);
appliquerTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

qs('#btn-logout').addEventListener('click', async () => {
  await window.api['auth:logout']();
  state.session = null;
  qs('#app-shell').classList.remove('active');
  qs('#auth-screen').style.display = 'flex';
  qs('#login-password').value = '';
  // BUGFIX : s'assurer que le formulaire de connexion est bien réactivé
  const submitBtn = qs('#login-submit');
  submitBtn.disabled = false;
  submitBtn.textContent = 'Se connecter';
  qs('#login-error').style.display = 'none';
  qs('#login-email').focus();
});

qs('#btn-account').addEventListener('click', () => openMonCompteForm());

// CORRECTIF (demande client) : le logo ET le nom de l'entreprise affichés
// sur cet écran (badge #auth-logo-fallback/#auth-logo-img + titre
// #auth-title) sont désormais appliqués depuis app.js#init, via
// modules/branding.js#appliquerBrandingConnexion — centralisé au même
// endroit que la personnalisation de la barre supérieure de l'application
// (voir modules/branding.js#appliquerBrandingApp, appelée depuis boot()).
}

