import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { esc, h, qs, qsa } from '../utils/helpers.js';

// AJOUT (demande client) : la sauvegarde est désormais une section de la
// page "Paramètres" (voir parametres.js) plutôt qu'une entrée de menu
// séparée. `container` est l'élément dans lequel dessiner le contenu de la
// section (au lieu de tout #main-content comme avant).
export async function renderSauvegardeSection(container) {
  if (!container) return;

  // Récupérer les destinataires email (si le service est configuré)
  let recipients = [];
  try {
    recipients = await call('email:recipients:list') || [];
  } catch (e) {
    // Ignorer l'erreur si le service email n'est pas encore implémenté
    recipients = [];
  }

  container.innerHTML = `
    <div class="muted fs-13 mb-14">Protégez vos données — sauvegarde locale et par email</div>
    <!-- Sauvegarde locale -->
    <div class="grid grid-2 mb-16">
      <div class="card">
        <div class="kpi-label mb-8">Exporter toutes les données</div>
        <p class="muted fs-13 mb-16">
          Crée une copie complète de la base dans un fichier que vous choisissez.
          Conservez-le sur une clé USB ou un cloud.
        </p>
        <button class="btn btn-primary" id="btn-backup">Exporter maintenant</button>
      </div>
      <div class="card">
        <div class="kpi-label mb-8">Importer une sauvegarde</div>
        <p class="muted fs-13 mb-16">
          Restaure les données à partir d'un fichier exporté précédemment.
          <strong>Toutes les données actuelles seront remplacées.</strong>
        </p>
        <button class="btn btn-danger" id="btn-restore">Importer une sauvegarde</button>
      </div>
    </div>
    
    <!-- Configuration email -->
    <div class="card mb-16">
      <div class="flex justify-between items-center mb-12">
        <div class="kpi-label">Sauvegarde par email</div>
        <button class="btn btn-ghost btn-sm" id="btn-email-config">⚙️ Configurer</button>
      </div>
      
      <div class="flex gap-10 flex-wrap mb-12">
        <button class="btn btn-primary btn-sm" id="btn-email-backup-now">📧 Envoyer maintenant</button>
        <span class="muted fs-12 self-center">${recipients.length} destinataire(s) configuré(s)</span>
      </div>
      
      <div id="email-recipients-list">
        ${recipients.length ? `
          <table>
            <thead><tr><th>Nom</th><th>Email</th><th></th></tr></thead>
            <tbody>
              ${recipients.map(r => `
                <tr>
                  <td>${esc(r.name || '—')}</td>
                  <td>${esc(r.email)}</td>
                  <td class="text-right">
                    <button class="btn btn-danger btn-sm act-remove-email" data-email="${esc(r.email)}">Supprimer</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="muted">Aucun destinataire configuré. Cliquez sur "Configurer" pour ajouter des emails.</div>'}
      </div>
    </div>
    
    <div class="card">
      <div class="kpi-label mb-8">Conseils</div>
      <ul class="muted fs-13" style="padding-left:20px;margin:0;">
        <li>La sauvegarde automatique est créée <strong>chaque jour</strong> dans le dossier <code>backups</code>.</li>
        <li>Elle est envoyée par email <strong>automatiquement</strong> à tous les destinataires configurés.</li>
        <li>Les anciennes sauvegardes (30 jours) sont <strong>automatiquement supprimées</strong>.</li>
        <li>Configurez votre <strong>serveur SMTP</strong> (Gmail, Outlook, etc.) pour activer l'envoi par email.</li>
      </ul>
    </div>
  `;

  // Événements
  qs('#btn-backup', container).addEventListener('click', async () => {
    const r = await call('backup:create');
    if (r && r.chemin) toast('Sauvegarde créée : ' + r.chemin, 'success');
  });

  qs('#btn-restore', container).addEventListener('click', () => {
    confirmDialog('Importer cette sauvegarde remplacera TOUTES les données actuelles. Continuer ?', async () => {
      const r = await call('backup:restore');
      if (r && r.ok) toast('Sauvegarde restaurée avec succès', 'success');
    });
  });

  qs('#btn-email-config', container).addEventListener('click', () => openEmailConfigForm(() => renderSauvegardeSection(container)));

  qs('#btn-email-backup-now', container).addEventListener('click', async () => {
    try {
      toast('Envoi en cours...', 'info');
      const results = await call('email:backup:send');
      const successCount = results.filter(r => r.success).length;
      toast(`Email envoyé à ${successCount}/${results.length} destinataires`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Supprimer un destinataire
  qsa('.act-remove-email', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      confirmDialog(`Supprimer ${email} des destinataires ?`, async () => {
        await call('email:recipients:remove', { email });
        toast('Destinataire supprimé', 'success');
        renderSauvegardeSection(container);
      });
    });
  });
}

// Formulaire de configuration email (appelé depuis renderSauvegardeSection).
// `onSaved` : rappel exécuté après enregistrement réussi, pour rafraîchir la
// section "Sauvegarde" des Paramètres.
// CORRECTIF 1.1/1.2 : le formulaire pré-remplissait auparavant des valeurs
// codées en dur (smtp.gmail.com, port 587...) qui donnaient l'illusion d'une
// configuration déjà valide. Il repart désormais vide par défaut et se
// pré-remplit avec la configuration réellement enregistrée (email:config:get)
// si l'administrateur en a déjà configuré une — sans jamais réafficher le
// mot de passe existant (laissé vide : "ne pas modifier" si non renseigné).
export function openEmailConfigForm(onSaved) {
  const body = h(`<div>
    <p class="muted fs-13 mb-12">Configurez votre serveur SMTP pour envoyer des sauvegardes par email.</p>
    
    <div class="field">
      <label>Serveur SMTP</label>
      <input id="cfg-host" placeholder="smtp.gmail.com" />
    </div>
    <div class="two-col">
      <div class="field">
        <label>Port</label>
        <input id="cfg-port" type="number" placeholder="587" />
      </div>
      <div class="field">
        <label>Sécurisé (SSL)</label>
        <select id="cfg-secure">
          <option value="false">Non (STARTTLS)</option>
          <option value="true">Oui (SSL/TLS)</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Email d'envoi</label>
      <input id="cfg-from" placeholder="votre-email@gmail.com" />
    </div>
    <div class="field">
      <label>Mot de passe (ou mot de passe d'application)</label>
      <input id="cfg-password" type="password" placeholder="••••••••" />
      <div class="muted fs-11_5" id="cfg-password-hint"></div>
    </div>
    
    <div class="hr"></div>
    <div class="kpi-label mb-8">Destinataires</div>
    <div class="flex gap-8 flex-wrap">
      <input id="cfg-recipient-email" placeholder="Email du destinataire" class="flex-2 minw-180" />
      <input id="cfg-recipient-name" placeholder="Nom (optionnel)" class="flex-1 minw-120" />
      <button class="btn btn-primary btn-sm" id="cfg-add-recipient">Ajouter</button>
    </div>
    <div id="cfg-recipients-list" class="mt-10"></div>
    
    <div class="hr"></div>
    <div class="flex gap-8">
      <button class="btn btn-primary" id="cfg-test">Tester la connexion</button>
      <button class="btn btn-ghost" id="cfg-save">Enregistrer</button>
    </div>
    <div id="cfg-status" class="mt-10"></div>
  </div>`);

  let recipients = [];

  // Pré-remplir avec la configuration SMTP déjà enregistrée, le cas échéant.
  (async () => {
    try {
      const cfg = await call('email:config:get');
      if (cfg) {
        qs('#cfg-host', body).value = cfg.host || '';
        qs('#cfg-port', body).value = cfg.port || 587;
        qs('#cfg-secure', body).value = cfg.secure ? 'true' : 'false';
        qs('#cfg-from', body).value = cfg.from || cfg.user || '';
        qs('#cfg-password-hint', body).textContent = cfg.hasPassword
          ? 'Un mot de passe est déjà enregistré — laissez ce champ vide pour le conserver.'
          : '';
      }
    } catch (e) { /* pas encore configuré */ }
  })();

  function refreshRecipientsList() {
    const container = qs('#cfg-recipients-list', body);
    if (!recipients.length) {
      container.innerHTML = '<div class="muted">Aucun destinataire</div>';
      return;
    }
    container.innerHTML = recipients.map(r => `
      <div class="flex justify-between p-6-0 bb-1px-solid-var-line">
        <span>${esc(r.name || '—')} <span class="muted">${esc(r.email)}</span></span>
        <button class="btn btn-danger btn-sm act-remove-rcp" data-email="${esc(r.email)}">✕</button>
      </div>
    `).join('');

    qsa('.act-remove-rcp', container).forEach(btn => {
      btn.addEventListener('click', () => {
        recipients = recipients.filter(r => r.email !== btn.dataset.email);
        refreshRecipientsList();
      });
    });
  }

  // Charger les destinataires existants
  (async () => {
    try {
      recipients = await call('email:recipients:list') || [];
      refreshRecipientsList();
    } catch (e) {}
  })();

  qs('#cfg-add-recipient', body).addEventListener('click', () => {
    const email = qs('#cfg-recipient-email', body).value.trim();
    const name = qs('#cfg-recipient-name', body).value.trim();
    if (!email || !email.includes('@')) {
      toast('Email invalide', 'error');
      return;
    }
    if (recipients.some(r => r.email === email)) {
      toast('Cet email est déjà ajouté', 'error');
      return;
    }
    recipients.push({ email, name });
    qs('#cfg-recipient-email', body).value = '';
    qs('#cfg-recipient-name', body).value = '';
    refreshRecipientsList();
  });

  qs('#cfg-test', body).addEventListener('click', async () => {
    const status = qs('#cfg-status', body);
    status.innerHTML = '<span class="muted">Test en cours...</span>';

    try {
      await call('email:configure', {
        host: qs('#cfg-host', body).value,
        port: parseInt(qs('#cfg-port', body).value),
        secure: qs('#cfg-secure', body).value === 'true',
        user: qs('#cfg-from', body).value,
        password: qs('#cfg-password', body).value,
        from: qs('#cfg-from', body).value
      });
      status.innerHTML = '<span class="text-success">✓ Connexion réussie !</span>';
      toast('Configuration email validée', 'success');
    } catch (err) {
      status.innerHTML = `<span class="text-danger">✗ Erreur : ${err.message}</span>`;
      toast(err.message, 'error');
    }
  });

  qs('#cfg-save', body).addEventListener('click', async () => {
    try {
      // Sauvegarder la configuration
      await call('email:configure', {
        host: qs('#cfg-host', body).value,
        port: parseInt(qs('#cfg-port', body).value),
        secure: qs('#cfg-secure', body).value === 'true',
        user: qs('#cfg-from', body).value,
        password: qs('#cfg-password', body).value,
        from: qs('#cfg-from', body).value
      });

      // Sauvegarder les destinataires
      for (const r of recipients) {
        await call('email:recipients:add', r);
      }

      toast('Configuration enregistrée', 'success');
      closeModal();
      onSaved && onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  openModal('Configuration email', body, [
    { label: 'Fermer', cls: 'btn-ghost', onClick: closeModal }
  ]);
}

// ------------------------- Page : Paramètres (société / facture) -------------------------
