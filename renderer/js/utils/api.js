import { toast } from '../components/toast.js';
import { qs } from './helpers.js';

export async function call(channel, payload) {
  const res = await window.api[channel](payload);
  if (!res || res.ok === undefined) return res;
  if (!res.ok) { toast(res.error, 'error'); throw new Error(res.error); }
  return res.data;
}

// ------------------------- Indicateur de chargement sur les boutons -------------------------
// Utilisé pour les actions potentiellement lentes (import CSV, sauvegarde,
// impression, export…) : désactive le bouton et affiche un spinner pendant
// l'exécution de la tâche asynchrone, quel que soit son résultat.
export async function withSpinner(btn, task) {
  if (!btn) return task();
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  try {
    return await task();
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = wasDisabled;
  }
}

// ------------------------- Écran de chargement global -------------------------
// Affiché pendant le chargement des pages lourdes (tableau de bord, rapports)
// pour éviter que l'utilisateur ne voie un écran vide ou incomplet le temps
// que les statistiques agrégées reviennent du processus principal.
export let globalLoaderCount = 0;
export function showGlobalLoader(label = 'Chargement…') {
  globalLoaderCount++;
  const el = qs('#global-loader');
  if (!el) return;
  qs('#global-loader-label').textContent = label;
  el.classList.add('active');
}
export function hideGlobalLoader() {
  globalLoaderCount = Math.max(0, globalLoaderCount - 1);
  if (globalLoaderCount > 0) return;
  const el = qs('#global-loader');
  if (el) el.classList.remove('active');
}
export async function withGlobalLoader(label, task) {
  showGlobalLoader(label);
  try { return await task(); } finally { hideGlobalLoader(); }
}

// ------------------------- Persistance de préférences locales -------------------------
// Filtres de recherche, taille de page, colonnes visibles… stockés côté
// poste de travail (par utilisateur) pour ne pas avoir à les ressaisir à
// chaque session.
