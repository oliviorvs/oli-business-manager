const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const RETENTION_JOURS = 30;

class Logger {
  constructor() {
    try {
      this.logDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.currentLogFile = path.join(this.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    } catch (e) {
      // Fallback si app n'est pas disponible (ex: tests)
      this.logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.currentLogFile = path.join(this.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    }
    this._purgerAnciensLogs();
  }
  
  _purgerAnciensLogs() {
    try {
      const limite = Date.now() - RETENTION_JOURS * 24 * 60 * 60 * 1000;
      const fichiers = fs.readdirSync(this.logDir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f));
      for (const f of fichiers) {
        const dateStr = f.slice(4, 14); // "AAAA-MM-JJ"
        const t = new Date(dateStr + 'T00:00:00Z').getTime();
        if (Number.isFinite(t) && t < limite) {
          try { fs.unlinkSync(path.join(this.logDir, f)); } catch (e) { /* pas bloquant */ }
        }
      }
    } catch (e) {
      // pas bloquant : un échec de purge ne doit jamais empêcher le démarrage
    }
  }

  log(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };
    
    try {
      const line = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.currentLogFile, line, 'utf-8');
    } catch (e) {
      // Ignorer les erreurs d'écriture
    }
    
    // Console avec couleurs
    const colors = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[36m',
      debug: '\x1b[35m'
    };
    const color = colors[level] || '\x1b[0m';
    console.log(`${color}[${level.toUpperCase()}]\x1b[0m ${timestamp} - ${message}`);
  }

  info(message, meta) { this.log('info', message, meta); }
  warn(message, meta) { this.log('warn', message, meta); }
  error(message, meta) { this.log('error', message, meta); }
  debug(message, meta) { this.log('debug', message, meta); }
}

// Singleton
let instance = null;
function getLogger() {
  if (!instance) {
    instance = new Logger();
  }
  return instance;
}

module.exports = getLogger();