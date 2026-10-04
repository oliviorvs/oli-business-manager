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

const dashboardCharts = new Map();

export function axisMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + 'k ' + CURRENCY;
  return Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY;
}

function destroyDashboardCharts() {
  for (const chart of dashboardCharts.values()) chart.destroy();
  dashboardCharts.clear();
}

export function disposeDashboardCharts() {
  destroyDashboardCharts();
}

function chartCanvas(id, label, height = 230) {
  return `<div class="dashboard-chart" style="height:${height}px"><canvas id="${id}" role="img" aria-label="${esc(label)}"></canvas></div>`;
}

function axisChartOptions(formatValue = axisMoney, horizontal = false, formatTooltip = formatValue) {
  const valueAxis = horizontal ? 'x' : 'y';
  const categoryAxis = horizontal ? 'y' : 'x';
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6B7A82';
  return {
    responsive: true,
    maintainAspectRatio: false,
    color: textColor,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (context) => {
            const value = horizontal ? context.parsed.x : context.parsed.y;
            const prefix = context.dataset.label ? `${context.dataset.label} : ` : '';
            return `${prefix}${formatTooltip(value)}`;
          }
        }
      }
    },
    scales: {
      [categoryAxis]: { grid: { display: false } },
      [valueAxis]: { beginAtZero: true, ticks: { callback: formatValue } }
    }
  };
}

function lineChartConfig(labels, values, label, color) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: color,
        backgroundColor: `${color}26`,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6
      }]
    },
    options: axisChartOptions(axisMoney, false, money)
  };
}

function rankingChartConfig(items, nameKey, valueKey, currencyValues = false) {
  const formatValue = currencyValues
    ? axisMoney
    : (value) => Number(value).toLocaleString('fr-FR');
  return {
    type: 'bar',
    data: {
      labels: items.map((item) => item[nameKey]),
      datasets: [{
        label: currencyValues ? 'Montant' : 'Quantité',
        data: items.map((item) => item[valueKey]),
        backgroundColor: '#5B5FE0',
        borderRadius: 4
      }]
    },
    options: {
      ...axisChartOptions(formatValue, true, currencyValues ? money : formatValue),
      indexAxis: 'y'
    }
  };
}

function mountDashboardChart(id, config) {
  if (!window.Chart) throw new Error('Chart.js local est introuvable.');
  const canvas = qs(`#${id}`);
  if (!canvas) throw new Error(`Canvas du graphique introuvable : ${id}`);
  const chart = new window.Chart(canvas, config);
  dashboardCharts.set(id, chart);
  return chart;
}

function mountRankingChart(id, items, nameKey, valueKey, currencyValues = false) {
  if (items.length) mountDashboardChart(id, rankingChartConfig(items, nameKey, valueKey, currencyValues));
}


