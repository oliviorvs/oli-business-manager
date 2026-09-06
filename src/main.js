// src/main.js
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store/store');
const { migrateJsonToSqlite } = require('./store/migrate-json-to-sqlite');
const services = require('./services');
const { startAutoBackup, stopAutoBackup } = require('./services/backup.automatic');
const logger = require('./utils/logger');
const emailService = require('./services/email.service');

let mainWindow;
let store;
let session = null;

process.on('uncaughtException', (err) => {
  logger.error('Exception non interceptée (process principal)', { error: err.message, stack: err.stack });
  try {
    if (app.isReady()) {
      dialog.showErrorBox(
        'Erreur inattendue',
        "Une erreur inattendue s'est produite. L'application reste ouverte — si vous constatez un comportement anormal, enregistrez votre travail puis redémarrez-la.\n\nDétail technique : " + err.message
      );
    }
  } catch (e) { /* l'affichage de la boîte de dialogue ne doit jamais faire planter le gestionnaire lui-même */ }
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Promesse rejetée non interceptée (process principal)', { error: err.message, stack: err.stack });
});

const verrouInstanceUnique = app.requestSingleInstanceLock();
if (!verrouInstanceUnique) {

  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function getDbPath() {
  return path.join(app.getPath('userData'), 'data', 'db.sqlite');
}

function getLegacyJsonDbPath() {
  return path.join(app.getPath('userData'), 'data', 'db.json');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(__dirname, "../assets/logo.png"),
    backgroundColor: '#F4F5F3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.setMenuBarVisibility(false);
  
  // Log de démarrage
  logger.info('Application démarrée', { version: app.getVersion() });
}

app.whenReady().then(async () => {

  try {
    const resultat = migrateJsonToSqlite(getLegacyJsonDbPath(), getDbPath());
    if (resultat.migrated) {
      logger.info('Migration automatique db.json -> db.sqlite effectuée', { backup: resultat.backupPath });
    }
  } catch (err) {

    logger.error('Échec de la migration automatique db.json -> db.sqlite', { error: err.message });
  }

  store = new Store(getDbPath());
  createWindow();

  await emailService.loadConfig(store);

  await startAutoBackup(getDbPath, store);
  logger.info('Sauvegarde automatique activée');
  
  // Vérifier les alertes stock toutes les heures
  setInterval(() => {
    checkStockAlerts();
  }, 60 * 60 * 1000); // 1 heure
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', async (event) => {
  stopAutoBackup();
  if (store) {
    event.preventDefault();
    await store.close();
    logger.info('Application arrêtée');
    app.exit(0);
  } else {
    logger.info('Application arrêtée');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
// ALERTES STOCK
// ============================================================
async function checkStockAlerts() {
  if (!store) return;
  try {
    const alertes = (await store.list('produits')).filter(p => p.quantite <= (p.seuilMin || 0));
    if (alertes.length > 0) {
      logger.warn(`Alerte stock : ${alertes.length} produit(s) en dessous du seuil`);
      
      // Notification système
      if (Notification.isSupported()) {
        new Notification({
          title: '⚠️ Alerte stock',
          body: `${alertes.length} produit(s) en dessous du seuil minimum`,
          icon: path.join(__dirname, '../assets/logo.png')
        }).show();
      }
    }
  } catch (err) {
    logger.error('Erreur lors de la vérification des alertes stock', { error: err.message });
  }
}

ipcMain.handle('setup:status', async () => {
  const needsSetup = await services.setupService.needsSetup(store);
  return { needsSetup };
});

ipcMain.handle('setup:complete', async (e, payload) => {
  try {
    const result = await services.setupService.completeInitialSetup(store, payload);
    session = result;
    logger.info('Configuration initiale terminée', { entreprise: payload && payload.entrepriseName, admin: payload && payload.adminEmail });
    return result;
  } catch (err) {
    logger.warn('Échec de la configuration initiale', { error: err.message });
    throw err;
  }
});

// ============================================================
// AUTHENTIFICATION
// ============================================================
ipcMain.handle('auth:login', async (e, { email, password }) => {
  try {
    const result = await services.authService.login(store, { email, password });
    session = result;
    logger.info('Connexion réussie', { user: email });
    return result;
  } catch (err) {
    logger.warn('Tentative de connexion échouée', { email, error: err.message });
    throw err;
  }
});

ipcMain.handle('auth:logout', async () => {
  await services.authService.logout(store);
  session = null;
  logger.info('Déconnexion');
  return true;
});

ipcMain.handle('auth:session', () => session);

ipcMain.handle('auth:changePassword', async (e, payload) => {
  const result = await services.authService.changePassword(store, payload);
  logger.info('Changement de mot de passe', { user: session?.email });
  return result;
});

ipcMain.handle('auth:updateProfile', async (e, payload) => {
  const updated = await services.authService.updateProfile(store, payload);
  session = updated;
  logger.info('Profil mis à jour', { user: updated.email });
  return updated;
});

// ============================================================
// UTILITAIRE POUR WRAPPER LES HANDLERS
// ============================================================
const MESSAGE_ERREUR_GENERIQUE = 'Une erreur interne est survenue. Veuillez réessayer ou contacter le support.';
function estErreurMetier(err) {
  return err instanceof Error && err.constructor === Error && !err.code;
}
const CLES_SENSIBLES = new Set([
  'password', 'motdepasse', 'mot_de_passe', 'nouveaumotdepasse', 'ancien', 'nouveau',
  'ancienmotdepasse', 'nouveaumdp', 'pass', 'hash', 'salt', 'smtp_password'
]);
function censurerSecrets(value, profondeur = 0) {
  if (profondeur > 5 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => censurerSecrets(v, profondeur + 1));
  const copie = {};
  for (const key of Object.keys(value)) {
    if (CLES_SENSIBLES.has(key.toLowerCase())) {
      copie[key] = '[MASQUÉ]';
    } else {
      copie[key] = censurerSecrets(value[key], profondeur + 1);
    }
  }
  return copie;
}

const CHEMINS_OUVRABLES = new Set();
function enregistrerCheminOuvrable(chemin) {
  if (chemin) CHEMINS_OUVRABLES.add(chemin);
  // Borne la taille du registre (cas limite d'une session très longue avec
  // de nombreux exports) pour ne pas grossir indéfiniment.
  if (CHEMINS_OUVRABLES.size > 200) {
    const premier = CHEMINS_OUVRABLES.values().next().value;
    CHEMINS_OUVRABLES.delete(premier);
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const result = await fn(payload);
      return { ok: true, data: result };
    } catch (err) {
      logger.error(`Erreur sur ${channel}`, { error: err.message, stack: err.stack, payload: censurerSecrets(payload) });
      const message = estErreurMetier(err) ? err.message : MESSAGE_ERREUR_GENERIQUE;
      return { ok: false, error: message };
    }
  });
}

// ============================================================
// PARAMÈTRES
// ============================================================

handle('settings:get', () => {
  services.authService.requireAuth();
  return services.parametreService.get(store);
});

handle('settings:logo', async () => {
  const s = await services.parametreService.get(store);
  return { logoDataUrl: s.logoDataUrl, entrepriseName: s.entrepriseName };
});
handle('settings:update', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut modifier les paramètres');
  return services.parametreService.update(store, payload, s.email);
});

// ============================================================
// CLIENTS
// ============================================================
handle('clients:list', () => services.clientService.list(store));
handle('clients:create', (payload) => {
  const s = services.authService.requireModule('clients');
  return services.clientService.create(store, payload, s.email);
});
handle('clients:update', (payload) => {
  const s = services.authService.requireModule('clients');
  return services.clientService.update(store, payload.id, payload.patch, s.email);
});
handle('clients:delete', (payload) => {
  const s = services.authService.requireAuth();
  return services.clientService.delete(store, payload.id, s.email, s.role);
});
handle('clients:historique', (payload) => {
  services.authService.requireModule('clients');
  return services.clientService.historique(store, payload.id);
});

// ============================================================
// FOURNISSEURS
// ============================================================
handle('fournisseurs:list', () => services.fournisseurService.list(store));
handle('fournisseurs:create', (payload) => {
  const s = services.authService.requireModule('fournisseurs');
  return services.fournisseurService.create(store, payload, s.email);
});
handle('fournisseurs:update', (payload) => {
  const s = services.authService.requireModule('fournisseurs');
  return services.fournisseurService.update(store, payload.id, payload.patch, s.email);
});
handle('fournisseurs:delete', (payload) => {
  const s = services.authService.requireAuth();
  return services.fournisseurService.delete(store, payload.id, s.email, s.role);
});

// ============================================================
// CATÉGORIES
// ============================================================
handle('categories:list', () => {
  services.authService.requireAuth();
  return services.categorieService.list(store);
});
handle('categories:create', (payload) => {
  const s = services.authService.requireModule('produits');
  return services.categorieService.create(store, payload, s.email);
});
handle('categories:delete', (payload) => {
  const s = services.authService.requireAuth();
  return services.categorieService.delete(store, payload.id, s.email, s.role);
});

// ============================================================
// PHASE 3 — PLAN DE COMPTES
// ============================================================
handle('planComptable:list', () => services.planComptableService.list(store));
handle('planComptable:statutValidation', () => services.planComptableService.statutValidation(store));
handle('planComptable:update', (payload) => {
  const s = services.authService.requireAuth();
  return services.planComptableService.update(store, payload.id, payload.patch, s.email);
});
handle('planComptable:validerParComptable', (payload) => {
  const s = services.authService.requireAuth();
  return services.planComptableService.validerParComptable(store, payload, s.email);
});

// ============================================================
// PRODUITS
// ============================================================
handle('produits:list', () => services.produitService.list(store));
handle('produits:create', (payload) => {
  const s = services.authService.requireModule('produits');
  return services.produitService.create(store, payload, s.email);
});
handle('produits:update', (payload) => {
  const s = services.authService.requireModule('produits');
  return services.produitService.update(store, payload.id, payload.patch, s.email);
});
handle('produits:delete', (payload) => {
  const s = services.authService.requireAuth();
  return services.produitService.delete(store, payload.id, s.email, s.role);
});
handle('produits:ajusterStock', (payload) => {
  const s = services.authService.requireModule('stocks');
  return services.produitService.ajusterStock(store, payload, s.email);
});

// ============================================================
// STOCKS
// ============================================================
handle('stocks:mouvements', (payload) => {
  services.authService.requireModule('stocks');
  return services.stockService.mouvements(store, payload?.produitId);
});
handle('stocks:alertes', () => services.stockService.alertes(store));

// ============================================================
// RECETTES (NOMENCLATURES DE CONSOMMATION)
// ============================================================
handle('recettes:list', () => services.recetteService.list(store));
handle('recettes:getActiveByCible', (payload) =>
  services.recetteService.getActiveByCible(store, payload.cibleType, payload.cibleId)
);
handle('recettes:create', (payload) => {
  const s = services.authService.requireModule('produits');
  return services.recetteService.create(store, payload, s.email);
});
handle('recettes:update', (payload) => {
  const s = services.authService.requireModule('produits');
  return services.recetteService.update(store, payload.id, payload.patch, s.email);
});
handle('recettes:delete', (payload) => {
  const s = services.authService.requireModule('produits');
  return services.recetteService.delete(store, payload.id, s.email, s.role);
});
handle('consommations:simuler', (payload) => {
  services.authService.requireModule('produits');
  return services.consommationService.simulateConsommation(store, payload.cibleType, payload.cibleId, payload.quantite);
});

// ============================================================
// ACHATS
// ============================================================
handle('achats:list', () => services.achatService.list(store));
handle('achats:create', (payload) => {
  const s = services.authService.requireModule('achats');
  return services.achatService.create(store, payload, s.email);
});
handle('achats:annuler', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut annuler un achat');
  return services.achatService.annuler(store, payload.id, s.email);
});
handle('achats:payer', (payload) => {
  const s = services.authService.requireModule('achats');
  return services.achatService.payer(store, payload.id, payload.montant, s.email);
});
handle('achats:supprimer', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer définitivement un achat');
  return services.achatService.supprimer(store, payload.id, s.email);
});

