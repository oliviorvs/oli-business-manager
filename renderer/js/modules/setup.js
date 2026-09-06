// renderer/js/modules/setup.js
// ============================================================
// ECRAN DE CONFIGURATION INITIALE (demande client — premier lancement).
// ============================================================
// Remplace l'ancien compte admin créé automatiquement avec un mot de passe
// par défaut public ("admin123", voir src/store/store.js). Tant qu'aucun
// utilisateur n'existe en base (voir 'setup:status', appelé depuis
// app.js#init), cet écran est affiché à la place de l'écran de connexion et
// son passage est obligatoire : c'est ici que l'administrateur choisit
// lui-même son mot de passe, son nom, et le nom (+ logo, optionnel) de
// l'entreprise.
import { boot } from '../app.js';
import { toast } from '../components/toast.js';
import { qs } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export function initSetupUI() {
  const form = qs('#setup-form');
  if (!form || form.dataset.init) return; // évite un double-branchement si initSetupUI() est appelée plusieurs fois
  form.dataset.init = '1';

  let logoDataUrl = null;

  qs('#setup-btn-logo').addEventListener('click', () => qs('#setup-logo-file').click());
  qs('#setup-logo-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      logoDataUrl = reader.result;
      const img = qs('#setup-logo-preview');
      img.src = logoDataUrl;
      img.classList.remove('hidden');
      qs('#setup-logo-fallback').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  });

  // Aperçu de l'initiale du badge (comme sur l'écran de connexion et la
  // barre supérieure) pendant la saisie du nom de l'entreprise, tant
  // qu'aucun logo n'est choisi.
  qs('#setup-entreprise').addEventListener('input', (e) => {
    if (logoDataUrl) return;
    const initiale = e.target.value.trim().charAt(0).toUpperCase();
    qs('#setup-logo-fallback').textContent = initiale || '?';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = qs('#setup-error');
    const submitBtn = qs('#setup-submit');
    errBox.style.display = 'none';

    const entrepriseName = qs('#setup-entreprise').value.trim();
    const adminNom = qs('#setup-admin-nom').value.trim();
    const adminPrenom = qs('#setup-admin-prenom').value.trim();
    const adminEmail = qs('#setup-admin-email').value.trim();
    const adminPassword = qs('#setup-admin-password').value;
    const adminPassword2 = qs('#setup-admin-password2').value;

    if (adminPassword.length < 8) {
      errBox.textContent = 'Le mot de passe doit contenir au moins 8 caractères';
      errBox.style.display = 'block';
      return;
    }
    if (adminPassword !== adminPassword2) {
      errBox.textContent = 'Les deux mots de passe ne correspondent pas';
      errBox.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Configuration…';
    try {
      const session = await window.api['setup:complete']({
        entrepriseName, adminNom, adminPrenom, adminEmail, adminPassword,
        logoDataUrl: logoDataUrl || undefined
      });
      state.session = session;
      qs('#setup-screen').classList.remove('active');
      toast('Configuration terminée, bienvenue !', 'success');
      boot();
    } catch (err) {
      errBox.textContent = err.message || 'Erreur lors de la configuration';
      errBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Terminer la configuration';
    }
  });
}