export function kpiTrend(cur, prev, suffix) {
  if (!prev) return '';
  const delta = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = delta >= 0 ? '↑' : '↓';
  const cls = delta >= 0 ? 'up' : 'down';
  return `<div class="kpi-sub ${cls}">${sign} ${Math.abs(delta).toFixed(0)}% ${esc(suffix)}</div>`;
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
      ${stats.produitsPlusVendus.length ? chartCanvas('dash-products-ranking', 'Produits les plus vendus', Math.max(210, stats.produitsPlusVendus.length * 32)) : '<div class="muted">Aucune donnée</div>'}
      </div>`,
    `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Services les plus demandés</div></div>
      ${stats.servicesPlusDemandes.length ? chartCanvas('dash-services-ranking', 'Services les plus demandés', Math.max(210, stats.servicesPlusDemandes.length * 32)) : '<div class="muted">Aucune donnée</div>'}
      </div>`
  ];

  body.innerHTML = `${quickActionsHtml}<div class="grid grid-2">${rankingCards.join('')}</div>`;
  mountRankingChart('dash-products-ranking', stats.produitsPlusVendus, 'designation', 'quantite');
  mountRankingChart('dash-services-ranking', stats.servicesPlusDemandes, 'nom', 'quantite');

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
  destroyDashboardCharts();
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
        <div id="dash-ca-chart-inner">${chartCanvas('dash-ca-chart', 'Chiffre d’affaires')}</div>
      </div>`;
  const recettesDepensesChartCard = `<div class="card">
        <div class="card-head-row">
          <div class="card-head-title">Recettes vs Dépenses</div>
        </div>
        ${chartCanvas('dash-income-expenses-chart', 'Recettes et dépenses mensuelles')}
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
        ${stats.caProduitsMois || stats.caServicesMois ? chartCanvas('dash-ca-split-chart', 'Répartition du chiffre d’affaires entre produits et services') : '<div class="muted">Aucune donnée</div>'}
      </div>`;

  // Répartition des ventes du mois par mode de paiement.
  const repartitionPaiementsCard = `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Ventes par mode de paiement (mois)</div></div>
        ${stats.repartitionPaiementsMois.length ? chartCanvas('dash-payment-methods-chart', 'Ventes ventilées par mode de paiement') : '<div class="muted">Aucune vente ce mois-ci</div>'}
      </div>`;

  // Tendance du bénéfice net sur 6 mois (réservé aux rôles ayant accès aux
  // informations financières sensibles, comme le solde de trésorerie ci-dessus).
  const beneficeNetTrendCard = `<div class="card mb-16">
      <div class="card-head-title mb-10">Tendance du bénéfice net — 6 derniers mois</div>
      ${chartCanvas('dash-net-profit-chart', 'Tendance du bénéfice net sur six mois')}
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
        ${stats.produitsPlusVendus.length ? chartCanvas('dash-products-ranking', 'Produits les plus vendus', Math.max(210, stats.produitsPlusVendus.length * 32)) : '<div class="muted">Aucune donnée</div>'}
      </div>`,
    `<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Services les plus demandés</div></div>
        ${stats.servicesPlusDemandes.length ? chartCanvas('dash-services-ranking', 'Services les plus demandés', Math.max(210, stats.servicesPlusDemandes.length * 32)) : '<div class="muted">Aucune donnée</div>'}
      </div>`
  ];
  if (!hideSensitiveFinance) {
    rankingCards.push(`<div class="card">
        <div class="card-head-row"><div class="card-head-title"><span class="icon-badge"></span>Top fournisseurs</div></div>
        ${stats.topFournisseurs.length ? chartCanvas('dash-suppliers-ranking', 'Fournisseurs classés par montant des achats', Math.max(210, stats.topFournisseurs.length * 32)) : '<div class="muted">Aucune donnée</div>'}
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
      ${chartCanvas('dash-treasury-chart', 'Solde de trésorerie de fin de mois sur six mois')}
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

  const dailySeries = stats.serieCaJournaliere;
  mountDashboardChart('dash-ca-chart', lineChartConfig(
    dailySeries.map((item) => item.label),
    dailySeries.map((item) => item.valeur),
    'Chiffre d’affaires',
    '#5B5FE0'
  ));
  if (!hideSensitiveFinance) {
    mountDashboardChart('dash-income-expenses-chart', {
      type: 'bar',
      data: {
        labels: stats.serieMensuelle.map((item) => item.label),
        datasets: [
          { label: 'Recettes', data: stats.serieMensuelle.map((item) => item.recettes), backgroundColor: '#5B5FE0' },
          { label: 'Dépenses', data: stats.serieMensuelle.map((item) => item.depenses), backgroundColor: '#B23A3A' }
        ]
      },
      options: {
        ...axisChartOptions(axisMoney, false, money),
        plugins: {
          ...axisChartOptions(axisMoney, false, money).plugins,
          legend: { display: true, position: 'bottom' }
        }
      }
    });
  }
  if (stats.caProduitsMois || stats.caServicesMois) {
    mountDashboardChart('dash-ca-split-chart', {
      type: 'doughnut',
      data: {
        labels: ['Produits', 'Services'],
        datasets: [{
          data: [stats.caProduitsMois, stats.caServicesMois],
          backgroundColor: ['#5B5FE0', '#F2B155'],
          borderColor: 'transparent'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6B7A82',
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const total = context.dataset.data.reduce((sum, value) => sum + value, 0);
                const percent = total ? (context.raw / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '0';
                return `${context.label} : ${money(context.raw)} (${percent} %)`;
              }
            }
          }
        }
      }
    });
  }
  if (stats.repartitionPaiementsMois.length) {
    mountDashboardChart('dash-payment-methods-chart', {
      type: 'bar',
      data: {
        labels: stats.repartitionPaiementsMois.map((item) => item.label),
        datasets: [{
          label: 'Montant encaissé',
          data: stats.repartitionPaiementsMois.map((item) => item.montant),
          backgroundColor: '#5B5FE0',
          borderRadius: 4
        }]
      },
      options: { ...axisChartOptions(axisMoney, true, money), indexAxis: 'y' }
    });
  }
  mountRankingChart('dash-products-ranking', stats.produitsPlusVendus, 'designation', 'quantite');
  mountRankingChart('dash-services-ranking', stats.servicesPlusDemandes, 'nom', 'quantite');
  if (!hideSensitiveFinance) {
    mountRankingChart('dash-suppliers-ranking', stats.topFournisseurs, 'nom', 'montant', true);
    mountDashboardChart('dash-net-profit-chart', lineChartConfig(
      stats.serieMensuelle.map((item) => item.label),
      stats.serieMensuelle.map((item) => item.beneficeNet),
      'Bénéfice net',
      '#2F7D5C'
    ));
    mountDashboardChart('dash-treasury-chart', lineChartConfig(
      stats.serieMensuelle.map((item) => item.label),
      stats.serieMensuelle.map((item) => item.soldeTresorerie),
      'Solde de trésorerie',
      '#5B5FE0'
    ));
  }
  qs('#dash-ca-period').addEventListener('change', async (e) => {
    const select = e.target;
    const jours = Number(select.value);
    select.disabled = true;
    try {
      const chart = dashboardCharts.get('dash-ca-chart');
      const nouvellesStats = await call('dashboard:stats', { jours });
      if (dashboardCharts.get('dash-ca-chart') !== chart) return;
      chart.data.labels = nouvellesStats.serieCaJournaliere.map((item) => item.label);
      chart.data.datasets[0].data = nouvellesStats.serieCaJournaliere.map((item) => item.valeur);
      chart.update();
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
