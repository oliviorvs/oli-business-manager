import { bindClientField, clientFieldHtml, getClientPayload, setClientFieldValue } from '../components/clientField.js';
import { createCombobox } from '../components/combobox.js';
import { creerEditeurLignes } from '../components/editorLignes.js';
import { openFormatFactureChoix, printFactureGroupee } from '../components/invoice.js';
import { closeModal, confirmDialog, openModal, openPaiementForm, quickPayer } from '../components/modal.js';
import { createColumnPicker, createPager } from '../components/tableTools.js';
import { toast } from '../components/toast.js';
import { openBonLivraisonForm } from './livraisons.js';
import { call } from '../utils/api.js';
import { CURRENCY } from '../utils/constants.js';
import { clientLabel, dateFr, esc, h, lsGet, lsSet, money, qs, qsa, sectionTitleHtml } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderVentes() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Ventes</h2><div class="sub">Un seul encaissement pour produits et services</div></div>
    <div class="toolbar-actions">
      <button class="btn btn-ghost" id="btn-facture-groupee">Facture groupée</button>
      <button class="btn btn-primary" id="btn-new-vente">+ Nouvelle vente</button>
    </div></div>
    <div class="toolbar">
      <div class="toolbar-actions">
        <input id="ventes-search" placeholder="Rechercher par numéro..." class="p-9-12 border-1px-solid-var-line radius-8 minw-140" />
        <select id="f-filtre-statut" class="p-8-10 border-1px-solid-var-line radius-8">
          <option value="">Tous les statuts</option>
          <option value="paye">Payé</option>
          <option value="impaye">Impayé (partiel ou en attente)</option>
          <option value="annulee">Annulée</option>
        </select>
        <input type="date" id="f-filtre-debut" title="Du" class="p-7-10 border-1px-solid-var-line radius-8" />
        <input type="date" id="f-filtre-fin" title="Au" class="p-7-10 border-1px-solid-var-line radius-8" />
        <button class="btn btn-ghost btn-sm" id="f-filtre-reset">Réinitialiser <span class="badge-filtre-actif hidden" id="ventes-filtre-badge">●</span></button>
      </div>
      <div class="flex items-center gap-10">
        <div class="muted fw-600" id="ventes-total"></div>
        <div id="ventes-col-picker"></div>
      </div>
    </div>
    <div class="card" id="ventes-table-wrap">Chargement…</div>`;
  
  const [ventes, clients, produits, services, meta] = await Promise.all([call('ventes:list'), call('clients:list'), call('produits:list'), call('services:list'), call('settings:get')]);
  const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 0 };
  const stampCls = { payee: 'stamp-payee', partiellement_payee: 'stamp-partiel', en_attente: 'stamp-attente', annulee: 'stamp-annulee' };
  const stampLbl = { payee: 'Payée', partiellement_payee: 'Partielle', en_attente: 'En attente', annulee: 'Annulée' };
  const wrap = qs('#ventes-table-wrap');
  
  // Variable pour savoir si des filtres sont actifs
  let filtresActifs = false;
  const ventesPager = createPager('ventes');
  const ventesCols = createColumnPicker('ventes', [
    { key: 'numero', label: 'N°' }, { key: 'date', label: 'Date' }, { key: 'client', label: 'Client' },
    { key: 'contenu', label: 'Contenu' }, { key: 'total', label: 'Total' }, { key: 'statut', label: 'Statut' }
  ]);
  qs('#ventes-col-picker').innerHTML = ventesCols.html();
  let currentVentesList = ventes;
  ventesCols.bind(() => draw(currentVentesList));

  function buildVentesTableHtml(list) {
    if (!list.length) return `<div class="empty-state"><div class="big">$</div>Aucune vente ne correspond.</div>`;
    return `<table><thead><tr>
        <th class="${ventesCols.cls('numero')}">N°</th><th class="${ventesCols.cls('date')}">Date</th><th class="${ventesCols.cls('client')}">Client</th>
        <th class="${ventesCols.cls('contenu')}">Contenu</th><th class="${ventesCols.cls('total')}">Total</th><th class="${ventesCols.cls('statut')}">Statut</th><th></th></tr></thead>
      <tbody>${list.map((v) => `<tr data-id="${v.id}"><td class="${ventesCols.cls('numero')}">${esc(v.numero)}</td><td class="${ventesCols.cls('date')}">${dateFr(v.createdAt)}</td><td class="${ventesCols.cls('client')}">${esc(clientLabel(v, clients))}</td>
        <td class="muted ${ventesCols.cls('contenu')}">${v.lignes.some((l) => l.kind === 'produit') ? 'Produits' : ''}${v.lignes.some((l) => l.kind === 'produit') && v.lignes.some((l) => l.kind === 'service') ? ' + ' : ''}${v.lignes.some((l) => l.kind === 'service') ? 'Services' : ''}</td>
        <td class="${ventesCols.cls('total')}">${money(v.total)}</td>
        <td class="${ventesCols.cls('statut')}"><span class="stamp ${stampCls[v.statut]}">${stampLbl[v.statut]}</span></td>
        <td class="text-right nowrap">
          <button class="btn btn-ghost btn-sm act-print" title="Imprimer la facture">Facture</button>
          ${v.statut !== 'annulee' ? '<button class="btn btn-ghost btn-sm act-livraison" title="Créer un bon de livraison">Livraison</button>' : ''}
          ${v.statut !== 'annulee' ? '<button class="btn btn-ghost btn-sm act-client" title="Changer le client rattaché">Client</button>' : ''}
          ${v.statut === 'partiellement_payee' || v.statut === 'en_attente' ? '<button class="btn btn-ghost btn-sm act-payer" title="Encaisser le solde en un clic">Payer</button><button class="btn btn-ghost btn-sm act-payer-partiel" title="Encaisser un montant partiel">±</button>' : ''}
          ${v.statut !== 'annulee' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-cancel" title="Annuler cette vente">Annuler</button>' : ''}
          ${v.statut === 'annulee' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-delete" title="Supprimer définitivement">Suppr. définitivement</button>' : ''}
        </td></tr>`).join('')}</tbody></table>`;
  }

  function draw(list) {
    currentVentesList = list;
    // Calcul des totaux uniquement si des filtres sont actifs
    if (filtresActifs) {
      const total = list.reduce((s, v) => s + (v.statut === 'annulee' ? 0 : v.total), 0);
      const totalImpayees = list.filter(v => v.statut === 'en_attente' || v.statut === 'partiellement_payee')
        .reduce((s, v) => s + (v.total - v.montantPaye), 0);
      
      // Afficher les totaux
      qs('#ventes-total').innerHTML = `
        <span class="mr-8">${list.length} vente(s)</span>
        <span class="mr-8">Total : ${money(total)}</span>
        ${totalImpayees > 0 ? `<span class="text-danger">Dont impayé : ${money(totalImpayees)}</span>` : ''}
      `;
    } else {
      // Masquer les totaux
      qs('#ventes-total').innerHTML = '';
    }

    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">$</div>Aucune vente ne correspond.</div>`;
      return;
    }

    // CORRECTIF : voir tableTools.js#createPager — le rattachement des
    // écouteurs de ligne doit passer par le callback onRender pour continuer
    // à fonctionner après un changement de page ou de taille de page.
    ventesPager.render(wrap, list, buildVentesTableHtml, (pageItems) => {
      qsa('.act-print', wrap).forEach((btn) => btn.addEventListener('click', (e) => openFormatFactureChoix(pageItems.find((v) => v.id === e.target.closest('tr').dataset.id), clients)));
      qsa('.act-livraison', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        openBonLivraisonForm(pageItems.find((v) => v.id === id));
      }));
      qsa('.act-client', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        openModifierClientVente(pageItems.find((v) => v.id === id), clients);
      }));
      qsa('.act-payer', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        const v = pageItems.find((x) => x.id === id);
        quickPayer({ numero: v.numero, total: v.total, montantPaye: v.montantPaye, channel: 'ventes:payer', id, onDone: refreshListe });
      }));
      qsa('.act-payer-partiel', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        const v = pageItems.find((x) => x.id === id);
        openPaiementForm({ titre: 'Encaisser le solde', numero: v.numero, total: v.total, montantPaye: v.montantPaye, channel: 'ventes:payer', id, onDone: refreshListe });
      }));
      qsa('.act-cancel', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Annuler cette vente ? Le stock produit sera réintégré et l\'encaissement retiré de la trésorerie.', async () => { await call('ventes:annuler', { id }); toast('Vente annulée', 'success'); refreshListe(); });
      }));
      qsa('.act-delete', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Supprimer définitivement cette vente de la base de données ? Cette action est irréversible.', async () => { await call('ventes:supprimer', { id }); toast('Vente supprimée définitivement', 'success'); refreshListe(); });
      }));
    });
  }

  // CORRECTIF : rafraîchit uniquement les données et le tableau après une
  // action (payer/annuler/supprimer une vente), au lieu de rappeler
  // renderVentes() en entier — qui reconstruit toute la page (barre d'outils,
  // champs de recherche/filtres, focus, scroll) et provoquait un flash visible
  // à chaque action, en plus de réinitialiser les filtres en cours.
  async function refreshListe() {
    const nouvellesVentes = await call('ventes:list');
    ventes.length = 0;
    ventes.push(...nouvellesVentes);
    applyFilters();
  }

  function applyFilters() {
    const searchQuery = qs('#ventes-search').value.toLowerCase();
    const statutFiltre = qs('#f-filtre-statut').value;
    const debut = qs('#f-filtre-debut').value ? new Date(qs('#f-filtre-debut').value) : null;
    const fin = qs('#f-filtre-fin').value ? new Date(qs('#f-filtre-fin').value + 'T23:59:59') : null;
    
    // Vérifier si au moins un filtre est actif
    filtresActifs = !!(searchQuery || statutFiltre || debut || fin);
    qs('#ventes-filtre-badge').classList.toggle('hidden', !filtresActifs);
    lsSet('filters:ventes', { statut: statutFiltre, debut: qs('#f-filtre-debut').value, fin: qs('#f-filtre-fin').value });
    
    const filtered = ventes.filter((v) => {
      // Recherche par numéro
      if (searchQuery && !v.numero.toLowerCase().includes(searchQuery)) return false;
      // Filtre statut
      if (statutFiltre === 'paye' && v.statut !== 'payee') return false;
      if (statutFiltre === 'impaye' && !(v.statut === 'en_attente' || v.statut === 'partiellement_payee')) return false;
      if (statutFiltre === 'annulee' && v.statut !== 'annulee') return false;
      // Filtre dates
      const d = new Date(v.createdAt);
      if (debut && d < debut) return false;
      if (fin && d > fin) return false;
      return true;
    });
    draw(filtered);
  }

  // Écouteurs d'événements pour les filtres
  qs('#ventes-search').addEventListener('input', applyFilters);
  qs('#f-filtre-statut').addEventListener('change', applyFilters);
  qs('#f-filtre-debut').addEventListener('change', applyFilters);
  qs('#f-filtre-fin').addEventListener('change', applyFilters);
  
  qs('#f-filtre-reset').addEventListener('click', () => {
    qs('#ventes-search').value = '';
    qs('#f-filtre-statut').value = '';
    qs('#f-filtre-debut').value = '';
    qs('#f-filtre-fin').value = '';
    filtresActifs = false;
    qs('#ventes-filtre-badge').classList.add('hidden');
    lsSet('filters:ventes', {});
    draw(ventes);
    toast('Filtres réinitialisés', 'info');
  });

  // Filtres mémorisés d'une session à l'autre (statut, dates)
  const filtresSauves = lsGet('filters:ventes', {});
  if (filtresSauves.statut) qs('#f-filtre-statut').value = filtresSauves.statut;
  if (filtresSauves.debut) qs('#f-filtre-debut').value = filtresSauves.debut;
  if (filtresSauves.fin) qs('#f-filtre-fin').value = filtresSauves.fin;

  // Affichage initial : sans filtres, pas de totaux
  filtresActifs = false;
  applyFilters();
  
  qs('#btn-new-vente').addEventListener('click', () => openVenteForm(clients, produits, services, taxSettings));
  qs('#btn-facture-groupee').addEventListener('click', () => openFactureGroupeeForm(ventes, clients));
}

