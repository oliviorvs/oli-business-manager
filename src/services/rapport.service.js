// src/services/rapport.service.js
const { requireAuth, requireModule } = require('./auth.service');
const clientService = require('./client.service');
const ecritureComptableService = require('./ecritureComptable.service');
const { debutJourUTC, finJourUTC, debutMoisUTC, debutAnneeUTC, ajouterJoursUTC } = require('../../utils/helpers');

// Fonction utilitaire pour les statistiques du tableau de bord
// CORRECTIF : toutes les bornes de dates (jour/semaine/mois/année) sont
// désormais calculées en UTC (voir utils/helpers.js) plutôt qu'avec les
// méthodes locales (getFullYear/getMonth/setHours...), qui pouvaient
// provoquer un décalage d'un mois entier dans les statistiques selon le
// fuseau horaire du poste (ex. tout juste après minuit dans un fuseau en
// avance sur UTC, encore avant minuit UTC).
//
// ADAPTATION SQLITE (Phase 2) : cette fonction est un gros calcul en
// LECTURE SEULE sur plusieurs collections à la fois. Plutôt que de refaire
// un `await store.get(...)` à chaque lookup individuel à l'intérieur des
// .map()/.reduce() ci-dessous (ce qui obligerait à transformer chacun de
// ces .map() en boucle for..of + Promise.all, pour un gain nul puisque
// toutes les données sont de toute façon déjà en mémoire — voir la note
// d'architecture dans store.js), on récupère UNE SEULE FOIS chaque
// collection nécessaire en tête de fonction (await store.list(...)), puis
// on construit de petites Map id -> enregistrement pour les lookups
// ponctuels. Le reste du calcul reste ensuite du JS pur et synchrone,
// identique à l'ancienne version.
async function dashboardStats(store, joursCA = 14, role) {
  const [
    ventesBrut, prestationsBrut, produits, clientsList, fournisseursList,
    depensesList, achatsListBrut, toutesOps, proformas, journalList
  ] = await Promise.all([
    store.list('ventes'),
    store.list('prestations'),
    store.list('produits'),
    store.list('clients'),
    store.list('fournisseurs'),
    store.list('depenses'),
    store.list('achats'),
    store.list('operationsTresorerie'),
    store.list('proformas'),
    store.list('journal')
  ]);
  const produitsById = new Map(produits.map((p) => [p.id, p]));
  const clientsById = new Map(clientsList.map((c) => [c.id, c]));
  const fournisseursById = new Map(fournisseursList.map((f) => [f.id, f]));

  const ventes = ventesBrut.filter((v) => v.statut !== 'annulee');
  const prestations = prestationsBrut.filter((pr) => pr.statut !== 'annulee');
  const prestationsAutonomes = prestations.filter((p) => !p.venteId);
  const now = new Date();
  const startJour = debutJourUTC(now);
  // CORRECTIF (audit — nouvelle passe, bug n°2) : `ajouterJoursUTC(now, -7)`
  // part de l'instant présent (avec heure/minute/seconde), donc `caSemaine`
  // glissait en continu au fil de la journée au lieu d'être ancré à minuit
  // UTC comme caJour/caMois/caAnnee — même bug déjà corrigé pour la branche
  // "semaine" de tresorerie.service.js (voir CORRECTIFS_AUDIT.md, point 7).
  const startSemaine = ajouterJoursUTC(startJour, -7);
  const startMois = debutMoisUTC(now);
  const startAnnee = debutAnneeUTC(now);

  function caSur(start) {
    const v = ventes.filter((x) => new Date(x.createdAt) >= start).reduce((s, x) => s + x.total, 0);
    const p = prestationsAutonomes.filter((x) => new Date(x.createdAt) >= start).reduce((s, x) => s + x.total, 0);
    return v + p;
  }

  function caEntre(start, end) {
    const v = ventes.filter((x) => { const d = new Date(x.createdAt); return d >= start && d <= end; }).reduce((s, x) => s + x.total, 0);
    const p = prestationsAutonomes.filter((x) => { const d = new Date(x.createdAt); return d >= start && d <= end; }).reduce((s, x) => s + x.total, 0);
    return v + p;
  }

  const startHier = ajouterJoursUTC(startJour, -1);
  const finHier = new Date(startJour.getTime() - 1);
  const caHier = caEntre(startHier, finHier);
  const startMoisPrecedent = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const finMoisPrecedent = new Date(startMois.getTime() - 1);
  const caMoisPrecedent = caEntre(startMoisPrecedent, finMoisPrecedent);
  // AMÉLIORATION (audit) : "CA de l'année" n'avait pas de comparaison,
  // contrairement à "CA du jour" (vs hier) et "CA du mois" (vs mois
  // dernier) — même logique appliquée à l'année précédente complète.
  const startAnneePrecedente = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  const finAnneePrecedente = new Date(startAnnee.getTime() - 1);
  const caAnneePrecedente = caEntre(startAnneePrecedente, finAnneePrecedente);

  const depensesManuellesMois = depensesList.filter((d) => new Date(d.createdAt) >= startMois).reduce((s, d) => s + d.montant, 0);
  // CORRECTIF (audit — bug n°4) : ce calcul mélangeait deux référentiels
  // comptables incompatibles — `caMois` en comptabilité d'ENGAGEMENT (le
  // `total` intégral de chaque vente du mois, y compris à crédit) contre
  // `achatsPayesMois` en base CAISSE partielle (`montantPaye`, pas
  // `achat.total`). Cela provoquait aussi un deuxième bug indépendant : le
  // filtre portait sur la date de l'ACHAT (`createdAt`) alors que le montant
  // sommé (`montantPaye`) est un compteur cumulatif qui continue d'évoluer
  // après coup à chaque règlement ultérieur — un règlement de mars sur un
  // achat de janvier ne comptait dans les dépenses d'AUCUN mois, tandis que
  // le "bénéfice de janvier" recalculé plus tard changeait rétroactivement
  // sans qu'il ne se soit rien passé "en janvier" entre-temps.
  // On aligne désormais `achatsMois` sur le MÊME référentiel d'engagement
  // que `caMois` : `achat.total` (fixé une bonne fois pour toutes à la
  // création de l'achat), et non plus `achat.montantPaye` (qui évolue). Ceci
  // élimine à la fois l'incohérence d'unité et la dérive rétroactive.
  // NOTE MÉTIER (reste un choix à valider avec le porteur du projet, pas
  // seulement un bug technique) : le coût réel des marchandises vendues
  // (quantité vendue × prix d'achat, éventuellement affiné par le coût
  // matière des nomenclatures) resterait une mesure plus juste économiquement
  // que le montant total des achats du mois, qui peut inclure des articles
  // achetés mais pas encore vendus (stock). Ce point n'a pas été changé ici
  // pour rester un correctif ciblé sur l'incohérence signalée, plutôt qu'un
  // changement plus large de méthodologie.
  const achatsMois = achatsListBrut.filter((a) => a.statut !== 'annulee' && new Date(a.createdAt) >= startMois).reduce((s, a) => s + (a.total || 0), 0);
  const depensesMois = depensesManuellesMois + achatsMois;
  const caMois = caSur(startMois);
  const beneficeEstime = Math.round((caMois - depensesMois) * 100) / 100;

  const ventesParProduit = {};
  ventes.forEach((v) => v.lignes.forEach((l) => { if (l.kind === 'service') return; ventesParProduit[l.produitId] = (ventesParProduit[l.produitId] || 0) + l.quantite; }));
  const produitsPlusVendus = Object.entries(ventesParProduit).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, qte]) => { const pr = produitsById.get(id); return { designation: pr ? pr.designation : 'Produit supprimé', quantite: qte }; });

  const servicesCount = {};
  prestations.forEach((p) => { servicesCount[p.serviceNom] = (servicesCount[p.serviceNom] || 0) + p.quantite; });
  const servicesPlusDemandes = Object.entries(servicesCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nom, qte]) => ({ nom, quantite: qte }));

  const nouveauxClientsMois = clientsList.filter((c) => new Date(c.createdAt) >= startMois).length;
  const depensesParClient = {};
  ventes.forEach((v) => { if (!v.clientId) return; const e = depensesParClient[v.clientId] || { montant: 0, nb: 0 }; e.montant += v.total; e.nb += 1; depensesParClient[v.clientId] = e; });
  prestationsAutonomes.forEach((p) => { if (!p.clientId) return; const e = depensesParClient[p.clientId] || { montant: 0, nb: 0 }; e.montant += p.total; e.nb += 1; depensesParClient[p.clientId] = e; });
  const meilleursClients = Object.entries(depensesParClient)
    .sort((a, b) => b[1].montant - a[1].montant)
    .slice(0, 5)
    .map(([id, e]) => { const c = clientsById.get(id); return { nom: c ? (c.nom + ' ' + (c.prenom || '')).trim() : 'Client supprimé', montant: Math.round(e.montant * 100) / 100, nombreAchats: e.nb }; });
  const clientsActifsMois = new Set(
    ventes.filter((v) => v.clientId && new Date(v.createdAt) >= startMois).map((v) => v.clientId)
      .concat(prestations.filter((p) => p.clientId && new Date(p.createdAt) >= startMois).map((p) => p.clientId))
  ).size;

  const tresorerieActuelle = toutesOps.reduce((s, o) => s + (o.type === 'entree' ? o.montant : -o.montant), 0);

  // Panier moyen (mois en cours) : chiffre d'affaires du mois / nombre de
  // transactions du mois (ventes + prestations autonomes).
  const ventesMoisCount = ventes.filter((v) => new Date(v.createdAt) >= startMois).length;
  const prestationsAutonomesMoisCount = prestationsAutonomes.filter((p) => new Date(p.createdAt) >= startMois).length;
  const nbTransactionsMois = ventesMoisCount + prestationsAutonomesMoisCount;
  const panierMoyen = nbTransactionsMois ? Math.round((caMois / nbTransactionsMois) * 100) / 100 : 0;

  // Top fournisseurs (montant total des achats, hors achats annulés).
  const achatsActifs = achatsListBrut.filter((a) => a.statut !== 'annulee');
  const montantParFournisseur = {};
  achatsActifs.forEach((a) => { montantParFournisseur[a.fournisseurId] = (montantParFournisseur[a.fournisseurId] || 0) + a.total; });
  const topFournisseurs = Object.entries(montantParFournisseur)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, montant]) => { const f = fournisseursById.get(id); return { nom: f ? f.nom : 'Fournisseur supprimé', montant: Math.round(montant * 100) / 100 }; });

  // Taux de conversion des devis (pro-forma) : proportion de devis validés
  // (transformés en vente) parmi l'ensemble des devis émis.
  const proformasValidees = proformas.filter((p) => p.statut === 'validee').length;
  const tauxConversionDevis = proformas.length ? Math.round((proformasValidees / proformas.length) * 1000) / 10 : 0;

  // Séries pour graphiques
  function jourLabel(d) { return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); }
  function moisLabel(d) { return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }); }

  const serieCaJournaliere = [];
  for (let i = joursCA - 1; i >= 0; i--) {
    const jour = ajouterJoursUTC(startJour, -i);
    const finJour = new Date(ajouterJoursUTC(jour, 1).getTime() - 1);
    const total = ventes.filter((v) => new Date(v.createdAt) >= jour && new Date(v.createdAt) <= finJour).reduce((s, v) => s + v.total, 0)
      + prestationsAutonomes.filter((p) => new Date(p.createdAt) >= jour && new Date(p.createdAt) <= finJour).reduce((s, p) => s + p.total, 0);
    serieCaJournaliere.push({ label: jourLabel(jour), valeur: Math.round(total * 100) / 100 });
  }

  const serieMensuelle = [];
  for (let i = 5; i >= 0; i--) {
    const debutMois = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const finMois = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59, 999));
    const recettes = toutesOps.filter((o) => o.type === 'entree' && new Date(o.createdAt) >= debutMois && new Date(o.createdAt) <= finMois).reduce((s, o) => s + o.montant, 0);
    const depenses = toutesOps.filter((o) => o.type === 'sortie' && new Date(o.createdAt) >= debutMois && new Date(o.createdAt) <= finMois).reduce((s, o) => s + o.montant, 0);
    const soldeFinMois = toutesOps.filter((o) => new Date(o.createdAt) <= finMois).reduce((s, o) => s + (o.type === 'entree' ? o.montant : -o.montant), 0);
    // Bénéfice net du mois = CA (ventes + prestations autonomes) du mois - dépenses
    // (manuelles + achats) du mois — même logique que beneficeEstime ci-dessus (voir le
    // correctif du bug n°4 : achat.total, comptabilité d'engagement, plutôt qu'achat.montantPaye).
    const caDuMois = caEntre(debutMois, finMois);
    const depensesManuellesDuMois = depensesList.filter((d) => { const d2 = new Date(d.createdAt); return d2 >= debutMois && d2 <= finMois; }).reduce((s, d) => s + d.montant, 0);
    const achatsDuMois = achatsListBrut.filter((a) => a.statut !== 'annulee').filter((a) => { const d2 = new Date(a.createdAt); return d2 >= debutMois && d2 <= finMois; }).reduce((s, a) => s + (a.total || 0), 0);
    const beneficeNet = Math.round((caDuMois - depensesManuellesDuMois - achatsDuMois) * 100) / 100;
    serieMensuelle.push({ label: moisLabel(debutMois), recettes: Math.round(recettes * 100) / 100, depenses: Math.round(depenses * 100) / 100, soldeTresorerie: Math.round(soldeFinMois * 100) / 100, beneficeNet });
  }

  // Répartition du CA du mois entre produits et services (pour le graphique en camembert).
  let caProduitsMois = 0, caServicesMois = 0;
  ventes.filter((v) => new Date(v.createdAt) >= startMois).forEach((v) => {
    v.lignes.forEach((l) => {
      if (l.kind === 'service') caServicesMois += l.sousTotal;
      else caProduitsMois += l.sousTotal;
    });
  });
  caServicesMois += prestationsAutonomes.filter((p) => new Date(p.createdAt) >= startMois).reduce((s, p) => s + p.total, 0);
  caProduitsMois = Math.round(caProduitsMois * 100) / 100;
  caServicesMois = Math.round(caServicesMois * 100) / 100;

  // Répartition des ventes du mois par mode de paiement (espèces, mobile money, carte, etc.).
  const LABELS_PAIEMENT = { especes: 'Espèces', mobile_money: 'Mobile Money', carte: 'Carte bancaire', virement: 'Virement', mixte: 'Paiement mixte' };
  const paiementsMoisMap = {};
  ventes.filter((v) => new Date(v.createdAt) >= startMois).forEach((v) => {
    const mode = v.modePaiement || 'especes';
    paiementsMoisMap[mode] = (paiementsMoisMap[mode] || 0) + v.total;
  });
  const repartitionPaiementsMois = Object.entries(paiementsMoisMap)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, montant]) => ({ mode, label: LABELS_PAIEMENT[mode] || mode, montant: Math.round(montant * 100) / 100 }));

  // Indicateur de rotation des stocks / taux de couverture : compare la
  // quantité totale vendue sur les 30 derniers jours à la quantité totale
  // actuellement en stock, pour estimer combien de jours le stock actuel
  // tiendrait au rythme de vente actuel.
  const start30j = ajouterJoursUTC(startJour, -29);
  const quantiteVendue30j = ventes.filter((v) => new Date(v.createdAt) >= start30j)
    .reduce((s, v) => s + v.lignes.filter((l) => l.kind !== 'service').reduce((s2, l) => s2 + l.quantite, 0), 0);
  const stockActuelTotal = produits.reduce((s, p) => s + (p.quantite || 0), 0);
  const venteMoyenneJournaliere = quantiteVendue30j / 30;
  const joursCouvertureStock = venteMoyenneJournaliere > 0 ? Math.round(stockActuelTotal / venteMoyenneJournaliere) : null;
  const tauxRotationStock = stockActuelTotal > 0 ? Math.round((quantiteVendue30j / stockActuelTotal) * 1000) / 10 : 0;

  // Nombre de factures pro-forma (devis) en attente de validation.
  const proformasEnAttente = proformas.filter((p) => p.statut !== 'validee').length;

  // Flux d'activité : 5 dernières actions du journal (audit trail léger,
  // sans détail financier sensible — juste l'action, la cible et l'auteur).
  // CORRECTIF (audit) : même bug que journal.service.js#list —
  // store.list('journal') renvoie les lignes triées par rowid ASCENDANT
  // (la plus ancienne en premier), donc `.slice(0, 5)` remontait les 5
  // entrées les PLUS ANCIENNES encore conservées en base (jusqu'à
  // JOURNAL_MAX = 5000 lignes), jamais l'activité réellement récente.
  // Le widget "Activité récente" du dashboard affichait donc en pratique
  // toujours les mêmes vieilles lignes, figées, au lieu de refléter ce qui
  // vient de se passer. Corrigé en prenant les 5 dernières lignes puis en
  // les inversant (plus récente en premier).
  const activiteRecente = journalList.slice(-5).reverse().map((j) => ({ action: j.action, cible: j.cible, utilisateur: j.utilisateur, date: j.date }));

  const stats = {
    caJour: caSur(startJour),
    caSemaine: caSur(startSemaine),
    caMois,
    caAnnee: caSur(startAnnee),
    caAnneePrecedente,
    caHier,
    caMoisPrecedent,
    beneficeEstime,
    nombreVentes: ventes.length,
    nombreClients: clientsList.length,
    nouveauxClientsMois,
    clientsActifsMois,
    meilleursClients,
    nombrePrestations: prestations.length,
    depensesMois,
    tresorerieActuelle,
    panierMoyen,
    topFournisseurs,
    tauxConversionDevis,
    serieCaJournaliere,
    serieMensuelle,
    produitsPlusVendus,
    servicesPlusDemandes,
    alertesStock: produits.filter((p) => p.quantite <= (p.seuilMin || 0)),
    facturesImpayees: ventes.filter((v) => v.statut === 'en_attente' || v.statut === 'partiellement_payee').map(v => ({...v,clientNom: clientService.clientLabel(v, clientsList)})),
    caProduitsMois,
    caServicesMois,
    repartitionPaiementsMois,
    joursCouvertureStock,
    tauxRotationStock,
    proformasEnAttente,
    activiteRecente,
  };

  // SÉCURITÉ (audit) : le rôle "gestionnaire" a accès au module "dashboard"
  // (voir auth.service.js#ROLE_PERMISSIONS), mais ne doit PAS voir les
  // indicateurs financiers sensibles (bénéfice, dépenses, trésorerie,
  // factures impayées) — c'était déjà l'intention affichée en commentaire
  // dans renderer/js/modules/dashboard.js ("hideSensitiveFinance"). Le
  // problème : cette restriction n'existait QUE dans le code d'affichage du
  // renderer, qui se contente de ne pas construire ces blocs HTML. Le canal
  // IPC dashboard:stats, lui, renvoyait déjà l'objet stats COMPLET —
  // atteignable directement depuis la console développeur ou tout script du
  // renderer via `window.api['dashboard:stats'](...)` (exposé sans
  // distinction de rôle par contextBridge, voir preload.js), en
  // contournant totalement l'interface. Un gestionnaire pouvait donc lire
  // beneficeEstime, depensesMois, tresorerieActuelle et facturesImpayees
  // malgré l'intention. On retire désormais ces champs ICI, à la source —
  // c'est la vraie frontière de sécurité, le masquage côté renderer restant
  // une couche d'affichage supplémentaire mais non suffisante à elle seule.
  //
  // "topFournisseurs" est retiré pour la même raison ET n'était filtré
  // NULLE PART avant ce correctif (ni ici, ni côté renderer) : il expose le
  // montant total des achats par fournisseur, qui est la même catégorie
  // d'information que "depensesMois" déjà jugée sensible — accessible en
  // clair via la carte "Top fournisseurs" du dashboard, même sans passer
  // par la console (voir dashboard.js, corrigé pour ne plus l'afficher).
  //
  // "serieMensuelle" (recettes/dépenses/solde de trésorerie/bénéfice net
  // mois par mois) alimente exclusivement les 2 graphiques déjà masqués
  // côté renderer pour ce rôle ; vidé ici pour cohérence, sans effet sur le
  // reste du dashboard qui ne l'utilise pas.
  if (role === 'gestionnaire') {
    stats.beneficeEstime = null;
    stats.depensesMois = null;
    stats.tresorerieActuelle = null;
    stats.facturesImpayees = [];
    stats.topFournisseurs = [];
    stats.serieMensuelle = [];
  }

  // AJOUT (demande client) : le rôle "caissier" a maintenant accès au module
  // "dashboard" (voir auth.service.js#ROLE_PERMISSIONS), mais l'affichage
  // côté renderer se limite volontairement aux raccourcis d'action et aux 2
  // classements "Produits les plus vendus" / "Services les plus demandés"
  // (voir dashboard.js#renderDashboardCaissier). Comme pour le rôle
  // gestionnaire ci-dessus, cette restriction est appliquée ICI, à la
  // source, et non uniquement dans le code d'affichage — un caissier ne doit
  // pas pouvoir lire le chiffre d'affaires, la trésorerie, le bénéfice, les
  // classements clients/fournisseurs ni le détail des ventes via la console
  // développeur. Seuls produitsPlusVendus et servicesPlusDemandes restent
  // renseignés.
  if (role === 'caissier') {
    stats.caJour = null; stats.caSemaine = null; stats.caMois = null; stats.caAnnee = null;
    stats.caAnneePrecedente = null; stats.caHier = null; stats.caMoisPrecedent = null;
    stats.beneficeEstime = null;
    stats.nombreVentes = null; stats.nombreClients = null; stats.nouveauxClientsMois = null; stats.clientsActifsMois = null;
    stats.meilleursClients = [];
    stats.nombrePrestations = null;
    stats.depensesMois = null;
    stats.tresorerieActuelle = null;
    stats.panierMoyen = null;
    stats.topFournisseurs = [];
    stats.tauxConversionDevis = null;
    stats.serieCaJournaliere = [];
    stats.serieMensuelle = [];
    stats.alertesStock = [];
    stats.facturesImpayees = [];
    stats.caProduitsMois = null;
    stats.caServicesMois = null;
    stats.repartitionPaiementsMois = [];
    stats.joursCouvertureStock = null;
    stats.tauxRotationStock = null;
    stats.proformasEnAttente = null;
    stats.activiteRecente = [];
  }

  return stats;
}

