import { bindClientField, clientFieldHtml, getClientPayload, setClientFieldValue } from '../components/clientField.js';
import { creerEditeurLignes } from '../components/editorLignes.js';
import { printProforma } from '../components/invoice.js';
import { closeModal, confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { CURRENCY } from '../utils/constants.js';
import { clientLabel, dateFr, esc, h, money, qs, qsa, sectionTitleHtml } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderProformas() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Factures pro-forma</h2><div class="sub">Devis — sans impact sur le stock ni la trésorerie tant qu'ils ne sont pas validés</div></div>
    <button class="btn btn-primary" id="btn-new-proforma">+ Nouvelle facture pro-forma</button></div>
    <div class="toolbar">
      <div class="toolbar-actions">
        <input id="pf-search" placeholder="Rechercher par numéro, client..." class="p-9-12 border-1px-solid-var-line radius-8 minw-260" />
      </div>
    </div>
    <div class="card" id="pf-table-wrap">Chargement…</div>`;
  const [proformas, clients, produits, services, meta] = await Promise.all([call('proformas:list'), call('clients:list'), call('produits:list'), call('services:list'), call('settings:get')]);
  const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 0 };
  const wrap = qs('#pf-table-wrap');

  function draw(list) {
    if (!list.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">≣</div>Aucune facture pro-forma enregistrée.</div>`; return; }
    wrap.innerHTML = `<table><thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Objet</th><th>Total</th><th>Statut</th><th></th></tr></thead>
      <tbody>${list.map((pf) => `<tr data-id="${pf.id}"><td>${esc(pf.numero)}</td><td>${dateFr(pf.createdAt)}</td><td>${esc(clientLabel(pf, clients))}</td>
        <td class="muted maxw-220 overflow-hidden text-ellipsis nowrap">${esc(pf.objet) || '—'}</td>
        <td>${money(pf.total)}</td>
        <td>${pf.statut === 'validee' ? `<span class="stamp stamp-payee">Validée${pf.venteNumero ? ' → ' + esc(pf.venteNumero) : ''}</span>` : '<span class="stamp stamp-attente">Brouillon</span>'}</td>
        <td class="text-right nowrap">
          <button class="btn btn-ghost btn-sm act-print">Imprimer</button>
          ${pf.statut !== 'validee' ? '<button class="btn btn-ghost btn-sm act-edit">Modifier</button>' : ''}
          ${pf.statut !== 'validee' ? '<button class="btn btn-ghost btn-sm act-client">Client</button>' : ''}
          ${pf.statut !== 'validee' ? '<button class="btn btn-primary btn-sm act-valider">Valider</button>' : ''}
          ${pf.statut !== 'validee' ? '<button class="btn btn-danger btn-sm act-delete">Suppr.</button>' : ''}
        </td></tr>`).join('')}</tbody></table>`;
    qsa('.act-print', wrap).forEach((btn) => btn.addEventListener('click', (e) => printProforma(proformas.find((pf) => pf.id === e.target.closest('tr').dataset.id), clients)));
    qsa('.act-edit', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      openProformaEditForm(proformas.find((pf) => pf.id === id), clients, produits, services, taxSettings);
    }));
    qsa('.act-client', wrap).forEach((btn) => btn.addEventListener('click', (e) => openModifierClientProforma(proformas.find((pf) => pf.id === e.target.closest('tr').dataset.id), clients)));
    qsa('.act-valider', wrap).forEach((btn) => btn.addEventListener('click', (e) => openValiderProforma(proformas.find((pf) => pf.id === e.target.closest('tr').dataset.id))));
    qsa('.act-delete', wrap).forEach((btn) => btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      confirmDialog('Supprimer cette facture pro-forma ? Elle n\'a aucun impact comptable, la suppression est donc sans risque.', async () => { await call('proformas:supprimer', { id }); toast('Facture pro-forma supprimée', 'success'); renderProformas(); });
    }));
  }

  // Recherche par numéro
  qs('#pf-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    draw(proformas.filter(pf => 
      pf.numero.toLowerCase().includes(q) ||
      clientLabel(pf, clients).toLowerCase().includes(q) ||
      (pf.objet || '').toLowerCase().includes(q)
    ));
  });

  draw(proformas);
  qs('#btn-new-proforma').addEventListener('click', () => openProformaForm(clients, produits, services, taxSettings));
}

