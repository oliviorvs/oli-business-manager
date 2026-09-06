import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { esc, h, qs, qsa } from '../utils/helpers.js';
import { state } from '../utils/state.js';

// AJOUT (demande client) : la gestion des utilisateurs est désormais une
// section de la page "Paramètres" (voir parametres.js) plutôt qu'une entrée
// de menu séparée. `container` est l'élément dans lequel dessiner le
// contenu de la section (au lieu de tout #main-content comme avant).
export async function renderUtilisateursSection(container) {
  container.innerHTML = `<div class="flex justify-between items-center mb-12">
      <div class="kpi-label">Comptes et rôles d'accès</div>
      <button class="btn btn-primary btn-sm" id="btn-new-user">+ Nouvel utilisateur</button>
    </div>
    <div id="u-table-wrap">Chargement…</div>`;
  const users = await call('utilisateurs:list');
  const wrap = qs('#u-table-wrap', container);
  const refresh = () => renderUtilisateursSection(container);
  wrap.innerHTML = `<table><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
    <tbody>${users.map((u) => `<tr data-id="${u.id}"><td>${esc(u.nom)} ${esc(u.prenom)}</td><td>${esc(u.email)}</td><td><span class="badge-role">${u.role}</span></td>
      <td>${u.actif ? '<span class="stamp stamp-payee">Actif</span>' : '<span class="stamp stamp-annulee">Inactif</span>'}</td>
      <td class="text-right nowrap">
        <button class="btn btn-ghost btn-sm act-edit">Modifier</button>
        <button class="btn btn-ghost btn-sm act-reset">Réinit. mdp</button>
        ${u.id !== state.session.id ? `<button class="btn btn-ghost btn-sm act-toggle">${u.actif ? 'Désactiver' : 'Activer'}</button>` : ''}
        ${u.id !== state.session.id ? '<button class="btn btn-danger btn-sm act-del">Suppr.</button>' : ''}
      </td></tr>`).join('')}</tbody></table>`;
  qsa('.act-edit', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
    const id = e.target.closest('tr').dataset.id;
    openUserForm(users.find((u) => u.id === id), refresh);
  }));
  qsa('.act-toggle', wrap).forEach((btn) => btn.addEventListener('click', async (e) => {
    const id = e.target.closest('tr').dataset.id; const u = users.find((x) => x.id === id);
    await call('utilisateurs:update', { id, patch: { actif: !u.actif } }); toast('Statut mis à jour', 'success'); refresh();
  }));
  qsa('.act-del', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
    const id = e.target.closest('tr').dataset.id;
    confirmDialog('Supprimer cet utilisateur ?', async () => { await call('utilisateurs:delete', { id }); toast('Utilisateur supprimé', 'success'); refresh(); });
  }));
  qsa('.act-reset', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
    const id = e.target.closest('tr').dataset.id;
    const body = h(`<div class="field"><label>Nouveau mot de passe</label><input id="new-pass" type="text" placeholder="Nouveau mot de passe" /></div>`);
    openModal('Réinitialiser le mot de passe', body, [
      { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
      { label: 'Valider', cls: 'btn-primary', onClick: async () => {
        const val = qs('#new-pass', body).value.trim();
        if (val.length < 8) { toast('8 caractères minimum', 'error'); return; }
        await call('utilisateurs:resetPassword', { id, nouveauMotDePasse: val });
        toast('Mot de passe réinitialisé', 'success'); closeModal();
      } }
    ]);
  }));
  qs('#btn-new-user', container).addEventListener('click', () => openUserForm(null, refresh));
}

// `onSaved` : rappel exécuté après création/modification réussie, pour
// rafraîchir la section "Utilisateurs" des Paramètres (voir ci-dessus).
export function openUserForm(user, onSaved) {
  const estModification = !!user;
  const body = h(`<div>
    <div class="two-col">
      <div class="field"><label>Nom</label><input id="f-nom" value="${esc(user?.nom || '')}" /></div>
      <div class="field"><label>Prénom</label><input id="f-prenom" value="${esc(user?.prenom || '')}" /></div>
    </div>
    <div class="field"><label>E-mail</label><input id="f-email" type="email" value="${esc(user?.email || '')}" /></div>
    <div class="two-col">
      <div class="field"><label>Rôle</label><select id="f-role">
        <option value="caissier" ${user?.role === 'caissier' ? 'selected' : ''}>Caissier</option>
        <option value="gestionnaire" ${user?.role === 'gestionnaire' ? 'selected' : ''}>Gestionnaire</option>
        <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrateur</option>
      </select></div>
      ${estModification ? '' : '<div class="field"><label>Mot de passe initial</label><input id="f-pass" type="text" placeholder="Min. 8 caractères" /></div>'}
    </div>
    ${estModification && user.id === state.session.id ? '<p class="muted fs-12_5">Vous modifiez votre propre compte — le rôle ne peut pas être changé ici pour éviter de vous retirer vos propres droits par erreur ; utilisez un autre compte administrateur pour cela.</p>' : ''}
  </div>`);
  if (estModification && user.id === state.session.id) {
    qs('#f-role', body).disabled = true;
  }
  openModal(estModification ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: estModification ? 'Enregistrer' : 'Créer', cls: 'btn-primary', onClick: async () => {
      const nom = qs('#f-nom', body).value.trim();
      const email = qs('#f-email', body).value.trim();
      const role = qs('#f-role', body).value;
      if (!nom || !email) { toast('Le nom et l\'e-mail sont obligatoires', 'error'); return; }
      if (estModification) {
        await call('utilisateurs:update', { id: user.id, patch: { nom, prenom: qs('#f-prenom', body).value.trim(), email, role } });
        toast('Utilisateur modifié', 'success'); closeModal(); onSaved && onSaved();
      } else {
        const password = qs('#f-pass', body).value.trim();
        if (password.length < 8) { toast('Mot de passe : 8 caractères minimum', 'error'); return; }
        await call('utilisateurs:create', { nom, prenom: qs('#f-prenom', body).value.trim(), email, role, password });
        toast('Utilisateur créé', 'success'); closeModal(); onSaved && onSaved();
      }
    } }
  ]);
}