// ============================================================
// VENTES
// ============================================================
handle('ventes:list', () => services.venteService.list(store));
handle('ventes:create', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.venteService.create(store, payload, s.email);
});
handle('ventes:annuler', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut annuler une vente');
  return services.venteService.annuler(store, payload.id, s.email);
});
handle('ventes:payer', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.venteService.payer(store, payload.id, payload.montant, s.email);
});
handle('ventes:supprimer', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer définitivement une vente');
  return services.venteService.supprimer(store, payload.id, s.email);
});
handle('ventes:modifierClient', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.venteService.modifierClient(store, payload.id, { clientId: payload.clientId, clientNom: payload.clientNom }, s.email);
});

// ============================================================
// PROFORMAS
// ============================================================
handle('proformas:list', () => services.proformaService.list(store));
handle('proformas:create', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.proformaService.create(store, payload, s.email);
});
handle('proformas:get', (payload) => {
  services.authService.requireModule('ventes');
  return services.proformaService.get(store, payload.id);
});
handle('proformas:update', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.proformaService.update(store, payload.id, payload, s.email);
});
handle('proformas:valider', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.proformaService.valider(store, payload.id, payload.montantPaye, payload.modePaiement, s.email);
});
handle('proformas:supprimer', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.proformaService.supprimer(store, payload.id, s.email);
});
handle('proformas:modifierClient', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.proformaService.modifierClient(store, payload.id, { clientId: payload.clientId, clientNom: payload.clientNom }, s.email);
});

