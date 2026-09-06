import { timeAgoFr } from '../components/toast.js';
import { renderClients } from './clients.js';
import { allowed, bindFullscreenToggle, fullscreenToggleBtnHtml, navigate, renderNav } from './nav.js';
import { renderVentes } from './ventes.js';
import { renderAchats } from './achats.js';
import { renderServices } from './services.js';
import { call, withGlobalLoader } from '../utils/api.js';
import { CURRENCY } from '../utils/constants.js';
import { esc, money, qs } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export function axisMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + 'k ' + CURRENCY;
  return Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY;
}

export function svgLineChart(labels, values, opts = {}) {
  // CORRECTIF (audit) : avec un tableau `values` vide, `points` restait
  // vide et `points[points.length - 1]` (== points[-1]) valait `undefined`
  // — le `.toFixed(1)` suivant plantait alors avec un TypeError, faisant
  // planter tout le rendu du dashboard. Ce cas ne pouvait pas se produire
  // avant ce correctif (serieMensuelle avait toujours 6 mois), mais peut
  // désormais survenir légitimement : le rôle "gestionnaire" reçoit un
  // serieMensuelle vidé côté serveur pour les graphiques financiers
  // masqués (voir rapport.service.js#dashboardStats). On retourne un état
  // vide propre plutôt qu'un graphique cassé.
  if (!values.length) return `<div class="muted">Aucune donnée</div>`;
  const w = 600, h = 210, padL = 62, padB = 26, padT = 14, padR = 14;
  const color = opts.color || '#5B5FE0';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const stepX = (w - padL - padR) / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => [padL + i * stepX, padT + (h - padT - padB) * (1 - (v - min) / range)]);
  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaD = pathD + ` L${points[points.length - 1][0].toFixed(1)},${h - padB} L${points[0][0].toFixed(1)},${h - padB} Z`;
  const steps = 4;
  let grid = '', yLabels = '';
  for (let i = 0; i <= steps; i++) {
    const y = padT + (h - padT - padB) * i / steps;
    const val = max - (max - min) * i / steps;
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#E1DED4" stroke-width="1"/>`;
    yLabels += `<text x="${padL - 8}" y="${(y + 3).toFixed(1)}" font-size="9.5" fill="#5C6572" text-anchor="end">${esc(axisMoney(val))}</text>`;
  }
  const labelEvery = Math.max(1, Math.ceil(labels.length / 7));
  const xLabels = labels.map((l, i) => (i % labelEvery === 0 || i === labels.length - 1) ? `<text x="${points[i][0].toFixed(1)}" y="${h - 8}" font-size="9" fill="#5C6572" text-anchor="middle">${esc(l)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="w-100p h-190 block">${grid}${yLabels}<path d="${areaD}" fill="${color}22" stroke="none"/><path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5"/>${points.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${color}"/>`).join('')}${xLabels}</svg>`;
}

export function svgBarChart(labels, datasets) {
  const w = 600, h = 230, padL = 62, padB = 28, padT = 16, padR = 14;
  const allVals = datasets.flatMap((d) => d.values);
  const max = Math.max(...allVals, 1);
  const groupW = (w - padL - padR) / Math.max(labels.length, 1);
  const barW = Math.min(20, (groupW - 12) / datasets.length);
  let bars = '';
  labels.forEach((lab, i) => {
    const groupX = padL + i * groupW + (groupW - barW * datasets.length) / 2;
    datasets.forEach((d, di) => {
      const v = d.values[i] || 0;
      const bh = (h - padT - padB) * (v / max);
      const x = groupX + di * barW;
      const y = h - padB - bh;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${bh.toFixed(1)}" fill="${d.color}" rx="2"/>`;
    });
    bars += `<text x="${(groupX + (barW * datasets.length) / 2).toFixed(1)}" y="${h - 10}" font-size="9" fill="#5C6572" text-anchor="middle">${esc(lab)}</text>`;
  });
  const steps = 4;
  let grid = '', yLabels = '';
  for (let i = 0; i <= steps; i++) {
    const y = padT + (h - padT - padB) * i / steps;
    const val = max * (1 - i / steps);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#E1DED4" stroke-width="1"/>`;
    yLabels += `<text x="${padL - 8}" y="${(y + 3).toFixed(1)}" font-size="9.5" fill="#5C6572" text-anchor="end">${esc(axisMoney(val))}</text>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="w-100p h-210 block">${grid}${yLabels}${bars}</svg>`;
}

