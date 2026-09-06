import { VALIDATION_MESSAGES, VALIDATORS } from '../utils/constants.js';
import { esc, h, lsGet, lsSet } from '../utils/helpers.js';

export function attachLiveValidation(inputEl, type, customMsg) {
  if (!inputEl) return () => true;
  let errEl = inputEl.parentElement.querySelector('.field-error-msg');
  if (!errEl) {
    errEl = h(`<div class="field-error-msg"></div>`);
    inputEl.insertAdjacentElement('afterend', errEl);
  }
  function check() {
    const ok = VALIDATORS[type](inputEl.value);
    inputEl.classList.toggle('input-invalid', !ok && inputEl.value !== '');
    inputEl.classList.toggle('input-valid', ok && inputEl.value !== '');
    errEl.textContent = customMsg || VALIDATION_MESSAGES[type];
    errEl.classList.toggle('show', !ok && inputEl.value !== '');
    return ok;
  }
  inputEl.addEventListener('input', check);
  inputEl.addEventListener('blur', check);
  return check;
}

// ------------------------- Auto-complétion des champs de saisie libre -------------------------
// Pour les champs où l'utilisateur tape un texte libre plutôt que de choisir
// dans une liste (nom d'un client saisi manuellement, détails de
// prestation…), on propose désormais les valeurs déjà saisies par le passé
// via une <datalist>, mémorisées localement par utilisateur.
export function bindFreeTextSuggestions(inputEl, historyKey) {
  if (!inputEl) return;
  const listId = 'suggest-list-' + historyKey;
  let dl = document.getElementById(listId);
  if (!dl) { dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl); }
  const values = lsGet('suggest:' + historyKey, []);
  dl.innerHTML = values.map((v) => `<option value="${esc(v)}"></option>`).join('');
  inputEl.setAttribute('list', listId);
}
export function rememberFreeTextSuggestion(historyKey, value) {
  const v = String(value || '').trim();
  if (!v) return;
  const values = lsGet('suggest:' + historyKey, []);
  const next = [v, ...values.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 20);
  lsSet('suggest:' + historyKey, next);
}

// ------------------------- Mode « Lecture seule » (caissier) -------------------------
// Sur demande, les caissiers peuvent activer un mode où les champs sensibles
// (prix des services, remises) sont grisés dans les formulaires de vente et
// de facture pro-forma — pour éviter toute modification accidentelle ou non
// autorisée pendant l'encaissement. Uniquement proposé au rôle "caissier".
