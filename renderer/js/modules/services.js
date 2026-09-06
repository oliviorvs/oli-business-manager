import { bindClientField, clientFieldHtml, getClientPayload } from '../components/clientField.js';
import { createCombobox } from '../components/combobox.js';
import { attachLiveValidation, bindFreeTextSuggestions, rememberFreeTextSuggestion } from '../components/formTools.js';
import { closeModal, confirmDialog, openImportRecapModal, openModal } from '../components/modal.js';
import { createColumnPicker, createPager } from '../components/tableTools.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { clientLabel, dateFr, esc, h, money, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderServices() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Services</h2><div class="sub">Prestations : impression, photocopie, cybercafé, wifi…</div></div>
    <div class="toolbar-actions">
      ${state.session.role !== 'caissier' ? '<button class="btn btn-ghost" id="btn-manage-services">Types de service</button>' : ''}
      <button class="btn btn-primary" id="btn-new-prestation">+ Nouvelle prestation</button>
      <button class="btn btn-ghost" id="btn-import-services">📥 Importer CSV</button>
    </div></div>
    <div class="toolbar">
      <div class="toolbar-actions">
        <input id="prest-num-search" placeholder="Rechercher par numéro..." class="p-9-12 border-1px-solid-var-line radius-8 minw-120" />
        <input id="prest-search" placeholder="Rechercher par service, client, détail…" class="p-9-12 border-1px-solid-var-line radius-8 minw-140" />
        <input type="date" id="prest-debut" title="Du" class="p-7-10 border-1px-solid-var-line radius-8" />
        <input type="date" id="prest-fin" title="Au" class="p-7-10 border-1px-solid-var-line radius-8" />
        <button class="btn btn-ghost btn-sm" id="prest-reset">Réinitialiser <span class="badge-filtre-actif hidden" id="prest-filtre-badge">●</span></button>
      </div>
      <div class="flex items-center gap-10">
        <div class="muted fw-600" id="prest-total"></div>
        <div id="prest-col-picker"></div>
      </div>
    </div>
    <div class="card" id="prest-table-wrap">Chargement…</div>`;
  
  const [prestations, services, clients, ventes, meta] = await Promise.all([call('prestations:list'), call('services:list'), call('clients:list'), call('ventes:list'), call('settings:get')]);
  const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 20 };
  // CORRECTIF : une vente mixte (produits + service dans le même passage en
  // caisse — ex. papier + stylos vendus en même temps qu'une photocopie et
  // une plastification) ne faisait apparaître ici que la ou les ligne(s) de
  // service : les produits vendus au même moment restaient invisibles sur
  // cette page alors qu'ils figurent bien sur la même facture, sous le même
  // numéro (voir la facture imprimée). On reconstitue donc, pour chaque
  // prestation liée à une vente, les lignes "produit" de cette même vente
  // — ajoutées UNE SEULE FOIS par vente (et non une fois par prestation)
  // pour ne pas dupliquer les produits si plusieurs services partagent la
  // même vente.
  const venteIdsAjoutes = new Set();
  const lignesProduitsAssocies = [];
  prestations.forEach((p) => {
    if (!p.venteId || venteIdsAjoutes.has(p.venteId)) return;
    venteIdsAjoutes.add(p.venteId);
    const vente = ventes.find((v) => v.id === p.venteId);
    if (!vente) return;
    vente.lignes.filter((l) => l.kind === 'produit').forEach((l) => {
      lignesProduitsAssocies.push({
        venteId: vente.id, numero: vente.numero, createdAt: vente.createdAt, serviceNom: l.designation, details: l.details,
        clientId: vente.clientId, clientNom: vente.clientNom, quantite: l.quantite, total: l.totalTTC != null ? l.totalTTC : l.sousTotal,
        statut: vente.statut, isProduit: true
      });
    });
  });
  // CORRECTIF ORDRE : la liste affichait auparavant "toutes les prestations
  // d'abord, tous les produits associés ensuite" (deux blocs concaténés),
  // ce qui éclatait les lignes d'une même vente aux deux extrémités du
  // tableau. On regroupe maintenant les lignes par transaction (venteId, ou
  // l'id de la prestation elle-même pour une prestation autonome sans
  // vente) — chaque groupe garde ses lignes ensemble (service(s) puis
  // produit(s), dans l'ordre où ils ont été assemblés ci-dessus) — puis on
  // trie les groupes de la transaction la plus récente à la plus ancienne.
  const groupes = new Map();
  function ajouterALaGroupe(cle, date, ligne) {
    if (!groupes.has(cle)) groupes.set(cle, { date, lignes: [] });
    groupes.get(cle).lignes.push(ligne);
  }
  prestations.forEach((p) => ajouterALaGroupe(p.venteId || p.id, p.createdAt, p));
  lignesProduitsAssocies.forEach((l) => ajouterALaGroupe(l.venteId, l.createdAt, l));
  const historique = Array.from(groupes.values())
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .flatMap((g) => g.lignes);
  const wrap = qs('#prest-table-wrap');
  
  // Variable pour savoir si des filtres sont actifs
  let filtresActifs = false;

  // PHASE 4 : colonnes personnalisables + pagination 10/20/50, mêmes
  // composants réutilisables que Ventes/Achats/Produits/Clients (voir
  // tableTools.js).
  const prestPager = createPager('prestations');
  const prestCols = createColumnPicker('prestations', [
    { key: 'numero', label: 'N°' }, { key: 'date', label: 'Date' }, { key: 'article', label: 'Article' },
    { key: 'client', label: 'Client' }, { key: 'qte', label: 'Qté' }, { key: 'total', label: 'Total' }, { key: 'statut', label: 'Statut' }
  ]);
  qs('#prest-col-picker').innerHTML = prestCols.html();
  let currentPrestList = historique;
  prestCols.bind(() => draw(currentPrestList));

  function buildPrestTableHtml(list) {
    if (!list.length) return `<div class="empty-state"><div class="big">✎</div>Aucune prestation ne correspond.</div>`;
    // CORRECTIF (audit) : une prestation autonome (sans venteId) peut
    // désormais être annulée/supprimée par un admin, comme les ventes. Une
    // prestation liée à une vente (venteId défini) n'affiche aucun bouton :
    // elle se gère via l'annulation de la vente elle-même.
    return `<table><thead><tr>
        <th class="${prestCols.cls('numero')}">N°</th><th class="${prestCols.cls('date')}">Date</th><th class="${prestCols.cls('article')}">Article</th>
        <th class="${prestCols.cls('client')}">Client</th><th class="${prestCols.cls('qte')}">Qté</th><th class="${prestCols.cls('total')}">Total</th><th class="${prestCols.cls('statut')}">Statut</th><th>Actions</th></tr></thead>
      <tbody>${list.map((p) => `<tr data-id="${p.id}">
        <td class="${prestCols.cls('numero')}">${esc(p.numero)}</td><td class="${prestCols.cls('date')}">${dateFr(p.createdAt)}</td>
        <td class="${prestCols.cls('article')}">${p.isProduit ? '<span class="count-badge mr-8">Produit</span>' : ''}${esc(p.serviceNom)}${p.details ? `<br/><span class="muted fs-11_5">${esc(p.details)}</span>` : ''}</td>
        <td class="${prestCols.cls('client')}">${esc(clientLabel(p, clients))}</td><td class="${prestCols.cls('qte')}">${p.quantite}</td>
        <td class="${prestCols.cls('total')}">${money(p.total)}</td>
        <td class="${prestCols.cls('statut')}">${p.statut === 'annulee' ? '<span class="stamp stamp-annulee">Annulée</span>' : '<span class="stamp stamp-payee">Active</span>'}</td>
        <td>${!p.venteId && p.statut !== 'annulee' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-prest-cancel" title="Annuler cette prestation">Annuler</button>' : ''}${!p.venteId && p.statut === 'annulee' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-prest-delete" title="Supprimer définitivement">Suppr. définitivement</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  function draw(list) {
    currentPrestList = list;
    // Calcul des totaux uniquement si des filtres sont actifs
    if (filtresActifs) {
      const total = list.reduce((s, p) => s + (p.statut === 'annulee' ? 0 : p.total), 0);
      qs('#prest-total').innerHTML = `
        <span class="mr-8">${list.length} ligne(s)</span>
        <span>Total : ${money(total)}</span>
      `;
    } else {
      qs('#prest-total').innerHTML = '';
    }

    if (!list.length) { 
      wrap.innerHTML = `<div class="empty-state"><div class="big">✎</div>Aucune prestation ne correspond.</div>`; 
      return; 
    }

    prestPager.render(wrap, list, buildPrestTableHtml, (pageItems) => {
      qsa('.act-prest-cancel', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Annuler cette prestation ? L\'encaissement sera retiré de la trésorerie.', async () => { await call('prestations:annuler', { id }); toast('Prestation annulée', 'success'); renderServices(); });
      }));
      qsa('.act-prest-delete', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Supprimer définitivement cette prestation de la base de données ? Cette action est irréversible.', async () => { await call('prestations:supprimer', { id }); toast('Prestation supprimée définitivement', 'success'); renderServices(); });
      }));
    });
  }

  function applyFilters() {
    const numSearch = qs('#prest-num-search').value.toLowerCase();
    const q = qs('#prest-search').value.toLowerCase();
    const debut = qs('#prest-debut').value ? new Date(qs('#prest-debut').value) : null;
    const fin = qs('#prest-fin').value ? new Date(qs('#prest-fin').value + 'T23:59:59') : null;
    
    // Vérifier si au moins un filtre est actif
    filtresActifs = !!(numSearch || q || debut || fin);
    qs('#prest-filtre-badge').classList.toggle('hidden', !filtresActifs);
    
    const filtered = historique.filter((p) => {
      // Recherche par numéro
      if (numSearch && !p.numero.toLowerCase().includes(numSearch)) return false;
      // Recherche par texte
      if (q && !(p.serviceNom + ' ' + (p.details || '') + ' ' + clientLabel(p, clients)).toLowerCase().includes(q)) return false;
      // Filtre dates
      const d = new Date(p.createdAt);
      if (debut && d < debut) return false;
      if (fin && d > fin) return false;
      return true;
    });
    draw(filtered);
  }

  // Ecouteur import csv
  // Import CSV des services
  qs('#btn-import-services').addEventListener('click', async () => {
      const result = await call('import:services', {});
      if (result && result.annule) return;
      if (result) {
        const doublons = result.doublons || [];
        const parts = [`${result.inserted} service(s) importé(s)`];
        if (doublons.length) parts.push(`${doublons.length} doublon(s) ignoré(s)`);
        if (result.errors.length) parts.push(`${result.errors.length} erreur(s)`);
        toast(parts.join(', '), (doublons.length || result.errors.length) ? 'warn' : 'success');
        renderServices(); // Rafraîchir la liste
        openImportRecapModal("Récapitulatif de l'import services", result);
      }
    });

  // Écouteurs d'événements pour les filtres
  qs('#prest-num-search').addEventListener('input', applyFilters);
  qs('#prest-search').addEventListener('input', applyFilters);
  qs('#prest-debut').addEventListener('change', applyFilters);
  qs('#prest-fin').addEventListener('change', applyFilters);
  
  qs('#prest-reset').addEventListener('click', () => {
    qs('#prest-num-search').value = '';
    qs('#prest-search').value = '';
    qs('#prest-debut').value = '';
    qs('#prest-fin').value = '';
    filtresActifs = false;
    qs('#prest-filtre-badge').classList.add('hidden');
    draw(historique);
    toast('Filtres réinitialisés', 'info');
  });
  // Affichage initial : sans filtres, pas de totaux
  filtresActifs = false;
  draw(historique);
  
  qs('#btn-new-prestation').addEventListener('click', () => openPrestationForm(services, clients));
  const btnManage = qs('#btn-manage-services');
  if (btnManage) btnManage.addEventListener('click', () => openServicesManager(services, taxSettings));
}

export function openPrestationForm(services, clients) {
  const body = h(`<div>
    <div class="field"><label>Type de service</label><div id="f-service-combo-wrap"></div></div>
    ${clientFieldHtml(clients)}
    <div class="two-col">
      <div class="field"><label>Quantité</label><input type="number" id="f-qte" value="1" min="1" /></div>
      <div class="field"><label>Prix unitaire</label><input type="number" id="f-prix" value="0" /></div>
    </div>
    <div class="field"><label>Remise (%)</label><input type="number" id="f-remise" value="0" /></div>
    <div class="field"><label>Détails (optionnel)</label><input id="f-details" placeholder="ex. Curriculum vitae" /></div>
  </div>`);
  // UX/UI : recherche combobox au lieu d'un <select> natif (voir
  // combobox.js — déjà utilisé pour les lignes produit/service de vente).
  const servicesActifs = services.filter((s) => s.actif !== false);
  const serviceOptions = servicesActifs.map((s) => ({ id: s.id, label: s.nom + (s.unite ? ' — ' + s.unite : ''), prix: s.prixDefaut }));
  const serviceCombo = createCombobox(serviceOptions, servicesActifs[0]?.id || null, 'Rechercher un type de service...');
  const serviceHidden = serviceCombo.querySelector('.combobox-hidden');
  qs('#f-service-combo-wrap', body).appendChild(serviceCombo);
  function syncPrix() {
    const svc = servicesActifs.find((s) => s.id === serviceHidden.value);
    if (svc) qs('#f-prix', body).value = svc.prixDefaut;
  }
  serviceCombo.querySelector('.combobox-input').addEventListener('change', syncPrix);
  syncPrix();
  bindClientField(body, clients);
  bindFreeTextSuggestions(qs('#f-details', body), 'prestation-details');
  const checkQte = attachLiveValidation(qs('#f-qte', body), 'positive');
  const checkPrix = attachLiveValidation(qs('#f-prix', body), 'nonNegative');
  openModal('Nouvelle prestation', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      if (!checkQte() || !checkPrix()) { toast('Veuillez corriger les champs en erreur', 'error'); return; }
      if (!serviceHidden.value) { toast('Choisissez un type de service', 'error'); return; }
      const clientPayload = getClientPayload(body);
      const details = qs('#f-details', body).value.trim();
      if (details) rememberFreeTextSuggestion('prestation-details', details);
      const payload = Object.assign({ serviceId: serviceHidden.value, quantite: qs('#f-qte', body).value, prixUnitaire: qs('#f-prix', body).value, remise: qs('#f-remise', body).value, details }, clientPayload);
      await call('prestations:create', payload);
      toast('Prestation enregistrée', 'success'); closeModal(); renderServices();
    } }
  ]);
}

export function openServicesManager(services, taxSettings) {
  taxSettings = taxSettings || { vatEnabled: false, defaultVatRate: 20 };
  const body = h(`<div>
    <div class="field"><label>Nouveau type de service</label>
      <div class="flex gap-8 flex-wrap">
        <input id="new-srv-name" placeholder="Nom (ex. Impression)" class="flex-2 minw-140" />
        <input id="new-srv-unite" placeholder="Unité (ex. Page, Heure)" class="flex-1-4 minw-120" />
        <input id="new-srv-prix" type="number" placeholder="Prix (HT)" class="flex-1 minw-90" />
        <input id="new-srv-vat-rate" type="number" min="0" max="100" step="0.1" placeholder="TVA spécifique % (vide = général)" class="flex-1-4 minw-140" />
        <button class="btn btn-primary btn-sm" id="add-srv">Ajouter</button>
      </div>
    </div>
    <div class="hr"></div>
    <div id="srv-list"></div>
  </div>`);
  function libelleTvaService(s) {
    if (!taxSettings.vatEnabled) return 'TVA désactivée';
    if (s.vat && s.vat.mode === 'custom') return `TVA ${s.vat.rate}%`;
    return `TVA générale ${taxSettings.defaultVatRate}%`;
  }
  function drawList(list) {
    qs('#srv-list', body).innerHTML = list.map((s) => `<div class="flex justify-between p-6-0 bb-1px-solid-var-line" data-id="${s.id}"><span>${esc(s.nom)} <span class="muted">(${esc(s.unite || 'Prestation')})</span> — ${money(s.prixDefaut)} <span class="muted fs-11_5">· ${esc(libelleTvaService(s))}</span></span><button class="btn btn-danger btn-sm act-del-srv">Suppr.</button></div>`).join('') || '<div class="muted">Aucun type de service</div>';
    qsa('.act-del-srv', body).forEach((btn) => btn.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      await call('services:delete', { id });
      drawList(await call('services:list'));
      toast('Type de service supprimé', 'success');
    }));
  }
  drawList(services);
  qs('#add-srv', body).addEventListener('click', async () => {
    const nom = qs('#new-srv-name', body).value.trim();
    if (!nom) return;
    const rateStr = qs('#new-srv-vat-rate', body).value.trim();
    const vat = rateStr === '' ? { mode: 'default', rate: null } : { mode: 'custom', rate: Number(rateStr) };
    if (vat.mode === 'custom' && (!Number.isFinite(vat.rate) || vat.rate < 0 || vat.rate > 100)) { toast('Le taux de TVA spécifique doit être compris entre 0 et 100', 'error'); return; }
    await call('services:create', { nom, unite: qs('#new-srv-unite', body).value.trim(), prixDefaut: qs('#new-srv-prix', body).value, vat });
    qs('#new-srv-name', body).value = ''; qs('#new-srv-unite', body).value = ''; qs('#new-srv-prix', body).value = ''; qs('#new-srv-vat-rate', body).value = '';
    drawList(await call('services:list'));
    toast('Type de service ajouté', 'success');
  });
  openModal('Types de service', body, [{ label: 'Fermer', cls: 'btn-ghost', onClick: () => { closeModal(); renderServices(); } }]);
}

// ------------------------- Page : Dépenses -------------------------
