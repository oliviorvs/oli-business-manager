import { createCombobox } from './combobox.js';
import { attachLiveValidation, bindFreeTextSuggestions, rememberFreeTextSuggestion } from './formTools.js';
import { closeModal2, openModal2 } from './modal.js';
import { toast } from './toast.js';
import { call } from '../utils/api.js';
import { h, qs, qsa } from '../utils/helpers.js';

function clientOptionLabel(c) { return `${c.nom} ${c.prenom || ''}`.trim() + ` (${c.numero})`; }

export function clientFieldHtml(clients, opts) {
  const o = opts || {};
  return `<div class="field">
    ${o.hideLabel ? '' : '<label>Client</label>'}
    <div class="client-mode-tabs flex gap-6 mb-6 flex-wrap${o.evenTabs ? ' client-mode-tabs-even' : ''}">
      <button type="button" class="btn btn-ghost btn-sm client-mode-btn active" data-mode="comptoir">Client comptoir</button>
      <button type="button" class="btn btn-ghost btn-sm client-mode-btn" data-mode="enregistre">Client enregistré</button>
      <button type="button" class="btn btn-ghost btn-sm client-mode-btn" data-mode="manuel">Saisie manuelle</button>
    </div>
    <div class="hidden gap-6 flex-wrap items-start" id="f-client-enregistre-wrap">
      <div class="flex-1 minw-140" id="f-client-combo-wrap"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="f-client-nouveau">+ Nouveau</button>
    </div>
    <div class="hidden" id="f-client-manuel-wrap">
      <div class="flex gap-6 flex-wrap">
        <input id="f-client-manuel-numero" placeholder="N° client (ex: CL123456)" class="flex-1 minw-120" />
        <input id="f-client-manuel-nom" placeholder="Nom du client" class="flex-2 minw-140" />
      </div>
    </div>
  </div>`;
}
// UX/UI : le choix du client enregistré utilisait un <select> HTML natif —
// difficile à parcourir dès que la clientèle grandit (comportement natif
// limité selon l'OS, aucune recherche). On réutilise ici le même composant
// de recherche que pour les lignes produit/service (voir combobox.js), pour
// une expérience de recherche cohérente partout dans l'application.
// "clients" est désormais nécessaire ici (et non plus seulement dans
// clientFieldHtml) pour construire les options du combobox en JS.
export function bindClientField(body, clients) {
  const btns = qsa('.client-mode-btn', body);
  const enregistreWrap = qs('#f-client-enregistre-wrap', body);
  const manuelWrap = qs('#f-client-manuel-wrap', body);
  bindFreeTextSuggestions(qs('#f-client-manuel-nom', body), 'client-manuel-nom');

  const options = clients.map((c) => ({ id: c.id, label: clientOptionLabel(c) }));
  const combo = createCombobox(options, null, 'Rechercher un client...');
  const comboHidden = combo.querySelector('.combobox-hidden');
  // Conserve l'id "f-client" (même contrat que l'ancien <select>) pour que
  // getClientPayload() et tous les appelants existants continuent de
  // fonctionner sans changement : qs('#f-client', body).value reste valide,
  // c'est juste maintenant le champ caché du combobox plutôt qu'un <select>.
  comboHidden.id = 'f-client';
  qs('#f-client-combo-wrap', body).appendChild(combo);

  btns.forEach((btn) => btn.addEventListener('click', () => {
    btns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    enregistreWrap.style.display = mode === 'enregistre' ? 'flex' : 'none';
    manuelWrap.style.display = mode === 'manuel' ? 'block' : 'none';
  }));

  qs('#f-client-nouveau', body).addEventListener('click', () => {
    const miniBody = h(`<div>
      <div class="two-col">
        <div class="field"><label>Nom</label><input id="mc2-nom" /></div>
        <div class="field"><label>Prénom</label><input id="mc2-prenom" /></div>
      </div>
      <div class="two-col">
        <div class="field"><label>Téléphone</label><input id="mc2-tel" /></div>
        <div class="field"><label>E-mail</label><input id="mc2-email" type="email" /></div>
      </div>
      <div class="field"><label>Adresse</label><textarea id="mc2-adresse"></textarea></div>
    </div>`);
    const checkMiniEmail = attachLiveValidation(qs('#mc2-email', miniBody), 'email');
    openModal2('Nouveau client', miniBody, [
      { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal2 },
      { label: 'Créer', cls: 'btn-primary', onClick: async () => {
        const nom = qs('#mc2-nom', miniBody).value.trim();
        if (!nom) { toast('Le nom est obligatoire', 'error'); return; }
        if (!checkMiniEmail()) { toast('Adresse e-mail invalide', 'error'); return; }
        const client = await call('clients:create', { 
          nom, 
          prenom: qs('#mc2-prenom', miniBody).value.trim(), 
          telephone: qs('#mc2-tel', miniBody).value.trim(),
          email: qs('#mc2-email', miniBody).value.trim(),
          adresse: qs('#mc2-adresse', miniBody).value.trim()
        });
        options.push({ id: client.id, label: clientOptionLabel(client) });
        clients.push(client);
        comboHidden.value = client.id;
        combo.querySelector('.combobox-input').value = clientOptionLabel(client);
        toast('Client créé', 'success'); closeModal2();
      } }
    ]);
  });
}

// Pré-sélectionne un client déjà enregistré dans le champ combobox — utilisé
// par les formulaires de modification du client d'une vente/proforma déjà
// existante (mode édition). Met à jour à la fois la valeur cachée (id) et le
// texte visible du champ de recherche.
export function setClientFieldValue(body, clientId, clients) {
  const hidden = qs('#f-client', body);
  if (!hidden) return;
  hidden.value = clientId || '';
  const wrapEl = qs('#f-client-combo-wrap', body);
  const input = wrapEl ? qs('.combobox-input', wrapEl) : null;
  if (input) {
    const c = clients.find((x) => x.id === clientId);
    input.value = c ? clientOptionLabel(c) : '';
  }
}

export function getClientPayload(body) {
  const mode = qs('.client-mode-btn.active', body)?.dataset.mode || 'comptoir';
  if (mode === 'enregistre') return { clientId: qs('#f-client', body).value || null, clientNom: '' };
  if (mode === 'manuel') {
    const nom = qs('#f-client-manuel-nom', body).value.trim();
    const numero = qs('#f-client-manuel-numero', body).value.trim();
    if (nom) rememberFreeTextSuggestion('client-manuel-nom', nom);
    return { clientId: null, clientNom: nom, clientNumero: numero || undefined };
  }
  return { clientId: null, clientNom: '' };
}

// ------------------------- Modale générique -------------------------
// Focus automatique + tabulation fluide : à l'ouverture d'une modale, le
// premier champ saisissable visible (texte, nombre, select, textarea…) reçoit
// le focus, pour permettre de commencer à saisir immédiatement sans avoir à
// cliquer. L'ordre naturel du DOM assure ensuite un enchaînement Tab logique.
