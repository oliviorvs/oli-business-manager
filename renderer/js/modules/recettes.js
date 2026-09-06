// renderer/js/modules/recettes.js
//
// CORRECTIF (audit — bug n°2) : écran manquant pour gérer les nomenclatures
// de consommation. Le moteur (consommation.service.js / recette.service.js)
// était bien câblé côté backend et IPC, mais aucune interface ne permettait
// de créer/consulter/modifier une recette — voir aussi le correctif dans
// preload.js qui expose désormais les canaux 'recettes:*' et
// 'consommations:simuler' au renderer.
//
// AJOUT (audit) : une nomenclature peut désormais s'appliquer à PLUSIEURS
// cibles (plusieurs services et/ou produits) au lieu d'une seule — voir
// recette.service.js#listeCibles. La section « S'applique à » devient donc
// une liste de cibles ajoutables/supprimables (même logique que la liste
// des matières premières juste en dessous), au lieu d'un simple sélecteur
// unique. Un produit consommé par plusieurs services (ex. de l'encre pour
// « Photocopie N&B » et « Photocopie couleur ») se déclare ainsi UNE seule
// fois, dans UNE seule nomenclature, plutôt que d'être recopié pour chaque
// service.
import { createCombobox } from '../components/combobox.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { ICONS } from '../utils/constants.js';
import { esc, h, money, qs, qsa, sectionTitleHtml } from '../utils/helpers.js';

// Normalise les cibles d'une nomenclature (compatible avec les anciens
// enregistrements qui n'ont qu'un couple cibleType/cibleId unique) — reflet
// côté renderer de recette.service.js#listeCibles.
function listeCibles(r) {
  if (Array.isArray(r.cibles) && r.cibles.length) return r.cibles;
  if (r.cibleType && r.cibleId) return [{ cibleType: r.cibleType, cibleId: r.cibleId }];
  return [];
}

export async function renderRecettes() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Nomenclatures</h2><div class="sub">Matières premières consommées automatiquement à la vente d'un produit ou d'un service</div></div>
    <button class="btn btn-primary" id="btn-new-recette">+ Nouvelle nomenclature</button></div>
    <div class="card" id="r-table-wrap">Chargement…</div>`;

  const [recettes, produits, services] = await Promise.all([call('recettes:list'), call('produits:list'), call('services:list')]);
  const wrap = qs('#r-table-wrap');
  const produitNom = (id) => produits.find((p) => p.id === id)?.designation || '(produit introuvable)';
  const serviceNom = (id) => services.find((s) => s.id === id)?.nom || '(service introuvable)';
  const cibleUniteNom = (c) => (c.cibleType === 'service' ? serviceNom(c.cibleId) : produitNom(c.cibleId));
  const ciblesLabel = (r) => listeCibles(r).map((c) => `${c.cibleType === 'service' ? 'Service' : 'Produit'} — ${esc(cibleUniteNom(c))}`).join(', ') || '<span class="muted">— aucune cible —</span>';

  function draw(list) {
    if (!list.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">⚗</div>Aucune nomenclature enregistrée. Une matière première n'est déduite automatiquement d'un produit/service vendu que si une nomenclature active existe pour lui.</div>`; return; }
    wrap.innerHTML = `<table><thead><tr><th>Nom</th><th>S'applique à</th><th>Lignes</th><th>Statut</th><th></th></tr></thead>
      <tbody>${list.map((r) => `<tr data-id="${r.id}">
        <td>${esc(r.nom)}</td>
        <td>${ciblesLabel(r)}</td>
        <td>${(r.lignes || []).length} matière(s)</td>
        <td>${r.actif ? '<span class="stamp stamp-payee">Active</span>' : '<span class="stamp stamp-annulee">Inactive</span>'}</td>
        <td class="text-right nowrap">
          <button class="btn btn-ghost btn-sm act-simuler" title="Aperçu du coût matière">Simuler</button>
          <button class="btn btn-ghost btn-sm act-edit" title="Modifier la nomenclature">Modifier</button>
          <button class="btn btn-danger btn-sm act-del" title="Supprimer la nomenclature">Suppr.</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
    qsa('.act-edit', wrap).forEach((btn) => btn.addEventListener('click', (e) => openRecetteForm(list.find((r) => r.id === e.target.closest('tr').dataset.id), produits, services)));
    qsa('.act-simuler', wrap).forEach((btn) => btn.addEventListener('click', (e) => openSimulationForm(list.find((r) => r.id === e.target.closest('tr').dataset.id), produits, services)));
    qsa('.act-del', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      confirmDialog('Supprimer cette nomenclature ? Les ventes déjà réalisées ne sont pas affectées.', async () => { await call('recettes:delete', { id }); toast('Nomenclature supprimée', 'success'); renderRecettes(); });
    }));
  }
  draw(recettes);
  qs('#btn-new-recette').addEventListener('click', () => openRecetteForm(null, produits, services));
}

