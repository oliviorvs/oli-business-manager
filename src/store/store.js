
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const Database = require('better-sqlite3');
const { uid } = require('../../utils/helpers');
const DEFAULT_LOGO = require('../../assets/logo-default');
const { listeComptesParDefaut } = require('../../utils/planComptableDefaults');

function DEFAULTS() {
  return {
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
      entrepriseName: 'OLI Tech',
      stat: '',
      nif: '',
      adresse: "",
      rib: '',
      telephone: '',
      email: '',
      ville: '',
      gerantNom: '',
      gerantTitre: '',
      tauxTva: '',
      taxSettings: {
        vatEnabled: false,
        defaultVatRate: 20
      },
      banqueNom: '',
      devise: 'Ar',
      logoDataUrl: DEFAULT_LOGO,
      planComptableValide: false,
      planComptableValidePar: '',
      planComptableValideDate: null,
      sequences: {
        produit: 0,
        client: 0
      },
      smtp: {
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
        passwordEncrypted: '',
        from: ''
      }
    },
    utilisateurs: [],
    clients: [],
    fournisseurs: [],
    categories: [],
    produits: [],
    mouvementsStock: [],
    recettes: [],
    ventes: [],
    proformas: [],
    bonsLivraison: [],
    services: [],
    prestations: [],
    achats: [],
    depenses: [],
    operationsTresorerie: [],
    journal: [],
    planComptable: []
  };
}

// ============================================================
// SCHÉMA SQLITE — une table par collection + une table "meta"
// ============================================================
const SCHEMA = {
  utilisateurs: { dateField: 'createdAt', extra: [] },
  clients: { dateField: 'createdAt', extra: ['telephone'] },
  fournisseurs: { dateField: 'createdAt', extra: [] },
  categories: { dateField: 'createdAt', extra: [] },
  produits: { dateField: 'createdAt', extra: ['code'] },
  mouvementsStock: { dateField: 'createdAt', extra: ['produitId'] },
  recettes: { dateField: 'createdAt', extra: ['cibleType', 'cibleId'] },
  ventes: { dateField: 'createdAt', extra: ['clientId', 'statut'] },
  proformas: { dateField: 'createdAt', extra: ['statut'] },
  bonsLivraison: { dateField: 'createdAt', extra: ['venteId'] },
  services: { dateField: 'createdAt', extra: [] },
  prestations: { dateField: 'createdAt', extra: ['clientId', 'venteId'] },
  achats: { dateField: 'createdAt', extra: ['fournisseurId'] },
  depenses: { dateField: 'createdAt', extra: [] },
  operationsTresorerie: { dateField: 'createdAt', extra: [] },
  journal: { dateField: 'date', extra: [] },
  planComptable: { dateField: 'createdAt', extra: ['categorieInterne'] }
};
const COLLECTIONS = Object.keys(SCHEMA);
const COLLECTION_SET = new Set(COLLECTIONS);

function assertCollectionValide(collection) {
  if (!COLLECTION_SET.has(collection)) {
    throw new Error(`Collection inconnue : "${collection}"`);
  }
}

// Nombre maximum d'entrées de journal conservées (voir logJournal ci-dessous).
const JOURNAL_MAX = 5000;

