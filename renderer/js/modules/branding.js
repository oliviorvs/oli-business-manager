// renderer/js/modules/branding.js
// ============================================================
// PERSONNALISATION DE LA MARQUE (demande client)
// ============================================================
// Remplace l'ancien badge statique "OLI" / le texte "OLI Business Manager"
// codés en dur dans renderer/index.html par le logo et le nom de
// l'entreprise réellement configurés (Paramètres > Entreprise, ou saisis
// lors de la configuration initiale — voir setup.js). Deux points d'entrée :
//  - appliquerBrandingConnexion() : écran de connexion, AVANT toute
//    authentification, via l'endpoint public 'settings:logo' ;
//  - appliquerBrandingApp(meta) : barre supérieure de l'application, une
//    fois connecté (meta déjà récupéré via 'settings:get' par l'appelant).
import { call } from '../utils/api.js';
import { qs } from '../utils/helpers.js';

// Bascule entre le logo (image) et le badge de repli (initiale du nom de
// l'entreprise) selon qu'un logo est enregistré ou non — même logique pour
// l'écran de connexion et la barre supérieure, juste sur des éléments
// différents.
function appliquerBadge(imgSelector, fallbackSelector, nom, logoDataUrl) {
  const img = qs(imgSelector);
  const fallback = qs(fallbackSelector);
  if (fallback) {
    const initiale = String(nom || '').trim().charAt(0).toUpperCase();
    fallback.textContent = initiale || '?';
  }
  if (logoDataUrl && img) {
    img.src = logoDataUrl;
    img.classList.remove('hidden');
    if (fallback) fallback.classList.add('hidden');
  } else {
    if (img) img.classList.add('hidden');
    if (fallback) fallback.classList.remove('hidden');
  }
}

export async function appliquerBrandingConnexion() {
  try {
    const { logoDataUrl, entrepriseName } = await call('settings:logo');
    if (entrepriseName) {
      document.title = entrepriseName;
      const titre = qs('#auth-title');
      if (titre) titre.textContent = entrepriseName;
    }
    appliquerBadge('#auth-logo-img', '#auth-logo-fallback', entrepriseName, logoDataUrl);
  } catch (e) { /* pas de logo/nom configuré, ou erreur réseau/IPC : contenu par défaut conservé */ }
}

export function appliquerBrandingApp(meta) {
  if (!meta) return;
  if (meta.entrepriseName) {
    document.title = meta.entrepriseName;
    const nomEl = qs('#brand-name');
    if (nomEl) nomEl.textContent = meta.entrepriseName;
  }
  appliquerBadge('#brand-logo-img', '#brand-mark-fallback', meta.entrepriseName, meta.logoDataUrl);
}
