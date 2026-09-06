import { closeModal, confirmDialog, openImportRecapModal, openModal } from '../components/modal.js';
import { createCombobox } from '../components/combobox.js';
import { createColumnPicker, createPager } from '../components/tableTools.js';
import { toast } from '../components/toast.js';
import { call, withSpinner } from '../utils/api.js';
import { esc, h, money, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderProduits() {
  const main = qs('#main-content');
  main.innerHTML = `
    <div class="topbar"><div><h2>Produits</h2><div class="sub">Catalogue et prix</div></div>
      <div class="toolbar-actions">
        <button class="btn btn-ghost" id="btn-import-produits">📥 Importer CSV</button>
        <button class="btn btn-ghost" id="btn-cats">Catégories</button>
        <button class="btn btn-primary" id="btn-new-p">+ Nouveau produit</button>
      </div></div>
    <div class="toolbar">
      <div class="toolbar-actions">
        <input id="p-code-search" placeholder="Rechercher par code..." class="p-9-12 border-1px-solid-var-line radius-8 minw-120" />
        <input id="p-search" placeholder="Rechercher un produit…" class="p-9-12 border-1px-solid-var-line radius-8 minw-260" />
      </div>
      <div id="produits-col-picker"></div>
    </div>
    <div class="card" id="p-table-wrap">Chargement…</div>
  `;
  const [produits, categories, fournisseurs, meta] = await Promise.all([call('produits:list'), call('categories:list'), call('fournisseurs:list'), call('settings:get')]);
  state.cache.produits = produits; state.cache.categories = categories; state.cache.fournisseurs = fournisseurs;
  const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 20 };
  // SYSTÈME TVA (§12) : libellé résolu du taux appliqué à un produit, pour
  // la colonne "TVA" du tableau — reflète taxService.js#getEffectiveVatRate
  // côté serveur, en lecture seule ici (aucun calcul de TVA n'est fait côté
  // renderer).
  function libelleTvaProduit(p) {
    if (!taxSettings.vatEnabled) return 'Désactivée';
    if (p.vat && p.vat.mode === 'custom') return `${p.vat.rate}%`;
    return `Général ${taxSettings.defaultVatRate}%`;
  }
  const catName = (id) => categories.find((c) => c.id === id)?.nom || '—';
  const produitsPager = createPager('produits');
  const produitsCols = createColumnPicker('produits', [
    { key: 'code', label: 'Code' }, { key: 'desig', label: 'Désignation' }, { key: 'cat', label: 'Catégorie' },
    { key: 'pa', label: 'Prix achat' }, { key: 'pv', label: 'Prix vente' }, { key: 'tva', label: 'TVA' }, { key: 'stock', label: 'Stock' }
  ]);
  qs('#produits-col-picker').innerHTML = produitsCols.html();
  let currentProduitsList = produits;
  produitsCols.bind(() => draw(currentProduitsList));
  function buildProduitsTableHtml(list) {
    if (!list.length) return `<div class="empty-state"><div class="big">▣</div>Aucun produit enregistré.</div>`;
    return `<table><thead><tr>
        <th class="${produitsCols.cls('code')}">Code</th><th class="${produitsCols.cls('desig')}">Désignation</th><th class="${produitsCols.cls('cat')}">Catégorie</th>
        <th class="${produitsCols.cls('pa')}">Prix achat</th><th class="${produitsCols.cls('pv')}">Prix vente</th><th class="${produitsCols.cls('tva')}">TVA</th><th class="${produitsCols.cls('stock')}">Stock</th><th></th></tr></thead>
      <tbody>${list.map((p) => `<tr data-id="${p.id}">
        <td class="${produitsCols.cls('code')}">${esc(p.code)}</td><td class="${produitsCols.cls('desig')}">${esc(p.designation)}</td><td class="${produitsCols.cls('cat')}">${esc(catName(p.categorieId))}</td>
        <td class="${produitsCols.cls('pa')}">${money(p.prixAchat)}</td><td class="${produitsCols.cls('pv')}">${money(p.prixVente)}</td>
        <td class="${produitsCols.cls('tva')}">${esc(libelleTvaProduit(p))}</td>
        <td class="${produitsCols.cls('stock')}">${p.quantite <= Math.max(0, Number(p.seuilMin) || 0) ? `<span class="stamp stamp-annulee">${p.quantite}</span>` : p.quantite}</td>
        <td class="text-right nowrap"><button class="btn btn-ghost btn-sm act-edit" title="Modifier le produit">Modifier</button> <button class="btn btn-danger btn-sm act-del" title="Supprimer le produit">Suppr.</button></td>
      </tr>`).join('')}</tbody></table>`;
  }
  function draw(list) {
    currentProduitsList = list;
    const wrap = qs('#p-table-wrap');
    if (!list.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">▣</div>Aucun produit enregistré.</div>`; return; }
    // CORRECTIF : voir tableTools.js#createPager — le rattachement des
    // écouteurs de ligne doit passer par le callback onRender pour continuer
    // à fonctionner après un changement de page ou de taille de page.
    produitsPager.render(wrap, list, buildProduitsTableHtml, (pageItems) => {
      qsa('.act-edit', wrap).forEach((btn) => btn.addEventListener('click', (e) => openProduitForm(pageItems.find((p) => p.id === e.target.closest('tr').dataset.id), categories, fournisseurs, taxSettings)));
      qsa('.act-del', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Supprimer ce produit ?', async () => { await call('produits:delete', { id }); toast('Produit supprimé', 'success'); renderProduits(); });
      }));
    });
  }
  function applyProduitsFilters() {
    const codeSearch = qs('#p-code-search').value.toLowerCase();
    const desigSearch = qs('#p-search').value.toLowerCase();
    draw(produits.filter((p) => {
      if (codeSearch && !p.code.toLowerCase().includes(codeSearch)) return false;
      if (desigSearch && !p.designation.toLowerCase().includes(desigSearch)) return false;
      return true;
    }));
  }
  applyProduitsFilters();
  qs('#p-search').addEventListener('input', applyProduitsFilters);
  qs('#p-code-search').addEventListener('input', applyProduitsFilters);
  qs('#btn-import-produits').addEventListener('click', async (e) => {
    const result = await withSpinner(e.currentTarget, () => call('import:produits', {}));
    if (result && result.annule) return;
    if (result) {
      const doublons = result.doublons || [];
      const parts = [`${result.inserted} produit(s) importés`];
      if (doublons.length) parts.push(`${doublons.length} doublon(s) ignoré(s)`);
      if (result.errors.length) parts.push(`${result.errors.length} erreur(s)`);
      toast(parts.join(', '), (doublons.length || result.errors.length) ? 'warn' : 'success');
      renderProduits();
      openImportRecapModal("Récapitulatif de l'import produits", result);
    }
  });
  qs('#btn-new-p').addEventListener('click', () => openProduitForm(null, categories, fournisseurs, taxSettings));
  qs('#btn-cats').addEventListener('click', () => openCategoriesManager(categories));
}