export function openFactureGroupeeForm(ventes, clients) {
  const clientsAvecVentes = clients.filter((c) => ventes.some((v) => v.clientId === c.id && v.statut !== 'annulee'));
  const body = h(`<div>
    <div class="field"><label>Client</label><div id="fg-client-combo-wrap"></div></div>
    <div id="fg-ventes-wrap" class="muted mt-10">Sélectionnez un client pour voir ses ventes.</div>
  </div>`);
  const wrap = qs('#fg-ventes-wrap', body);
  // UX/UI : recherche combobox au lieu d'un <select> natif — cohérent avec
  // le reste de l'application dès que la liste de clients grandit.
  const fgClientOptions = clientsAvecVentes.map((c) => ({ id: c.id, label: `${c.nom} ${c.prenom || ''}`.trim() }));
  const fgClientCombo = createCombobox(fgClientOptions, null, 'Rechercher un client...');
  const fgClientHidden = fgClientCombo.querySelector('.combobox-hidden');
  qs('#fg-client-combo-wrap', body).appendChild(fgClientCombo);

  function drawVentesClient(clientId) {
    const ventesClient = ventes.filter((v) => v.clientId === clientId && v.statut !== 'annulee').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (!ventesClient.length) { wrap.innerHTML = '<div class="muted">Aucune vente pour ce client.</div>'; return; }
    wrap.innerHTML = `
      <div class="kpi-label mb-8">Ventes à regrouper</div>
      <label class="flex items-center gap-6 fs-13 mb-8"><input type="checkbox" id="fg-tout" /> Tout sélectionner</label>
      ${ventesClient.map((v) => `<label class="flex items-center gap-8 p-6-0 bb-1px-solid-var-line fs-13">
        <input type="checkbox" class="fg-vente" value="${v.id}" />
        <span class="flex-1">${esc(v.numero)} — ${dateFr(v.createdAt)}</span>
        <span>${money(v.total)}</span>
      </label>`).join('')}
      <div class="muted mt-10 fw-600" id="fg-total"></div>
    `;
    function majTotal() {
      const cochees = qsa('.fg-vente', wrap).filter((c) => c.checked).map((c) => ventesClient.find((v) => v.id === c.value));
      const total = cochees.reduce((s, v) => s + v.total, 0);
      qs('#fg-total', wrap).textContent = cochees.length ? `${cochees.length} vente(s) sélectionnée(s) — total : ${money(total)}` : '';
    }
    qs('#fg-tout', wrap).addEventListener('change', (e) => { qsa('.fg-vente', wrap).forEach((c) => { c.checked = e.target.checked; }); majTotal(); });
    qsa('.fg-vente', wrap).forEach((c) => c.addEventListener('change', majTotal));
  }
  fgClientHidden.id = 'fg-client';
  fgClientCombo.querySelector('.combobox-input').addEventListener('change', () => {
    const clientId = fgClientHidden.value;
    if (clientId) drawVentesClient(clientId); else wrap.innerHTML = '<div class="muted">Sélectionnez un client pour voir ses ventes.</div>';
  });

  openModal('Facture groupée', body, [
    { label: 'Fermer', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Imprimer la facture groupée', cls: 'btn-primary', onClick: () => {
      const clientId = qs('#fg-client', body).value;
      if (!clientId) { toast('Choisissez un client', 'error'); return; }
      const idsChoisis = qsa('.fg-vente', body).filter((c) => c.checked).map((c) => c.value);
      if (!idsChoisis.length) { toast('Cochez au moins une vente', 'error'); return; }
      const ventesChoisies = ventes.filter((v) => idsChoisis.includes(v.id));
      const client = clients.find((c) => c.id === clientId);
      closeModal();
      printFactureGroupee(ventesChoisies, client);
    } }
  ]);
}

