import { closeModal, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { esc, h, qs, qsa } from '../utils/helpers.js';
import { renderPlanComptableSection } from './planComptable.js';
import { renderSauvegardeSection } from './sauvegarde.js';
import { renderUtilisateursSection } from './utilisateurs.js';

// AJOUT (demande client) : la gestion des utilisateurs, le plan de comptes
// et la sauvegarde vivaient chacun sur leur propre écran (accessibles via
// des entrées de menu séparées dans "Administration"). Ils sont désormais
// regroupés ici, en sections dépliables au sein de la page "Paramètres" —
// chacune garde sa logique propre (voir utilisateurs.js, planComptable.js,
// sauvegarde.js), simplement rendue dans un sous-conteneur au lieu de tout
// #main-content, et la modification s'y fait via une modale plutôt qu'un
// formulaire toujours visible.
//
// Les champs "Entreprise" (nom, STAT, NIF, adresse...) suivent le même
// principe : ils sont affichés en lecture seule par défaut, et un bouton
// "Modifier" les remplace par le formulaire d'édition (masqué jusque-là),
// qui se referme et repasse en lecture seule une fois l'enregistrement fait.
//
// AJOUT (audit) : chaque module de cette page (Modèle de document,
// Entreprise, Utilisateurs, Plan de comptes, Sauvegarde) peut désormais être
// plié/déplié individuellement au lieu d'avoir à scroller jusqu'en bas de la
// page pour atteindre le module suivant. L'état plié/déplié de chaque module
// est mémorisé (localStorage) et restauré à la prochaine visite ; un bouton
// "Tout plier / Tout déplier" permet de basculer tous les modules d'un coup.
const CHAMPS_ENTREPRISE = [
  { key: 'entrepriseName', label: "Nom de l'entreprise" },
  { key: 'devise', label: 'Devise' },
  { key: 'stat', label: 'STAT' },
  { key: 'nif', label: 'NIF' },
  { key: 'adresse', label: 'Adresse / secteur' },
  { key: 'rib', label: 'RIB' },
  { key: 'telephone', label: 'Téléphone' },
  { key: 'email', label: 'E-mail' },
  { key: 'ville', label: 'Ville (pour « Fait à … »)' },
  { key: 'banqueNom', label: 'Nom de la banque' },
  { key: 'gerantNom', label: 'Nom du gérant' },
  { key: 'gerantTitre', label: 'Titre / fonction du gérant' }
];

const CLEF_REPLI = 'oli.parametres.sectionsRepliees';
function chargerEtatsReplies() {
  try { return JSON.parse(localStorage.getItem(CLEF_REPLI)) || {}; } catch { return {}; }
}
function sauverEtatRepli(id, replie) {
  const etats = chargerEtatsReplies();
  if (replie) etats[id] = true; else delete etats[id];
  try { localStorage.setItem(CLEF_REPLI, JSON.stringify(etats)); } catch { /* stockage indisponible : on continue sans mémorisation */ }
}

// Enveloppe un module de Paramètres dans une carte pliable/dépliable.
// `actionHtml` (optionnel) place un bouton dans l'en-tête (ex. "✏️
// Modifier") sans déclencher le pli/dépli au clic dessus.
function sectionCollapsible(id, title, sub, innerHtml, etats, actionHtml) {
  const replie = !!etats[id];
  return `<div class="card settings-section mt-16${replie ? ' collapsed' : ''}" data-section="${id}">
      <div class="settings-section-head" data-toggle="${id}">
        <div>
          <div class="kpi-label">${esc(title)}</div>
          ${sub ? `<div class="muted fs-12_5 mt-2">${esc(sub)}</div>` : ''}
        </div>
        <div class="flex items-center gap-8">
          ${actionHtml || ''}
          <button type="button" class="settings-section-chevron" title="Plier / déplier ce module">▾</button>
        </div>
      </div>
      <div class="settings-section-body">${innerHtml}</div>
    </div>`;
}

// Toujours utilisée pour Utilisateurs / Plan de comptes / Sauvegarde : leur
// contenu est rendu de façon asynchrone dans ce conteneur une fois la page
// affichée (voir renderUtilisateursSection & co. en bas de fichier).
function sectionCard(id, title, sub, etats) {
  return sectionCollapsible(id, title, sub, `<div id="${id}"></div>`, etats);
}

function attacherRepliage(main) {
  qsa('.settings-section-head', main).forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('.settings-section-action')) return; // ex. le bouton "Modifier" de la carte Entreprise
      const card = head.closest('.settings-section');
      const replie = card.classList.toggle('collapsed');
      sauverEtatRepli(card.dataset.section, replie);
      majLibelleToutBasculer(main);
    });
  });
}

