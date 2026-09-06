// renderer/js/modules/planComptable.js
//
// PHASE 3 — SECTION "PLAN DE COMPTES" (Paramètres)
// ============================================================
// Table "catégorie interne -> compte PCG 2005" + panneau de validation
// comptable. Tant que le plan n'a pas été marqué comme validé par un
// comptable, un bandeau d'avertissement reste affiché ici et sur l'écran
// d'export comptable (voir rapports.js).
//
// AJOUT (demande client) : cette section vit désormais dans la page
// "Paramètres" (voir parametres.js) plutôt que sur son propre écran, et la
// modification d'un compte se fait via une modale (au lieu de champs
// éditables directement dans le tableau).
import { closeModal, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { dateOnlyFr, esc, h, qs, qsa } from '../utils/helpers.js';

export async function renderPlanComptableSection(container) {
  container.innerHTML = `<div id="pcg-warning"></div>
    <div class="muted fs-12_5 mb-12">Correspondance entre les catégories internes de l'application et les comptes du Plan Comptable Général (PCG 2005), utilisée par l'export comptable. Les valeurs pré-remplies sont des PROPOSITIONS courantes — à adapter et à faire valider par votre comptable avant tout export réel.</div>
    <div class="overflow-x-auto mb-16"><table><thead><tr><th>Catégorie interne</th><th>N° de compte</th><th>Intitulé du compte</th><th></th></tr></thead>
    <tbody id="pcg-tbody"></tbody></table></div>
    <div id="pcg-validation"></div>`;

  await chargerEtAfficher();

  async function chargerEtAfficher() {
    const [comptes, statut] = await Promise.all([
      call('planComptable:list'),
      call('planComptable:statutValidation')
    ]);
    afficherAvertissement(statut);
    afficherTableau(comptes);
    afficherValidation(statut);
  }

  function afficherAvertissement(statut) {
    const box = qs('#pcg-warning', container);
    if (statut.valide) {
      box.innerHTML = `<div class="alert alert-success mb-16">✓ Plan de comptes validé par <strong>${esc(statut.validePar)}</strong> le ${dateOnlyFr(statut.valideDate)}.</div>`;
    } else {
      box.innerHTML = `<div class="alert alert-warning mb-16">⚠️ Ce plan de comptes n'a pas encore été validé par un comptable. Ne l'utilisez pour l'export comptable qu'à titre de test tant qu'il n'a pas été relu et confirmé.</div>`;
    }
  }

  function afficherTableau(comptes) {
    const tbody = qs('#pcg-tbody', container);
    tbody.innerHTML = comptes.map((c) => `<tr data-id="${c.id}">
      <td>${esc(c.libelle || c.categorieInterne)}</td>
      <td>${esc(c.numeroCompte)}</td>
      <td>${esc(c.intitule)}</td>
      <td class="text-right"><button class="btn btn-ghost btn-sm act-edit">Modifier</button></td>
    </tr>`).join('');
    qsa('.act-edit', tbody).forEach((btn) => btn.addEventListener('click', () => {
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const compte = comptes.find((c) => c.id === id);
      ouvrirModaleCompte(compte);
    }));
  }

  function ouvrirModaleCompte(compte) {
    const body = h(`<div>
      <div class="field"><label>Catégorie interne</label><input value="${esc(compte.libelle || compte.categorieInterne)}" disabled /></div>
      <div class="field"><label>N° de compte</label><input id="pcg-numero" value="${esc(compte.numeroCompte)}" /></div>
      <div class="field"><label>Intitulé du compte</label><input id="pcg-intitule" value="${esc(compte.intitule)}" /></div>
    </div>`);
    openModal('Modifier le compte', body, [
      { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
      { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
        const numeroCompte = qs('#pcg-numero', body).value.trim();
        const intitule = qs('#pcg-intitule', body).value.trim();
        if (!numeroCompte || !intitule) { toast('Le numéro et l\'intitulé du compte sont requis', 'error'); return; }
        await call('planComptable:update', { id: compte.id, patch: { numeroCompte, intitule } });
        toast('Compte mis à jour', 'success');
        closeModal();
        await chargerEtAfficher();
      } }
    ]);
  }

  function afficherValidation(statut) {
    const box = qs('#pcg-validation', container);
    box.innerHTML = `<div class="kpi-label mb-12">Validation comptable</div>
      <p class="muted fs-13 mb-12">Une fois la liste des comptes relue et confirmée par votre comptable, enregistrez sa validation ici. Toute modification ultérieure d'un compte annulera automatiquement cette validation.</p>
      <div class="two-col">
        <div class="field"><label>Nom du comptable</label><input id="pcg-comptable-nom" placeholder="Nom du cabinet ou du comptable" /></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary btn-block" id="pcg-btn-valider">Marquer comme validé</button></div>
      </div>`;
    qs('#pcg-btn-valider', container).addEventListener('click', async () => {
      const comptableNom = qs('#pcg-comptable-nom', container).value.trim();
      if (!comptableNom) { toast('Indiquez le nom du comptable ayant validé la liste', 'error'); return; }
      await call('planComptable:validerParComptable', { comptableNom });
      toast('Validation enregistrée', 'success');
      await chargerEtAfficher();
    });
  }
}