export function chartLegend(items) {
  return `<div class="flex gap-16 mt-6">${items.map((it) => `<div class="flex items-center gap-6 fs-12 muted"><span class="legend-swatch" style="--sw:${it.color}"></span>${esc(it.label)}</div>`).join('')}</div>`;
}


export function kpiTrend(cur, prev, suffix) {
  if (!prev) return '';
  const delta = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = delta >= 0 ? '↑' : '↓';
  const cls = delta >= 0 ? 'up' : 'down';
  return `<div class="kpi-sub ${cls}">${sign} ${Math.abs(delta).toFixed(0)}% ${esc(suffix)}</div>`;
}

// Classement avec barre de progression (produits les plus vendus, services les plus demandés)
export function rankingBars(items, nameKey, valueKey) {
  if (!items.length) return '<div class="muted">Aucune donnée</div>';
  const max = Math.max(...items.map((i) => i[valueKey]), 1);
  return items.map((i) => `
    <div class="rank-row">
      <div class="rank-top"><span class="rank-name">${esc(i[nameKey])}</span><span class="rank-value">${i[valueKey]}</span></div>
      <div class="rank-bar-bg"><div class="rank-bar-fill" style="--w:${Math.max(4, (i[valueKey] / max) * 100).toFixed(1)}%"></div></div>
    </div>`).join('');
}

