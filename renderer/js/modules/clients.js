import { attachLiveValidation } from '../components/formTools.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { createColumnPicker, createPager } from '../components/tableTools.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { dateOnlyFr, esc, h, money, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderClients() {
  const main = qs('#main-content');
  main.innerHTML = `
    <div class="topbar"><div><h2>Clients</h2><div class="sub">Fiches clients et historique</div></div>
      <button class="btn btn-primary" id="btn-new-client">+ Nouveau client</button></div>
    <div class="toolbar">
      <div class="toolbar-actions">
        <input class="field-inline search-input p-9-12 border-1px-solid-var-line radius-8 minw-260" id="client-search" placeholder="Rechercher par numéro, nom, téléphone…" />
      </div>
      <div id="clients-col-picker"></div>
    </div>
    <div class="card" id="clients-table-wrap">Chargement…</div>
  `;
  const clients = await call('clients:list');
  state.cache.clients = clients;
  const clientsPager = createPager('clients');
  const clientCols = createColumnPicker('clients', [
    { key: 'numero', label: 'N°' }, { key: 'nom', label: 'Nom' }, { key: 'tel', label: 'Téléphone' },
    { key: 'email', label: 'E-mail' }, { key: 'depuis', label: 'Depuis' }
  ]);
  qs('#clients-col-picker').innerHTML = clientCols.html();
  let currentClientsList = clients;
  clientCols.bind(() => draw(currentClientsList));
  function buildClientsTableHtml(list) {
    if (!list.length) return `<div class="empty-state"><div class="big">☺</div>Aucun client enregistré.</div>`;
    return `<table><thead><tr>
        <th class="${clientCols.cls('numero')}">N°</th><th class="${clientCols.cls('nom')}">Nom</th><th class="${clientCols.cls('tel')}">Téléphone</th>
        <th class="${clientCols.cls('email')}">E-mail</th><th class="${clientCols.cls('depuis')}">Depuis</th><th></th></tr></thead>
      <tbody>${list.map((c) => `<tr data-id="${c.id}">
        <td class="${clientCols.cls('numero')}">${esc(c.numero)}</td><td class="${clientCols.cls('nom')}">${esc(c.nom)} ${esc(c.prenom)}</td><td class="${clientCols.cls('tel')}">${esc(c.telephone) || '—'}</td><td class="${clientCols.cls('email')}">${esc(c.email) || '—'}</td>
        <td class="${clientCols.cls('depuis')}">${dateOnlyFr(c.createdAt)}</td>
        <td class="text-right nowrap">
          <button class="btn btn-ghost btn-sm act-hist" title="Voir l'historique des achats">Historique</button>
          <button class="btn btn-ghost btn-sm act-edit" title="Modifier la fiche client">Modifier</button>
          <button class="btn btn-danger btn-sm act-del" title="Supprimer ce client">Suppr.</button>
        </td></tr>`).join('')}</tbody></table>`;
  }
  function draw(list) {
    currentClientsList = list;
    const wrap = qs('#clients-table-wrap');
    if (!list.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">☺</div>Aucun client enregistré.</div>`; return; }
    // CORRECTIF : voir tableTools.js#createPager — le rattachement des
    // écouteurs de ligne doit passer par le callback onRender pour continuer
    // à fonctionner après un changement de page ou de taille de page.
    clientsPager.render(wrap, list, buildClientsTableHtml, (pageItems) => bindClientsRowActions(pageItems, wrap));
  }
  function bindClientsRowActions(pageItems, wrap) {
    qsa('.act-edit', wrap).forEach((btn) => btn.addEventListener('click', (e) => openClientForm(pageItems.find((c) => c.id === e.target.closest('tr').dataset.id))));
    qsa('.act-del', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      confirmDialog('Supprimer ce client ? Cette action est irréversible.', async () => { await call('clients:delete', { id }); toast('Client supprimé', 'success'); renderClients(); });
    }));
    qsa('.act-hist', wrap).forEach((btn) => btn.addEventListener('click', async (e) => {
      const id = e.target.closest('tr').dataset.id;
      const hist = await call('clients:historique', { id });
      // CORRECTIF : l'historique n'affichait qu'une ligne agrégée par vente
      // (numéro + total global), sans jamais détailler les articles —
      // impossible de voir qu'une même vente contenait par exemple un
      // produit ("Enveloppe") ET un service ("Impression"). On détaille
      // maintenant chaque ligne (produit ou service) de chaque vente, sous
      // le même numéro de vente. Les prestations "autonomes" (sans vente —
      // déjà comptées à part dans le total dépensé, voir
      // client.service.js#historique) sont ajoutées à la suite avec leur
      // propre numéro, dans le même tableau à 4 colonnes.
      const lignesHistorique = [];
      hist.ventes.forEach((v) => {
        (v.lignes || []).forEach((l) => {
          lignesHistorique.push({ numero: v.numero, designation: l.designation, quantite: l.quantite, montant: l.sousTotal, date: v.createdAt, annulee: v.statut === 'annulee' });
        });
      });
      hist.prestations.filter((p) => !p.venteId).forEach((p) => {
        lignesHistorique.push({ numero: p.numero, designation: p.serviceNom, quantite: p.quantite, montant: p.total, date: p.createdAt, annulee: p.statut === 'annulee' });
      });
      lignesHistorique.sort((a, b) => new Date(b.date) - new Date(a.date));
      const body = h(`<div>
        <p><strong>Total dépensé :</strong> ${money(hist.totalDepense)}</p>
        <div class="kpi-label m-12-0-6">Articles achetés (${lignesHistorique.length})</div>
        ${lignesHistorique.length ? `<table><thead><tr><th>N°</th><th>Article</th><th>Qté</th><th>Montant</th></tr></thead>
          <tbody>${lignesHistorique.map((l) => `<tr><td>${esc(l.numero)}</td><td>${esc(l.designation)}${l.annulee ? ' <span class="stamp stamp-annulee">Annulée</span>' : ''}</td><td>${l.quantite}</td><td>${money(l.montant)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="muted">Aucune</div>'}
      </div>`);
      openModal('Historique client', body, [{ label: 'Fermer', cls: 'btn-ghost', onClick: closeModal }]);
    }));
  }
  draw(clients);
  qs('#client-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    draw(clients.filter((c) =>
      (c.numero && c.numero.toLowerCase().includes(q)) ||
      (c.nom + c.prenom + c.telephone + c.email).toLowerCase().includes(q)
    ));
  });
  qs('#btn-new-client').addEventListener('click', () => openClientForm());
}