// Aperçu du coût matière pour une quantité donnée (canal `consommations:simuler`).
// Une nomenclature pouvant couvrir plusieurs cibles, on laisse choisir sur
// laquelle simuler quand il y en a plus d'une (le calcul reste par cible,
// une quantité vendue s'appliquant à UN produit/service à la fois).
function openSimulationForm(recette, produits, services) {
  const cibles = listeCibles(recette);
  const nomCible = (c) => (c.cibleType === 'service' ? (services.find((s) => s.id === c.cibleId)?.nom) : (produits.find((p) => p.id === c.cibleId)?.designation)) || '(introuvable)';
  const body = h(`<div>
    ${cibles.length > 1 ? `<div class="field"><label>Cible à simuler</label>
      <select id="sim-cible">${cibles.map((c, i) => `<option value="${i}">${esc(c.cibleType === 'service' ? 'Service' : 'Produit')} — ${esc(nomCible(c))}</option>`).join('')}</select>
    </div>` : ''}
    <div class="field"><label>Quantité vendue à simuler</label><input type="number" id="sim-qte" value="1" min="0.0001" /></div>
    <div id="sim-resultat" class="mt-12"></div>
  </div>`);
  async function runSimulation() {
    const idx = cibles.length > 1 ? Number(qs('#sim-cible', body).value) : 0;
    const cible = cibles[idx];
    const qte = Number(qs('#sim-qte', body).value) || 0;
    const resBox = qs('#sim-resultat', body);
    if (!cible) { resBox.innerHTML = '<div class="muted">Aucune cible définie pour cette nomenclature.</div>'; return; }
    const res = await call('consommations:simuler', { cibleType: cible.cibleType, cibleId: cible.cibleId, quantite: qte });
    if (!res || res.statut !== 'OK') { resBox.innerHTML = '<div class="muted">Aucune consommation (pas de nomenclature active).</div>'; return; }
    resBox.innerHTML = `<table><thead><tr><th>Matière</th><th>Besoin</th><th>Disponible ?</th><th>Coût</th></tr></thead>
      <tbody>${res.lignes.map((l) => `<tr>
        <td>${esc(l.designation)}${l.optionnel ? ' <span class="muted">(optionnel)</span>' : ''}</td>
        <td>${l.quantite} ${esc(l.unite)}</td>
        <td>${l.disponible ? '<span class="stamp stamp-payee">Oui</span>' : '<span class="stamp stamp-annulee">Non — sera ignorée</span>'}</td>
        <td>${money(l.quantite * l.coutUnitaire)}</td>
      </tr>`).join('')}</tbody></table>
      <div class="totals-cards mt-8"><div class="total-card"><div class="kpi-label">Coût matière prévisionnel</div><div class="kpi-value">${money(res.coutTotal)}</div></div></div>`;
  }
  qs('#sim-qte', body).addEventListener('input', runSimulation);
  if (cibles.length > 1) qs('#sim-cible', body).addEventListener('change', runSimulation);
  openModal(`Simuler — ${recette.nom}`, body, [{ label: 'Fermer', cls: 'btn-ghost', onClick: closeModal }]);
  runSimulation();
}