export function openProduitForm(p, categories, fournisseurs, taxSettings) {
  taxSettings = taxSettings || { vatEnabled: false, defaultVatRate: 20 };
  const vatMode = (p && p.vat && p.vat.mode === 'custom') ? 'custom' : 'default';
  const vatRateActuel = (p && p.vat && p.vat.rate != null) ? p.vat.rate : taxSettings.defaultVatRate;
  const body = h(`<div>
    <div class="field"><label>Code produit</label><input id="f-code" value="${esc(p?.code || '')}" placeholder="Automatique si vide" /></div>
    <div class="two-col">
      <div class="field"><label>Désignation</label><input id="f-desig" value="${esc(p?.designation || '')}" /></div>
      <div class="field"><label>Catégorie</label><div id="f-cat-combo-wrap"></div></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Prix d'achat (HT)</label><input type="number" id="f-pa" value="${p?.prixAchat ?? 0}" /></div>
      <div class="field"><label>Prix de vente (HT)</label><input type="number" id="f-pv" value="${p?.prixVente ?? 0}" /></div>
    </div>
    <div class="two-col">
      <div class="field"><label>${p ? 'Quantité en stock' : 'Quantité initiale'}</label><input type="number" id="f-qte" value="${p?.quantite ?? 0}" ${p ? 'disabled title="Utilisez Mouvements de stock pour ajuster"' : ''} /></div>
      <div class="field"><label>Seuil minimum</label><input type="number" id="f-seuil" min="0" value="${p?.seuilMin ?? 0}" /></div>
    </div>
    <div class="field"><label>Unité (affichée sur la facture)</label><input id="f-unite" value="${esc(p?.unite || 'Unité')}" placeholder="Unité, Kg, Ramette, Paquet…" /></div>
    <div class="two-col">
      <div class="field">
        <label>Gestion TVA</label>
        <div class="fs-13_5">
          <label class="d-block mb-4"><input type="radio" name="f-vat-mode" value="default" ${vatMode === 'default' ? 'checked' : ''} /> Utiliser le taux général (${taxSettings.defaultVatRate}%)</label>
          <label class="d-block"><input type="radio" name="f-vat-mode" value="custom" ${vatMode === 'custom' ? 'checked' : ''} /> Taux spécifique</label>
        </div>
      </div>
      <div class="field"><label>Taux TVA (%)</label><input type="number" min="0" max="100" step="0.1" id="f-vat-rate" value="${vatRateActuel}" ${vatMode === 'custom' ? '' : 'disabled'} /></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Fournisseur</label><div id="f-four-combo-wrap"></div></div>
    </div>
    <div class="field"><label>Description</label><textarea id="f-desc">${esc(p?.description || '')}</textarea></div>
  </div>`);
  qsa('input[name="f-vat-mode"]', body).forEach((radio) => {
    radio.addEventListener('change', () => {
      qs('#f-vat-rate', body).disabled = qs('input[name="f-vat-mode"]:checked', body).value !== 'custom';
    });
  });
  // UX/UI : recherche combobox au lieu de <select> natifs pour la catégorie
  // et le fournisseur — cohérent avec les autres formulaires (voir
  // combobox.js), et bien plus praticable dès que ces listes grandissent.
  const catOptions = categories.map((c) => ({ id: c.id, label: c.nom }));
  const catCombo = createCombobox(catOptions, p?.categorieId || null, 'Rechercher une catégorie...');
  catCombo.querySelector('.combobox-hidden').id = 'f-cat';
  qs('#f-cat-combo-wrap', body).appendChild(catCombo);
  const fourOptions = fournisseurs.map((f) => ({ id: f.id, label: f.nom }));
  const fourCombo = createCombobox(fourOptions, p?.fournisseurId || null, 'Rechercher un fournisseur (optionnel)...');
  fourCombo.querySelector('.combobox-hidden').id = 'f-four';
  qs('#f-four-combo-wrap', body).appendChild(fourCombo);
  openModal(p ? 'Modifier le produit' : 'Nouveau produit', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      const vatModeChoisi = qs('input[name="f-vat-mode"]:checked', body)?.value === 'custom' ? 'custom' : 'default';
      const payload = { code: qs('#f-code').value.trim() || undefined, designation: qs('#f-desig').value.trim(), unite: qs('#f-unite').value.trim() || 'Unité', categorieId: qs('#f-cat').value || null, prixAchat: qs('#f-pa').value, prixVente: qs('#f-pv').value, quantite: qs('#f-qte').value, seuilMin: qs('#f-seuil').value, vat: { mode: vatModeChoisi, rate: vatModeChoisi === 'custom' ? Number(qs('#f-vat-rate').value) : null }, fournisseurId: qs('#f-four').value || null, description: qs('#f-desc').value.trim() };
      if (!payload.designation) { toast('La désignation est obligatoire', 'error'); return; }
      if (vatModeChoisi === 'custom' && (!Number.isFinite(payload.vat.rate) || payload.vat.rate < 0 || payload.vat.rate > 100)) { toast('Le taux de TVA spécifique doit être compris entre 0 et 100', 'error'); return; }
      if (p) { delete payload.quantite; await call('produits:update', { id: p.id, patch: payload }); }
      else await call('produits:create', payload);
      toast('Produit enregistré', 'success'); closeModal(); renderProduits();
    } }
  ]);
}