export function openModifierClientVente(vente, clients) {
  const body = h(`<div>${clientFieldHtml(clients)}</div>`);
  bindClientField(body, clients);
  // Pré-sélectionne le mode actuel du client sur cette vente.
  const btns = qsa('.client-mode-btn', body);
  btns.forEach((b) => b.classList.remove('active'));
  if (vente.clientId) {
    qs('.client-mode-btn[data-mode="enregistre"]', body).classList.add('active');
    qs('#f-client-enregistre-wrap', body).style.display = 'flex';
    setClientFieldValue(body, vente.clientId, clients);
  } else if (vente.clientNom) {
    qs('.client-mode-btn[data-mode="manuel"]', body).classList.add('active');
    // CORRECTIF : ce bloc ciblait #f-client-manuel — un id qui n'existe pas
    // (seuls #f-client-manuel-wrap et #f-client-manuel-nom existent) — donc
    // l'ouverture de "Modifier le client" pour une vente saisie manuellement
    // plantait silencieusement (TypeError sur null) avant même d'afficher la
    // modale.
    qs('#f-client-manuel-wrap', body).style.display = 'block';
    qs('#f-client-manuel-nom', body).value = vente.clientNom;
  } else {
    qs('.client-mode-btn[data-mode="comptoir"]', body).classList.add('active');
  }
  openModal('Modifier le client de la vente ' + vente.numero, body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      const payload = getClientPayload(body);
      await call('ventes:modifierClient', { id: vente.id, ...payload });
      toast('Client mis à jour', 'success'); closeModal(); renderVentes();
    } }
  ]);
}


