// src/services/backup.automatic.js
const fs = require('fs');
const path = require('path');
const emailService = require('./email.service');
const logger = require('../utils/logger');

let backupInterval = null;
const BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 heures
let storeInstance = null;
let getDbPathFn = null;

async function startAutoBackup(getDbPath, store) {
  if (backupInterval) return;
  
  getDbPathFn = getDbPath;
  storeInstance = store;
  
  await emailService.loadRecipients(store);
  
  // Sauvegarde au démarrage
  performBackup();
  
  // Planifier les sauvegardes quotidiennes
  backupInterval = setInterval(() => {
    performBackup();
  }, BACKUP_INTERVAL);
}

function stopAutoBackup() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

async function performBackup() {
  try {
    const dbPath = getDbPathFn();
    if (!fs.existsSync(dbPath)) return;
    if (!storeInstance || typeof storeInstance.exportJSON !== 'function') return;
    const contenuSauvegarde = await storeInstance.exportJSON();

    const backupDir = path.join(path.dirname(dbPath), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const date = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(backupDir, `backup-${date}.json`);
    
    // Créer la sauvegarde
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, contenuSauvegarde, 'utf-8');
      logger.info(`Sauvegarde automatique créée : ${backupPath}`);
      
      // Envoyer par email si des destinataires sont configurés
      const recipients = emailService.getRecipients();
      if (recipients.length > 0 && storeInstance) {
        emailService.sendBackupToAllRecipients(storeInstance, backupPath)
          .then(results => {
            const successCount = results.filter(r => r.success).length;
            logger.info(`Email de sauvegarde envoyé à ${successCount}/${recipients.length} destinataires`);
          })
          .catch(err => {
            logger.error('Erreur lors de l\'envoi des emails de sauvegarde', { error: err.message });
          });
      }
    }
    
    // Nettoyer les anciennes sauvegardes (garder 30 jours)
    const files = fs.readdirSync(backupDir);
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    files.forEach(file => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs < thirtyDaysAgo) {
        fs.unlinkSync(filePath);
        logger.info(`Ancienne sauvegarde supprimée : ${filePath}`);
      }
    });
  } catch (err) {
    logger.error('Erreur lors de la sauvegarde automatique', { error: err.message });
  }
}

// Fonction pour forcer une sauvegarde manuelle avec email
function forceBackupWithEmail() {
  performBackup();
}

module.exports = { startAutoBackup, stopAutoBackup, forceBackupWithEmail };