// Nouvelle fonction : Formulaire d'édition d'une proforma
export function openProformaEditForm(proforma, clients, produits, services, taxSettings) {
  const body = h(`<div>
    <div class="field"><label>Numéro de proforma</label><input id="f-numero" value="${esc(proforma.numero)}" placeholder="Ex: 001-0126" /></div>
    <div class="form-section">
      ${sectionTitleHtml('personne', 1, 'Client')}
      ${clientFieldHtml(clients, { hideLabel: true, evenTabs: true })}
    </div>
    <div class="form-section">
      ${sectionTitleHtml('message', 2, 'Objet', 'optionnel')}
      <div class="field"><input id="f-objet" value="${esc(proforma.objet)}" placeholder="Ex. Prestation de service pour multiplication des documents" /></div>
    </div>
    <div class="form-section">
      ${sectionTitleHtml('carte', 3, 'Terme de paiement')}
      <div class="field"><select id="f-mode">
        <option value="especes" ${proforma.modePaiement === 'especes' ? 'selected' : ''}>Espèces</option>
        <option value="mobile_money" ${proforma.modePaiement === 'mobile_money' ? 'selected' : ''}>Mobile Money</option>
        <option value="carte" ${proforma.modePaiement === 'carte' ? 'selected' : ''}>Carte bancaire</option>
        <option value="virement" ${proforma.modePaiement === 'virement' ? 'selected' : ''}>Virement</option>
        <option value="mixte" ${proforma.modePaiement === 'mixte' ? 'selected' : ''}>Paiement mixte</option>
      </select></div>
    </div>
    <div class="form-section">
      ${sectionTitleHtml('panier', 4, 'Articles', 'produits et/ou services')}
      <div class="toolbar-actions mb-8">
        <button class="btn btn-ghost btn-sm" id="add-produit" type="button">+ Ajouter un produit</button>
        <button class="btn btn-ghost btn-sm" id="add-service" type="button">+ Ajouter un service</button>
      </div>
      <div class="lignes-scroll">
        <div class="lignes-header"><span></span><span>Article</span><span>Quantité</span><span>Prix unitaire</span><span>Remise %</span><span>Total</span><span></span></div>
        <div id="lignes-container"></div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="form-section">
      ${sectionTitleHtml('calculatrice', 5, 'Total')}
      <div class="total-card"><input id="f-total-display" disabled value="${money(proforma.total)}" class="kpi-value-input" /></div>
      <p class="form-note">Ce document est un devis : aucun impact sur le stock ni sur la trésorerie tant qu'il n'est pas validé.</p>
    </div>
  </div>`);

  // Initialiser l'éditeur de lignes sans ligne vide par défaut (on va y injecter
  // les lignes existantes explicitement juste après).
  const editeur = creerEditeurLignes(body, produits, services, { autoAddEmpty: false, taxSettings });

  // BUGFIX : les lignes existantes étaient auparavant construites "à la main" avec un
  // <select class="l-item"> — un composant totalement différent de celui attendu par
  // editeur.getItems() (qui cherche `.combobox-hidden` / `.combobox-input`). Résultat :
  // au clic sur "Enregistrer", la lecture de la 1ère ligne existante plantait
  // (élément introuvable), et la modification ne pouvait jamais être enregistrée.
  // On réutilise maintenant editeur.addLigne(), le même composant que pour une ligne
  // neuve, pré-rempli avec les données de la ligne existante.
  const container = qs('#lignes-container', body);
  container.innerHTML = '';
  proforma.lignes.forEach((l) => {
    const kind = l.kind || 'produit';
    editeur.addLigne(kind, {
      produitId: l.produitId,
      serviceId: l.serviceId,
      quantite: l.quantite,
      remise: l.remise,
      prixUnitaire: l.prixUnitaire,
      details: l.details
    });
  });
  if (!proforma.lignes.length) {
    if (produits.length) editeur.addLigne('produit');
    else if (services.length) editeur.addLigne('service');
  }
  
  // Pré-sélectionner le mode client
  bindClientField(body, clients);
  const btns = qsa('.client-mode-btn', body);
  btns.forEach((b) => b.classList.remove('active'));
  if (proforma.clientId) {
    qs('.client-mode-btn[data-mode="enregistre"]', body).classList.add('active');
    qs('#f-client-enregistre-wrap', body).style.display = 'flex';
    setClientFieldValue(body, proforma.clientId, clients);
  } else if (proforma.clientNom) {
    qs('.client-mode-btn[data-mode="manuel"]', body).classList.add('active');
    // CORRECTIF : #f-client-manuel n'existe pas (voir ventes.js pour le même
    // correctif) — on cible le vrai conteneur et le vrai champ de saisie.
    qs('#f-client-manuel-wrap', body).style.display = 'block';
    qs('#f-client-manuel-nom', body).value = proforma.clientNom;
  } else {
    qs('.client-mode-btn[data-mode="comptoir"]', body).classList.add('active');
  }

  openModal('Modifier la facture pro-forma', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      let items;
      try { items = editeur.getItems(); } catch (err) { toast(err.message, 'error'); return; }
      if (!items.length) { toast('Ajoutez au moins un article', 'error'); return; }
      const clientPayload = getClientPayload(body);
      const payload = {
        numero: qs('#f-numero', body).value.trim(),
        modePaiement: qs('#f-mode', body).value,
        objet: qs('#f-objet', body).value.trim(),
        items,
        ...clientPayload
      };
      await call('proformas:update', { id: proforma.id, ...payload });
      toast('Facture pro-forma mise à jour', 'success'); closeModal(); renderProformas();
    } }
  ], { wide: true });
}

