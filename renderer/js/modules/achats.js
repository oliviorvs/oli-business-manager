import { createCombobox } from '../components/combobox.js';
import { closeModal, closeModal2, confirmDialog, openModal, openModal2, openPaiementForm, quickPayer } from '../components/modal.js';
import { createColumnPicker, createPager } from '../components/tableTools.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { CURRENCY, ICONS } from '../utils/constants.js';
import { dateOnlyFr, esc, h, lsGet, lsSet, money, qs, qsa, sectionTitleHtml } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderAchats() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Achats</h2><div class="sub">Bons d'achat et réception de stock</div></div>
    <button class="btn btn-primary" id="btn-new-achat">+ Nouvel achat</button></div>
    <div class="toolbar">
      <div class="toolbar-actions">
        <select id="f-filtre-statut" class="p-8-10 border-1px-solid-var-line radius-8">
          <option value="">Tous les statuts</option>
          <option value="paye">Payé</option>
          <option value="partiel">Partiellement payé</option>
          <option value="impaye">Impayé</option>
          <option value="annulee">Annulé</option>
        </select>
        <input type="date" id="f-filtre-debut" title="Du" class="p-7-10 border-1px-solid-var-line radius-8" />
        <input type="date" id="f-filtre-fin" title="Au" class="p-7-10 border-1px-solid-var-line radius-8" />
        <button class="btn btn-ghost btn-sm" id="f-filtre-reset">Réinitialiser</button>
      </div>
      <div id="achats-col-picker"></div>
    </div>
    <div class="card" id="achats-table-wrap">Chargement…</div>`;
  const [achats, fournisseurs, produits] = await Promise.all([call('achats:list'), call('fournisseurs:list'), call('produits:list')]);
  const fname = (id) => fournisseurs.find((f) => f.id === id)?.nom || '—';
  const wrap = qs('#achats-table-wrap');
  const achatsPager = createPager('achats');
  const achatsCols = createColumnPicker('achats', [
    { key: 'numero', label: 'N°' }, { key: 'four', label: 'Fournisseur' }, { key: 'date', label: 'Date' },
    { key: 'total', label: 'Total' }, { key: 'paye', label: 'Payé' }, { key: 'statut', label: 'Statut' }
  ]);
  qs('#achats-col-picker').innerHTML = achatsCols.html();
  let currentAchatsList = achats;
  achatsCols.bind(() => draw(currentAchatsList));

  // CORRECTIF (audit — bug n°8) : le badge était binaire (Payé / En attente),
  // identique pour un achat jamais réglé et un achat réglé à 90 % — on
  // introduit un troisième état, symétrique de l'affichage déjà en place
  // côté ventes (voir ventes.js#stampCls/stampLbl).
  const achatsStampCls = { paye: 'stamp-payee', partiellement_paye: 'stamp-partiel', en_attente: 'stamp-attente' };
  const achatsStampLbl = { paye: 'Payé', partiellement_paye: 'Partiel', en_attente: 'En attente' };

  function buildAchatsTableHtml(list) {
    if (!list.length) return `<div class="empty-state"><div class="big">⇩</div>Aucun achat ne correspond.</div>`;
    return `<table><thead><tr>
        <th class="${achatsCols.cls('numero')}">N°</th><th class="${achatsCols.cls('four')}">Fournisseur</th><th class="${achatsCols.cls('date')}">Date</th>
        <th class="${achatsCols.cls('total')}">Total</th><th class="${achatsCols.cls('paye')}">Payé</th><th class="${achatsCols.cls('statut')}">Statut</th><th></th></tr></thead>
      <tbody>${list.map((a) => `<tr data-id="${a.id}"><td class="${achatsCols.cls('numero')}">${esc(a.numero)}</td><td class="${achatsCols.cls('four')}">${esc(fname(a.fournisseurId))}</td><td class="${achatsCols.cls('date')}">${dateOnlyFr(a.createdAt)}</td><td class="${achatsCols.cls('total')}">${money(a.total)}</td><td class="${achatsCols.cls('paye')}">${money(a.montantPaye)}</td>
        <td class="${achatsCols.cls('statut')}">${a.statut === 'annulee' ? '<span class="stamp stamp-annulee">Annulé</span>' : `<span class="stamp ${achatsStampCls[a.statutPaiement] || 'stamp-attente'}">${achatsStampLbl[a.statutPaiement] || 'En attente'}</span>`}</td>
        <td class="text-right nowrap">
          ${a.statut !== 'annulee' && a.statutPaiement !== 'paye' ? '<button class="btn btn-ghost btn-sm act-payer" title="Régler la totalité en un clic">Payer</button><button class="btn btn-ghost btn-sm act-payer-partiel" title="Régler un montant partiel">±</button>' : ''}
          ${a.statut !== 'annulee' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-cancel" title="Annuler cet achat">Annuler</button>' : ''}
          ${a.statut === 'annulee' && state.session.role === 'admin' ? '<button class="btn btn-danger btn-sm act-delete" title="Supprimer définitivement">Suppr. définitivement</button>' : ''}
        </td></tr>`).join('')}</tbody></table>`;
  }

  function draw(list) {
    currentAchatsList = list;
    if (!list.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">⇩</div>Aucun achat ne correspond.</div>`; return; }
    // CORRECTIF : voir tableTools.js#createPager — le rattachement des
    // écouteurs de ligne doit passer par le callback onRender pour continuer
    // à fonctionner après un changement de page ou de taille de page.
    achatsPager.render(wrap, list, buildAchatsTableHtml, (pageItems) => {
      qsa('.act-payer', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        const a = pageItems.find((x) => x.id === id);
        quickPayer({ numero: a.numero, total: a.total, montantPaye: a.montantPaye, channel: 'achats:payer', id, onDone: () => applyFilters() });
      }));
      qsa('.act-payer-partiel', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        const a = pageItems.find((x) => x.id === id);
        openPaiementForm({ titre: 'Régler l\'achat', numero: a.numero, total: a.total, montantPaye: a.montantPaye, channel: 'achats:payer', id, onDone: () => applyFilters() });
      }));
      qsa('.act-cancel', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Annuler cet achat ? Le stock reçu sera retiré et le paiement retiré de la trésorerie.', async () => { await call('achats:annuler', { id }); toast('Achat annulé', 'success'); applyFilters(); }); 
      }));
      qsa('.act-delete', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
        const id = e.target.closest('tr').dataset.id;
        confirmDialog('Supprimer définitivement cet achat de la base de données ? Cette action est irréversible.', async () => { await call('achats:supprimer', { id }); toast('Achat supprimé définitivement', 'success'); applyFilters(); });
      }));
    });
  }

  function applyFilters() {
    const statutFiltre = qs('#f-filtre-statut').value;
    const debut = qs('#f-filtre-debut').value ? new Date(qs('#f-filtre-debut').value) : null;
    const fin = qs('#f-filtre-fin').value ? new Date(qs('#f-filtre-fin').value + 'T23:59:59') : null;
    lsSet('filters:achats', { statut: statutFiltre, debut: qs('#f-filtre-debut').value, fin: qs('#f-filtre-fin').value });
    const filtered = achats.filter((a) => {
      if (statutFiltre === 'paye' && !(a.statut !== 'annulee' && a.statutPaiement === 'paye')) return false;
      if (statutFiltre === 'partiel' && !(a.statut !== 'annulee' && a.statutPaiement === 'partiellement_paye')) return false;
      if (statutFiltre === 'impaye' && !(a.statut !== 'annulee' && a.statutPaiement !== 'paye')) return false;
      if (statutFiltre === 'annulee' && a.statut !== 'annulee') return false;
      const d = new Date(a.createdAt);
      if (debut && d < debut) return false;
      if (fin && d > fin) return false;
      return true;
    });
    draw(filtered);
  }
  ['#f-filtre-statut', '#f-filtre-debut', '#f-filtre-fin'].forEach((sel) => qs(sel).addEventListener('change', applyFilters));
  qs('#f-filtre-reset').addEventListener('click', () => { qs('#f-filtre-statut').value = ''; qs('#f-filtre-debut').value = ''; qs('#f-filtre-fin').value = ''; lsSet('filters:achats', {}); applyFilters(); });

  // Filtres mémorisés d'une session à l'autre (statut, dates)
  const filtresAchatsSauves = lsGet('filters:achats', {});
  if (filtresAchatsSauves.statut) qs('#f-filtre-statut').value = filtresAchatsSauves.statut;
  if (filtresAchatsSauves.debut) qs('#f-filtre-debut').value = filtresAchatsSauves.debut;
  if (filtresAchatsSauves.fin) qs('#f-filtre-fin').value = filtresAchatsSauves.fin;

  applyFilters();
  qs('#btn-new-achat').addEventListener('click', () => openAchatForm(fournisseurs, produits));
}

