import { dateOnlyFr, esc, h, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export function pushNotification(message, type = 'info') {
  const entry = { id: 'ntf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), message, type, date: new Date().toISOString(), read: false };
  state.notifications.unshift(entry);
  if (state.notifications.length > 100) state.notifications.length = 100;
  renderNotifPanel();
  updateNotifBadge();
}
export function updateNotifBadge() {
  const badge = qs('#notif-badge');
  if (!badge) return;
  const unread = state.notifications.filter((n) => !n.read).length;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}
export function timeAgoFr(iso) {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'à l\'instant';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return dateOnlyFr(iso);
}
export function renderNotifPanel() {
  const list = qs('#notif-panel-list');
  if (!list) return;
  if (!state.notifications.length) { list.innerHTML = '<div class="notif-panel-empty">Aucune notification pour le moment.</div>'; return; }
  list.innerHTML = state.notifications.map((n) => `
    <div class="notif-item ${n.type} ${n.read ? '' : 'unread'}" data-id="${n.id}">
      <span class="notif-dot"></span>
      <div class="notif-item-body">
        <div class="notif-item-msg">${esc(n.message)}</div>
        <div class="notif-item-time">${esc(timeAgoFr(n.date))}</div>
      </div>
      <button type="button" class="notif-item-close" data-notif-close="${n.id}" title="Effacer">✕</button>
    </div>`).join('');
  qsa('[data-notif-close]', list).forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.notifications = state.notifications.filter((n) => n.id !== btn.dataset.notifClose);
    renderNotifPanel(); updateNotifBadge();
  }));
}
export function setupNotifCenter() {
  const bell = qs('#notif-bell-btn');
  const panel = qs('#notif-panel');
  if (!bell || bell.dataset.bound) return;
  bell.dataset.bound = '1';
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !panel.classList.contains('open');
    panel.classList.toggle('open', willOpen);
    if (willOpen) { state.notifications.forEach((n) => { n.read = true; }); renderNotifPanel(); updateNotifBadge(); }
  });
  document.addEventListener('click', () => panel.classList.remove('open'));
  panel.addEventListener('click', (e) => e.stopPropagation());
  qs('#notif-clear-all').addEventListener('click', () => { state.notifications = []; renderNotifPanel(); updateNotifBadge(); });
  renderNotifPanel();
}

export function toast(message, type = 'info') {
  pushNotification(message, type);
  const wrap = qs('#toast-wrap');
  const el = h(`<div class="toast ${type}">${esc(message)}</div>`);
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ------------------------- Aperçu avant impression -------------------------
// CORRECTIF : auparavant, window.print() était appelé directement dès que le
// document était généré, sans possibilité de le relire avant l'impression
// (mise en page, informations manquantes…). On affiche désormais un aperçu
// dans une modale, avec un bouton "Imprimer" explicite.