export function openProformaForm(clients, produits, services, taxSettings) {
  const body = h(`<div>
    <div class="form-section">
      ${sectionTitleHtml('personne', 1, 'Client')}
      ${clientFieldHtml(clients, { hideLabel: true, evenTabs: true })}
    </div>
    <div class="form-section">
      ${sectionTitleHtml('message', 2, 'Objet', 'optionnel')}
      <div class="field"><input id="f-objet" placeholder="Ex. Prestation de service pour multiplication des documents" /></div>
    </div>
    <div class="form-section">
      ${sectionTitleHtml('carte', 3, 'Terme de paiement')}
      <div class="field"><select id="f-mode"><option value="especes">Espèces</option><option value="mobile_money">Mobile Money</option><option value="carte">Carte bancaire</option><option value="virement">Virement</option><option value="mixte">Paiement mixte</option></select></div>
    </div>
    <div class="form-section">
      ${sectionTitleHtml('panier', 4, 'Articles', 'produits et/ou services')}
      <div class="toolbar-actions mb-8">
        <button class="btn btn-ghost btn-sm" id="add-produit" type="button">+ Ajouter un produit</button>
        <button class="btn btn-ghost btn-sm" id="add-service" type="button">+ Ajouter un service</button>
      </div>
      <div class="lignes-scroll">
        <div class="lignes-header"><span></span><span>Article</span><span>Quantité</span><span>Prix unitaire</span><span>Remise %</span><span>Total</span><span></span></div>
        <div id="lignes-container"></div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="form-section">
      ${sectionTitleHtml('calculatrice', 5, 'Total')}
      <div class="total-card"><input id="f-total-display" disabled value="0 ${CURRENCY}" class="kpi-value-input" /></div>
      <p class="form-note">Ce document est un devis : aucun impact sur le stock ni sur la trésorerie tant qu'il n'est pas validé (bouton "Valider" dans la liste).</p>
    </div>
  </div>`);
  const editeur = creerEditeurLignes(body, produits, services, { taxSettings });
  bindClientField(body, clients);

  openModal('Nouvelle facture pro-forma', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer le devis', cls: 'btn-primary', onClick: async () => {
      let items;
      try { items = editeur.getItems(); } catch (err) { toast(err.message, 'error'); return; }
      if (!items.length) { toast('Ajoutez au moins un article', 'error'); return; }
      const clientPayload = getClientPayload(body);
      const payload = Object.assign({ modePaiement: qs('#f-mode', body).value, objet: qs('#f-objet', body).value.trim(), items }, clientPayload);
      await call('proformas:create', payload);
      toast('Facture pro-forma enregistrée', 'success'); closeModal(); renderProformas();
    } }
  ], { wide: true });
}

