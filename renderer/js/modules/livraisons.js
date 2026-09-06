import { printBonLivraison } from '../components/invoice.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { clientLabel, dateOnlyFr, esc, h, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderLivraisons() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Bons de livraison</h2><div class="sub">Preuves de livraison rattachées à une vente — utilisez le bouton « Livraison » depuis la liste des ventes pour en créer un</div></div></div>
    <div class="card" id="bl-table-wrap">Chargement…</div>`;
  const [livraisons, clients] = await Promise.all([call('livraisons:list'), call('clients:list')]);
  const wrap = qs('#bl-table-wrap');
  if (!livraisons.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">⇒</div>Aucun bon de livraison enregistré.</div>`; return; }
  wrap.innerHTML = `<table><thead><tr><th>N°</th><th>Date livraison</th><th>Réf. vente</th><th>Client</th><th>Articles</th><th></th></tr></thead>
    <tbody>${livraisons.map((bl) => `<tr data-id="${bl.id}"><td>${esc(bl.numero)}</td><td>${dateOnlyFr(bl.dateLivraison)}</td><td>${esc(bl.venteNumero)}</td><td>${esc(clientLabel(bl, clients))}</td><td>${bl.lignes.length}</td>
      <td class="text-right nowrap">
        <button class="btn btn-ghost btn-sm act-print">Imprimer</button>
        ${state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-delete">Suppr.</button>' : ''}
      </td></tr>`).join('')}</tbody></table>`;
  qsa('.act-print', wrap).forEach((btn) => btn.addEventListener('click', (e) => printBonLivraison(livraisons.find((bl) => bl.id === e.target.closest('tr').dataset.id))));
  qsa('.act-delete', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
    const id = e.target.closest('tr').dataset.id;
    confirmDialog('Supprimer ce bon de livraison ?', async () => { await call('livraisons:supprimer', { id }); toast('Bon de livraison supprimé', 'success'); renderLivraisons(); });
  }));
}

export function openBonLivraisonForm(vente) {
  const modeLabel = { especes: 'Espèce', mobile_money: 'Mobile Money', carte: 'Carte bancaire', virement: 'Virement', mixte: 'Paiement mixte' }[vente.modePaiement] || vente.modePaiement;
  const body = h(`<div>
    <div class="two-col">
      <div class="field"><label>Date de livraison</label><input type="date" id="f-date" value="${new Date().toISOString().slice(0, 10)}" /></div>
      <div class="field"><label>N° de contrat (optionnel)</label><input id="f-contrat" placeholder="Ex. FED/2022/439-059" /></div>
    </div>
    <div class="field"><label>Objet</label><input id="f-objet" placeholder="Ex. Prestation de service" /></div>
    <div class="field"><label>Terme de paiement</label><input id="f-terme" value="${esc(modeLabel)}" /></div>
    <div class="kpi-label m-12-0-8">Articles à livrer</div>
    <div class="lignes-scroll">
      <div class="lignes-header grid-line-wide"><span>Article</span><span>Unité</span><span>Commandée</span><span>Livrée</span><span></span></div>
      <div id="bl-lignes"></div>
    </div>
  </div>`);
  const container = qs('#bl-lignes', body);
  vente.lignes.forEach((l) => {
    const row = h(`<div class="line-item grid-line-wide" data-kind="bl">
      <div class="fs-13">${esc(l.designation)}${l.details ? `<br/><span class="muted fs-11">${esc(l.details)}</span>` : ''}</div>
      <input class="l-unite bg-paper" value="${esc(l.unite || 'Unité')}" readonly />
      <input class="l-commandee bg-paper" type="number" value="${l.quantite}" readonly />
      <input class="l-livree" type="number" value="${l.quantite}" min="0" />
      <span></span>
    </div>`);
    row.dataset.designation = l.designation;
    row.dataset.details = l.details || '';
    container.appendChild(row);
  });
  openModal('Bon de livraison — Vente ' + vente.numero, body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Générer et imprimer', cls: 'btn-primary', onClick: async () => {
      const lignes = qsa('.line-item', container).map((row) => ({
        designation: row.dataset.designation,
        details: row.dataset.details || '',
        unite: qs('.l-unite', row).value,
        quantiteCommandee: qs('.l-commandee', row).value,
        quantiteLivree: qs('.l-livree', row).value
      }));
      const payload = {
        venteId: vente.id,
        dateLivraison: qs('#f-date', body).value,
        contrat: qs('#f-contrat', body).value.trim(),
        objet: qs('#f-objet', body).value.trim(),
        termePaiement: qs('#f-terme', body).value.trim(),
        lignes
      };
      const bl = await call('livraisons:create', payload);
      toast('Bon de livraison créé', 'success'); closeModal();
      printBonLivraison(bl);
    } }
  ]);
}