export function openCategoriesManager(categories) {
  const body = h(`<div>
    <div class="field"><label>Nouvelle catégorie</label><div class="flex gap-8"><input id="new-cat-name" placeholder="Nom de la catégorie" /><button class="btn btn-primary btn-sm" id="add-cat">Ajouter</button></div></div>
    <div class="hr"></div>
    <div id="cats-list"></div>
  </div>`);
  function drawList(list) {
    qs('#cats-list', body).innerHTML = list.map((c) => `<div class="flex justify-between p-6-0 bb-1px-solid-var-line" data-id="${c.id}"><span>${esc(c.nom)}</span><button class="btn btn-danger btn-sm act-del-cat">Suppr.</button></div>`).join('') || '<div class="muted">Aucune catégorie</div>';
    qsa('.act-del-cat', body).forEach((btn) => btn.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      await call('categories:delete', { id });
      const updated = await call('categories:list');
      drawList(updated);
      toast('Catégorie supprimée', 'success');
    }));
  }
  drawList(categories);
  qs('#add-cat', body).addEventListener('click', async () => {
    const input = qs('#new-cat-name', body);
    if (!input.value.trim()) return;
    await call('categories:create', { nom: input.value.trim() });
    input.value = '';
    const updated = await call('categories:list');
    drawList(updated);
    toast('Catégorie ajoutée', 'success');
  });
  openModal('Gérer les catégories', body, [{ label: 'Fermer', cls: 'btn-ghost', onClick: () => { closeModal(); renderProduits(); } }]);
}

// ------------------------- Page : Mouvements de stock -------------------------