export function openAchatForm(fournisseurs, produits) {
  const body = h(`<div>
    <div class="form-section">
      ${sectionTitleHtml('personne', '', 'Fournisseur')}
      <div class="field">
        <div class="flex gap-6 flex-wrap items-start">
          <div class="flex-1 minw-140" id="f-fournisseur-combo-wrap"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="f-fournisseur-nouveau">+ Nouveau</button>
        </div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="form-section">
      ${sectionTitleHtml('panier2', '', 'Produits achetés')}
      <div class="toolbar-actions mb-8">
        <button class="btn btn-ghost btn-sm" id="add-ligne" type="button">+ Ajouter un produit</button>
      </div>
      <div class="lignes-scroll">
        <div class="achat-lignes-header"><span></span><span>Produit</span><span>Quantité</span><span>Prix d'achat U.</span><span>Total</span><span></span></div>
        <div id="lignes-container"></div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="totals-cards">
      <div class="total-card"><div class="kpi-label">Total</div><input id="f-total-display" disabled value="0 ${CURRENCY}" class="kpi-value-input" /></div>
      <div class="total-card"><div class="kpi-label">Montant payé maintenant</div><input type="number" id="f-paye" value="0" class="kpi-value-input" /></div>
    </div>
  </div>`);
  const container = qs('#lignes-container', body);
  const produitOptions = produits.map((p) => ({ id: p.id, label: p.designation + ' (stock: ' + p.quantite + ')', prix: p.prixAchat }));

  // UX/UI : recherche combobox pour le fournisseur également (voir plus bas
  // pour les produits — même composant, même logique).
  const fournisseurOptions = fournisseurs.map((f) => ({ id: f.id, label: f.nom }));
  const fournisseurCombo = createCombobox(fournisseurOptions, null, 'Rechercher un fournisseur...');
  const fournisseurHidden = fournisseurCombo.querySelector('.combobox-hidden');
  fournisseurHidden.id = 'f-fournisseur';
  qs('#f-fournisseur-combo-wrap', body).appendChild(fournisseurCombo);
  if (!fournisseurs.length) qs('.combobox-input', fournisseurCombo).placeholder = 'Aucun fournisseur — créez-en un';

  // DEMANDE UTILISATEUR : créer un fournisseur directement depuis le
  // formulaire d'achat, sans quitter/fermer celui-ci pour passer par le
  // module Fournisseurs (perte de toutes les lignes déjà saisies). Reprend
  // le même schéma que la création rapide de client (voir
  // components/clientField.js#bindClientField) : une modale secondaire
  // empilée par-dessus la modale d'achat (openModal2/closeModal2 — voir
  // components/modal.js), qui ne touche pas au formulaire en cours. À la
  // création, le nouveau fournisseur est ajouté à `fournisseurOptions` (le
  // tableau est lu par référence à chaque frappe dans le combobox — voir
  // combobox.js#renderOptions — donc il devient immédiatement trouvable
  // dans la recherche) et directement sélectionné, sans repasser par la
  // liste déroulante.
  qs('#f-fournisseur-nouveau', body).addEventListener('click', () => {
    const miniBody = h(`<div>
      <div class="field"><label>Nom</label><input id="mf2-nom" /></div>
      <div class="two-col">
        <div class="field"><label>Responsable</label><input id="mf2-resp" /></div>
        <div class="field"><label>Téléphone</label><input id="mf2-tel" /></div>
      </div>
      <div class="field"><label>E-mail</label><input id="mf2-email" type="email" /></div>
      <div class="field"><label>Adresse</label><textarea id="mf2-adresse"></textarea></div>
    </div>`);
    openModal2('Nouveau fournisseur', miniBody, [
      { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal2 },
      { label: 'Créer', cls: 'btn-primary', onClick: async () => {
        const nom = qs('#mf2-nom', miniBody).value.trim();
        if (!nom) { toast('Le nom est obligatoire', 'error'); return; }
        const fournisseur = await call('fournisseurs:create', {
          nom,
          responsable: qs('#mf2-resp', miniBody).value.trim(),
          telephone: qs('#mf2-tel', miniBody).value.trim(),
          email: qs('#mf2-email', miniBody).value.trim(),
          adresse: qs('#mf2-adresse', miniBody).value.trim()
        });
        fournisseurOptions.push({ id: fournisseur.id, label: fournisseur.nom });
        fournisseurs.push(fournisseur);
        fournisseurHidden.value = fournisseur.id;
        qs('.combobox-input', fournisseurCombo).value = fournisseur.nom;
        toast('Fournisseur créé', 'success'); closeModal2();
      } }
    ]);
  });

  // Renumérote la colonne "#" de chaque ligne (après ajout/suppression).
  function renumeroterLignes() {
    qsa('.line-num', container).forEach((el, i) => { el.textContent = String(i + 1); });
  }

  // UX/UI : la sélection produit utilisait auparavant un <select> HTML natif —
  // avec des dizaines de produits, impossible à parcourir/rechercher
  // correctement (comportement natif limité selon l'OS). On réutilise le même
  // composant de recherche que les formulaires de vente/pro-forma, pour une
  // expérience cohérente dans toute l'application (recherche, liste
  // déroulante scrollable en entier, cf. createCombobox()).
  function addLigne() {
    const combobox = createCombobox(produitOptions, null, 'Rechercher un produit...');
    const input = combobox.querySelector('.combobox-input');
    const hiddenId = combobox.querySelector('.combobox-hidden');

    const row = document.createElement('div');
    row.className = 'achat-line-item';
    let html = `<span class="line-num">•</span>`;
    html += `<div class="article-search-row"></div>`;
    html += `<div class="qte-stepper"><button type="button" class="qte-btn qte-dec" tabindex="-1" title="Diminuer la quantité">−</button><input type="number" class="l-qte" value="1" min="1" placeholder="Qté" /><button type="button" class="qte-btn qte-inc" tabindex="-1" title="Augmenter la quantité">+</button></div>`;
    html += `<input type="number" class="l-prix" value="0" placeholder="Prix U." />`;
    html += `<span class="l-sous-total muted">0 ${CURRENCY}</span>`;
    html += `<button class="btn btn-sm line-item-delete" type="button" title="Supprimer la ligne">${ICONS.poubelle}</button>`;
    row.innerHTML = html;
    row.querySelector('.article-search-row').appendChild(combobox);

    const qteInput = row.querySelector('.l-qte');
    const prixInput = row.querySelector('.l-prix');
    const deleteBtn = row.querySelector('.line-item-delete');
    const qteDec = row.querySelector('.qte-dec');
    const qteInc = row.querySelector('.qte-inc');

    function syncPrix() {
      const produit = produits.find((p) => p.id === hiddenId.value);
      if (produit) prixInput.value = produit.prixAchat;
      recalcTotal();
    }
    input.addEventListener('change', syncPrix); // sélection d'un produit (voir createCombobox)
    qteInput.addEventListener('input', recalcTotal);
    prixInput.addEventListener('input', recalcTotal);
    qteDec.addEventListener('click', () => { qteInput.value = Math.max(1, (Number(qteInput.value) || 1) - 1); recalcTotal(); });
    qteInc.addEventListener('click', () => { qteInput.value = (Number(qteInput.value) || 0) + 1; recalcTotal(); });
    deleteBtn.addEventListener('click', () => { row.remove(); renumeroterLignes(); recalcTotal(); });

    container.appendChild(row);
    renumeroterLignes();
    recalcTotal();
  }
  function recalcTotal() {
    let total = 0;
    qsa('.achat-line-item', body).forEach((row) => {
      const qte = Number(qs('.l-qte', row).value) || 0;
      const prix = Number(qs('.l-prix', row).value) || 0;
      const st = qte * prix;
      qs('.l-sous-total', row).textContent = money(st);
      total += st;
    });
    qs('#f-total-display', body).value = money(total);
    // CORRECTIF : limite la saisie du montant payé maintenant au total de
    // l'achat, comme pour la vente.
    const payeInput = qs('#f-paye', body);
    if (payeInput) { payeInput.max = Math.round(total * 100) / 100; payeInput.min = 0; }
    return total;
  }
  qs('#add-ligne', body).addEventListener('click', addLigne);
  if (produits.length) addLigne();

  openModal('Nouvel achat', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      const lignes = qsa('.achat-line-item', body).map((row) => ({ produitId: qs('.combobox-hidden', row).value, quantite: Number(qs('.l-qte', row).value), prixUnitaire: Number(qs('.l-prix', row).value) })).filter((l) => l.produitId && l.quantite > 0);
      if (!lignes.length) { toast('Ajoutez au moins une ligne', 'error'); return; }
      const montantPaye = Number(qs('#f-paye', body).value) || 0;
      const total = recalcTotal();
      await call('achats:create', { fournisseurId: qs('#f-fournisseur', body).value, lignes, montantPaye, statutPaiement: montantPaye >= total ? 'paye' : 'en_attente' });
      toast('Achat enregistré, stock mis à jour', 'success'); closeModal(); renderAchats();
    } }
  ], { wide: true });
}

// ------------------------- Page : Ventes -------------------------