export function openClientForm(client) {
  const body = h(`<div>
    <div class="field"><label>Numéro client</label><input id="f-numero" value="${esc(client?.numero || '')}" placeholder="Automatique si vide" /></div>
    <div class="two-col">
      <div class="field"><label>Nom</label><input id="f-nom" value="${esc(client?.nom || '')}" /></div>
      <div class="field"><label>Prénom</label><input id="f-prenom" value="${esc(client?.prenom || '')}" /></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Téléphone</label><input id="f-tel" value="${esc(client?.telephone || '')}" /></div>
      <div class="field"><label>E-mail</label><input id="f-email" type="email" value="${esc(client?.email || '')}" /></div>
    </div>
    <div class="field"><label>Adresse</label><textarea id="f-adresse">${esc(client?.adresse || '')}</textarea></div>
  </div>`);
  const checkEmail = attachLiveValidation(qs('#f-email', body), 'email');
  openModal(client ? 'Modifier le client' : 'Nouveau client', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      if (!checkEmail()) { toast('Adresse e-mail invalide', 'error'); return; }
      // CORRECTIF : si le champ "Numéro client" est vidé, on ne doit jamais
      // envoyer numero: "" (ce qui supprimerait le numéro du client existant
      // — voir aussi le contrôle serveur dans client.service.js#update). En
      // édition, on remet automatiquement le numéro déjà attribué ; en
      // création, on laisse "undefined" pour qu'un nouveau numéro soit généré.
      const numeroSaisi = qs('#f-numero').value.trim();
      const payload = { numero: numeroSaisi || (client ? client.numero : undefined), nom: qs('#f-nom').value.trim(), prenom: qs('#f-prenom').value.trim(), telephone: qs('#f-tel').value.trim(), email: qs('#f-email').value.trim(), adresse: qs('#f-adresse').value.trim() };
      if (!payload.nom) { toast('Le nom est obligatoire', 'error'); return; }
      if (client) await call('clients:update', { id: client.id, patch: payload }); else await call('clients:create', payload);
      toast('Client enregistré', 'success'); closeModal(); renderClients();
    } }
  ]);
}

// ------------------------- Page : Fournisseurs -------------------------
