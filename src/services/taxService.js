// src/services/taxService.js
//
// SERVICE CENTRAL DE TVA
// ============================================================
// Point UNIQUE de calcul de la TVA pour toute l'application (ventes, achats,
// devis, prestations, factures, rapports, export comptable). Aucun autre
// fichier ne doit recalculer une TVA "à la main" — voir le §13/§20 de la
// demande fonctionnelle.
//
// RÈGLE FONDAMENTALE (§20) :
//   taxSettings.vatEnabled === false  → taux effectif = 0%, quel que soit
//                                        le réglage du produit/service.
//   taxSettings.vatEnabled === true   → le produit/service utilise son
//                                        propre taux ("custom") s'il en a
//                                        un, sinon le taux général de
//                                        l'entreprise ("default").
//
// GEL HISTORIQUE (§7/§15) : ce service ne fait AUCUNE lecture différée —
// il calcule une fois, au moment de la vente/achat, et le résultat
// (vatRate/vatAmount/totalHT/totalTTC) est ensuite stocké tel quel dans la
// ligne du document. Une modification ultérieure du taux général ou du
// taux d'un produit ne modifie donc jamais un document déjà enregistré,
// puisque ce document ne rappelle plus jamais ce service pour ses propres
// lignes (voir invoice.js#calculTotaux, qui relit les valeurs GELÉES dans
// les lignes plutôt que de refaire ce calcul).

// Précision monétaire utilisée par l'application : 2 décimales (centimes).
// Centralisé ici pour que tout montant monétaire arrondi le soit de façon
// identique, quel que soit le module appelant (§14).
const MONEY_DECIMALS = 2;

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = Math.pow(10, MONEY_DECIMALS);
  return Math.round(n * factor) / factor;
}

// Détermine le taux de TVA (%) réellement applicable à un produit ou un
// service donné, compte tenu de l'état global de la TVA dans l'entreprise.
//   entity   : { vat: { mode: 'default'|'custom', rate: number|null } }
//              (un produit ou un service — même forme dans les deux cas)
//   settings : { vatEnabled: boolean, defaultVatRate: number }
function getEffectiveVatRate(entity, settings) {
  if (!settings || !settings.vatEnabled) return 0;
  const vat = (entity && entity.vat) || null;
  if (vat && vat.mode === 'custom') {
    const r = Number(vat.rate);
    return Number.isFinite(r) && r >= 0 ? r : 0;
  }
  const general = Number(settings.defaultVatRate);
  return Number.isFinite(general) && general >= 0 ? general : 0;
}

// Montant de TVA pour un montant HT et un taux (%) donnés.
function calculateVat(amountHT, rate) {
  const ht = Number(amountHT) || 0;
  const r = Number(rate) || 0;
  return roundMoney(ht * r / 100);
}

// TTC à partir d'un montant HT et d'un taux.
function calculateTTC(amountHT, rate) {
  const ht = Number(amountHT) || 0;
  return roundMoney(ht + calculateVat(ht, rate));
}

// HT reconstitué à partir d'un montant TTC et d'un taux (§6).
function calculateHTFromTTC(amountTTC, rate) {
  const ttc = Number(amountTTC) || 0;
  const r = Number(rate) || 0;
  if (!r) return roundMoney(ttc);
  return roundMoney(ttc / (1 + r / 100));
}

// Construit le détail complet d'une ligne à partir d'un montant HT et d'un
// taux déjà déterminé (§7) : { totalHT, vatRate, vatAmount, totalTTC }.
// C'est CE résultat qui doit être figé dans la ligne du document (produit
// vendu, ligne d'achat, prestation…) — jamais recalculé plus tard.
function calculateLineFromHT(amountHT, rate) {
  const totalHT = roundMoney(amountHT);
  const vatAmount = calculateVat(totalHT, rate);
  return {
    totalHT,
    vatRate: Number(rate) || 0,
    vatAmount,
    totalTTC: roundMoney(totalHT + vatAmount)
  };
}

// Agrège un tableau de lignes DÉJÀ CALCULÉES (chacune portant vatRate/
// vatAmount/totalTTC gelés, comme produites par calculateLineFromHT ou
// stockées dans un document existant) en un récapitulatif de facture :
// total HT, total TVA, total TTC, et le détail par taux (une facture peut
// mélanger plusieurs taux — §7).
//   ligne attendue : { sousTotal|totalHT, vatRate, vatAmount }
function calculateInvoiceTotals(lignes) {
  const liste = lignes || [];
  const totalHT = roundMoney(liste.reduce((s, l) => s + (Number(l.totalHT != null ? l.totalHT : l.sousTotal) || 0), 0));
  const totalVat = roundMoney(liste.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0));
  const totalTTC = roundMoney(totalHT + totalVat);

  const parTaux = new Map();
  liste.forEach((l) => {
    const taux = Number(l.vatRate) || 0;
    const montant = Number(l.vatAmount) || 0;
    parTaux.set(taux, roundMoney((parTaux.get(taux) || 0) + montant));
  });
  const detailParTaux = Array.from(parTaux.entries())
    .filter(([taux, montant]) => taux > 0 || montant > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([taux, montant]) => ({ taux, montant }));

  return { totalHT, totalVat, totalTTC, detailParTaux, vatApplicable: totalVat > 0 };
}

// Valide un taux de TVA saisi (§16) : nombre fini entre 0 et 100 inclus.
// Lève une exception explicite si invalide — à appeler côté serveur avant
// tout enregistrement (produit, service, paramètres généraux).
function validerTaux(valeur, libelle) {
  const r = Number(valeur);
  if (!Number.isFinite(r) || r < 0 || r > 100) {
    throw new Error(`${libelle || 'Le taux de TVA'} doit être un nombre compris entre 0 et 100`);
  }
  return r;
}

// Normalise le champ `vat` d'un produit/service à partir d'un payload
// utilisateur ({ vatMode, vatRate } ou déjà { vat: {...} }) — utilisé par
// produit.service.js et service.service.js pour rester cohérents. Ne valide
// le taux QUE si le mode est "custom" (le mode "default" n'a pas besoin
// d'un taux propre, il suit le taux général).
function normaliserVat(payload) {
  const source = payload && payload.vat ? payload.vat : payload || {};
  const mode = source.mode === 'custom' ? 'custom' : 'default';
  if (mode === 'custom') {
    const rate = validerTaux(source.rate, 'Le taux de TVA spécifique');
    return { mode, rate };
  }
  return { mode: 'default', rate: null };
}

module.exports = {
  roundMoney,
  getEffectiveVatRate,
  calculateVat,
  calculateTTC,
  calculateHTFromTTC,
  calculateLineFromHT,
  calculateInvoiceTotals,
  validerTaux,
  normaliserVat
};