export function openModifierClientProforma(proforma, clients) {
  const body = h(`<div>${clientFieldHtml(clients)}</div>`);
  bindClientField(body, clients);
  const btns = qsa('.client-mode-btn', body);
  btns.forEach((b) => b.classList.remove('active'));
  if (proforma.clientId) {
    qs('.client-mode-btn[data-mode="enregistre"]', body).classList.add('active');
    qs('#f-client-enregistre-wrap', body).style.display = 'flex';
    setClientFieldValue(body, proforma.clientId, clients);
  } else if (proforma.clientNom) {
    qs('.client-mode-btn[data-mode="manuel"]', body).classList.add('active');
    // CORRECTIF : #f-client-manuel n'existe pas (voir plus haut) — on cible
    // le vrai conteneur et le vrai champ de saisie.
    qs('#f-client-manuel-wrap', body).style.display = 'block';
    qs('#f-client-manuel-nom', body).value = proforma.clientNom;
  } else {
    qs('.client-mode-btn[data-mode="comptoir"]', body).classList.add('active');
  }
  openModal('Modifier le client — ' + proforma.numero, body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      await call('proformas:modifierClient', { id: proforma.id, ...getClientPayload(body) });
      toast('Client mis à jour', 'success'); closeModal(); renderProformas();
    } }
  ]);
}

export function openValiderProforma(proforma) {
  const body = h(`<div>
    <p class="mb-14">Cette facture pro-forma (<strong>${esc(proforma.numero)}</strong>, ${money(proforma.total)}) va être intégrée
    comme <strong>vente réelle</strong> : le stock des produits sera décrémenté et l'écriture correspondante sera créée en trésorerie.</p>
    <div class="field"><label>Le client règle-t-il maintenant ?</label>
      <select id="f-solde">
        <option value="total">Oui — solde payé en totalité</option>
        <option value="partiel">Paiement partiel</option>
        <option value="aucun">Non — rien payé pour l'instant (facture en attente)</option>
      </select>
    </div>
    <div class="field hidden" id="wrap-montant"><label>Montant réglé maintenant</label><input type="number" id="f-montant" value="0" min="0" max="${proforma.total}" step="any" /></div>
    <div class="field"><label>Mode de paiement</label><select id="f-mode-paiement"><option value="especes">Espèces</option><option value="mobile_money">Mobile Money</option><option value="carte">Carte bancaire</option><option value="virement">Virement</option><option value="mixte">Paiement mixte</option></select></div>
  </div>`);
  qs('#f-mode-paiement', body).value = proforma.modePaiement || 'especes';
  qs('#f-solde', body).addEventListener('change', (e) => {
    qs('#wrap-montant', body).style.display = e.target.value === 'partiel' ? 'block' : 'none';
  });
  openModal('Valider la facture pro-forma', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Valider et intégrer', cls: 'btn-primary', onClick: async () => {
      const choix = qs('#f-solde', body).value;
      let montantPaye = choix === 'total' ? proforma.total : (choix === 'aucun' ? 0 : Number(qs('#f-montant', body).value) || 0);
      // Le serveur revalide et rejette de toute façon un montant hors bornes
      // (voir vente.service.js#finaliserVente) ; ce contrôle côté client
      // évite juste un aller-retour inutile pour une erreur de saisie.
      if (choix === 'partiel' && (montantPaye < 0 || montantPaye > proforma.total)) {
        toast('Le montant réglé doit être compris entre 0 et ' + money(proforma.total), 'error');
        return;
      }
      await call('proformas:valider', { id: proforma.id, montantPaye, modePaiement: qs('#f-mode-paiement', body).value });
      toast('Facture pro-forma validée et intégrée comme vente', 'success'); closeModal(); renderProformas();
    } }
  ]);
}

