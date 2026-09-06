import { imprimerEtatFinancier, imprimerServicesProduits } from '../components/invoice.js';
import { toast } from '../components/toast.js';
import { bindFullscreenToggle, fullscreenToggleBtnHtml } from './nav.js';
import { call, withGlobalLoader } from '../utils/api.js';
import { RAPPORT_TYPES } from '../utils/constants.js';
import { dateOnlyFr, esc, money, qs } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderRapports() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Rapports</h2><div class="sub">Analyses et export CSV</div></div>
    <div class="toolbar-actions">${fullscreenToggleBtnHtml('rapports-fullscreen-btn')}</div></div>
    <div class="card mb-16">
      <div class="two-col">
        <div class="field"><label>Type de rapport</label><select id="r-type">${RAPPORT_TYPES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary btn-block" id="r-generer">Générer</button></div>
      </div>
      <div class="two-col">
        <div class="field"><label>Du</label><input type="date" id="r-debut" /></div>
        <div class="field"><label>Au</label><input type="date" id="r-fin" /></div>
      </div>
    </div>
    <div class="card" id="r-result"></div>`;
  bindFullscreenToggle('rapports-fullscreen-btn');
  qs('#r-generer').addEventListener('click', async () => {
    const type = qs('#r-type').value;
    const debut = qs('#r-debut').value; const fin = qs('#r-fin').value;
    const data = await withGlobalLoader('Génération du rapport…', () => call('rapports:generer', { type, debut, fin }));
    renderRapportResult(type, data, { debut, fin });
  });
}

export function renderRapportResult(type, data, periode) {
  const wrap = qs('#r-result');
  if (type === 'etatFinancier') { renderEtatFinancier(wrap, data, periode); return; }
  if (type === 'exportComptable') { renderExportComptable(wrap, data, periode); return; }
  if (type === 'servicesEtProduits') { renderServicesEtProduits(wrap, data, periode); return; }
  if (type === 'rentabilite') {
    wrap.innerHTML = `<div class="grid grid-3">
      <div class="card"><div class="kpi-label">Chiffre d'affaires</div><div class="kpi-value">${money(data.chiffreAffaires)}</div></div>
      <div class="card"><div class="kpi-label">Bénéfice brut</div><div class="kpi-value">${money(data.beneficeBrut)}</div></div>
      <div class="card"><div class="kpi-label">Bénéfice net</div><div class="kpi-value kpi-accent">${money(data.beneficeNet)}</div></div>
      <div class="card"><div class="kpi-label">Coût d'achat</div><div class="kpi-value">${money(data.coutAchat)}</div></div>
      <div class="card"><div class="kpi-label">Total dépenses</div><div class="kpi-value">${money(data.totalDepenses)}</div></div>
      <div class="card"><div class="kpi-label">Marge</div><div class="kpi-value">${data.marge.toFixed(1)}%</div></div>
    </div>`;
    return;
  }
  if (!Array.isArray(data) || !data.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">▤</div>Aucune donnée pour cette période.</div>`; return; }
  const columns = Object.keys(data[0]).filter((k) => typeof data[0][k] !== 'object').slice(0, 8);
  wrap.innerHTML = `<div class="toolbar"><div class="muted">${data.length} résultat(s)</div><button class="btn btn-ghost btn-sm" id="r-export">Exporter en CSV</button></div>
    <div class="overflow-x-auto"><table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${data.slice(0, 300).map((row) => `<tr>${columns.map((c) => `<td>${esc(typeof row[c] === 'number' ? row[c] : row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  qs('#r-export').addEventListener('click', async () => {
    const res = await call('rapports:exporterCsv', { defaultPath: `rapport-${type}.csv`, data, columns: columns.map((c) => ({ key: c, label: c })) });
    if (res && res.chemin) toast('Export enregistré : ' + res.chemin, 'success');
  });
}

// ------------------------- État financier -------------------------
export function renderEtatFinancier(wrap, data, periode) {
  const periodeLabel = (periode && (periode.debut || periode.fin))
    ? `Du ${periode.debut ? dateOnlyFr(periode.debut) : '—'} au ${periode.fin ? dateOnlyFr(periode.fin) : "aujourd'hui"}`
    : 'Depuis le début de l\'activité';
  wrap.innerHTML = `
    <div class="toolbar"><div class="muted">${esc(periodeLabel)}</div><button class="btn btn-ghost btn-sm" id="ef-imprimer">Imprimer / Exporter en PDF</button></div>
    <div class="grid grid-3 mb-16">
      <div class="card"><div class="kpi-label">Chiffre d'affaires</div><div class="kpi-value">${money(data.produits.total)}</div></div>
      <div class="card"><div class="kpi-label">Charges totales</div><div class="kpi-value">${money(data.charges.totalCharges)}</div></div>
      <div class="card"><div class="kpi-label">Résultat net</div><div class="kpi-value ${data.resultat.resultatNet >= 0 ? 'kpi-accent' : 'text-danger'}">${money(data.resultat.resultatNet)}</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="kpi-label mb-10">Produits d'exploitation</div>
        <table><tbody>
          <tr><td>Ventes de produits</td><td class="text-right">${money(data.produits.ventesProduits)}</td></tr>
          <tr><td>Ventes de services</td><td class="text-right">${money(data.produits.ventesServices)}</td></tr>
          <tr><td class="fw-600">Total produits</td><td class="text-right fw-600">${money(data.produits.total)}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <div class="kpi-label mb-10">Charges d'exploitation</div>
        <table><tbody>
          <tr><td>Coût des marchandises vendues</td><td class="text-right">${money(data.charges.coutMarchandisesVendues)}</td></tr>
          ${data.charges.depensesParCategorie.map((d) => `<tr><td>${esc(d.categorie)}</td><td class="text-right">${money(d.montant)}</td></tr>`).join('') || '<tr><td class="muted">Aucune dépense</td><td></td></tr>'}
          <tr><td class="fw-600">Total charges</td><td class="text-right fw-600">${money(data.charges.totalCharges)}</td></tr>
        </tbody></table>
      </div>
    </div>
    <div class="grid grid-2 mt-16">
      <div class="card">
        <div class="kpi-label mb-10">Trésorerie de la période</div>
        <table><tbody>
          <tr><td>Solde avant la période</td><td class="text-right">${money(data.tresorerie.soldeAvantPeriode)}</td></tr>
          <tr><td>Recettes</td><td class="text-right text-success">+${money(data.tresorerie.recettesPeriode)}</td></tr>
          <tr><td>Dépenses (décaissements)</td><td class="text-right text-danger">−${money(data.tresorerie.depensesPeriode)}</td></tr>
          <tr><td class="fw-600">Solde en fin de période</td><td class="text-right fw-600">${money(data.tresorerie.soldeFinPeriode)}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <div class="kpi-label mb-10">Achats fournisseurs & indicateurs</div>
        <table><tbody>
          <tr><td>Achats de la période</td><td class="text-right">${money(data.achats.total)}</td></tr>
          <tr><td>dont payé</td><td class="text-right">${money(data.achats.paye)}</td></tr>
          <tr><td>Reste à payer fournisseurs</td><td class="text-right">${money(data.achats.resteAPayer)}</td></tr>
          <tr><td>Marge nette</td><td class="text-right">${data.resultat.marge.toFixed(1)}%</td></tr>
          <tr><td>Ventes / Prestations / Clients</td><td class="text-right">${data.indicateurs.nombreVentes} / ${data.indicateurs.nombrePrestations} / ${data.indicateurs.nombreClients}</td></tr>
        </tbody></table>
      </div>
    </div>
    ${data.tva && (data.tva.collectee || data.tva.deductible) ? `
    <div class="grid grid-1 mt-16">
      <div class="card">
        <div class="kpi-label mb-10">TVA de la période</div>
        <table><tbody>
          <tr><td>TVA collectée (sur ventes)</td><td class="text-right">${money(data.tva.collectee)}</td></tr>
          <tr><td>TVA déductible (sur achats)</td><td class="text-right">${money(data.tva.deductible)}</td></tr>
          <tr><td class="fw-600">${data.tva.aPayer >= 0 ? 'TVA à reverser' : 'TVA à récupérer (crédit)'}</td><td class="text-right fw-600">${money(Math.abs(data.tva.aPayer))}</td></tr>
        </tbody></table>
      </div>
    </div>` : ''}
    ${data.bilan ? `
    <div class="grid grid-1 mt-16">
      <div class="card">
        <div class="kpi-label mb-10">Bilan au ${esc(dateOnlyFr(data.bilan.date))}</div>
        <div class="grid grid-2">
          <table><tbody>
            <tr><td colspan="2" class="fw-600">ACTIF</td></tr>
            <tr><td>Trésorerie (caisse + banque)</td><td class="text-right">${money(data.bilan.actif.tresorerie)}</td></tr>
            <tr><td>Créances clients (impayés)</td><td class="text-right">${money(data.bilan.actif.creancesClients)}</td></tr>
            <tr><td>Valeur du stock</td><td class="text-right">${money(data.bilan.actif.valeurStock)}</td></tr>
            <tr><td class="fw-600">Total actif</td><td class="text-right fw-600">${money(data.bilan.actif.total)}</td></tr>
          </tbody></table>
          <table><tbody>
            <tr><td colspan="2" class="fw-600">PASSIF</td></tr>
            <tr><td>Dettes fournisseurs (impayés)</td><td class="text-right">${money(data.bilan.passif.dettesFournisseurs)}</td></tr>
            <tr><td>Capitaux propres (résultat cumulé)</td><td class="text-right">${money(data.bilan.passif.capitauxPropres)}</td></tr>
            <tr><td class="fw-600">Total passif</td><td class="text-right fw-600">${money(data.bilan.passif.total)}</td></tr>
          </tbody></table>
        </div>
        <div class="muted fs-12 mt-10">${esc(data.bilan.avertissement)}</div>
      </div>
    </div>` : ''}`;
  qs('#ef-imprimer').addEventListener('click', () => imprimerEtatFinancier(data, periodeLabel));
}

// ------------------------- Services et produits vendus (PDF) -------------------------
function renderServicesEtProduits(wrap, data, periode) {
  const periodeLabel = (periode && (periode.debut || periode.fin))
    ? `Du ${periode.debut ? dateOnlyFr(periode.debut) : '—'} au ${periode.fin ? dateOnlyFr(periode.fin) : "aujourd'hui"}`
    : 'Depuis le début de l\'activité';
  if (!data.lignes.length) {
    wrap.innerHTML = `<div class="toolbar"><div class="muted">${esc(periodeLabel)}</div></div>
      <div class="empty-state"><div class="big">▤</div>Aucune donnée pour cette période.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="toolbar"><div class="muted">${esc(periodeLabel)} — ${data.lignes.length} ligne(s) — Total : <strong>${money(data.total)}</strong></div>
      <button class="btn btn-primary btn-sm" id="sp-imprimer">Imprimer / Exporter en PDF</button></div>
    <div class="overflow-x-auto"><table><thead><tr>
      <th>Date de création</th><th>Numéro</th><th>Service/Produits</th><th>Détails</th><th>Montant (Ar)</th>
    </tr></thead>
    <tbody>${data.lignes.slice(0, 500).map((l) => `<tr>
      <td>${dateOnlyFr(l.createdAt)}</td><td>${esc(l.numero)}</td><td>${esc(l.designation)}</td>
      <td>${esc(l.details)}</td><td class="text-right">${money(l.montant)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  qs('#sp-imprimer').addEventListener('click', () => imprimerServicesProduits(data, periodeLabel));
}

// ------------------------- Export comptable (journal) -------------------------
// PHASE 3 : aperçu à l'écran du journal en partie double généré à partir de
// la période sélectionnée, avec bandeau d'avertissement tant que le plan de
// comptes n'a pas été validé par un comptable (voir planComptable.js), et
// bouton d'export vers un fichier .xlsx à deux feuilles (Journal + Plan de
// comptes utilisé) — voir rapports:exporterComptableXlsx dans main.js.
export function renderExportComptable(wrap, data, periode) {
  const periodeLabel = (periode && (periode.debut || periode.fin))
    ? `Du ${periode.debut ? dateOnlyFr(periode.debut) : '—'} au ${periode.fin ? dateOnlyFr(periode.fin) : "aujourd'hui"}`
    : 'Depuis le début de l\'activité';
  const avertissement = data.validation.valide
    ? `<div class="alert alert-success mb-16">✓ Plan de comptes validé par <strong>${esc(data.validation.validePar)}</strong> le ${dateOnlyFr(data.validation.valideDate)}.</div>`
    : `<div class="alert alert-warning mb-16">⚠️ Plan de comptes non encore validé par un comptable — cet export est à considérer comme un TEST. Faites valider la liste des comptes depuis Paramètres &gt; Plan de comptes avant toute utilisation en production.</div>`;
  const confirmationHtml = data.validation.valide ? '' : `
    <label class="confirm-skip-row mb-12">
      <input type="checkbox" id="ec-confirme-test" />
      Je confirme qu'il s'agit d'un export de test (plan de comptes non encore validé par le comptable)
    </label>`;
  if (!data.lignes.length) {
    wrap.innerHTML = `${avertissement}<div class="empty-state"><div class="big">▤</div>Aucune écriture pour cette période.</div>`;
    return;
  }
  wrap.innerHTML = `${avertissement}
    <div class="toolbar"><div class="muted">${esc(periodeLabel)} — ${data.lignes.length} ligne(s) d'écriture</div></div>
    <div class="overflow-x-auto mb-12"><table><thead><tr>
      <th>Date</th><th>Journal</th><th>N° pièce</th><th>N° compte</th><th>Intitulé compte</th><th>Libellé écriture</th><th>Débit</th><th>Crédit</th>
    </tr></thead>
    <tbody>${data.lignes.slice(0, 500).map((l) => `<tr>
      <td>${dateOnlyFr(l.date)}</td><td>${esc(l.journal)}</td><td>${esc(l.piece)}</td><td>${esc(l.numeroCompte)}</td>
      <td>${esc(l.intituleCompte)}</td><td>${esc(l.libelleEcriture)}</td>
      <td class="text-right">${l.debit ? money(l.debit) : ''}</td><td class="text-right">${l.credit ? money(l.credit) : ''}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr class="fw-600"><td colspan="6" class="text-right">Totaux${data.totaux.equilibre ? '' : ' — ⚠️ DÉSÉQUILIBRE'}</td><td class="text-right">${money(data.totaux.debit)}</td><td class="text-right">${money(data.totaux.credit)}</td></tr></tfoot>
    </table></div>
    ${confirmationHtml}
    <button class="btn btn-primary" id="ec-export-xlsx">Générer le fichier Excel (.xlsx)</button>`;

  qs('#ec-export-xlsx').addEventListener('click', async () => {
    const forcerNonValide = !data.validation.valide && qs('#ec-confirme-test')?.checked;
    if (!data.validation.valide && !forcerNonValide) {
      toast('Cochez la case de confirmation, ou faites valider le plan de comptes, avant d\'exporter', 'error');
      return;
    }
    try {
      const res = await call('rapports:exporterComptableXlsx', {
        debut: periode?.debut, fin: periode?.fin, forcerNonValide,
        defaultPath: `export-comptable-${(periode?.debut || 'debut')}-${(periode?.fin || 'fin')}.xlsx`
      });
      if (res && res.chemin) toast('Export enregistré : ' + res.chemin, 'success');
    } catch (e) { /* toast déjà affiché par call() */ }
  });
}

