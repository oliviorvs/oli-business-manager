const fs = require('fs');
const path = require('path');
const Store = require('./store');

/**
 * Migre un fichier db.json existant vers une base SQLite.
 * @param {string} jsonPath  chemin du fichier db.json source
 * @param {string} sqlitePath chemin de la base SQLite à créer
 * @returns {{ migrated: boolean, reason?: string, backupPath?: string }}
 */
function migrateJsonToSqlite(jsonPath, sqlitePath) {
  if (!fs.existsSync(jsonPath)) {
    return { migrated: false, reason: 'Aucun fichier db.json trouvé — rien à migrer.' };
  }
  if (fs.existsSync(sqlitePath)) {
    return { migrated: false, reason: 'Une base SQLite existe déjà à cet emplacement — migration ignorée.' };
  }

  const content = fs.readFileSync(jsonPath, 'utf-8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new Error(`Le fichier ${jsonPath} n'est pas un JSON valide, migration annulée : ${err.message}`);
  }

  // CONSERVER L'ANCIEN JSON EN SAUVEGARDE AVANT CONVERSION, comme demandé
  const backupPath = jsonPath + '.avant-migration-sqlite.bak';
  fs.copyFileSync(jsonPath, backupPath);
  const store = new Store(sqlitePath);
  store.importJSON(content);
  store.db.close();

  fs.renameSync(jsonPath, jsonPath + '.migre-vers-sqlite.bak');

  return { migrated: true, backupPath };
}

module.exports = { migrateJsonToSqlite };

// Exécution en ligne de commande directe : `node src/store/migrate-json-to-sqlite.js [json] [sqlite]`
if (require.main === module) {
  const os = require('os');
  const appDataDir = (() => {
    const base = process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.config');
    return path.join(base, 'oli-businesss-manager', 'data');
  })();

  const jsonPath = process.argv[2] || path.join(appDataDir, 'db.json');
  const sqlitePath = process.argv[3] || path.join(appDataDir, 'db.sqlite');

  console.log(`Migration : ${jsonPath} -> ${sqlitePath}`);
  try {
    const result = migrateJsonToSqlite(jsonPath, sqlitePath);
    if (result.migrated) {
      console.log('Migration terminée avec succès.');
      console.log(`Sauvegarde de l'ancien fichier JSON : ${result.backupPath}`);
    } else {
      console.log('Migration non effectuée : ' + result.reason);
    }
  } catch (err) {
    console.error('Échec de la migration :', err.message);
    process.exitCode = 1;
  }
}
