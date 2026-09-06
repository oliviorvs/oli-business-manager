// src/services/email.service.js
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { isValidEmail } = require('../validators/schemas');

// SÉCURITÉ (audit — chiffrement au repos) : le mot de passe SMTP était
// jusqu'ici persisté EN CLAIR dans meta.smtp (base SQLite locale) — retiré
// des exports/sauvegardes (voir store.js#exportJSON), mais lisible en clair
// par quiconque ouvre directement le fichier db.sqlite sur le poste.
// `safeStorage` (Electron, disponible sans dépendance supplémentaire) chiffre
// la chaîne avec une clé gérée par l'OS (Trousseau macOS, DPAPI Windows,
// libsecret/kwallet Linux) : le blob chiffré n'est déchiffrable que par le
// même compte utilisateur sur la même machine — exactement le périmètre de
// confiance déjà admis pour une application desktop mono-poste. `require`
// est fait ici plutôt qu'en tête de fichier de façon strictement
// équivalente ; conservé en haut pour rester lisible.
const { safeStorage } = require('electron');

function chiffrementDisponible() {
  try {
    return !!safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  } catch (e) {
    return false;
  }
}

// Chiffre un mot de passe pour le stockage (base64, prêt pour JSON/SQLite).
// Retourne null si le chiffrement OS n'est pas disponible sur ce poste (ex.
// certains environnements Linux sans trousseau configuré) — dans ce cas
// l'appelant retombe sur le comportement précédent (clair), en le
// journalisant, plutôt que de perdre silencieusement le mot de passe saisi.
function chiffrerMotDePasse(clair) {
  if (!clair) return null;
  if (!chiffrementDisponible()) return null;
  try {
    return safeStorage.encryptString(clair).toString('base64');
  } catch (e) {
    logger.error('Échec du chiffrement du mot de passe SMTP', { error: e.message });
    return null;
  }
}

function dechiffrerMotDePasse(base64) {
  if (!base64) return '';
  if (!chiffrementDisponible()) {
    logger.error('Mot de passe SMTP chiffré présent mais le déchiffrement OS est indisponible sur ce poste — reconfigurez l\'envoi d\'email (Sauvegarde > Configurer).');
    return '';
  }
  try {
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  } catch (e) {
    logger.error('Échec du déchiffrement du mot de passe SMTP', { error: e.message });
    return '';
  }
}

// CORRECTIF 1.2 : aucune valeur par défaut (hôte/identifiants) n'est plus
// codée en dur ici. Un serveur SMTP par défaut connu de tous (et un mot de
// passe d'application vide) donnait l'illusion d'une configuration valide et
// pouvait laisser croire que l'envoi fonctionnait alors qu'il échouait
// silencieusement — ou pire, exposait des identifiants génériques dans le
// code source. L'administrateur doit désormais configurer explicitement son
// propre serveur d'envoi (menu Sauvegarde > Configurer). Voir loadConfig()/
// saveConfig() pour la persistance de ces réglages dans meta.smtp (1.1).
const EMAIL_CONFIG = {
  host: '',
  port: 587,
  secure: false,
  auth: {
    user: '',
    pass: ''
  },
  from: ''
};

function estConfigurationComplete() {
  return !!(EMAIL_CONFIG.host && EMAIL_CONFIG.auth.user && EMAIL_CONFIG.auth.pass);
}

