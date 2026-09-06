import { CURRENCY, ICONS, NUM_DIZAINES, NUM_UNITES } from './constants.js';
import { state } from './state.js';

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function esc(str) { return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function money(n) { return (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + CURRENCY; }

// ------------------------- Icônes des sections (formulaires vente / pro-forma) -------------------------
export function sectionTitleHtml(icon, num, label, hint) {
  return `<div class="form-section-title"><span class="section-icon">${ICONS[icon] || ''}</span>${num ? num + '. ' : ''}${esc(label)}${hint ? ` <span class="form-section-hint">${esc(hint)}</span>` : ''}</div>`;
}
export function dateFr(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
export function dateOnlyFr(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('fr-FR'); }

// ==================== COMBOBOX AVEC RECHERCHE ====================
// Combobox de recherche pour produits/services.
// BUGFIX : l'ancienne implémentation reposait sur <input list="..."> + <datalist>, un
// composant natif du navigateur non stylable et dont la liste de suggestions ne défile pas
// correctement dans ce contexte (Electron/OS), rendant impossible la recherche parmi de
// nombreux produits/services. Elle acceptait aussi n'importe quel texte tapé comme une
// sélection valide, ce qui créait silencieusement un doublon de produit à l'enregistrement
// dès que la saisie ne correspondait pas EXACTEMENT (casse, espaces, suffixe "(stock: X)") à
// une option existante. Ce composant "maison" corrige les deux problèmes : liste déroulante
// scrollable, et sélection possible uniquement par clic sur une option réelle (id garanti).
export function clientLabel(record, clients) {
  if (record.clientId) { const c = clients.find((x) => x.id === record.clientId); if (c) return (c.nom + ' ' + c.prenom).trim(); }
  if (record.clientNom) return record.clientNom;
  return 'Client comptoir';
}

// ------------------------- Centre de notifications persistantes -------------------------
// Remplace l'ancien comportement où le message d'un toast disparaissait
// définitivement au bout de 3,8 secondes, sans laisser de trace : chaque
// notification est désormais conservée dans un panneau accessible depuis la
// cloche de l'en-tête, jusqu'à ce que l'utilisateur l'efface explicitement
// (individuellement ou via « Tout effacer »). Un toast furtif continue de
// s'afficher brièvement pour le retour immédiat, mais ce n'est plus le seul
// moyen de consulter le message.
export function lsKey(key) { return 'oli-' + key + (state.session ? ':' + state.session.id : ''); }
export function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(lsKey(key));
    return raw != null ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(lsKey(key), JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
}

// ------------------------- Validations dynamiques en temps réel -------------------------
// Attache une validation live (au fil de la frappe / du changement) sur un
// champ : bordure rouge + message d'erreur immédiat si la valeur ne
// respecte pas la règle, sans attendre la soumission du formulaire. Types
// supportés : 'email', 'positive' (nombre > 0), 'nonNegative' (nombre >= 0),
// 'required' (non vide). Retourne une fonction isValid() utilisable avant
// l'enregistrement.
export function deuxChiffresEnLettres(n) {
  if (n < 20) return NUM_UNITES[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) return NUM_DIZAINES[d] + (u === 0 ? '-dix' : '-' + NUM_UNITES[10 + u]);
  if (d === 8) return u === 0 ? 'quatre-vingts' : 'quatre-vingt-' + NUM_UNITES[u];
  if (u === 0) return NUM_DIZAINES[d];
  if (u === 1) return NUM_DIZAINES[d] + '-et-un';
  return NUM_DIZAINES[d] + '-' + NUM_UNITES[u];
}
export function troisChiffresEnLettres(n) {
  const c = Math.floor(n / 100), r = n % 100;
  let str = '';
  if (c > 0) { str += c === 1 ? 'cent' : NUM_UNITES[c] + ' cent'; if (c > 1 && r === 0) str += 's'; }
  if (r > 0) str += (str ? ' ' : '') + deuxChiffresEnLettres(r);
  return str;
}
export function nombreEnLettresFr(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'zéro';
  const groupes = [];
  let reste = n;
  while (reste > 0) { groupes.unshift(reste % 1000); reste = Math.floor(reste / 1000); }
  const total = groupes.length;
  const mots = [];
  groupes.forEach((g, idx) => {
    if (g === 0) return;
    const puissance = total - idx - 1;
    let mot;
    if (puissance === 1 && g === 1) mot = 'mille';
    else {
      mot = troisChiffresEnLettres(g);
      if (puissance === 1) mot += ' mille';
      else if (puissance === 2) mot += g > 1 ? ' millions' : ' million';
      else if (puissance === 3) mot += g > 1 ? ' milliards' : ' milliard';
    }
    mots.push(mot);
  });
  return mots.join(' ').replace(/\s+/g, ' ').trim();
}
export function montantEnLettres(n) {
  const mots = nombreEnLettresFr(n);
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}

