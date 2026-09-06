import { attachLiveValidation } from '../components/formTools.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { CATEGORIES_DEPENSE } from '../utils/constants.js';
import { dateOnlyFr, esc, h, money, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderDepenses() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Dépenses</h2><div class="sub">Charges de l'entreprise, y compris les achats de marchandises réglés</div></div>
    <button class="btn btn-primary" id="btn-new-depense">+ Nouvelle dépense</button></div>
    <div class="card" id="dep-table-wrap">Chargement…</div>`;
  const [depenses, achats, fournisseurs] = await Promise.all([call('depenses:list'), call('achats:list'), call('fournisseurs:list')]);
  const fname = (id) => fournisseurs.find((f) => f.id === id)?.nom || '—';

  const achatsCommeDepenses = achats
    .filter((a) => a.statut !== 'annulee' && a.montantPaye > 0)
    .map((a) => ({ id: a.id, createdAt: a.createdAt, categorie: 'Achat de marchandises', montant: a.montantPaye, modePaiement: '—', commentaire: a.numero + ' — ' + fname(a.fournisseurId), source: 'achat' }));
  const lignes = depenses.map((d) => Object.assign({ source: 'depense' }, d)).concat(achatsCommeDepenses)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const wrap = qs('#dep-table-wrap');
  if (!lignes.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">−</div>Aucune dépense enregistrée.</div>`; }
  else {
    wrap.innerHTML = `<table><thead><tr><th>Date</th><th>Origine</th><th>Catégorie</th><th>Montant</th><th>Paiement</th><th>Commentaire</th><th></th></tr></thead>
      <tbody>${lignes.map((d) => `<tr data-id="${d.id}" data-source="${d.source}"><td>${dateOnlyFr(d.createdAt)}</td>
        <td>${d.source === 'achat' ? '<span class="stamp stamp-attente">Achat</span>' : '<span class="stamp stamp-partiel">Dépense</span>'}</td>
        <td>${esc(d.categorie)}</td><td>${money(d.montant)}</td><td>${esc(d.modePaiement)}</td><td>${esc(d.commentaire) || '—'}</td>
        <td class="text-right">${d.source === 'depense' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-del">Suppr.</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
    qsa('.act-del', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      confirmDialog('Supprimer cette dépense ?', async () => { await call('depenses:delete', { id }); toast('Dépense supprimée', 'success'); renderDepenses(); });
    }));
  }
  qs('#btn-new-depense').addEventListener('click', openDepenseForm);
}

export function openDepenseForm() {
  const catOptions = CATEGORIES_DEPENSE.map((c) => `<option value="${c}">${c}</option>`).join('');
  const body = h(`<div>
    <div class="two-col">
      <div class="field"><label>Catégorie</label><select id="f-cat">${catOptions}</select></div>
      <div class="field"><label>Montant</label><input type="number" id="f-montant" value="0" /></div>
    </div>
    <div class="field"><label>Mode de paiement</label><select id="f-mode"><option value="especes">Espèces</option><option value="mobile_money">Mobile Money</option><option value="carte">Carte bancaire</option><option value="virement">Virement</option></select></div>
    <div class="field"><label>Commentaire</label><textarea id="f-comment"></textarea></div>
  </div>`);
  const checkMontant = attachLiveValidation(qs('#f-montant', body), 'positive');
  openModal('Nouvelle dépense', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      const montant = Number(qs('#f-montant', body).value);
      if (!checkMontant() || !montant || montant <= 0) { toast('Montant invalide', 'error'); return; }
      await call('depenses:create', { categorie: qs('#f-cat', body).value, montant, modePaiement: qs('#f-mode', body).value, commentaire: qs('#f-comment', body).value.trim() });
      toast('Dépense enregistrée', 'success'); closeModal(); renderDepenses();
    } }
  ]);
}

// ------------------------- Page : Trésorerie -------------------------
