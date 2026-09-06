import { createColumnPicker, createPager } from '../components/tableTools.js';
import { call } from '../utils/api.js';
import { dateFr, esc, money, qs } from '../utils/helpers.js';

export async function renderTresorerie() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Trésorerie</h2><div class="sub">Recettes, dépenses et solde</div></div>
    <div class="toolbar-actions">
      <select id="periode-select" class="p-8-10 border-1px-solid-var-line radius-8">
        <option value="jour">Aujourd'hui</option><option value="semaine">7 derniers jours</option><option value="mois" selected>Ce mois</option><option value="annee">Cette année</option>
      </select>
    </div></div>
    <div id="tresorerie-body">Chargement…</div>`;

  // PHASE 4 : colonnes personnalisables + pagination 10/20/50 sur le
  // tableau des mouvements (mêmes composants que Ventes/Achats/Services).
  const tresoCols = createColumnPicker('tresorerie', [
    { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'categorie', label: 'Catégorie' }, { key: 'montant', label: 'Montant' }
  ]);
  const tresoPager = createPager('tresorerie-mouvements');

  function buildMouvementsTableHtml(list) {
    if (!list.length) return '<div class="muted">Aucun mouvement</div>';
    return `<table><thead><tr>
        <th class="${tresoCols.cls('date')}">Date</th><th class="${tresoCols.cls('type')}">Type</th>
        <th class="${tresoCols.cls('categorie')}">Catégorie</th><th class="${tresoCols.cls('montant')} text-right">Montant</th></tr></thead>
      <tbody>${list.map((o) => `<tr>
        <td class="${tresoCols.cls('date')}">${dateFr(o.createdAt)}</td><td class="${tresoCols.cls('type')}">${o.type === 'entree' ? 'Recette' : 'Dépense'}</td>
        <td class="${tresoCols.cls('categorie')}">${esc(o.categorie)}</td>
        <td class="${tresoCols.cls('montant')} text-right ${o.type === 'entree' ? 'text-success' : 'text-danger'}">${o.type === 'entree' ? '+' : '−'}${money(o.montant)}</td></tr>`).join('')}</tbody></table>`;
  }

  async function load(periode) {
    const r = await call('tresorerie:resume', { periode });
    qs('#tresorerie-body').innerHTML = `
      <div class="grid grid-3 mb-16">
        <div class="card"><div class="kpi-label">Recettes</div><div class="kpi-value text-success">${money(r.recettes)}</div></div>
        <div class="card"><div class="kpi-label">Dépenses</div><div class="kpi-value text-danger">${money(r.depenses)}</div></div>
        <div class="card"><div class="kpi-label">Solde de la période</div><div class="kpi-value kpi-accent">${money(r.soldeFinal)}</div></div>
      </div>
      <div class="card mb-16"><div class="kpi-label">Trésorerie globale actuelle</div><div class="kpi-value">${money(r.soldeActuel)}</div></div>
      <div class="card">
        <div class="flex justify-between items-center mb-10">
          <div class="kpi-label">Mouvements de la période</div>
          <div id="tresorerie-col-picker"></div>
        </div>
        <div id="tresorerie-mouvements-wrap"></div>
      </div>`;
    qs('#tresorerie-col-picker').innerHTML = tresoCols.html();
    tresoCols.bind(() => tresoPager.render(qs('#tresorerie-mouvements-wrap'), r.operations, buildMouvementsTableHtml));
    tresoPager.render(qs('#tresorerie-mouvements-wrap'), r.operations, buildMouvementsTableHtml);
  }
  qs('#periode-select').addEventListener('change', (e) => load(e.target.value));
  load('mois');
}

// ------------------------- Page : Rapports -------------------------
