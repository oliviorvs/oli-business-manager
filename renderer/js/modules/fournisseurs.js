import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { esc, h, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderFournisseurs() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Fournisseurs</h2><div class="sub">Partenaires et approvisionnement</div></div>
    <button class="btn btn-primary" id="btn-new-f">+ Nouveau fournisseur</button></div>
    <div class="card" id="f-table-wrap">Chargement…</div>`;
  const list = await call('fournisseurs:list');
  state.cache.fournisseurs = list;
  const wrap = qs('#f-table-wrap');
  if (!list.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">⌂</div>Aucun fournisseur enregistré.</div>`; }
  else {
    wrap.innerHTML = `<table><thead><tr><th>Nom</th><th>Responsable</th><th>Téléphone</th><th>E-mail</th><th></th></tr></thead>
      <tbody>${list.map((f) => `<tr data-id="${f.id}"><td>${esc(f.nom)}</td><td>${esc(f.responsable) || '—'}</td><td>${esc(f.telephone) || '—'}</td><td>${esc(f.email) || '—'}</td>
        <td class="text-right"><button class="btn btn-ghost btn-sm act-edit">Modifier</button> <button class="btn btn-danger btn-sm act-del">Suppr.</button></td></tr>`).join('')}</tbody></table>`;
    qsa('.act-edit', wrap).forEach((btn) => btn.addEventListener('click', (e) => openFournisseurForm(list.find((f) => f.id === e.target.closest('tr').dataset.id))));
    qsa('.act-del', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      confirmDialog('Supprimer ce fournisseur ?', async () => { await call('fournisseurs:delete', { id }); toast('Fournisseur supprimé', 'success'); renderFournisseurs(); });
    }));
  }
  qs('#btn-new-f').addEventListener('click', () => openFournisseurForm());
}

export function openFournisseurForm(f) {
  const body = h(`<div>
    <div class="field"><label>Nom</label><input id="f-nom" value="${esc(f?.nom || '')}" /></div>
    <div class="two-col">
      <div class="field"><label>Responsable</label><input id="f-resp" value="${esc(f?.responsable || '')}" /></div>
      <div class="field"><label>Téléphone</label><input id="f-tel" value="${esc(f?.telephone || '')}" /></div>
    </div>
    <div class="field"><label>E-mail</label><input id="f-email" value="${esc(f?.email || '')}" /></div>
    <div class="field"><label>Adresse</label><textarea id="f-adresse">${esc(f?.adresse || '')}</textarea></div>
  </div>`);
  openModal(f ? 'Modifier le fournisseur' : 'Nouveau fournisseur', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      const payload = { nom: qs('#f-nom').value.trim(), responsable: qs('#f-resp').value.trim(), telephone: qs('#f-tel').value.trim(), email: qs('#f-email').value.trim(), adresse: qs('#f-adresse').value.trim() };
      if (!payload.nom) { toast('Le nom est obligatoire', 'error'); return; }
      if (f) await call('fournisseurs:update', { id: f.id, patch: payload }); else await call('fournisseurs:create', payload);
      toast('Fournisseur enregistré', 'success'); closeModal(); renderFournisseurs();
    } }
  ]);
}

// ------------------------- Page : Produits (+ catégories) -------------------------
