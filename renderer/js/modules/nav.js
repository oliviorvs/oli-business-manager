import { renderAchats } from './achats.js';
import { renderClients } from './clients.js';
import { disposeDashboardCharts, renderDashboard } from './dashboard.js';
import { renderDepenses } from './depenses.js';
import { renderFournisseurs } from './fournisseurs.js';
import { renderJournal } from './journal.js';
import { renderLivraisons } from './livraisons.js';
import { renderParametres } from './parametres.js';
import { renderProduits } from './produits.js';
import { renderProformas } from './proformas.js';
import { renderRapports } from './rapports.js';
import { renderRecettes } from './recettes.js';
import { renderServices } from './services.js';
import { renderStocks } from './stocks.js';
import { renderTresorerie } from './tresorerie.js';
import { renderVentes } from './ventes.js';
import { call } from '../utils/api.js';
import { MODULE_NEW_BTN, NAV, ROLE_MODULES } from '../utils/constants.js';
import { esc, h, money, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export function allowed(moduleKey) {
  const list = ROLE_MODULES[state.session.role];
  return list === null || list.includes(moduleKey);
}

// ------------------------- Barre de navigation horizontale -------------------------
// Regroupe les modules par catégorie (Aperçu, Opérations, Stocks & Achats,
// Finance, Administration) dans la barre du haut. Une catégorie qui ne
// contient (pour le rôle courant) qu'une seule entrée devient un lien direct ;
// les autres s'ouvrent en menu déroulant au survol.
export function renderNav() {
  if (state.currentModule !== 'dashboard') disposeDashboardCharts();
  const container = qs('#nav-container');
  container.innerHTML = '';
  NAV.forEach((group) => {
    const visibleItems = group.items.filter((i) => allowed(i.module));
    if (!visibleItems.length) return;
    const groupHasCurrent = visibleItems.some((i) => i.key === state.currentModule);

    if (visibleItems.length === 1) {
      const item = visibleItems[0];
      const el = h(`<div class="topnav-item${item.key === state.currentModule ? ' active' : ''}">
        <a href="#" class="topnav-link" data-key="${item.key}">${esc(group.group)}</a>
      </div>`);
      qs('.topnav-link', el).addEventListener('click', (e) => { e.preventDefault(); navigate(item.key); });
      container.appendChild(el);
      return;
    }

    const el = h(`<div class="topnav-item${groupHasCurrent ? ' active' : ''}">
      <a href="#" class="topnav-link">${esc(group.group)} <span class="caret">▾</span></a>
      <div class="dropdown">
        ${visibleItems.map((item) => `<a href="#" class="dropdown-item${item.key === state.currentModule ? ' active' : ''}" data-key="${item.key}"><span class="nav-icon">${item.icon}</span>${esc(item.label)}</a>`).join('')}
      </div>
    </div>`);
    qs('.topnav-link', el).addEventListener('click', (e) => e.preventDefault());
    qsa('.dropdown-item', el).forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.dataset.key); });
    });
    container.appendChild(el);
  });
}

export function navigate(key) {
  state.currentModule = key;
  renderNav();
  const renderers = {
    dashboard: renderDashboard, ventes: renderVentes, proformas: renderProformas, livraisons: renderLivraisons, services: renderServices, clients: renderClients,
    produits: renderProduits, stocks: renderStocks, achats: renderAchats, fournisseurs: renderFournisseurs,
    recettes: renderRecettes,
    depenses: renderDepenses, tresorerie: renderTresorerie, rapports: renderRapports,
    journal: renderJournal, parametres: renderParametres
  };
  (renderers[key] || renderDashboard)();
}

// ------------------------- Recherche globale (en-tête) -------------------------
// Retrouve rapidement une vente (par numéro), un client (nom/téléphone) ou un
// produit (code/désignation) depuis n'importe quelle page, sans naviguer
// manuellement vers le bon module au préalable.
let globalSearchTimer = null;
export function setupGlobalSearch() {
  const input = qs('#global-search');
  const resultsBox = qs('#global-search-results');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    clearTimeout(globalSearchTimer);
    const q = input.value.trim();
    if (!q) { resultsBox.classList.remove('open'); resultsBox.innerHTML = ''; return; }
    globalSearchTimer = setTimeout(() => runGlobalSearch(q), 200);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) resultsBox.classList.add('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.global-search-wrap')) resultsBox.classList.remove('open'); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.blur(); resultsBox.classList.remove('open'); } });
}