export function svgPieChart(slices, opts = {}) {
  const size = opts.size || 190;
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (!total) return `<div class="muted">Aucune donnée</div>`;
  let angle = -Math.PI / 2;
  const paths = slices.filter((sl) => sl.value > 0).map((sl) => {
    const frac = sl.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    // Cas particulier : une seule tranche = 100 % (le tracé d'arc dégénère) → cercle plein.
    if (frac >= 0.999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${sl.color}"/>`;
    return `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${sl.color}" stroke="var(--paper-2)" stroke-width="1.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="block" style="width:${size}px;height:${size}px;margin:0 auto;">${paths}</svg>`;
}

// ------------------------- Tableau de bord — rôle Caissier -------------------------
// AJOUT (demande client) : le caissier avait auparavant zéro accès au
// tableau de bord. Il y a désormais accès, mais avec un affichage
// volontairement réduit à l'essentiel de son quotidien : 4 raccourcis
// d'action (au lieu des indicateurs financiers réservés à l'admin/au
// gestionnaire) et les 2 classements "Produits les plus vendus" /
// "Services les plus demandés". Les autres champs de dashboard:stats sont
// de toute façon vidés côté serveur pour ce rôle (voir
// rapport.service.js#dashboardStats) — cette fonction ne fait qu'éviter de
// construire à l'écran des blocs qui n'auraient plus de données à montrer.
async function renderDashboardCaissier() {
  const main = qs('#main-content');
  main.innerHTML = `
    <div class="dash-header">
      <div><h2>Tableau de bord</h2><div class="sub">Accès rapide à vos opérations du quotidien</div></div>
      <div class="flex items-center gap-8">
        ${fullscreenToggleBtnHtml('dash-fullscreen-btn')}
        <span class="status-pill"><span class="dot"></span>En ligne</span>
      </div>
    </div>
    <div id="dash-body">Chargement…</div>`;
  bindFullscreenToggle('dash-fullscreen-btn');
  const stats = await withGlobalLoader('Chargement du tableau de bord…', () => call('dashboard:stats', {}));
  const body = qs('#dash-body');

  const quickActions = [
    { key: 'qa-vente', icon: '$', label: 'Nouvelle vente' },
    { key: 'qa-devis', icon: '≣', label: 'Nouveau devis' },
    { key: 'qa-client', icon: '☺', label: 'Nouveau client' },
    { key: 'qa-prestation', icon: '✎', label: 'Nouvelle prestation' }
  ];
  const quickActionsHtml = `<div class="quick-actions mb-16">${quickActions.map((qa) => `<button class="quick-action-tile" id="${qa.key}" data-tip="${esc(qa.label)}"><span class="quick-action-icon">${qa.icon}</span><span>${esc(qa.label)}</span></button>`).join('')}</div>`;

  const rankingCards = [
    `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Produits les plus vendus</div></div>
        ${rankingBars(stats.produitsPlusVendus, 'designation', 'quantite')}
      </div>`,
    `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Services les plus demandés</div></div>
        ${rankingBars(stats.servicesPlusDemandes, 'nom', 'quantite')}
      </div>`
  ];

  body.innerHTML = `${quickActionsHtml}<div class="grid grid-2">${rankingCards.join('')}</div>`;

  qs('#qa-vente')?.addEventListener('click', async () => {
    state.currentModule = 'ventes'; renderNav();
    await renderVentes();
    qs('#btn-new-vente')?.click();
  });
  qs('#qa-devis')?.addEventListener('click', () => navigate('proformas'));
  qs('#qa-client')?.addEventListener('click', async () => {
    state.currentModule = 'clients'; renderNav();
    await renderClients();
    qs('#btn-new-client')?.click();
  });
  qs('#qa-prestation')?.addEventListener('click', async () => {
    state.currentModule = 'services'; renderNav();
    await renderServices();
    qs('#btn-new-prestation')?.click();
  });
}

export async function renderDashboard(joursCA = 14) {
  if (state.session.role === 'caissier') return renderDashboardCaissier();
  const main = qs('#main-content');
  main.innerHTML = `
    <div class="dash-header">
      <div><h2>Tableau de bord</h2><div class="sub">Vue d'ensemble de l'activité commerciale</div></div>
      <div class="flex items-center gap-8">
        ${fullscreenToggleBtnHtml('dash-fullscreen-btn')}
        <span class="status-pill"><span class="dot"></span>En ligne</span>
      </div>
    </div>
    <div id="dash-body">Chargement…</div>`;
  bindFullscreenToggle('dash-fullscreen-btn');
  const stats = await withGlobalLoader('Chargement du tableau de bord…', () => call('dashboard:stats', { jours: joursCA }));
  const body = qs('#dash-body');
  const totalImpayees = stats.facturesImpayees.reduce((s, v) => s + (v.total - v.montantPaye), 0);
  const periodesCA = [7, 14, 30, 90];
  // SÉCURITÉ / CONFIDENTIALITÉ : le gestionnaire ne doit pas voir les blocs financiers
  // sensibles (bénéfice, dépenses, trésorerie, factures impayées) du tableau de bord.
  // Ces informations restent réservées à l'admin.
  const hideSensitiveFinance = state.session.role === 'gestionnaire';

  // AMÉLIORATION (audit, v3) : ligne 1 réunit les 4 chiffres regardés en
  // premier — CA du jour, CA du mois, Trésorerie actuelle et Bénéfice
  // estimé (les 2 derniers restant masqués au rôle gestionnaire, voir
  // hideSensitiveFinance, la grille passe alors naturellement à 2
  // colonnes). Ligne 2 = tout le reste (CA année, dépenses si visibles,
  // croissance clients, indicateurs secondaires, compteurs cumulés) réuni
  // dans une seule bande compacte qui s'adapte en largeur (voir .kpi-flow
  // dans style.css) — sur un écran normal ça tient sur 1 à 2 lignes.
  const kpiHero = [
    `<div class="card kpi-hero">
        <div class="kpi-label">CA du jour</div>
        <div class="kpi-value">${money(stats.caJour)}</div>
        ${kpiTrend(stats.caJour, stats.caHier, 'par rapport à hier') || '<div class="kpi-sub">Depuis minuit</div>'}
      </div>`,
    `<div class="card kpi-hero">
        <div class="kpi-label">CA du mois</div>
        <div class="kpi-value">${money(stats.caMois)}</div>
        ${kpiTrend(stats.caMois, stats.caMoisPrecedent, 'par rapport au mois dernier') || '<div class="kpi-sub">Depuis le 1er du mois</div>'}
      </div>`
  ];
  if (!hideSensitiveFinance) {
    kpiHero.push(
      `<div class="card kpi-hero">
        <div class="kpi-label">Trésorerie actuelle</div>
        <div class="kpi-value kpi-value-success">${money(stats.tresorerieActuelle)}</div>
      </div>`,
      `<div class="card kpi-hero">
        <div class="kpi-label">Bénéfice estimé (mois)</div>
        <div class="kpi-value kpi-value-accent">${money(stats.beneficeEstime)}</div>
      </div>`
    );
  }

  // CORRECTIF (audit) : les 10 indicateurs tenaient auparavant dans une
  // SEULE bande (.kpi-flow) qui se repliait automatiquement en 1 ou 2
  // lignes selon la largeur de la fenêtre (grid-template-columns:
  // repeat(auto-fit, ...)) — le point de coupure entre lignes dépendait
  // donc de la taille de l'écran et pouvait tomber n'importe où, y compris
  // au milieu d'un groupe logique. On les répartit maintenant explicitement
  // en 2 bandes fixes : ligne 1 = "CA de l'année" → "Taux conversion
  // devis" (chiffres du mois/de l'année), ligne 2 = "Proformas en attente"
  // → "Prestations (total)" (compteurs cumulés). Chaque bande reste
  // .kpi-flow (même grille, mêmes classes CSS) : la taille du texte ne
  // change donc pas, qu'il y ait 5 ou 10 éléments au total.
  const kpiFlowItemsRow1 = [
    `<div class="kpi-flow-item"><div class="kpi-label">CA de l'année</div><div class="kpi-value">${money(stats.caAnnee)}</div>${kpiTrend(stats.caAnnee, stats.caAnneePrecedente, 'vs an dernier') || ''}</div>`
  ];
  if (!hideSensitiveFinance) {
    kpiFlowItemsRow1.push(`<div class="kpi-flow-item"><div class="kpi-label">Dépenses du mois</div><div class="kpi-value">${money(stats.depensesMois)}</div></div>`);
  }
  kpiFlowItemsRow1.push(
    `<div class="kpi-flow-item"><div class="kpi-label">Nouveaux clients (mois)</div><div class="kpi-value">${stats.nouveauxClientsMois}</div></div>`,
    `<div class="kpi-flow-item"><div class="kpi-label">Clients actifs (mois)</div><div class="kpi-value">${stats.clientsActifsMois}</div></div>`,
    `<div class="kpi-flow-item"><div class="kpi-label">Panier moyen (mois)</div><div class="kpi-value">${money(stats.panierMoyen)}</div></div>`,
    `<div class="kpi-flow-item"><div class="kpi-label">Taux conversion devis</div><div class="kpi-value">${stats.tauxConversionDevis}%</div></div>`
  );
  const kpiFlowItemsRow2 = [
    `<div class="kpi-flow-item" data-tip="Nombre de factures pro-forma pas encore transformées en vente"><div class="kpi-label">Proformas en attente</div><div class="kpi-value">${stats.proformasEnAttente}</div></div>`,
    `<div class="kpi-flow-item" data-tip="Nombre de jours que durerait le stock actuel au rythme de vente des 30 derniers jours"><div class="kpi-label">Couverture stock</div><div class="kpi-value">${stats.joursCouvertureStock != null ? stats.joursCouvertureStock + ' j' : '—'}</div></div>`,
    `<div class="kpi-flow-item"><div class="kpi-label">Ventes (total)</div><div class="kpi-value">${stats.nombreVentes}</div></div>`,
    `<div class="kpi-flow-item"><div class="kpi-label">Clients (total)</div><div class="kpi-value">${stats.nombreClients}</div></div>`,
    `<div class="kpi-flow-item"><div class="kpi-label">Prestations (total)</div><div class="kpi-value">${stats.nombrePrestations}</div></div>`
  ];
  const kpiFlowRow1 = `<div class="card kpi-flow">${kpiFlowItemsRow1.join('')}</div>`;
  const kpiFlowRow2 = `<div class="card kpi-flow">${kpiFlowItemsRow2.join('')}</div>`;

  // CORRECTIF : changer la période (7/14/30/90 jours) rappelait
  // renderDashboard() en entier — ce qui vide immédiatement #main-content
  // ("Chargement…") puis réaffiche un écran de chargement plein cadre le
  // temps de tout recalculer (KPI, tous les graphiques, tableaux…), alors
  // que seule la série serieCaJournaliere dépend de "jours" côté serveur
  // (voir rapport.service.js#getDashboardStats). Résultat : un flash visible
  // de toute la page pour ne changer qu'un seul graphique. On isole donc ce
  // graphique dans son propre conteneur (#dash-ca-chart-inner) pour ne
  // rafraîchir que lui, sans toucher au reste du tableau de bord.
  const caChartCard = `<div class="card">
        <div class="card-head-row">
          <div class="card-head-title">Chiffre d'affaires</div>
          <select class="chart-select" id="dash-ca-period">${periodesCA.map((j) => `<option value="${j}" ${j === joursCA ? 'selected' : ''}>${j} derniers jours</option>`).join('')}</select>
        </div>
        <div id="dash-ca-chart-inner">${svgLineChart(stats.serieCaJournaliere.map((s) => s.label), stats.serieCaJournaliere.map((s) => s.valeur), { color: '#5B5FE0' })}</div>
      </div>`;
  const recettesDepensesChartCard = `<div class="card">
        <div class="card-head-row">
          <div class="card-head-title">Recettes vs Dépenses</div>
        </div>
        ${svgBarChart(stats.serieMensuelle.map((s) => s.label), [
          { label: 'Recettes', color: '#5B5FE0', values: stats.serieMensuelle.map((s) => s.recettes) },
          { label: 'Dépenses', color: '#B23A3A', values: stats.serieMensuelle.map((s) => s.depenses) }
        ])}
        ${chartLegend([{ label: 'Recettes', color: '#5B5FE0' }, { label: 'Dépenses', color: '#B23A3A' }])}
      </div>`;

  // AMÉLIORATION (audit) : la liste d'alertes n'avait aucune limite
  // d'affichage (contrairement aux classements "Top 5" utilisés ailleurs
  // sur ce dashboard), au risque de devenir très longue sur un gros
  // catalogue. Affiche au maximum les 8 produits les plus critiques
  // (l'écart quantité/seuil le plus important en premier), le pastille
  // "N en alerte" continuant elle de refléter le total réel.
  const ALERTES_STOCK_MAX = 8;
  const alertesStockTriees = [...stats.alertesStock].sort((a, b) => (a.quantite - a.seuilMin) - (b.quantite - b.seuilMin));
  const alertesStockAffichees = alertesStockTriees.slice(0, ALERTES_STOCK_MAX);
  const alertesStockCard = `<div class="card">
        <div class="card-head-row">
          <div class="card-head-title"><span class="icon-badge"></span>Alertes de stock faible</div>
          <span class="pill-muted">${stats.alertesStock.length} en alerte</span>
        </div>
        ${alertesStockAffichees.length ? `<table><tbody>${alertesStockAffichees.map((p) => `<tr><td>${esc(p.designation)}</td><td class="text-right">${p.quantite} / seuil ${p.seuilMin}</td></tr>`).join('')}</tbody></table>${stats.alertesStock.length > ALERTES_STOCK_MAX ? `<div class="muted mt-10">+ ${stats.alertesStock.length - ALERTES_STOCK_MAX} autre(s) produit(s) en alerte — voir le module Stocks</div>` : ''}` : '<div class="alert-ok"><span class="check">✓</span><span class="txt">Aucune alerte de stock. Tous les niveaux sont optimaux.</span></div>'}
      </div>`;
  const facturesImpayeesCard = `<div class="card">
        <div class="card-head-row">
          <div class="card-head-title"><span class="icon-badge icon-badge-danger"></span>Factures impayées</div>
          <span class="pill-danger">Total : ${money(totalImpayees)}</span>
        </div>
        ${stats.facturesImpayees.length ? stats.facturesImpayees.map((v) => `
          <div class="invoice-row">
            <span class="invoice-num">N° ${esc(v.numero)}</span>
            <span class="invoice-client">${esc(v.clientNom)}</span>
            <span class="invoice-amount">${money(v.total - v.montantPaye)}</span>
          </div>`).join('') : '<div class="alert-ok"><span class="check">✓</span><span class="txt">Aucune facture impayée.</span></div>'}</div>`;

  const lastRowCards = hideSensitiveFinance ? [alertesStockCard] : [alertesStockCard, facturesImpayeesCard];
  const chartsRowCards = hideSensitiveFinance ? [caChartCard] : [caChartCard, recettesDepensesChartCard];

  // Vignettes d'actions rapides — accès direct aux actions les plus fréquentes
  // depuis le tableau de bord, sans passer par la navigation latérale.
  const quickActions = [
    allowed('ventes') ? { key: 'qa-vente', icon: '$', label: 'Nouvelle vente' } : null,
    allowed('achats') ? { key: 'qa-achat', icon: '⇩', label: 'Nouvel achat' } : null,
    allowed('clients') ? { key: 'qa-client', icon: '☺', label: 'Nouveau client' } : null,
    allowed('proformas') ? { key: 'qa-devis', icon: '≣', label: 'Imprimer un devis' } : null
  ].filter(Boolean);
  const quickActionsHtml = quickActions.length ? `
    <div class="quick-actions mb-16">
      ${quickActions.map((qa) => `<button class="quick-action-tile" id="${qa.key}" data-tip="${esc(qa.label)}"><span class="quick-action-icon">${qa.icon}</span><span>${esc(qa.label)}</span></button>`).join('')}
    </div>` : '';


  // Répartition du CA du mois entre produits et services (camembert).
  const repartitionCaCard = `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Répartition du CA (mois)</div></div>
        ${svgPieChart([{ label: 'Produits', value: stats.caProduitsMois, color: '#5B5FE0' }, { label: 'Services', value: stats.caServicesMois, color: '#F2B155' }])}
        ${chartLegend([{ label: `Produits — ${money(stats.caProduitsMois)}`, color: '#5B5FE0' }, { label: `Services — ${money(stats.caServicesMois)}`, color: '#F2B155' }])}
      </div>`;

  // Répartition des ventes du mois par mode de paiement.
  const maxPaiement = Math.max(...stats.repartitionPaiementsMois.map((p) => p.montant), 1);
  const repartitionPaiementsCard = `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Ventes par mode de paiement (mois)</div></div>
        ${stats.repartitionPaiementsMois.length ? stats.repartitionPaiementsMois.map((p) => `
          <div class="payment-split-row">
            <div class="payment-split-label">${esc(p.label)}</div>
            <div class="payment-split-bar-bg"><div class="payment-split-bar-fill" style="width:${Math.max(3, (p.montant / maxPaiement) * 100).toFixed(1)}%"></div></div>
            <div class="payment-split-value">${money(p.montant)}</div>
          </div>`).join('') : '<div class="muted">Aucune vente ce mois-ci</div>'}
      </div>`;

  // Tendance du bénéfice net sur 6 mois (réservé aux rôles ayant accès aux
  // informations financières sensibles, comme le solde de trésorerie ci-dessus).
  const beneficeNetTrendCard = `<div class="card mb-16">
      <div class="card-head-title mb-10">Tendance du bénéfice net — 6 derniers mois</div>
      ${svgLineChart(stats.serieMensuelle.map((s) => s.label), stats.serieMensuelle.map((s) => s.beneficeNet), { color: '#2F7D5C' })}
    </div>`;

  // Flux d'activité : 5 dernières actions effectuées dans l'application.
  const ACTIVITY_LABELS = {
    creation_vente: 'Nouvelle vente enregistrée', annulation_vente: 'Vente annulée', suppression_vente: 'Vente supprimée', paiement_vente: 'Encaissement sur une vente',
    creation_client: 'Nouveau client', suppression_client: 'Client supprimé',
    creation_produit: 'Nouveau produit', suppression_produit: 'Produit supprimé',
    creation_achat: 'Nouvel achat', annulation_achat: 'Achat annulé', suppression_achat: 'Achat supprimé',
    creation_prestation: 'Nouvelle prestation', creation_depense: 'Nouvelle dépense', suppression_depense: 'Dépense supprimée',
    creation_proforma: 'Nouveau devis', validation_proforma: 'Devis validé', suppression_proforma: 'Devis supprimé'
  };
  const activiteFeedCard = `<div class="card mb-16">
      <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Activité récente</div></div>
      ${stats.activiteRecente.length ? stats.activiteRecente.map((a) => `
        <div class="activity-feed-item">
          <span class="activity-feed-icon">●</span>
          <span class="activity-feed-text">${esc(ACTIVITY_LABELS[a.action] || a.action)}${a.utilisateur ? ' — <span class="muted">' + esc(a.utilisateur) + '</span>' : ''}</span>
          <span class="activity-feed-time">${esc(timeAgoFr(a.date))}</span>
        </div>`).join('') : '<div class="muted">Aucune activité récente</div>'}
    </div>`;

  // CORRECTIF (audit) : "Top fournisseurs" expose le montant des achats par
  // fournisseur — la même catégorie d'information que "Dépenses du mois"
  // (déjà masquée pour le rôle gestionnaire, voir hideSensitiveFinance et
  // rapport.service.js#dashboardStats). Elle n'était filtrée nulle part
  // avant ce correctif ; désormais regroupée avec les autres blocs
  // financiers sensibles.
  const rankingCards = [
    `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Produits les plus vendus</div></div>
        ${rankingBars(stats.produitsPlusVendus, 'designation', 'quantite')}
      </div>`,
    `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Services les plus demandés</div></div>
        ${rankingBars(stats.servicesPlusDemandes, 'nom', 'quantite')}
      </div>`
  ];
  if (!hideSensitiveFinance) {
    rankingCards.push(`<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Top fournisseurs</div></div>
        ${stats.topFournisseurs.length ? stats.topFournisseurs.map((f) => `
          <div class="rank-row">
            <div class="rank-top"><span class="rank-name">${esc(f.nom)}</span><span class="rank-value">${money(f.montant)}</span></div>
          </div>`).join('') : '<div class="muted">Aucune donnée</div>'}
      </div>`);
  }

  body.innerHTML = `
    ${quickActionsHtml}
    <div class="grid grid-${kpiHero.length} mb-8">${kpiHero.join('')}</div>
    <div class="mb-8">${kpiFlowRow1}</div>
    <div class="mb-16">${kpiFlowRow2}</div>
    <div class="grid grid-${chartsRowCards.length} mb-16">${chartsRowCards.join('')}</div>
    <div class="grid grid-2 mb-16">${repartitionCaCard}${repartitionPaiementsCard}</div>
    ${hideSensitiveFinance ? '' : `<div class="card mb-16">
      <div class="card-head-title mb-10">Solde de trésorerie — fin de mois, 6 derniers mois</div>
      ${svgLineChart(stats.serieMensuelle.map((s) => s.label), stats.serieMensuelle.map((s) => s.soldeTresorerie), { color: '#5B5FE0' })}
    </div>`}
    ${hideSensitiveFinance ? '' : beneficeNetTrendCard}
    ${activiteFeedCard}
    <div class="grid grid-${rankingCards.length} mb-16">${rankingCards.join('')}</div>
    <div class="card mb-16">
      <div class="card-head-row">
        <div class="card-head-title"><span class="icon-badge"></span>Meilleurs clients</div>
        <span class="pill-muted">Classés par total dépensé</span>
      </div>
      ${stats.meilleursClients.length ? `<table><thead><tr><th>Client</th><th class="text-right">Nombre d'achats</th><th class="text-right">Total dépensé</th></tr></thead><tbody>${stats.meilleursClients.map((c, i) => `<tr class="${i === 0 ? 'client-top' : ''}"><td>${esc(c.nom)}</td><td class="text-right"><span class="count-badge">${c.nombreAchats}</span></td><td class="text-right">${money(c.montant)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Aucune donnée — seuls les clients enregistrés (pas « comptoir ») apparaissent ici.</div>'}
    </div>
    <div class="grid grid-${lastRowCards.length}">${lastRowCards.join('')}</div>`;
  qs('#dash-ca-period').addEventListener('change', async (e) => {
    const select = e.target;
    const jours = Number(select.value);
    select.disabled = true;
    try {
      const chartInner = qs('#dash-ca-chart-inner');
      const nouvellesStats = await call('dashboard:stats', { jours });
      chartInner.innerHTML = svgLineChart(nouvellesStats.serieCaJournaliere.map((s) => s.label), nouvellesStats.serieCaJournaliere.map((s) => s.valeur), { color: '#5B5FE0' });
    } finally {
      select.disabled = false;
    }
  });

  // Vignettes d'actions rapides
  const qaVente = qs('#qa-vente');
  if (qaVente) qaVente.addEventListener('click', async () => {
    state.currentModule = 'ventes'; renderNav();
    await renderVentes();
    qs('#btn-new-vente')?.click();
  });
  const qaAchat = qs('#qa-achat');
  if (qaAchat) qaAchat.addEventListener('click', async () => {
    state.currentModule = 'achats'; renderNav();
    await renderAchats();
    qs('#btn-new-achat')?.click();
  });
  const qaClient = qs('#qa-client');
  if (qaClient) qaClient.addEventListener('click', async () => {
    state.currentModule = 'clients'; renderNav();
    await renderClients();
    qs('#btn-new-client')?.click();
  });
  const qaDevis = qs('#qa-devis');
  if (qaDevis) qaDevis.addEventListener('click', () => navigate('proformas'));
}

// ------------------------- Page : Clients -------------------------