// ============================================================
// LIVRAISONS
// ============================================================
handle('livraisons:list', () => services.livraisonService.list(store));
handle('livraisons:create', (payload) => {
  const s = services.authService.requireModule('ventes');
  return services.livraisonService.create(store, payload, s.email);
});
handle('livraisons:supprimer', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer un bon de livraison');
  return services.livraisonService.supprimer(store, payload.id, s.email);
});

// ============================================================
// SERVICES (types)
// ============================================================
handle('services:list', () => {
  services.authService.requireAuth();
  return services.serviceService.list(store);
});
handle('services:create', (payload) => {
  const s = services.authService.requireModule('services');
  return services.serviceService.create(store, payload, s.email);
});
handle('services:update', (payload) => {
  const s = services.authService.requireModule('services');
  return services.serviceService.update(store, payload.id, payload.patch, s.email);
});
handle('services:delete', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer un service');
  return services.serviceService.delete(store, payload.id, s.email, s.role);
});

// ============================================================
// PRESTATIONS
// ============================================================
handle('prestations:list', () => services.prestationService.list(store));
handle('prestations:create', (payload) => {
  const s = services.authService.requireModule('services');
  return services.prestationService.create(store, payload, s.email);
});
handle('prestations:annuler', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut annuler une prestation');
  return services.prestationService.annuler(store, payload.id, s.email);
});
handle('prestations:supprimer', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer définitivement une prestation');
  return services.prestationService.supprimer(store, payload.id, s.email);
});