export function openRecetteForm(r, produits, services) {
  const body = h(`<div>
    <div class="two-col">
      <div class="field"><label>Nom de la nomenclature</label><input id="f-nom" value="${esc(r?.nom || '')}" placeholder="Ex. Photocopie A4 N&amp;B" /></div>
      <div class="field"><label>Statut</label>
        <select id="f-actif"><option value="1" ${r?.actif !== false ? 'selected' : ''}>Active</option><option value="0" ${r?.actif === false ? 'selected' : ''}>Inactive</option></select>
      </div>
    </div>
    <div class="field"><label>Description</label><textarea id="f-desc">${esc(r?.description || '')}</textarea></div>
    <div class="hr"></div>
    <div class="form-section">
      ${sectionTitleHtml('personne', '', "S'applique à — produit(s) et/ou service(s)")}
      <div class="muted fs-12_5 mb-8">Un même produit ou service ne peut être couvert que par une seule nomenclature active. Un produit consommé par plusieurs services peut désormais être déclaré une seule fois ici, en ajoutant chaque service concerné.</div>
      <div class="toolbar-actions mb-8"><button class="btn btn-ghost btn-sm" id="add-cible-recette" type="button">+ Ajouter une cible</button></div>
      <div class="cible-lignes-header"><span>Type</span><span>Produit ou service</span><span></span></div>
      <div id="cibles-recette-container"></div>
    </div>
    <div class="hr"></div>
    <div class="form-section">
      ${sectionTitleHtml('panier2', '', 'Matières premières consommées')}
      <div class="toolbar-actions mb-8"><button class="btn btn-ghost btn-sm" id="add-ligne-recette" type="button">+ Ajouter une matière</button></div>
      <div class="lignes-scroll">
        <div class="achat-lignes-header"><span></span><span>Matière</span><span>Qté / unité vendue</span><span>Perte %</span><span>Optionnel</span><span></span></div>
        <div id="lignes-recette-container"></div>
      </div>
    </div>
  </div>`);

  // ------------------------- Cibles (produit(s)/service(s) concernés) -------------------------
  const ciblesContainer = qs('#cibles-recette-container', body);
  const produitOptions = produits.map((p) => ({ id: p.id, label: p.designation }));
  const serviceOptions = services.map((s) => ({ id: s.id, label: s.nom }));

  function addCibleRow(cible) {
    const row = document.createElement('div');
    row.className = 'achat-line-item cible-line-item';
    row.innerHTML = `
      <select class="c-type">
        <option value="produit" ${(!cible || cible.cibleType === 'produit') ? 'selected' : ''}>Un produit</option>
        <option value="service" ${cible?.cibleType === 'service' ? 'selected' : ''}>Un service</option>
      </select>
      <div class="cible-combo-wrap"></div>
      <button class="btn btn-sm line-item-delete" type="button" title="Retirer cette cible">${ICONS.poubelle || '✕'}</button>`;
    const comboWrap = row.querySelector('.cible-combo-wrap');
    function buildCombo() {
      comboWrap.innerHTML = '';
      const type = row.querySelector('.c-type').value;
      const options = type === 'service' ? serviceOptions : produitOptions;
      const preselected = cible && (!cible.cibleType || cible.cibleType === type) ? cible.cibleId : null;
      const combo = createCombobox(options, preselected, type === 'service' ? 'Rechercher un service...' : 'Rechercher un produit...');
      combo.querySelector('.combobox-hidden').classList.add('c-id');
      comboWrap.appendChild(combo);
    }
    buildCombo();
    row.querySelector('.c-type').addEventListener('change', () => { cible = null; buildCombo(); });
    row.querySelector('.line-item-delete').addEventListener('click', () => row.remove());
    ciblesContainer.appendChild(row);
  }
  qs('#add-cible-recette', body).addEventListener('click', () => addCibleRow());
  const ciblesExistantes = r ? listeCibles(r) : [];
  ciblesExistantes.forEach((c) => addCibleRow(c));
  if (!ciblesExistantes.length) addCibleRow();

  // ------------------------- Matières premières consommées -------------------------
  const container = qs('#lignes-recette-container', body);
  const materielOptions = produits.map((p) => ({ id: p.id, label: `${p.designation} (stock: ${p.quantite} ${p.unite || ''})` }));

  function renumeroter() { qsa('.line-num', container).forEach((el, i) => { el.textContent = String(i + 1); }); }

  function addLigne(ligne) {
    const combobox = createCombobox(materielOptions, ligne?.materielId || null, 'Rechercher une matière première...');
    const hiddenId = combobox.querySelector('.combobox-hidden');
    const row = document.createElement('div');
    row.className = 'achat-line-item';
    row.innerHTML = `<span class="line-num">•</span>
      <div class="article-search-row"></div>
      <input type="number" class="l-qte" value="${ligne?.quantite ?? 1}" min="0.0001" step="any" placeholder="Qté" />
      <input type="number" class="l-perte" value="${ligne?.pertePourcentage ?? 0}" min="0" max="100" placeholder="Perte %" />
      <label class="flex items-center gap-6"><input type="checkbox" class="l-optionnel" ${ligne?.optionnel ? 'checked' : ''} /> Optionnel</label>
      <button class="btn btn-sm line-item-delete" type="button" title="Supprimer la ligne">${ICONS.poubelle || '✕'}</button>`;
    row.querySelector('.article-search-row').appendChild(combobox);
    row.querySelector('.line-item-delete').addEventListener('click', () => { row.remove(); renumeroter(); });
    container.appendChild(row);
    renumeroter();
  }
  qs('#add-ligne-recette', body).addEventListener('click', () => addLigne());
  ((r && r.lignes) || []).forEach((l) => addLigne(l));
  if (!r) addLigne();

  openModal(r ? 'Modifier la nomenclature' : 'Nouvelle nomenclature', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      const nom = qs('#f-nom', body).value.trim();
      if (!nom) { toast('Le nom est obligatoire', 'error'); return; }

      const cibles = qsa('.cible-line-item', body).map((row) => ({
        cibleType: qs('.c-type', row).value,
        cibleId: qs('.c-id', row).value
      })).filter((c) => c.cibleId);
      if (!cibles.length) { toast('Sélectionnez au moins un produit ou service concerné', 'error'); return; }
      const doublon = cibles.some((c, i) => cibles.findIndex((c2) => c2.cibleType === c.cibleType && c2.cibleId === c.cibleId) !== i);
      if (doublon) { toast('Le même produit/service est sélectionné plusieurs fois comme cible', 'error'); return; }

      const lignes = qsa('.achat-line-item:not(.cible-line-item)', body).map((row) => ({
        materielId: qs('.combobox-hidden', row).value,
        quantite: Number(qs('.l-qte', row).value),
        pertePourcentage: Number(qs('.l-perte', row).value) || 0,
        optionnel: qs('.l-optionnel', row).checked
      })).filter((l) => l.materielId && l.quantite > 0);
      if (!lignes.length) { toast('Ajoutez au moins une matière première consommée', 'error'); return; }

      const payload = { nom, description: qs('#f-desc', body).value.trim(), cibles, actif: qs('#f-actif', body).value === '1', lignes };
      try {
        if (r) await call('recettes:update', { id: r.id, patch: payload }); else await call('recettes:create', payload);
      } catch (err) {
        toast(err.message || 'Erreur lors de l\'enregistrement', 'error');
        return;
      }
      toast('Nomenclature enregistrée', 'success'); closeModal(); renderRecettes();
    } }
  ], { wide: true });
}