function majLibelleToutBasculer(main) {
  const btn = qs('#btn-toggle-all-sections', main);
  if (!btn) return;
  const sections = qsa('.settings-section', main);
  const toutesRepliees = sections.length > 0 && sections.every((s) => s.classList.contains('collapsed'));
  btn.textContent = toutesRepliees ? 'Tout déplier' : 'Tout replier';
}

export async function renderParametres() {
  const main = qs('#main-content');
  const etats = chargerEtatsReplies();
  main.innerHTML = `<div class="topbar"><div><h2>Paramètres</h2><div class="sub">Entreprise, modèle de facture, utilisateurs, plan de comptes et sauvegarde</div></div>
      <button class="btn btn-ghost btn-sm settings-toggle-all" id="btn-toggle-all-sections" type="button">Tout replier</button>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="kpi-label mb-12">Logo</div>
        <div class="flex items-center gap-16">
          <img id="logo-preview" class="w-84 h-84 object-contain border-1px-solid-var-line radius-8 p-6" />
          <div>
            <input type="file" id="logo-file" accept="image/*" class="hidden" />
            <button class="btn btn-ghost btn-sm" id="btn-change-logo">Changer le logo</button>
            <button class="btn btn-primary btn-sm hidden" id="btn-save-logo">Enregistrer le logo</button>
            <div class="muted fs-11_5 mt-6">PNG ou JPG, idéalement carré.</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="kpi-label mb-12">Aperçu rapide</div>
        <div class="muted fs-13">Ces informations apparaissent en en-tête de chaque facture imprimée, ainsi que le nom du gérant en pied de page (mention « Le Fournisseur »).</div>
      </div>
    </div>
    ${sectionCollapsible('modele-document', 'Modèle de document', "S'applique uniformément aux factures, devis pro-forma et bons de livraison imprimés.", `
      <div class="flex gap-16 flex-wrap" id="modele-doc-choix">
        <button type="button" class="modele-doc-card" data-modele="classique">
          <div class="modele-doc-preview modele-doc-preview-classique">
            <div class="modele-doc-preview-line w-70p"></div>
            <div class="modele-doc-preview-line w-40p"></div>
            <div class="modele-doc-preview-table"></div>
          </div>
          <div class="modele-doc-name">Classique</div>
          <div class="muted fs-11_5">Sobre, en-tête STAT/NIF/RIB — le modèle actuel</div>
        </button>
        <button type="button" class="modele-doc-card" data-modele="moderne">
          <div class="modele-doc-preview modele-doc-preview-moderne">
            <div class="modele-doc-preview-band"></div>
            <div class="modele-doc-preview-line w-50p"></div>
            <div class="modele-doc-preview-table"></div>
          </div>
          <div class="modele-doc-name">Moderne</div>
          <div class="muted fs-11_5">Coloré, bloc « Destinataire » séparé</div>
        </button>
        <button type="button" class="modele-doc-card" data-modele="nomade">
          <div class="modele-doc-preview modele-doc-preview-nomade">
            <div class="modele-doc-preview-line w-60p"></div>
            <div class="modele-doc-preview-line w-40p"></div>
            <div class="modele-doc-preview-table"></div>
            <div class="modele-doc-preview-line w-30p ml-auto"></div>
          </div>
          <div class="modele-doc-name">Nomade</div>
          <div class="muted fs-11_5">Émetteur/Destinataire, détail TVA et remise</div>
        </button>
        <button type="button" class="modele-doc-card" data-modele="essentiel">
          <div class="modele-doc-preview modele-doc-preview-essentiel">
            <div class="modele-doc-preview-band-thin"></div>
            <div class="modele-doc-preview-line w-45p center"></div>
            <div class="modele-doc-preview-table"></div>
          </div>
          <div class="modele-doc-name">Essentiel</div>
          <div class="muted fs-11_5">Épuré, remise ligne par ligne, détail TVA</div>
        </button>
      </div>`, etats)}
    ${sectionCollapsible('entreprise', 'Entreprise', '', '<div id="entreprise-view"></div>', etats,
      '<button class="btn btn-ghost btn-sm settings-section-action" id="btn-edit-entreprise" type="button">✏️ Modifier</button>')}
    ${sectionCollapsible('fiscalite', 'Fiscalité', 'Activation et taux général de la TVA — s\'applique à toutes les ventes, achats et prestations.', `
      <div class="two-col">
        <div class="field">
          <label>Activer la TVA</label>
          <label class="fs-13_5"><input type="checkbox" id="tva-enabled" style="margin-right:8px;vertical-align:middle;" />Activée</label>
        </div>
        <div class="field">
          <label>Taux général de TVA (%)</label>
          <input id="tva-default-rate" type="number" min="0" max="100" step="0.1" />
        </div>
      </div>
      <div class="muted fs-11_5 mb-12" id="tva-off-note">TVA désactivée au niveau de l'entreprise : tous les montants sont calculés sans TVA (0%), même pour les produits ayant un taux spécifique.</div>
      <button class="btn btn-primary btn-sm" id="btn-save-tva" type="button">Enregistrer</button>`, etats)}
    ${sectionCard('utilisateurs-section', 'Utilisateurs', "Comptes et rôles d'accès", etats)}
    ${sectionCard('plancomptable-section', 'Plan de comptes', 'Correspondance PCG 2005 utilisée par l\'export comptable', etats)}
    ${sectionCard('sauvegarde-section', 'Sauvegarde', 'Sauvegarde locale et par email', etats)}`;

  attacherRepliage(main);
  majLibelleToutBasculer(main);
  qs('#btn-toggle-all-sections', main).addEventListener('click', () => {
    const sections = qsa('.settings-section', main);
    const toutesRepliees = sections.length > 0 && sections.every((s) => s.classList.contains('collapsed'));
    const cible = !toutesRepliees; // si pas encore toutes repliées, on les replie toutes ; sinon on les déplie toutes
    sections.forEach((s) => { s.classList.toggle('collapsed', cible); sauverEtatRepli(s.dataset.section, cible); });
    majLibelleToutBasculer(main);
  });

  let meta = await call('settings:get');

  // ------------------------- Logo -------------------------
  qs('#logo-preview').src = meta.logoDataUrl || '';
  let newLogoDataUrl = null;
  qs('#btn-change-logo').addEventListener('click', () => qs('#logo-file').click());
  qs('#logo-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      newLogoDataUrl = reader.result;
      qs('#logo-preview').src = newLogoDataUrl;
      qs('#btn-save-logo').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  qs('#btn-save-logo').addEventListener('click', async () => {
    if (!newLogoDataUrl) return;
    meta = await call('settings:update', { logoDataUrl: newLogoDataUrl }) || { ...meta, logoDataUrl: newLogoDataUrl };
    toast('Logo enregistré', 'success');
    newLogoDataUrl = null;
    qs('#btn-save-logo').classList.add('hidden');
  });

  // ------------------------- Modèle de document -------------------------
  let modeleChoisi = ['moderne', 'nomade', 'essentiel'].includes(meta.modeleDocument) ? meta.modeleDocument : 'classique';
  const majSelectionModele = () => {
    qsa('.modele-doc-card', main).forEach((btn) => btn.classList.toggle('active', btn.dataset.modele === modeleChoisi));
  };
  majSelectionModele();
  qsa('.modele-doc-card', main).forEach((btn) => {
    btn.addEventListener('click', async () => {
      modeleChoisi = btn.dataset.modele; majSelectionModele();
      await call('settings:update', { modeleDocument: modeleChoisi });
      toast('Modèle de document mis à jour', 'success');
    });
  });

  // ------------------------- Entreprise (affiche/cache pour modifier) -------------------------
  function afficherEntreprise() {
    const box = qs('#entreprise-view');
    box.innerHTML = `<div class="two-col">${CHAMPS_ENTREPRISE.map((c) => `
      <div class="field"><label>${esc(c.label)}</label><div class="fs-13_5">${esc(meta[c.key] || '') || '<span class="muted">— non renseigné —</span>'}</div></div>`).join('')}</div>`;
  }
  afficherEntreprise();

  qs('#btn-edit-entreprise').addEventListener('click', () => ouvrirModaleEntreprise());

  // ------------------------- Fiscalité (TVA) -------------------------
  function afficherFiscalite() {
    const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 20 };
    qs('#tva-enabled', main).checked = !!taxSettings.vatEnabled;
    qs('#tva-default-rate', main).value = taxSettings.defaultVatRate != null ? taxSettings.defaultVatRate : 20;
    // §10 : les champs ne sont pas supprimés/vidés quand la TVA est
    // désactivée (la configuration est conservée pour une réactivation
    // ultérieure — §9) — seul un message informatif s'affiche, et le champ
    // de taux général est visuellement désactivé (mais garde sa valeur).
    qs('#tva-off-note', main).classList.toggle('hidden', !!taxSettings.vatEnabled);
    qs('#tva-default-rate', main).disabled = !taxSettings.vatEnabled;
  }
  afficherFiscalite();
  qs('#tva-enabled', main).addEventListener('change', (e) => {
    qs('#tva-off-note', main).classList.toggle('hidden', e.target.checked);
    qs('#tva-default-rate', main).disabled = !e.target.checked;
  });
  qs('#btn-save-tva', main).addEventListener('click', async () => {
    const vatEnabled = qs('#tva-enabled', main).checked;
    const rateStr = qs('#tva-default-rate', main).value;
    const defaultVatRate = Number(rateStr);
    if (rateStr === '' || !Number.isFinite(defaultVatRate) || defaultVatRate < 0 || defaultVatRate > 100) {
      toast('Le taux général de TVA doit être un nombre compris entre 0 et 100', 'error');
      return;
    }
    try {
      meta = await call('settings:update', { taxSettings: { vatEnabled, defaultVatRate } }) || { ...meta, taxSettings: { vatEnabled, defaultVatRate } };
      toast('Paramètres de TVA enregistrés', 'success');
      afficherFiscalite();
    } catch (err) {
      toast(err.message || 'Erreur lors de l\'enregistrement de la TVA', 'error');
    }
  });

  function ouvrirModaleEntreprise() {
    const body = h(`<div>
      <div class="two-col">
        <div class="field"><label>Nom de l'entreprise</label><input id="p-nom" value="${esc(meta.entrepriseName || '')}" /></div>
        <div class="field"><label>Devise</label><input id="p-devise" value="${esc(meta.devise || 'Ar')}" /></div>
      </div>
      <div class="two-col">
        <div class="field"><label>STAT</label><input id="p-stat" value="${esc(meta.stat || '')}" /></div>
        <div class="field"><label>NIF</label><input id="p-nif" value="${esc(meta.nif || '')}" /></div>
      </div>
      <div class="field"><label>Adresse / secteur</label><input id="p-adresse" value="${esc(meta.adresse || '')}" /></div>
      <div class="two-col">
        <div class="field"><label>RIB</label><input id="p-rib" value="${esc(meta.rib || '')}" /></div>
        <div class="field"><label>Téléphone</label><input id="p-tel" value="${esc(meta.telephone || '')}" /></div>
      </div>
      <div class="two-col">
        <div class="field"><label>E-mail</label><input id="p-email" value="${esc(meta.email || '')}" /></div>
        <div class="field"><label>Ville (pour « Fait à … »)</label><input id="p-ville" value="${esc(meta.ville || '')}" /></div>
      </div>
      <div class="field"><label>Nom de la banque</label><input id="p-banque" placeholder="Ex. Rimberio" value="${esc(meta.banqueNom || '')}" /></div>
      <div class="muted fs-11_5 mb-12">L'activation et le taux de TVA se gèrent désormais dans la section « Fiscalité » ci-dessous.</div>
      <div class="hr"></div>
      <div class="kpi-label mb-12">Signataire (« Le Fournisseur »)</div>
      <div class="two-col">
        <div class="field"><label>Nom du gérant</label><input id="p-gerant-nom" value="${esc(meta.gerantNom || '')}" /></div>
        <div class="field"><label>Titre / fonction</label><input id="p-gerant-titre" value="${esc(meta.gerantTitre || '')}" /></div>
      </div>
    </div>`);
    openModal("Modifier les informations de l'entreprise", body, [
      { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
      { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
        const patch = {
          entrepriseName: qs('#p-nom', body).value.trim(), devise: qs('#p-devise', body).value.trim() || 'Ar',
          stat: qs('#p-stat', body).value.trim(), nif: qs('#p-nif', body).value.trim(), adresse: qs('#p-adresse', body).value.trim(),
          rib: qs('#p-rib', body).value.trim(), telephone: qs('#p-tel', body).value.trim(), email: qs('#p-email', body).value.trim(),
          ville: qs('#p-ville', body).value.trim(), gerantNom: qs('#p-gerant-nom', body).value.trim(), gerantTitre: qs('#p-gerant-titre', body).value.trim(),
          banqueNom: qs('#p-banque', body).value.trim()
        };
        meta = await call('settings:update', patch) || { ...meta, ...patch };
        toast('Informations de l\'entreprise enregistrées', 'success');
        closeModal();
        afficherEntreprise();
      } }
    ]);
  }

  // ------------------------- Sections déplacées (Utilisateurs / Plan de comptes / Sauvegarde) -------------------------
  await renderUtilisateursSection(qs('#utilisateurs-section'));
  await renderPlanComptableSection(qs('#plancomptable-section'));
  await renderSauvegardeSection(qs('#sauvegarde-section'));
}