export function openVenteForm(clients, produits, services, taxSettings) {
  const body = h(`<div>
    <div class="two-col">
      ${clientFieldHtml(clients, { evenTabs: true })}
      <div class="field"><label>Mode de paiement</label><select id="f-mode"><option value="especes">Espèces</option><option value="mobile_money">Mobile Money</option><option value="carte">Carte bancaire</option><option value="virement">Virement</option><option value="mixte">Paiement mixte</option></select></div>
    </div>
    <div class="hr"></div>
    <div class="form-section">
      ${sectionTitleHtml('panier2', '', 'Articles', 'produits et/ou services')}
      <div class="toolbar-actions mb-8">
        <button class="btn btn-ghost btn-sm" id="add-produit" type="button">+ Ajouter un produit</button>
        <button class="btn btn-ghost btn-sm" id="add-service" type="button">+ Ajouter un service</button>
      </div>
      <div class="lignes-scroll">
        <div class="lignes-header"><span></span><span>Article</span><span>Quantité</span><span>Prix unitaire</span><span>Remise %</span><span>Total</span><span></span></div>
        <div id="lignes-container"></div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="totals-cards">
      <div class="total-card"><div class="kpi-label">Total</div><input id="f-total-display" disabled value="0 ${CURRENCY}" class="kpi-value-input" /></div>
      <div class="total-card"><div class="kpi-label">Montant payé</div><input type="number" id="f-paye" value="0" class="kpi-value-input" /></div>
    </div>
  </div>`);
  const editeur = creerEditeurLignes(body, produits, services, { taxSettings });
  bindClientField(body, clients);

  openModal('Nouvelle vente', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      let items;
      try { items = editeur.getItems(); } catch (err) { toast(err.message, 'error'); return; }
      if (!items.length) { toast('Ajoutez au moins un article', 'error'); return; }
      const clientPayload = getClientPayload(body);
      const payload = Object.assign({ modePaiement: qs('#f-mode', body).value, items, montantPaye: Number(qs('#f-paye', body).value) || 0 }, clientPayload);
      await call('ventes:create', payload);
      toast('Vente enregistrée', 'success'); closeModal(); renderVentes();
    } }
  ], { wide: true });
}

// ------------------------- Page : Proforma (devis) -------------------------