// ============================================================
// DÉPENSES
// ============================================================
handle('depenses:list', () => services.depenseService.list(store));
handle('depenses:create', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role === 'caissier') throw new Error('Accès refusé pour votre rôle à ce module : depenses');
  return services.depenseService.create(store, payload, s.email);
});
handle('depenses:delete', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer une dépense');
  return services.depenseService.delete(store, payload.id, s.email, s.role);
});

// ============================================================
// TRÉSORERIE
// ============================================================
handle('tresorerie:resume', (payload) => {
  services.authService.requireModule('tresorerie');
  return services.tresorerieService.resume(store, payload?.periode);
});

// ============================================================
// DASHBOARD
// ============================================================
handle('dashboard:stats', (payload) => {
  const s = services.authService.requireModule('dashboard');
  return store.withReadCache(() => services.rapportService.dashboardStats(store, payload?.jours, s.role));
});

// ============================================================
// RAPPORTS
// ============================================================
handle('rapports:generer', (payload) => {
  services.authService.requireModule('rapports');
  return store.withReadCache(() => services.rapportService.generer(store, payload));
});
handle('rapports:exporterCsv', async (payload) => {
  services.authService.requireAuth();
  const result = await dialog.showSaveDialog(mainWindow, { 
    defaultPath: payload.defaultPath, 
    filters: [{ name: 'CSV', extensions: ['csv'] }] 
  });
  if (result.canceled || !result.filePath) return { annule: true };
  const { sanitizeCsvField } = require('./services/import.service');
  const header = payload.columns.map((c) => c.label).join(';');
  const rows = payload.data.map((row) => payload.columns.map((c) => JSON.stringify(sanitizeCsvField(row[c.key] != null ? row[c.key] : ''))).join(';'));
  fs.writeFileSync(result.filePath, [header, ...rows].join('\n'), 'utf-8');
  logger.info('Export CSV', { file: result.filePath });
  enregistrerCheminOuvrable(result.filePath);
  return { chemin: result.filePath };
});