function completerRecursivement(cible, reference) {
  for (const key of Object.keys(reference)) {
    if (!(key in cible)) {
      cible[key] = reference[key];
    } else if (
      reference[key] && typeof reference[key] === 'object' && !Array.isArray(reference[key]) &&
      cible[key] && typeof cible[key] === 'object' && !Array.isArray(cible[key])
    ) {
      completerRecursivement(cible[key], reference[key]);
    }
  }
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = this._ouvrirBaseSqlite(filePath);
    this._readCacheALS = new AsyncLocalStorage();
    this._assurerSchema();
    this._assurerAmorcage();
  }

  _ouvrirBaseSqlite(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const db = new Database(filePath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    return db;
  }

  _assurerSchema() {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS meta (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );`
    ];
    for (const collection of COLLECTIONS) {
      const { dateField, extra } = SCHEMA[collection];
      const extraCols = extra.map((c) => `${c} TEXT`).join(',\n        ');
      stmts.push(`CREATE TABLE IF NOT EXISTS ${collection} (
        id TEXT PRIMARY KEY,
        ${dateField} TEXT,
        ${extraCols ? extraCols + ',' : ''}
        data TEXT NOT NULL
      );`);
      stmts.push(`CREATE INDEX IF NOT EXISTS idx_${collection}_${dateField} ON ${collection}(${dateField});`);
      for (const col of extra) {
        stmts.push(`CREATE INDEX IF NOT EXISTS idx_${collection}_${col} ON ${collection}(${col});`);
      }
    }
    this.db.exec(stmts.join('\n'));
  }

  _assurerAmorcage() {
    const metaRow = this.db.prepare('SELECT data FROM meta WHERE id = ?').get('meta');
    const estBaseVide = !metaRow && COLLECTIONS.every((c) => this.db.prepare(`SELECT COUNT(*) AS n FROM ${c}`).get().n === 0);

    const defaults = DEFAULTS();
    const meta = metaRow ? JSON.parse(metaRow.data) : defaults.meta;
    if (!meta || typeof meta !== 'object') this._ecrireMetaSync(defaults.meta);
    else {

      const taxSettingsAbsent = !meta.taxSettings;
      completerRecursivement(meta, defaults.meta);
      if (taxSettingsAbsent) {
        const tauxExistant = Number(meta.tauxTva);
        if (meta.tauxTva !== '' && meta.tauxTva != null && Number.isFinite(tauxExistant) && tauxExistant > 0) {
          meta.taxSettings = { vatEnabled: true, defaultVatRate: tauxExistant };
        }
      }
      this._ecrireMetaSync(meta);
    }

    if (estBaseVide) {
      const tx = this.db.transaction(() => this._seedSync());
      tx();
    } else {
      this._assurerAdminSecours();
    }
  }

  _assurerAdminSecours() {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM utilisateurs').get().n;
    if (n > 0) return;
    console.warn('[SÉCURITÉ] Aucun utilisateur trouvé au démarrage — la configuration initiale (création du compte administrateur) sera demandée au lancement de l\'application.');
  }

  // ============================================================
  // META — lecture/écriture directe de la ligne unique `meta`
  // ============================================================
  _lireMetaSync() {
    const row = this.db.prepare('SELECT data FROM meta WHERE id = ?').get('meta');
    const meta = row ? JSON.parse(row.data) : DEFAULTS().meta;
    completerRecursivement(meta, DEFAULTS().meta);
    return meta;
  }

  _ecrireMetaSync(meta) {
    this.db.prepare('INSERT OR REPLACE INTO meta (id, data) VALUES (?, ?)').run('meta', JSON.stringify(meta));
  }

  async getMeta() {
    return this._lireMetaSync();
  }

  async updateMeta(patch) {
    const meta = Object.assign({}, this._lireMetaSync(), patch || {});
    this._ecrireMetaSync(meta);
    return meta;
  }

  async allouerSequence(sequenceKey, callback) {
    let resultat;
    const tx = this.db.transaction(() => {
      const meta = this._lireMetaSync();
      if (!meta.sequences || typeof meta.sequences !== 'object') meta.sequences = {};
      const valeurActuelle = Number(meta.sequences[sequenceKey]) || 0;
      resultat = callback(valeurActuelle);
      meta.sequences[sequenceKey] = resultat;
      this._ecrireMetaSync(meta);
    });
    tx();
    return resultat;
  }

  async ajusterChamp(collection, id, champ, delta, options) {
    assertCollectionValide(collection);
    const validate = options && options.validate;
    let record = null;
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).get(id);
      if (!row) return;
      const existant = JSON.parse(row.data);
      const valeurActuelle = Number(existant[champ]) || 0;
      const nouvelleValeur = typeof delta === 'function' ? delta(valeurActuelle) : valeurActuelle + delta;
      if (validate) validate(valeurActuelle, nouvelleValeur, existant);
      existant[champ] = nouvelleValeur;
      existant.updatedAt = new Date().toISOString();
      const { extra } = SCHEMA[collection];
      const colonnesExtra = extra.map((c) => `${c} = ?`).join(', ');
      const sql = `UPDATE ${collection} SET data = ?${colonnesExtra ? ', ' + colonnesExtra : ''} WHERE id = ?`;
      this.db.prepare(sql).run(JSON.stringify(existant), ...this._valeursExtra(collection, existant), id);
      record = existant;
    });
    tx();
    this._purgerCache(collection);
    return record;
  }

  async transaction(fn) {
    let resultat;
    const collectionsTouchees = new Set();
    const api = {
      get: (collection, id) => {
        assertCollectionValide(collection);
        const row = this.db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).get(id);
        return row ? JSON.parse(row.data) : null;
      },
      list: (collection, filterFn) => {
        assertCollectionValide(collection);
        const rows = this.db.prepare(`SELECT data FROM ${collection} ORDER BY rowid ASC`).all();
        const arr = rows.map((r) => JSON.parse(r.data));
        return filterFn ? arr.filter(filterFn) : arr;
      },
      insert: (collection, obj) => {
        collectionsTouchees.add(collection);
        return this._inserer(collection, obj);
      },
      update: (collection, id, patch) => {
        collectionsTouchees.add(collection);
        return this._mettreAJour(collection, id, patch);
      },
      remove: (collection, id) => {
        collectionsTouchees.add(collection);
        return this._supprimer(collection, id);
      },
      removeWhere: (collection, predicate) => {
        collectionsTouchees.add(collection);
        return this._supprimerOu(collection, predicate);
      },
      ajusterChamp: (collection, id, champ, delta, options) => {
        collectionsTouchees.add(collection);
        return this._ajusterChampSync(collection, id, champ, delta, options);
      },
      logJournal: (entry) => {
        collectionsTouchees.add('journal');
        return this._journaliser(entry);
      }
    };
    const tx = this.db.transaction(() => {
      resultat = fn(api);
    });
    tx();
    collectionsTouchees.forEach((c) => this._purgerCache(c));
    return resultat;
  }

  _ajusterChampSync(collection, id, champ, delta, options) {
    assertCollectionValide(collection);
    const validate = options && options.validate;
    const row = this.db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).get(id);
    if (!row) return null;
    const existant = JSON.parse(row.data);
    const valeurActuelle = Number(existant[champ]) || 0;
    const nouvelleValeur = typeof delta === 'function' ? delta(valeurActuelle) : valeurActuelle + delta;
    if (validate) validate(valeurActuelle, nouvelleValeur, existant);
    existant[champ] = nouvelleValeur;
    existant.updatedAt = new Date().toISOString();
    const { extra } = SCHEMA[collection];
    const colonnesExtra = extra.map((c) => `${c} = ?`).join(', ');
    const sql = `UPDATE ${collection} SET data = ?${colonnesExtra ? ', ' + colonnesExtra : ''} WHERE id = ?`;
    this.db.prepare(sql).run(JSON.stringify(existant), ...this._valeursExtra(collection, existant), id);
    return existant;
  }

  _seedSync() {

    const cats = ['Fournitures de bureau', 'Informatique', 'Consommables', 'Impression', 'Services'];
    cats.forEach((nom) => {
      this._insertSync('categories', { id: uid('cat'), nom, createdAt: new Date().toISOString() });
    });
    const services = [
      { nom: 'Impression', prixDefaut: 200 },
      { nom: 'Photocopie', prixDefaut: 100 },
      { nom: 'Cybercafé', prixDefaut: 1000 },
      { nom: 'Wifi Zone', prixDefaut: 500 },
      { nom: 'Reliure', prixDefaut: 2000 },
      { nom: 'Plastification', prixDefaut: 1500 },
      { nom: 'Scan', prixDefaut: 300 },
      { nom: 'Saisie informatique', prixDefaut: 500 },
      { nom: 'Vente de crédits Internet', prixDefaut: 0 }
    ];
    services.forEach((s) => {
      this._insertSync('services', { id: uid('srv'), nom: s.nom, prixDefaut: s.prixDefaut, actif: true, createdAt: new Date().toISOString() });
    });

    listeComptesParDefaut().forEach((c) => {
      this._insertSync('planComptable', Object.assign({ id: uid('pcg'), createdAt: new Date().toISOString() }, c));
    });
  }

  _valeursExtra(collection, rec) {
    const { extra } = SCHEMA[collection];
    return extra.map((col) => (rec[col] != null ? String(rec[col]) : null));
  }

  _insertSync(collection, record) {
    assertCollectionValide(collection);
    const { dateField, extra } = SCHEMA[collection];
    const colonnes = ['id', dateField, ...extra, 'data'];
    const placeholders = colonnes.map(() => '?').join(', ');
    const valeurs = [
      record.id,
      record[dateField] != null ? String(record[dateField]) : null,
      ...this._valeursExtra(collection, record),
      JSON.stringify(record)
    ];
    this.db.prepare(`INSERT INTO ${collection} (${colonnes.join(', ')}) VALUES (${placeholders})`).run(...valeurs);
  }

  async withReadCache(fn) {
    if (this._readCacheALS.getStore()) return fn(); // appel imbriqué (même chaîne) : réutiliser le cache déjà actif
    return this._readCacheALS.run(new Map(), fn);
  }

  _purgerCache(collection) {
    const cache = this._readCacheALS.getStore();
    if (cache) cache.delete(collection);
  }

  async list(collection, filterFn) {
    assertCollectionValide(collection);
    const cache = this._readCacheALS.getStore();
    let arr;
    if (cache && cache.has(collection)) {
      arr = cache.get(collection);
    } else {
      const rows = this.db.prepare(`SELECT data FROM ${collection} ORDER BY rowid ASC`).all();
      arr = rows.map((r) => JSON.parse(r.data));
      if (cache) cache.set(collection, arr);
    }
    const source = filterFn ? arr.filter(filterFn) : arr;
    return cache ? source.slice() : source;
  }

  async get(collection, id) {
    assertCollectionValide(collection);
    const row = this.db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.data) : null;
  }

  _inserer(collection, obj) {
    const FORBIDDEN_KEYS = new Set(['id', 'createdAt', '__proto__', 'constructor', 'prototype']);
    const safeObj = {};
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (!FORBIDDEN_KEYS.has(key)) safeObj[key] = obj[key];
      }
    }
    const record = Object.assign({ id: uid(collection.slice(0, 3)), createdAt: new Date().toISOString() }, safeObj);
    this._insertSync(collection, record);
    return record;
  }

  _mettreAJour(collection, id, patch) {
    assertCollectionValide(collection);
    const row = this.db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).get(id);
    if (!row) return null;
    const existant = JSON.parse(row.data);
    const safePatch = {};
    const FORBIDDEN_KEYS = new Set(['id', 'createdAt', '__proto__', 'constructor', 'prototype']);
    if (patch && typeof patch === 'object') {
      for (const key of Object.keys(patch)) {
        if (!FORBIDDEN_KEYS.has(key)) safePatch[key] = patch[key];
      }
    }
    const record = Object.assign({}, existant, safePatch, { updatedAt: new Date().toISOString() });
    const { extra } = SCHEMA[collection];
    const colonnesExtra = extra.map((c) => `${c} = ?`).join(', ');
    const sql = `UPDATE ${collection} SET data = ?${colonnesExtra ? ', ' + colonnesExtra : ''} WHERE id = ?`;
    this.db.prepare(sql).run(JSON.stringify(record), ...this._valeursExtra(collection, record), id);
    return record;
  }

  _supprimer(collection, id) {
    assertCollectionValide(collection);
    const info = this.db.prepare(`DELETE FROM ${collection} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  _supprimerOu(collection, predicate) {
    assertCollectionValide(collection);
    const rows = this.db.prepare(`SELECT id, data FROM ${collection}`).all();
    const idsASupprimer = rows.filter((r) => predicate(JSON.parse(r.data))).map((r) => r.id);
    if (!idsASupprimer.length) return 0;
    const stmt = this.db.prepare(`DELETE FROM ${collection} WHERE id = ?`);
    for (const id of idsASupprimer) stmt.run(id);
    return idsASupprimer.length;
  }

  _journaliser(entry) {
    const rec = Object.assign({ id: uid('log'), date: new Date().toISOString() }, entry);
    this._insertSync('journal', rec);
    this.db.prepare(`
      DELETE FROM journal WHERE id NOT IN (
        SELECT id FROM journal ORDER BY rowid DESC LIMIT ${JOURNAL_MAX}
      )
    `).run();
    return rec;
  }

  async insert(collection, obj) {
    const record = this._inserer(collection, obj);
    this._purgerCache(collection);
    return record;
  }

  async update(collection, id, patch) {
    const record = this._mettreAJour(collection, id, patch);
    this._purgerCache(collection);
    return record;
  }

  async remove(collection, id) {
    const ok = this._supprimer(collection, id);
    this._purgerCache(collection);
    return ok;
  }

  async removeWhere(collection, predicate) {
    let n = 0;
    const tx = this.db.transaction(() => { n = this._supprimerOu(collection, predicate); });
    tx();
    this._purgerCache(collection);
    return n;
  }

  async logJournal(entry) {
    const rec = this._journaliser(entry);
    this._purgerCache('journal');
    return rec;
  }

  async flush() {}

  // Ferme proprement la connexion SQLite. À appeler à la fermeture de
  // l'application, pour ne pas laisser un fichier -wal/-shm orphelin.
  async close() {
    await this.flush();
    try {
      this.db.close();
    } catch (err) {
      console.error('Erreur lors de la fermeture de la base de données', err);
    }
  }

  // ============================================================
  // EXPORT / IMPORT JSON — utilisés par backup:create / backup:restore
  async exportJSON() {

    const donneesExport = { meta: this._lireMetaSync() };
    for (const collection of COLLECTIONS) {
      donneesExport[collection] = await this.list(collection);
    }

    if (donneesExport.meta && donneesExport.meta.smtp) {

      donneesExport.meta.smtp = Object.assign({}, donneesExport.meta.smtp, { password: '', passwordEncrypted: '' });
    }
    return JSON.stringify(donneesExport, null, 2);
  }

  async importJSON(jsonString) {
    const parsed = JSON.parse(jsonString);
    const defaults = DEFAULTS();
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = defaults.meta;
    completerRecursivement(parsed.meta, defaults.meta);
    for (const key of Object.keys(defaults)) {
      if (!(key in parsed)) parsed[key] = defaults[key];
      if (!Array.isArray(parsed[key]) && key !== 'meta') parsed[key] = [];
    }

    for (const collection of COLLECTIONS) {
      parsed[collection] = this._nettoyerCollectionImportee(parsed[collection]);
    }

    const tx = this.db.transaction(() => {
      this._ecrireMetaSync(parsed.meta);
      for (const collection of COLLECTIONS) {
        this.db.prepare(`DELETE FROM ${collection}`).run();
        for (const rec of parsed[collection]) {
          this._insertSync(collection, rec);
        }
      }
    });
    tx();

    COLLECTIONS.forEach((c) => this._purgerCache(c));
  }

  _nettoyerCollectionImportee(arr) {
    if (!Array.isArray(arr)) return [];
    const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const nettoyer = (val, profondeur = 0) => {
      if (profondeur > 10 || val == null || typeof val !== 'object') return val;
      if (Array.isArray(val)) return val.map((v) => nettoyer(v, profondeur + 1));
      const copie = {};
      for (const key of Object.keys(val)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        copie[key] = nettoyer(val[key], profondeur + 1);
      }
      return copie;
    };
    return arr.filter((rec) => rec && typeof rec === 'object' && rec.id).map((rec) => nettoyer(rec));
  }
}

module.exports = Store;
