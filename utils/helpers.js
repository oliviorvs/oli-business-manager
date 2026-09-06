// utils/helpers.js
const crypto = require('crypto');

function uid(prefix = '') {
  return (prefix ? prefix + '-' : '') + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function genererMotDePasseTemporaire() {
  // Alphabet sans caractères ambigus (0/O, 1/l/I) pour faciliter la saisie manuelle.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let mdp = '';
  const octets = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) mdp += alphabet[octets[i] % alphabet.length];
  return mdp;
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(String(hash || ''), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function nombrePositifOuZero(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function money(n, currency = 'Ar') {
  return (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + currency;
}

function dateFr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function dateOnlyFr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR');
}

// ============================================================
// DATES EN UTC
// ============================================================

function debutJourUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function debutMoisUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function finMoisUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function debutAnneeUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function ajouterJoursUTC(date, jours) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + jours);
  return d;
}

function finJourUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

// ============================================================
// NUMÉROTATION SÉQUENTIELLE (clients, produits) — fonction unique
// ============================================================
async function genererCodeSequentiel(store, { sequenceKey, prefixe, longueur = 3, existants }) {
  const codesExistants = new Set(existants.map((c) => String(c || '').trim().toLowerCase()));
  let code;
  await store.allouerSequence(sequenceKey, (seqActuel) => {
    let seq = seqActuel;
    let garde = 0;
    do {
      seq += 1;
      code = prefixe + String(seq).padStart(longueur, '0');
      garde += 1;
    } while (codesExistants.has(code.toLowerCase()) && garde < 100000);
    return seq;
  });
  return code;
}

async function numeroSequentielMensuel(store, collection) {
  const now = new Date();
  const anneeComplete = now.getUTCFullYear();
  const annee = String(anneeComplete).slice(-2);
  const mois = String(now.getUTCMonth() + 1).padStart(2, '0');
  const sequenceKey = `${collection}-${anneeComplete}-${mois}`;
  const seq = await store.allouerSequence(sequenceKey, (seqActuel) => seqActuel + 1);
  return `${String(seq).padStart(3, '0')}-${mois}${annee}`;
}

// Montant en lettres (déjà présent dans app.js, déplacé ici pour réutilisation)
const NUM_UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const NUM_DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function deuxChiffresEnLettres(n) {
  if (n < 20) return NUM_UNITES[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) return NUM_DIZAINES[d] + (u === 0 ? '-dix' : '-' + NUM_UNITES[10 + u]);
  if (d === 8) return u === 0 ? 'quatre-vingts' : 'quatre-vingt-' + NUM_UNITES[u];
  if (u === 0) return NUM_DIZAINES[d];
  if (u === 1) return NUM_DIZAINES[d] + '-et-un';
  return NUM_DIZAINES[d] + '-' + NUM_UNITES[u];
}

function troisChiffresEnLettres(n) {
  const c = Math.floor(n / 100), r = n % 100;
  let str = '';
  if (c > 0) { str += c === 1 ? 'cent' : NUM_UNITES[c] + ' cent'; if (c > 1 && r === 0) str += 's'; }
  if (r > 0) str += (str ? ' ' : '') + deuxChiffresEnLettres(r);
  return str;
}

function nombreEnLettresFr(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'zéro';
  const groupes = [];
  let reste = n;
  while (reste > 0) { groupes.unshift(reste % 1000); reste = Math.floor(reste / 1000); }
  const total = groupes.length;
  const mots = [];
  groupes.forEach((g, idx) => {
    if (g === 0) return;
    const puissance = total - idx - 1;
    let mot;
    if (puissance === 1 && g === 1) mot = 'mille';
    else {
      mot = troisChiffresEnLettres(g);
      if (puissance === 1) mot += ' mille';
      else if (puissance === 2) mot += g > 1 ? ' millions' : ' million';
      else if (puissance === 3) mot += g > 1 ? ' milliards' : ' milliard';
    }
    mots.push(mot);
  });
  return mots.join(' ').replace(/\s+/g, ' ').trim();
}

function montantEnLettres(n) {
  const mots = nombreEnLettresFr(n);
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}

module.exports = {
  uid,
  hashPassword,
  verifyPassword,
  genererMotDePasseTemporaire,
  nombrePositifOuZero,
  money,
  dateFr,
  dateOnlyFr,
  montantEnLettres,
  debutJourUTC,
  finJourUTC,
  debutMoisUTC,
  finMoisUTC,
  debutAnneeUTC,
  ajouterJoursUTC,
  genererCodeSequentiel,
  numeroSequentielMensuel
};