handle('rapports:exporterComptableXlsx', async (payload) => {
  services.authService.requireModule('rapports');
  const donnees = await store.withReadCache(() => services.rapportService.generer(store, { type: 'exportComptable', debut: payload?.debut, fin: payload?.fin }));
  if (!donnees.validation.valide && !payload?.forcerNonValide) {
    throw new Error("Le plan de comptes n'a pas encore été validé par un comptable. Faites-le valider (Paramètres > Plan de comptes), ou confirmez explicitement qu'il s'agit d'un export de test.");
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: payload?.defaultPath || `export-comptable-${new Date().toISOString().slice(0, 10)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled || !result.filePath) return { annule: true };
  const { construireClasseur } = require('./services/xlsxWriter.util');
  const enteteJournal = ['Date', 'Journal', 'N° pièce', 'N° compte', 'Intitulé compte', 'Libellé écriture', 'Débit', 'Crédit'];
  const lignesJournal = donnees.lignes.map((l) => [
    new Date(l.date).toLocaleDateString('fr-FR'), l.journal, l.piece, l.numeroCompte, l.intituleCompte, l.libelleEcriture,
    l.debit || null, l.credit || null
  ]);
  lignesJournal.push(['', '', '', '', '', 'TOTAUX', donnees.totaux.debit, donnees.totaux.credit]);
  const enteteAnnexe = ['Catégorie interne', 'Libellé', 'N° compte', 'Intitulé compte', 'Actif'];
  const lignesAnnexe = donnees.planComptableUtilise.map((c) => [c.categorieInterne, c.libelle || '', c.numeroCompte, c.intitule, c.actif ? 'Oui' : 'Non']);
  lignesAnnexe.push(['', '', '', '', '']);
  lignesAnnexe.push(['Statut de validation comptable', donnees.validation.valide ? `Validé par ${donnees.validation.validePar} le ${new Date(donnees.validation.valideDate).toLocaleDateString('fr-FR')}` : 'NON VALIDÉ — export de test', '', '', '']);
  const buffer = construireClasseur([
    { name: 'Journal', rows: [enteteJournal, ...lignesJournal] },
    { name: 'Plan de comptes', rows: [enteteAnnexe, ...lignesAnnexe] }
  ]);
  fs.writeFileSync(result.filePath, buffer);
  logger.info('Export comptable xlsx', { file: result.filePath, lignes: donnees.lignes.length });
  enregistrerCheminOuvrable(result.filePath);
  return { chemin: result.filePath };
});

// ============================================================
// UTILISATEURS
// ============================================================
handle('utilisateurs:list', () => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé pour votre rôle à ce module : utilisateurs');
  return services.utilisateurService.list(store);
});
handle('utilisateurs:create', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut créer un utilisateur');
  return services.utilisateurService.create(store, payload, s.email);
});
handle('utilisateurs:update', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut modifier un utilisateur');
  return services.utilisateurService.update(store, payload.id, payload.patch, s.id, s.email);
});
handle('utilisateurs:resetPassword', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut réinitialiser un mot de passe');
  return services.utilisateurService.resetPassword(store, payload.id, payload.nouveauMotDePasse);
});
handle('utilisateurs:delete', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut supprimer un utilisateur');
  return services.utilisateurService.delete(store, payload.id, s.id);
});

// ============================================================
// JOURNAL
// ============================================================
handle('journal:list', (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé pour votre rôle à ce module : journal');
  return services.journalService.list(store, payload?.limit);
});

// ============================================================
// SAUVEGARDE
// ============================================================
handle('backup:create', async () => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut effectuer une sauvegarde');
  const result = await dialog.showSaveDialog(mainWindow, { 
    defaultPath: 'sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', 
    filters: [{ name: 'JSON', extensions: ['json'] }] 
  });
  if (result.canceled || !result.filePath) return { annule: true };
  const json = await store.exportJSON();
  fs.writeFileSync(result.filePath, json, 'utf-8');
  await store.logJournal({ utilisateur: s.email, action: 'sauvegarde' });
  logger.info('Sauvegarde manuelle créée', { user: s.email, file: result.filePath });
  enregistrerCheminOuvrable(result.filePath);
  return { chemin: result.filePath };
});

handle('backup:restore', async () => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut restaurer une sauvegarde');
  const result = await dialog.showOpenDialog(mainWindow, { 
    filters: [{ name: 'JSON', extensions: ['json'] }], 
    properties: ['openFile'] 
  });
  if (result.canceled || !result.filePaths[0]) return { annule: true };
  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  JSON.parse(content); // valide le format
  try {
    const secours = path.join(app.getPath('userData'), 'data', 'avant-restauration-' + Date.now() + '.json');
    const jsonActuel = await store.exportJSON();
    fs.writeFileSync(secours, jsonActuel, 'utf-8');
    logger.info('Sauvegarde pré-restauration créée', { file: secours });
  } catch (e) { /* pas bloquant */ }
  await store.importJSON(content);
  await store.logJournal({ utilisateur: s.email, action: 'restauration' });
  logger.info('Restauration effectuée', { user: s.email });
  return { ok: true };
});

// ============================================================
// IMPORT / EXPORT
// ============================================================
handle('import:produits', async (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin' && s.role !== 'gestionnaire') {
    throw new Error('Seul un administrateur ou gestionnaire peut importer des produits');
  }
  
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return { annule: true };
  
  const { importProduitsFromCSV } = require('./services/import.service');
  const importResult = await importProduitsFromCSV(result.filePaths[0], store, s.email);
  logger.info('Import produits', { user: s.email, inserted: importResult.inserted, errors: importResult.errors.length });
  return importResult;
});

handle('import:services', async (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin' && s.role !== 'gestionnaire') {
    throw new Error('Seul un administrateur ou gestionnaire peut importer des services');
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return { annule: true };
  const { importServicesFromCSV } = require('./services/import.service');
  const importResult = await importServicesFromCSV(result.filePaths[0], store, s.email);
  logger.info('Import services', { user: s.email, inserted: importResult.inserted, errors: importResult.errors.length });
  return importResult;
});

// ============================================================
// APP
// ============================================================
handle('app:openPath', async (payload) => {
  services.authService.requireAuth();
  if (!payload || !CHEMINS_OUVRABLES.has(payload.chemin)) {
    throw new Error('Chemin non autorisé');
  }
  shell.showItemInFolder(payload.chemin);
  return true;
});

// ============================================================
// SAUVEGARDE PAR EMAIL
// ============================================================

// Configuration du service email
handle('email:configure', async (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Seul un administrateur peut configurer l\'email');

  emailService.configure(payload);

  // Tester la connexion
  try {
    await emailService.verify();
    await emailService.saveConfig(store);
    logger.info('Configuration email testée avec succès');
    return { success: true, message: 'Configuration email validée' };
  } catch (err) {
    logger.error('Erreur de configuration email', { error: err.message });
    throw new Error(`Erreur de connexion: ${err.message}`);
  }
});

// Lecture de la configuration SMTP actuelle (sans le mot de passe), pour
// pré-remplir le formulaire de configuration côté interface.
handle('email:config:get', () => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé');
  return emailService.getPublicConfig();
});

// Liste des destinataires
handle('email:recipients:list', () => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé');
  return emailService.getRecipients();
});

// Ajouter un destinataire
handle('email:recipients:add', async (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé');
  
  const result = emailService.addRecipient(payload.email, payload.name);
  await emailService.saveRecipients(store);
  logger.info('Destinataire email ajouté', { email: payload.email });
  return result;
});

// Supprimer un destinataire
handle('email:recipients:remove', async (payload) => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé');
  
  const result = emailService.removeRecipient(payload.email);
  await emailService.saveRecipients(store);
  logger.info('Destinataire email supprimé', { email: payload.email });
  return result;
});

// Envoyer une sauvegarde par email maintenant
handle('email:backup:send', async () => {
  const s = services.authService.requireAuth();
  if (s.role !== 'admin') throw new Error('Accès refusé');
  
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error('Base de données introuvable');
  }

  const contenuSauvegarde = await store.exportJSON();

  // Créer une copie temporaire pour l'email
  const tempDir = path.join(app.getPath('userData'), 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempBackup = path.join(tempDir, `backup-${Date.now()}.json`);
  fs.writeFileSync(tempBackup, contenuSauvegarde, 'utf-8');
  
  try {
    const recipients = emailService.getRecipients();
    if (!recipients.length) {
      throw new Error('Aucun destinataire configuré');
    }
    
    const results = await emailService.sendBackupToAllRecipients(store, tempBackup);
    
    // Nettoyer le fichier temporaire
    fs.unlinkSync(tempBackup);
    
    return results;
  } catch (err) {
    // Nettoyer le fichier temporaire en cas d'erreur
    try { fs.unlinkSync(tempBackup); } catch (e) {}
    throw err;
  }
});