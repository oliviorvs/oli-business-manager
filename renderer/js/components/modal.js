import { toast } from './toast.js';
import { call, withSpinner } from '../utils/api.js';
import { esc, h, lsGet, lsSet, money, qs } from '../utils/helpers.js';

export function openImportRecapModal(titre, result) {
  const doublons = result.doublons || [];
  const errors = result.errors || [];
  if (!doublons.length && !errors.length) return;
  const section = (label, items, cls) => !items.length ? '' : `
    <div class="mb-12">
      <div class="kpi-label mb-6">${esc(label)} (${items.length})</div>
      <ul class="import-recap-list ${cls}">
        ${items.map((it) => `<li>${esc(it)}</li>`).join('')}
      </ul>
    </div>`;
  const body = h(`<div>
    <p class="muted fs-13 mb-12">${result.inserted} ligne(s) importée(s) avec succès. Le détail des lignes ignorées est ci-dessous.</p>
    ${section('Doublons ignorés', doublons, 'import-recap-doublons')}
    ${section('Erreurs', errors, 'import-recap-erreurs')}
  </div>`);
  openModal(titre, body, [{ label: 'Fermer', cls: 'btn-primary', onClick: () => closeModal() }]);
}

export function focusFirstField(bodyEl) {
  setTimeout(() => {
    const el = bodyEl.querySelector('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)');
    if (el) { el.focus(); if (el.select && (el.type === 'text' || el.type === 'number')) el.select(); }
  }, 30);
}
export function openModal(title, bodyEl, buttons, opts) {
  qs('#modal-title').textContent = title;
  const body = qs('#modal-body');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  const footer = qs('#modal-footer');
  footer.innerHTML = '';
  (buttons || []).forEach((b) => {
    const btn = h(`<button class="btn ${b.cls || 'btn-ghost'}">${esc(b.label)}</button>`);
    // Indicateur de chargement automatique sur les actions "lentes" (celles
    // qui enregistrent/suppriment/impriment, en général asynchrones) : le
    // bouton se désactive et affiche un spinner pendant l'exécution.
    if (b.cls === 'btn-primary' || b.cls === 'btn-danger') {
      btn.id = 'modal-primary-btn';
      btn.addEventListener('click', (e) => withSpinner(btn, () => b.onClick(e)));
    } else {
      btn.addEventListener('click', b.onClick);
    }
    footer.appendChild(btn);
  });
  // Formulaires à contenu large (ex. lignes d'articles vente/pro-forma) :
  // on élargit la fenêtre de la modale plutôt que d'écraser les colonnes.
  qs('#modal').classList.toggle('modal-wide', !!(opts && opts.wide));
  // CORRECTIF SÉCURITÉ : masque la croix de fermeture quand la modale doit
  // rester ouverte tant que l'action requise (ex. changement d'un mot de
  // passe temporaire) n'est pas effectuée — évite de contourner l'obligation
  // en fermant simplement la fenêtre.
  qs('#modal-close').style.display = (opts && opts.fermetureBloquee) ? 'none' : '';
  qs('#modal-overlay').classList.add('active');
  focusFirstField(body);
}
export function closeModal() { qs('#modal-overlay').classList.remove('active'); }

export function openModal2(title, bodyEl, buttons) {
  qs('#modal-title-2').textContent = title;
  const body = qs('#modal-body-2');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  const footer = qs('#modal-footer-2');
  footer.innerHTML = '';
  (buttons || []).forEach((b) => {
    const btn = h(`<button class="btn ${b.cls || 'btn-ghost'}">${esc(b.label)}</button>`);
    if (b.cls === 'btn-primary' || b.cls === 'btn-danger') {
      btn.id = 'modal-primary-btn-2';
      btn.addEventListener('click', (e) => withSpinner(btn, () => b.onClick(e)));
    } else {
      btn.addEventListener('click', b.onClick);
    }
    footer.appendChild(btn);
  });
  qs('#modal-overlay-2').classList.add('active');
  focusFirstField(body);
}
export function closeModal2() { qs('#modal-overlay-2').classList.remove('active'); }

// CORRECTIF : chaque confirmation (suppression, annulation…) obligeait
// l'utilisateur à repasser par la modale même pour une action répétitive
// qu'il effectue régulièrement en connaissance de cause. Une clé optionnelle
// (dérivée du message si absente) permet de proposer une case « Ne plus
// demander pour cette action » ; le choix est mémorisé par utilisateur
// (localStorage) et vérifié avant même d'ouvrir la modale la prochaine fois.
export function confirmDialog(message, onConfirm, opts) {
  const key = (opts && opts.key) || message.slice(0, 60);
  if (lsGet('skip-confirm:' + key, false)) { onConfirm(); return; }
  const body = h(`<div>
    <p>${esc(message)}</p>
    <label class="confirm-skip-row">
      <input type="checkbox" id="confirm-skip-cb" />
      Ne plus demander pour cette action
    </label>
  </div>`);
  openModal('Confirmation', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Confirmer', cls: 'btn-danger', onClick: () => {
      if (qs('#confirm-skip-cb', body).checked) lsSet('skip-confirm:' + key, true);
      closeModal(); onConfirm();
    } }
  ]);
}

export function quickPayer({ numero, total, montantPaye, channel, id, onDone }) {
  const reste = Math.round((total - montantPaye) * 100) / 100;
  if (reste <= 0) { toast('Cette facture est déjà réglée', 'info'); return; }
  confirmDialog(`Encaisser le solde de ${esc(numero)} (${money(reste)}) ?`, async () => {
    await call(channel, { id, montant: reste });
    toast('Paiement enregistré', 'success');
    onDone();
  });
}

export function openPaiementForm({ titre, numero, total, montantPaye, channel, id, onDone }) {
  const reste = Math.round((total - montantPaye) * 100) / 100;
  const body = h(`<div>
    <p>${esc(numero)} — Total : <strong>${money(total)}</strong> · Déjà payé : <strong>${money(montantPaye)}</strong></p>
    <p>Solde restant dû : <strong>${money(reste)}</strong></p>
    <div class="field"><label>Montant à encaisser maintenant</label><input type="number" id="f-montant" value="${reste}" min="0" max="${reste}" step="any" /></div>
  </div>`);
  openModal(titre, body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer le paiement', cls: 'btn-primary', onClick: async () => {
      const montant = Number(qs('#f-montant', body).value);
      if (!montant || montant <= 0) { toast('Montant invalide', 'error'); return; }
      if (montant > reste) { toast('Le montant dépasse le solde restant dû', 'error'); return; }
      await call(channel, { id, montant });
      toast('Paiement enregistré', 'success'); closeModal(); onDone();
    } }
  ]);
}

export function initModalUI() {
  qs('#modal-close').addEventListener('click', closeModal);
  qs('#modal-close-2').addEventListener('click', closeModal2);
}