export async function runGlobalSearch(q) {
  if (!state.session) return;
  const resultsBox = qs('#global-search-results');
  const ql = q.toLowerCase();
  try {
    const jobs = [];
    if (allowed('ventes')) jobs.push(call('ventes:list').then((l) => ({ type: 'ventes', items: l.filter((v) => v.numero.toLowerCase().includes(ql)).slice(0, 5) })));
    if (allowed('clients')) jobs.push(call('clients:list').then((l) => ({ type: 'clients', items: l.filter((c) => ((c.numero || '') + c.nom + c.prenom + (c.telephone || '')).toLowerCase().includes(ql)).slice(0, 5) })));
    if (allowed('produits')) jobs.push(call('produits:list').then((l) => ({ type: 'produits', items: l.filter((p) => ((p.code || '') + p.designation).toLowerCase().includes(ql)).slice(0, 5) })));
    const groups = await Promise.all(jobs);
    const labels = { ventes: 'Ventes', clients: 'Clients', produits: 'Produits' };
    let html = '';
    groups.forEach((g) => {
      if (!g.items.length) return;
      html += `<div class="global-search-group-label">${labels[g.type]}</div>`;
      if (g.type === 'ventes') html += g.items.map((v) => `<div class="global-search-item" data-nav="ventes" data-q="${esc(v.numero)}"><span>${esc(v.numero)}</span><span class="gs-sub">${money(v.total)}</span></div>`).join('');
      if (g.type === 'clients') html += g.items.map((c) => `<div class="global-search-item" data-nav="clients" data-q="${esc(c.nom)}"><span>${esc(c.nom)} ${esc(c.prenom)}</span><span class="gs-sub">${esc(c.telephone || '')}</span></div>`).join('');
      if (g.type === 'produits') html += g.items.map((p) => `<div class="global-search-item" data-nav="produits" data-q="${esc(p.designation)}"><span>${esc(p.designation)}</span><span class="gs-sub">${money(p.prixVente)}</span></div>`).join('');
    });
    resultsBox.innerHTML = html || `<div class="global-search-empty">Aucun résultat pour « ${esc(q)} »</div>`;
    resultsBox.classList.add('open');
    qsa('.global-search-item', resultsBox).forEach((item) => item.addEventListener('click', async () => {
      resultsBox.classList.remove('open');
      const nav = item.dataset.nav, filterQ = item.dataset.q || '';
      qs('#global-search').value = '';
      state.currentModule = nav; renderNav();
      if (nav === 'ventes') { await renderVentes(); const si = qs('#ventes-search'); if (si) { si.value = filterQ; si.dispatchEvent(new Event('input')); } }
      else if (nav === 'clients') { await renderClients(); const si = qs('#client-search'); if (si) { si.value = filterQ; si.dispatchEvent(new Event('input')); } }
      else if (nav === 'produits') { await renderProduits(); const si = qs('#p-search'); if (si) { si.value = filterQ; si.dispatchEvent(new Event('input')); } }
    }));
  } catch (e) { /* recherche silencieuse en cas d'erreur réseau/permission */ }
}

// ------------------------- Raccourcis clavier -------------------------
// Ctrl/Cmd+N : nouvel enregistrement du module courant
// Ctrl/Cmd+S : enregistrer le formulaire ouvert (modale)
// Ctrl/Cmd+F : focus sur la recherche globale
export function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const key = e.key.toLowerCase();
    if (key === 'f') {
      e.preventDefault();
      qs('#global-search')?.focus();
      return;
    }
    if (key === 's') {
      const primaryBtn = qs('#modal-overlay-2.active #modal-primary-btn-2') || qs('#modal-overlay.active #modal-primary-btn');
      if (primaryBtn) { e.preventDefault(); primaryBtn.click(); }
      return;
    }
    if (key === 'n') {
      // N'ouvre pas la création si une modale est déjà ouverte (évite les conflits).
      if (qs('#modal-overlay.active') || qs('#modal-overlay-2.active')) return;
      const sel = MODULE_NEW_BTN[state.currentModule];
      const btn = sel && qs(sel);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });
}


// ------------------------- Mode plein écran (pages lourdes) -------------------------
// Bascule un mode « focus » qui masque le bandeau latéral et l'en-tête pour
// donner davantage d'espace au tableau de bord ou aux rapports — utile en
// vidéoprojection ou sur petit écran. Tente en plus le vrai plein écran du
// système d'exploitation quand l'API est disponible (sans bloquer si refusée).
export function isFocusModeActive() { return document.body.classList.contains('focus-mode'); }
export function toggleFocusMode() {
  const active = document.body.classList.toggle('focus-mode');
  if (active) { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch (e) {} }
  else { try { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); } catch (e) {} }
  qsa('[data-focus-mode-btn]').forEach((b) => { b.textContent = active ? '⛶ Quitter le plein écran' : '⛶ Plein écran'; });
  return active;
}
export function fullscreenToggleBtnHtml(id) {
  return `<button type="button" class="btn btn-ghost btn-sm btn-fullscreen-toggle" id="${id}" data-focus-mode-btn data-tip="Masquer le menu pour plus d'espace">⛶ Plein écran</button>`;
}
export function bindFullscreenToggle(id) {
  const btn = qs('#' + id);
  if (btn) btn.addEventListener('click', () => toggleFocusMode());
}
// CORRECTIF : le bouton "Plein écran" n'était disponible que sur le tableau
// de bord et les rapports. Il est désormais dans l'en-tête globale
// (#global-fullscreen-btn, présente sur toutes les pages) et accessible à
// tous les rôles. #focus-mode-exit-btn (dans .focus-mode-exit-bar) sert
// d'issue de secours à la souris puisque l'en-tête — donc le bouton
// global — est masquée une fois le mode plein écran actif.
export function setupGlobalFullscreenToggle() {
  bindFullscreenToggle('global-fullscreen-btn');
  bindFullscreenToggle('focus-mode-exit-btn');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isFocusModeActive()) toggleFocusMode(); });
}