// Génération de rapports
async function genererRapport(store, { type, debut, fin }) {
  // CORRECTIF (audit — nouvelle passe, bug n°1) : la borne de fin utilisait
  // auparavant `end.setHours(23, 59, 59, 999)` (heure LOCALE du poste), alors
  // que `start` est un `new Date(debut)` interprété en UTC minuit — sur un
  // poste en UTC+3 (Madagascar), les deux bornes étaient décalées de 3h et
  // pouvaient inclure/exclure des transactions de façon incohérente selon le
  // fuseau. Les deux bornes sont désormais calées en UTC, comme le reste de
  // l'application (voir dashboardStats plus haut).
  const start = debut ? debutJourUTC(new Date(debut)) : new Date(0);
  const end = fin ? finJourUTC(new Date(fin)) : finJourUTC(new Date());
  function dans(dateStr) { const d = new Date(dateStr); return d >= start && d <= end; }

  switch (type) {
    case 'ventes':
      return (await store.list('ventes')).filter((v) => dans(v.createdAt));
    case 'depenses':
      return (await store.list('depenses')).filter((d) => dans(d.createdAt));
    case 'achats':
      return (await store.list('achats')).filter((a) => dans(a.createdAt));
    case 'stocks':
      return store.list('produits');
    case 'services': {
      // CORRECTIF : quand une prestation fait partie d'une vente mixte
      // (produits + service dans le même passage en caisse — ex. vente de
      // ramettes de papier avec un service d'impression), le rapport
      // "Services" n'affichait plus que la ligne de service et perdait toute
      // trace des produits achetés au même moment. On rattache maintenant à
      // chaque ligne du rapport les produits vendus dans la même vente
      // (via prestation.venteId), comme c'était le cas auparavant, pour
      // avoir une vue complète de la transaction dans le rapport.
      // ADAPTATION SQLITE : on récupère la liste des ventes UNE SEULE FOIS
      // (via une Map id -> vente) avant le .map(), plutôt que d'appeler
      // `await store.get('ventes', ...)` à l'intérieur du .map() — ce qui
      // retournerait des Promises non résolues.
      const ventesList = await store.list('ventes');
      const ventesById = new Map(ventesList.map((v) => [v.id, v]));
      const prestations = await store.list('prestations');
      return prestations.filter((p2) => dans(p2.createdAt)).map((p2) => {
        let produitsAssocies = '';
        if (p2.venteId) {
          const vente = ventesById.get(p2.venteId);
          if (vente) {
            produitsAssocies = vente.lignes
              .filter((l) => l.kind === 'produit')
              .map((l) => `${l.designation} x${l.quantite}`)
              .join(', ');
          }
        }
        return {
          'Date de création': new Date(p2.createdAt).toLocaleString('fr-FR'),
          'Numéro': p2.numero,
          'Service': p2.serviceNom,
          'Détails': p2.details || '',
          'Produits achetés': produitsAssocies,
          'Montant (Ar)': p2.total
        };
      });
    }
    case 'produits':
      return store.list('produits');
    case 'clients':
      return store.list('clients');
    case 'fournisseurs':
      return store.list('fournisseurs');
    case 'rentabilite': {
      // ADAPTATION SQLITE : Map produitId -> produit construite une seule
      // fois, pour éviter un `await store.get()` par ligne de vente dans le
      // .reduce() imbriqué ci-dessous.
      const produitsById = new Map((await store.list('produits')).map((p) => [p.id, p]));
      const ventes = (await store.list('ventes')).filter((v) => dans(v.createdAt) && v.statut !== 'annulee');
      const prestations = (await store.list('prestations')).filter((p2) => dans(p2.createdAt) && p2.statut !== 'annulee' && !p2.venteId);
      const depenses = (await store.list('depenses')).filter((d) => dans(d.createdAt));
      // SYSTÈME TVA : le chiffre d'affaires d'un rapport de rentabilité doit
      // être HORS TAXE (la TVA n'est pas un revenu de l'entreprise, elle est
      // reversée à l'État) — on utilise donc v.totalHT/p2.totalHT plutôt que
      // v.total/p2.total (qui sont désormais des montants TTC). Filet de
      // compatibilité (`!= null ? ... : ...`) pour les ventes/prestations
      // antérieures à l'introduction de ce champ, où total était déjà HT par
      // construction (pas de TVA gérée à l'époque).
      const chiffreAffaires = ventes.reduce((s2, v) => s2 + (v.totalHT != null ? v.totalHT : v.total), 0) + prestations.reduce((s2, p2) => s2 + (p2.totalHT != null ? p2.totalHT : p2.total), 0);
      const coutAchat = ventes.reduce((s2, v) => s2 + v.lignes.reduce((s3, l) => { const pr = produitsById.get(l.produitId); return s3 + (pr ? pr.prixAchat * l.quantite : 0); }, 0), 0);
      const beneficeBrut = chiffreAffaires - coutAchat;
      const totalDepenses = depenses.reduce((s2, d) => s2 + d.montant, 0);
      const beneficeNet = beneficeBrut - totalDepenses;
      // TVA collectée sur la période, à titre indicatif (à ne pas confondre
      // avec le chiffre d'affaires ci-dessus, dont elle est exclue).
      const tvaCollectee = Math.round(ventes.reduce((s2, v) => s2 + (v.totalVat || 0), 0) * 100) / 100;
      return { chiffreAffaires, coutAchat, beneficeBrut, totalDepenses, beneficeNet, tvaCollectee, marge: chiffreAffaires ? (beneficeNet / chiffreAffaires) * 100 : 0 };
    }
    case 'etatFinancier': {
      // ADAPTATION SQLITE : même principe que pour 'rentabilite' ci-dessus.
      const produitsById = new Map((await store.list('produits')).map((p) => [p.id, p]));
      const ventes = (await store.list('ventes')).filter((v) => dans(v.createdAt) && v.statut !== 'annulee');
      const prestations = (await store.list('prestations')).filter((p2) => dans(p2.createdAt) && p2.statut !== 'annulee' && !p2.venteId);
      const achats = (await store.list('achats')).filter((a) => dans(a.createdAt) && a.statut !== 'annulee');
      const depenses = (await store.list('depenses')).filter((d) => dans(d.createdAt));

      const ventesProduitsTotal = ventes.reduce((s2, v) => s2 + v.lignes.filter((l) => l.kind === 'produit').reduce((s3, l) => s3 + l.sousTotal, 0), 0);
      // SYSTÈME TVA : l.sousTotal (lignes de vente) est déjà HT par
      // construction (voir vente.service.js) — inchangé ici. p2.total d'une
      // prestation est en revanche désormais TTC ; on utilise p2.totalHT
      // (avec repli sur p2.total pour les prestations antérieures à ce
      // système, où il n'y avait pas de TVA à retirer).
      const ventesServicesTotal = ventes.reduce((s2, v) => s2 + v.lignes.filter((l) => l.kind === 'service').reduce((s3, l) => s3 + l.sousTotal, 0), 0)
        + prestations.reduce((s2, p2) => s2 + (p2.totalHT != null ? p2.totalHT : p2.total), 0);
      const chiffreAffaires = ventesProduitsTotal + ventesServicesTotal;

      const coutMarchandisesVendues = ventes.reduce((s2, v) => s2 + v.lignes.reduce((s3, l) => { if (l.kind !== 'produit') return s3; const pr = produitsById.get(l.produitId); return s3 + (pr ? pr.prixAchat * l.quantite : 0); }, 0), 0);
      const beneficeBrut = chiffreAffaires - coutMarchandisesVendues;

      const depensesParCategorie = {};
      depenses.forEach((d) => { depensesParCategorie[d.categorie] = (depensesParCategorie[d.categorie] || 0) + d.montant; });
      const totalDepenses = depenses.reduce((s2, d) => s2 + d.montant, 0);

      const resultatNet = beneficeBrut - totalDepenses;

      const totalAchatsPeriode = achats.reduce((s2, a) => s2 + a.total, 0);
      const totalAchatsPayes = achats.reduce((s2, a) => s2 + a.montantPaye, 0);

      const toutesOpsTresorerie = await store.list('operationsTresorerie');
      const opsPeriode = toutesOpsTresorerie.filter((o) => dans(o.createdAt));
      const recettesPeriode = opsPeriode.filter((o) => o.type === 'entree').reduce((s2, o) => s2 + o.montant, 0);
      const depensesTresoreriePeriode = opsPeriode.filter((o) => o.type === 'sortie').reduce((s2, o) => s2 + o.montant, 0);
      const soldeAvantPeriode = toutesOpsTresorerie.filter((o) => new Date(o.createdAt) < start).reduce((s2, o) => s2 + (o.type === 'entree' ? o.montant : -o.montant), 0);
      const soldeFinPeriode = soldeAvantPeriode + recettesPeriode - depensesTresoreriePeriode;

      const nombreClients = (await store.list('clients')).length;

      // SYSTÈME TVA : TVA collectée (ventes) / déductible (achats) sur la
      // période — permet de lire directement le montant de TVA à reverser
      // (ou à récupérer si négatif) sans passer par l'export comptable.
      const tvaCollectee = Math.round(ventes.reduce((s2, v) => s2 + (v.totalVat || 0), 0) * 100) / 100;
      const tvaDeductible = Math.round(achats.reduce((s2, a) => s2 + (a.totalVat || 0), 0) * 100) / 100;
      const tvaAPayer = Math.round((tvaCollectee - tvaDeductible) * 100) / 100;

      // BILAN (demande client — "état financier complet") — photographie de
      // la situation patrimoniale à la date de fin choisie (ou à aujourd'hui
      // si aucune date de fin n'est précisée), pour compléter le compte de
      // résultat ci-dessus. Contrairement aux blocs précédents, le bilan
      // n'est PAS limité à la période affichée : par nature, un bilan est
      // une photo à un instant T, pas un flux sur une plage de dates.
      //
      // AVERTISSEMENT : l'application ne suit ni immobilisations ni apport
      // en capital initial (aucune saisie de ce type n'existe dans
      // l'application) — ce bilan reste donc simplifié. Les "capitaux
      // propres" affichés correspondent uniquement au résultat cumulé
      // (report à nouveau) depuis la toute première opération, obtenu par
      // différence Actif − Dettes plutôt que par un suivi comptable complet
      // en partie double (voir ecritureComptable.service.js pour l'export
      // comptable détaillé, qui reste la référence pour un comptable).
      const dateBilan = fin ? finJourUTC(new Date(fin)) : new Date();

      const toutesVentesNonAnnulees = (await store.list('ventes')).filter((v) => v.statut !== 'annulee');
      const creancesClients = Math.round(toutesVentesNonAnnulees.reduce((s2, v) => s2 + Math.max(0, (v.total || 0) - (v.montantPaye || 0)), 0) * 100) / 100;

      const tousProduits = await store.list('produits');
      const valeurStock = Math.round(tousProduits.reduce((s2, p2) => s2 + (p2.stock || 0) * (p2.prixAchat || 0), 0) * 100) / 100;

      const opsAvantDateBilan = toutesOpsTresorerie.filter((o) => new Date(o.createdAt) <= dateBilan);
      const tresorerieBilan = Math.round(opsAvantDateBilan.reduce((s2, o) => s2 + (o.type === 'entree' ? o.montant : -o.montant), 0) * 100) / 100;

      const totalActif = Math.round((creancesClients + valeurStock + tresorerieBilan) * 100) / 100;

      const tousAchatsNonAnnules = (await store.list('achats')).filter((a) => a.statut !== 'annulee');
      const dettesFournisseurs = Math.round(tousAchatsNonAnnules.reduce((s2, a) => s2 + Math.max(0, (a.total || 0) - (a.montantPaye || 0)), 0) * 100) / 100;

      const capitauxPropres = Math.round((totalActif - dettesFournisseurs) * 100) / 100;
      const totalPassif = Math.round((dettesFournisseurs + capitauxPropres) * 100) / 100;

      return {
        periode: { debut: debut || null, fin: fin || null },
        produits: { ventesProduits: ventesProduitsTotal, ventesServices: ventesServicesTotal, total: chiffreAffaires },
        charges: { coutMarchandisesVendues, depensesParCategorie: Object.entries(depensesParCategorie).map(([categorie, montant]) => ({ categorie, montant })), totalDepenses, totalCharges: coutMarchandisesVendues + totalDepenses },
        resultat: { beneficeBrut, resultatNet, marge: chiffreAffaires ? (resultatNet / chiffreAffaires) * 100 : 0 },
        tva: { collectee: tvaCollectee, deductible: tvaDeductible, aPayer: tvaAPayer },
        achats: { total: totalAchatsPeriode, paye: totalAchatsPayes, resteAPayer: Math.round((totalAchatsPeriode - totalAchatsPayes) * 100) / 100 },
        tresorerie: { soldeAvantPeriode, recettesPeriode, depensesPeriode: depensesTresoreriePeriode, soldeFinPeriode },
        indicateurs: { nombreVentes: ventes.length, nombrePrestations: prestations.length, nombreClients },
        bilan: {
          date: dateBilan.toISOString(),
          actif: { tresorerie: tresorerieBilan, creancesClients, valeurStock, total: totalActif },
          passif: { dettesFournisseurs, capitauxPropres, total: totalPassif },
          avertissement: "Bilan simplifié : ne tient pas compte des immobilisations ni d'un capital social initial (non suivis par l'application). Les capitaux propres correspondent au résultat cumulé depuis la première opération enregistrée."
        }
      };
    }
    // PHASE 3 — RAPPORT PDF "SERVICES ET PRODUITS VENDUS" : liste
    // chronologique de chaque ligne vendue (produits ET services) sur la
    // période choisie, au format du relevé de caisse habituel de
    // l'établissement (colonnes : date de création, numéro, désignation,
    // détails, montant), avec le montant total de la période. Contrairement
    // au rapport "services" ci-dessus (qui ne liste que les prestations), on
    // inclut ici aussi les lignes "produit" des ventes, et on aplati chaque
    // ligne de vente individuellement plutôt que de regrouper par vente.
    case 'servicesEtProduits': {
      const ventesPeriode = (await store.list('ventes')).filter((v) => dans(v.createdAt) && v.statut !== 'annulee');
      const prestationsAutonomes = (await store.list('prestations'))
        .filter((p2) => dans(p2.createdAt) && p2.statut !== 'annulee' && !p2.venteId);
      const lignesRapport = [];
      ventesPeriode.forEach((v) => {
        v.lignes.forEach((l) => {
          lignesRapport.push({
            createdAt: v.createdAt,
            numero: v.numero,
            designation: l.designation,
            details: l.details || '',
            montant: l.sousTotal
          });
        });
      });
      prestationsAutonomes.forEach((p2) => {
        lignesRapport.push({
          createdAt: p2.createdAt,
          numero: p2.numero,
          designation: p2.serviceNom,
          details: p2.details || '',
          montant: p2.total
        });
      });
      lignesRapport.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const total = Math.round(lignesRapport.reduce((s, l) => s + l.montant, 0) * 100) / 100;
      return { periode: { debut: debut || null, fin: fin || null }, lignes: lignesRapport, total };
    }
    // PHASE 3 — EXPORT COMPTABLE : aperçu du journal en partie double généré
    // à partir des ventes/achats/dépenses/encaissements de la période (voir
    // ecritureComptable.service.js). Le fichier .xlsx lui-même est produit
    // par un endpoint dédié (rapports:exporterComptableXlsx dans main.js),
    // qui régénère ces mêmes données côté serveur plutôt que de faire
    // confiance à ce qui a été affiché à l'écran.
    case 'exportComptable':
      return ecritureComptableService.generer(store, { debut, fin });
    default:
      throw new Error('Type de rapport inconnu');
  }
}

module.exports = {
  dashboardStats,
  generer: genererRapport
};