// Stocker les destinataires sauvegardés
let backupRecipients = [];

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
  }

  // Initialiser le transporteur
  init() {
    // CORRECTIF 1.2 : on ne tente même plus de créer un transporteur tant que
    // l'administrateur n'a pas renseigné un hôte et des identifiants — sans ce
    // garde-fou, un EMAIL_CONFIG vide créait quand même un transporteur
    // "valide" en apparence, qui échouait ensuite de façon peu claire au
        // premier envoi.
    if (!estConfigurationComplete()) {
      this.isConfigured = false;
      return false;
    }
    try {
      this.transporter = nodemailer.createTransport(EMAIL_CONFIG);
      this.isConfigured = true;
      logger.info('Service email initialisé');
      return true;
    } catch (err) {
      logger.error('Erreur d\'initialisation du service email', { error: err.message });
      this.isConfigured = false;
      return false;
    }
  }

  // CORRECTIF : main.js appelait auparavant
  // `require('./services/email.service').EMAIL_CONFIG` pour modifier la
  // configuration SMTP depuis l'extérieur. Or EMAIL_CONFIG est une constante
  // privée de ce module (fermeture ci-dessus), jamais exposée sur
  // `module.exports = new EmailService()` : cet accès renvoyait donc
  // `undefined`, et la ligne suivante (`emailConfig.host = host`) levait une
  // TypeError "Cannot set properties of undefined" — remontée telle quelle à
  // l'utilisateur (d'où le message contenant « undefined »). On expose
  // maintenant une méthode dédiée qui applique le correctif en encapsulant
  // EMAIL_CONFIG comme il se doit.
  configure({ host, port, secure, user, password, from } = {}) {
    // Mêmes règles qu'avant le correctif (contrôles de vérité conservés à
    // l'identique) : un champ vide n'écrase pas une valeur déjà enregistrée
    // — c'est ce qui permet au mot de passe de rester inchangé si on laisse
    // le champ vide dans le formulaire (voir sauvegarde.js#openEmailConfigForm).
    if (host) EMAIL_CONFIG.host = host;
    if (port) EMAIL_CONFIG.port = port;
    if (secure !== undefined) EMAIL_CONFIG.secure = secure;
    if (user) EMAIL_CONFIG.auth.user = user;
    if (password) EMAIL_CONFIG.auth.pass = password;
    if (from) EMAIL_CONFIG.from = from;
    this.isConfigured = false;
    this.init();
  }

  // Vérifier la configuration
  async verify() {
    if (!this.isConfigured) {
      if (!this.init()) {
        throw new Error('Service email non configuré. Renseignez un serveur SMTP et des identifiants valides.');
      }
    }
    try {
      await this.transporter.verify();
      return true;
    } catch (err) {
      this.isConfigured = false;
      throw new Error(`Erreur de connexion email: ${err.message}`);
    }
  }

  // Envoyer un email avec pièce jointe
  async sendBackupEmail(options) {
    await this.verify();

    const {
      to,
      subject = 'Sauvegarde OLI Business Manager',
      message = 'Voici la sauvegarde de votre base de données OLI Business Manager.',
      attachmentPath,
      attachmentName
    } = options;

    if (!to || !attachmentPath) {
      throw new Error('Destinataire et fichier de sauvegarde requis');
    }

    if (!fs.existsSync(attachmentPath)) {
      throw new Error('Fichier de sauvegarde introuvable');
    }

    const mailOptions = {
      from: EMAIL_CONFIG.from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text: message,
      attachments: [
        {
          filename: attachmentName || path.basename(attachmentPath),
          path: attachmentPath
        }
      ]
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Email de sauvegarde envoyé', { to, messageId: info.messageId });
      return info;
    } catch (err) {
      logger.error('Erreur d\'envoi d\'email', { error: err.message });
      throw err;
    }
  }

  // Envoyer une sauvegarde à tous les destinataires enregistrés
  async sendBackupToAllRecipients(store, backupFilePath) {
    if (!backupRecipients.length) {
      throw new Error('Aucun destinataire de sauvegarde enregistré');
    }

    const results = [];
    for (const recipient of backupRecipients) {
      try {
        const result = await this.sendBackupEmail({
          to: recipient.email,
          subject: `Sauvegarde OLI Business Manager - ${new Date().toISOString().slice(0, 10)}`,
          message: `Bonjour ${recipient.name || ''},\n\nVoici la sauvegarde automatique de votre base de données.\n\nDate: ${new Date().toLocaleString('fr-FR')}`,
          attachmentPath: backupFilePath
        });
        results.push({ recipient: recipient.email, success: true, messageId: result.messageId });
      } catch (err) {
        results.push({ recipient: recipient.email, success: false, error: err.message });
      }
    }

    // Journaliser l'opération
    await store.logJournal({
      utilisateur: 'sauvegarde_automatique',
      action: 'backup_email_envoye',
      cible: results.filter(r => r.success).map(r => r.recipient).join(', ')
    });

    return results;
  }

  // Ajouter un destinataire
  addRecipient(email, name = '') {
    if (!email || !isValidEmail(email)) {
      throw new Error('Email invalide');
    }
    if (backupRecipients.some(r => r.email === email)) {
      throw new Error('Cet email est déjà enregistré');
    }
    backupRecipients.push({ email, name });
    return backupRecipients;
  }

  // Supprimer un destinataire
  removeRecipient(email) {
    backupRecipients = backupRecipients.filter(r => r.email !== email);
    return backupRecipients;
  }

  // Liste des destinataires
  getRecipients() {
    return backupRecipients;
  }

  // Charger les destinataires depuis le store
  // PHASE 7 — SUPPRESSION DE LA COUCHE MÉMOIRE : lecture directe de la ligne
  // `meta` en base (store.getMeta()) au lieu de store.data.meta. Devenue
  // async ; voir les appelants (main.js, backup.automatic.js) mis à jour en
  // conséquence.
  async loadRecipients(store) {
    const config = await store.getMeta();
    if (config.backupEmails) {
      backupRecipients = config.backupEmails;
    }
    return backupRecipients;
  }

  // Sauvegarder les destinataires dans le store
  async saveRecipients(store) {
    await store.updateMeta({ backupEmails: backupRecipients });
  }

  // ============================================================
  // CORRECTIF 1.1 : PERSISTANCE DE LA CONFIGURATION SMTP
  // ============================================================
  // Charge la configuration SMTP précédemment enregistrée (meta.smtp) dans
  // EMAIL_CONFIG. À appeler au démarrage de l'application (main.js), avant
  // toute tentative d'envoi automatique, pour éviter d'avoir à ressaisir les
  // paramètres à chaque redémarrage.
  async loadConfig(store) {
    const meta = await store.getMeta();
    const smtp = meta && meta.smtp;
    if (!smtp) return false;
    if (smtp.host) EMAIL_CONFIG.host = smtp.host;
    if (smtp.port) EMAIL_CONFIG.port = smtp.port;
    if (smtp.secure !== undefined) EMAIL_CONFIG.secure = smtp.secure;
    if (smtp.user) EMAIL_CONFIG.auth.user = smtp.user;
    // SÉCURITÉ (audit — chiffrement au repos) : nouveau format chiffré en
    // priorité ; `smtp.password` (clair) reste lu en filet de compatibilité
    // pour une base existante pas encore migrée.
    if (smtp.passwordEncrypted) {
      EMAIL_CONFIG.auth.pass = dechiffrerMotDePasse(smtp.passwordEncrypted);
    } else if (smtp.password) {
      EMAIL_CONFIG.auth.pass = smtp.password;
      // MIGRATION AUTOMATIQUE (une seule fois) : un mot de passe encore en
      // clair (base créée/enregistrée avant l'introduction de safeStorage)
      // est immédiatement rechiffré et réécrit en base, sans action requise
      // de l'administrateur — n'échoue jamais le démarrage si le
      // chiffrement OS est indisponible (voir chiffrerMotDePasse()).
      const chiffre = chiffrerMotDePasse(smtp.password);
      if (chiffre) {
        store.updateMeta({ smtp: Object.assign({}, smtp, { password: '', passwordEncrypted: chiffre }) })
          .then(() => logger.info('Mot de passe SMTP migré vers le stockage chiffré'))
          .catch((e) => logger.error('Échec de la migration du mot de passe SMTP vers le stockage chiffré', { error: e.message }));
      }
    }
    if (smtp.from) EMAIL_CONFIG.from = smtp.from;
    this.isConfigured = false;
    if (estConfigurationComplete()) this.init();
    return true;
  }

  // Persiste la configuration SMTP actuelle (EMAIL_CONFIG) dans meta.smtp.
  async saveConfig(store) {
    // SÉCURITÉ (audit — chiffrement au repos) : le mot de passe n'est plus
    // jamais écrit en clair en base — voir chiffrerMotDePasse() en tête de
    // fichier. Si le chiffrement OS est indisponible sur ce poste (cas rare,
    // ex. Linux sans trousseau configuré), on retombe explicitement sur le
    // clair plutôt que de perdre silencieusement le mot de passe saisi, en
    // le journalisant pour que ce ne soit jamais une surprise.
    const motDePasse = EMAIL_CONFIG.auth.pass || '';
    const chiffre = chiffrerMotDePasse(motDePasse);
    if (motDePasse && !chiffre) {
      logger.warn('Chiffrement OS indisponible : le mot de passe SMTP est enregistré en clair sur ce poste');
    }
    await store.updateMeta({
      smtp: {
        host: EMAIL_CONFIG.host || '',
        port: EMAIL_CONFIG.port || 587,
        secure: !!EMAIL_CONFIG.secure,
        user: EMAIL_CONFIG.auth.user || '',
        password: chiffre ? '' : motDePasse,
        passwordEncrypted: chiffre || '',
        from: EMAIL_CONFIG.from || ''
      }
    });
  }

  // Retourne la configuration SMTP sans le mot de passe, pour pré-remplir le
  // formulaire de configuration côté interface sans exposer le secret.
  getPublicConfig() {
    return {
      host: EMAIL_CONFIG.host || '',
      port: EMAIL_CONFIG.port || 587,
      secure: !!EMAIL_CONFIG.secure,
      user: EMAIL_CONFIG.auth.user || '',
      from: EMAIL_CONFIG.from || '',
      hasPassword: !!EMAIL_CONFIG.auth.pass
    };
  }
}

module.exports = new EmailService();