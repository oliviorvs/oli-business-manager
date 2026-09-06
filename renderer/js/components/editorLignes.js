import { createCombobox } from './combobox.js';
import { closeModal2, openModal2 } from './modal.js';
import { toast } from './toast.js';
import { isReadOnlyModeActive } from '../modules/auth.js';
import { CURRENCY, ICONS } from '../utils/constants.js';
import { money, qs, qsa } from '../utils/helpers.js';

export function creerEditeurLignes(body, produits, services, options) {
  const opts = options || {};
  const autoAddEmpty = opts.autoAddEmpty !== false;
  // SYSTÈME TVA : réplique minimale, côté aperçu, de
  // taxService.js#getEffectiveVatRate — UNIQUEMENT pour donner au caissier
  // un aperçu TTC réaliste PENDANT LA SAISIE (avant tout enregistrement).
  // Le calcul qui compte réellement (celui qui est stocké, imprimé et
  // comptabilisé) reste exclusivement fait côté serveur par
  // src/services/taxService.js au moment de l'enregistrement — cet aperçu
  // n'a aucune autorité et un léger écart d'arrondi entre les deux ne
  // remettrait pas en cause le montant réellement dû.
  const taxSettings = opts.taxSettings || { vatEnabled: false, defaultVatRate: 0 };
  function tauxEffectifApercu(kind, id) {
    if (!taxSettings.vatEnabled) return 0;
    const liste = kind === 'produit' ? produits : services;
    const entite = liste.find((x) => x.id === id);
    if (entite && entite.vat && entite.vat.mode === 'custom' && entite.vat.rate != null) return Number(entite.vat.rate) || 0;
    return Number(taxSettings.defaultVatRate) || 0;
  }
  const container = qs('#lignes-container', body);
  if (!container) {
    console.error('Container #lignes-container introuvable');
    return { addLigne: () => {}, recalcTotal: () => {}, getItems: () => [] };
  }

  // Recalcul du total
  function recalcTotal() {
    let total = 0;
    qsa('.line-item', body).forEach((row) => {
      const kind = row.dataset.kind;
      const hiddenId = qs('.combobox-hidden', row);
      const qte = Number(qs('.l-qte', row).value) || 0;
      const remise = Number(qs('.l-remise', row).value) || 0;
      let prix = 0;
      if (kind === 'produit') {
        // BUGFIX : le prix était auparavant relu depuis l'ancien <datalist> (disparu).
        // On le retrouve désormais directement dans la liste des produits chargés.
        const produit = produits.find((p) => p.id === hiddenId.value);
        prix = produit ? produit.prixVente : 0;
        const prixDisplay = qs('.l-prix-produit', row);
        if (prixDisplay) prixDisplay.value = prix ? money(prix) : '';
      } else {
        const prixInput = qs('.l-prix-service', row);
        prix = prixInput ? Number(prixInput.value) || 0 : 0;
      }
      const ht = qte * prix * (1 - remise / 100);
      // SYSTÈME TVA : aperçu TTC (voir tauxEffectifApercu ci-dessus) — le
      // prix saisi/catalogue est HT (§1/§6), la TVA est ajoutée par-dessus
      // pour donner au caissier le montant réellement dû sur cette ligne.
      const taux = tauxEffectifApercu(kind, hiddenId ? hiddenId.value : null);
      const st = Math.round((ht + ht * taux / 100) * 100) / 100;
      const sousTotal = qs('.l-sous-total', row);
      if (sousTotal) sousTotal.textContent = money(st) + (taux > 0 ? ` (TTC, TVA ${taux}%)` : '');
      total += st;
    });
    const totalDisplay = qs('#f-total-display', body);
    if (totalDisplay) totalDisplay.value = money(total);
    const payeInput = qs('#f-paye', body);
    if (payeInput) {
      // CORRECTIF : limite la saisie du montant payé au total de la vente
      // (voir aussi le contrôle serveur dans vente.service.js#create) — évite
      // de laisser l'utilisateur saisir/incrémenter un montant supérieur au
      // total avant même l'enregistrement.
      payeInput.max = Math.round(total * 100) / 100;
      payeInput.min = 0;
      payeInput.value = Math.round(total * 100) / 100;
    }
    return total;
  }

  // Renumérote la colonne "#" de chaque ligne (après ajout/suppression).
  function renumeroterLignes() {
    qsa('.line-num', container).forEach((el, i) => { el.textContent = String(i + 1); });
  }

  // Ajout d'une ligne (produit ou service). "existing" (optionnel) permet de pré-remplir
  // une ligne déjà existante (mode édition : facture pro-forma par exemple).
  function addLigne(kind, existing) {
    const isProduit = kind === 'produit';
    const options = isProduit
      ? produits.map(p => ({ id: p.id, label: p.designation + ' (stock: ' + p.quantite + ')', prix: p.prixVente }))
      : services.filter(s => s.actif !== false).map(s => ({ id: s.id, label: s.nom + ' (' + (s.prixDefaut || 0) + ' Ar)', prix: s.prixDefaut }));

    const existingId = existing ? (isProduit ? existing.produitId : existing.serviceId) : null;
    const combobox = createCombobox(options, existingId, isProduit ? 'Rechercher un produit...' : 'Rechercher un service...');
    const input = combobox.querySelector('.combobox-input');
    const hiddenId = combobox.querySelector('.combobox-hidden');

    const row = document.createElement('div');
    row.className = 'line-item';
    row.dataset.kind = kind;

    const qte = existing && existing.quantite != null ? existing.quantite : 1;
    // BUGFIX CRITIQUE : la ligne était auparavant construite en sérialisant le
    // combobox en HTML (`combobox.outerHTML`) puis en le réinjectant via
    // `row.innerHTML = html`. Cette opération RECRÉE des nœuds DOM tout neufs à
    // partir du texte HTML — tous les écouteurs déjà posés sur le combobox
    // d'origine (ouverture/fermeture de la liste, filtrage par la saisie,
    // sélection d'une option au clic) étaient donc perdus : la recherche et
    // l'ajout de produit/service ne fonctionnaient plus après l'insertion dans
    // la page. On construit maintenant la ligne avec un simple emplacement vide
    // pour le combobox, puis on y rattache le VRAI nœud (déjà « vivant », avec
    // ses écouteurs) via appendChild — rien n'est jamais recréé depuis du texte.
    let html = `<span class="line-num">•</span>`;
    // BUGFIX/UX : la ligne "Détails (optionnel)" était auparavant un champ
    // totalement séparé, ajouté en pleine largeur de la fenêtre (aucun lien
    // visuel avec sa ligne). Elle est désormais imbriquée dans la même cellule
    // que le champ de recherche (article-cell, en colonne) : comme les deux
    // s'étirent naturellement à la largeur de leur parent commun, "Détails"
    // fait toujours exactement la même largeur que le champ de recherche,
    // juste en dessous.
    html += `<div class="article-cell">
      <div class="article-search-row"></div>
      <input type="text" class="l-details" placeholder="Détails (optionnel)" />
    </div>`;
    html += `<div class="qte-stepper"><button type="button" class="qte-btn qte-dec" tabindex="-1" title="Diminuer la quantité">−</button><input type="number" class="l-qte" value="${qte}" min="1" placeholder="Qté" /><button type="button" class="qte-btn qte-inc" tabindex="-1" title="Augmenter la quantité">+</button></div>`;
    if (isProduit) {
      html += `<input type="text" class="l-prix-produit muted" placeholder="Prix U." disabled />`;
      html += `<input type="number" class="l-remise" value="${existing && existing.remise != null ? existing.remise : 0}" placeholder="Remise %" />`;
    } else {
      html += `<input type="number" class="l-prix-service" placeholder="Prix U." value="${existing && existing.prixUnitaire != null ? existing.prixUnitaire : ''}" />`;
      html += `<input type="number" class="l-remise" value="${existing && existing.remise != null ? existing.remise : 0}" placeholder="Remise %" />`;
    }
    html += `<span class="l-sous-total muted">0 ${CURRENCY}</span>`;
    html += `<button class="btn btn-sm line-item-delete" type="button" title="Supprimer la ligne">${ICONS.poubelle}</button>`;
    row.innerHTML = html;
    // Rattache le combobox réellement instancié (avec ses écouteurs intacts) à
    // l'emplacement prévu — voir le commentaire plus haut sur l'ancien bug outerHTML.
    const searchRow = row.querySelector('.article-search-row');
    searchRow.appendChild(combobox);
    const detailsInput = row.querySelector('.l-details');
    detailsInput.value = existing && existing.details ? existing.details : '';

    // Récupérer les éléments
    const qteInput = row.querySelector('.l-qte');
    const remiseInput = row.querySelector('.l-remise');
    const deleteBtn = row.querySelector('.line-item-delete');
    const prixServiceInput = row.querySelector('.l-prix-service');
    const qteDec = row.querySelector('.qte-dec');
    const qteInc = row.querySelector('.qte-inc');

    // Mode « Lecture seule » (caissier) : les champs sensibles — prix de
    // vente d'un service et remise — sont grisés et non modifiables. La
    // quantité et le choix de l'article restent actionnables.
    if (isReadOnlyModeActive()) {
      remiseInput.disabled = true;
      remiseInput.classList.add('field-readonly-locked');
      if (prixServiceInput) { prixServiceInput.disabled = true; prixServiceInput.classList.add('field-readonly-locked'); }
    }

    // Événements
    qteInput.addEventListener('input', recalcTotal);
    remiseInput.addEventListener('input', recalcTotal);
    if (prixServiceInput) prixServiceInput.addEventListener('input', recalcTotal);
    // UX : à la sélection d'un service, on pré-remplit le prix unitaire avec
    // le tarif par défaut du catalogue (comme dans le formulaire de
    // prestation autonome) — sans écraser un prix déjà saisi manuellement,
    // pour ne pas perdre la saisie de l'utilisateur s'il change ensuite de
    // service dans la même ligne. Le champ reste modifiable : voir
    // vente.service.js#construireLignesVente pour la résolution finale
    // (prix saisi si renseigné, sinon prix par défaut si laissé vide).
    if (prixServiceInput) {
      input.addEventListener('change', () => {
        if (prixServiceInput.value.trim() === '') {
          const svc = services.find((s) => s.id === hiddenId.value);
          if (svc) { prixServiceInput.value = svc.prixDefaut; recalcTotal(); }
        }
      });
    }
    input.addEventListener('change', recalcTotal); // changement de sélection (voir createCombobox)
    qteDec.addEventListener('click', () => {
      const v = Math.max(1, (Number(qteInput.value) || 1) - 1);
      qteInput.value = v;
      recalcTotal();
    });
    qteInc.addEventListener('click', () => {
      qteInput.value = (Number(qteInput.value) || 0) + 1;
      recalcTotal();
    });
    deleteBtn.addEventListener('click', () => {
      row.remove();
      renumeroterLignes();
      recalcTotal();
    });

    // UX : le bouton de création à la volée était auparavant un texte "➕ Nouveau"
    // placé après le combobox, dans une rangée qui pouvait passer à la ligne du
    // dessous (flex-wrap) — peu visible, donnant l'impression qu'"ajouter un
    // service" n'était pas vraiment pris en charge dans le formulaire. Il est
    // maintenant un bouton "+" compact collé directement à droite du champ de
    // recherche, toujours sur la même ligne : seul moyen légitime d'ajouter un
    // produit/service inconnu (empêche la création silencieuse de doublons).
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn-add-inline';
    newBtn.textContent = '+';
    newBtn.title = 'Créer un nouveau ' + (isProduit ? 'produit' : 'service');
    searchRow.appendChild(newBtn);

    newBtn.addEventListener('click', () => {
      const miniBody = document.createElement('div');
      miniBody.innerHTML = `
        <div class="field"><label>Nom</label><input id="new-item-name" /></div>
        <div class="field"><label>Prix</label><input type="number" id="new-item-price" /></div>
        ${isProduit ? `<div class="field"><label>Unité</label><input id="new-item-unite" value="Unité" /></div>` : ''}
      `;
      openModal2('Nouvel ' + (isProduit ? 'produit' : 'service'), miniBody, [
        { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal2 },
        { label: 'Créer', cls: 'btn-primary', onClick: () => {
          const nom = qs('#new-item-name', miniBody).value.trim();
          if (!nom) { toast('Nom requis', 'error'); return; }
          const prix = Number(qs('#new-item-price', miniBody).value) || 0;
          const unite = isProduit ? (qs('#new-item-unite', miniBody).value.trim() || 'Unité') : 'Prestation';
          // CORRECTIF (audit — nouvelle passe, bug n°4) : ce bouton appelait
          // auparavant produits:create/services:create IMMÉDIATEMENT au clic
          // sur "Créer" — la fiche était donc persistée en base tout de suite,
          // avant même que le formulaire parent (vente/devis) soit soumis. Si
          // l'utilisateur annulait ensuite le formulaire parent, la fiche
          // restait en base, orpheline (fantôme), sans qu'aucune vente/devis
          // ne la référence jamais — particulièrement gênant pour les
          // produits/services (fiche catalogue avec éventuel stock initial,
          // bloquant toute recréation ultérieure du "même" article sous ce nom).
          // On construit désormais une entrée LOCALE provisoire (jamais
          // envoyée au serveur à ce stade, id préfixé "local:") et on marque
          // la ligne `nouveau: true` (voir getItems() plus bas). La création
          // réelle en base est entièrement déléguée au serveur au moment de la
          // soumission du formulaire, via le mécanisme `nouveau`/`provisoire`
          // déjà implémenté côté backend (vente.service.js#construireLignesVente,
          // proforma.service.js) : pour une vente directe, l'article est créé
          // de façon permanente seulement si la vente est réellement
          // enregistrée ; pour un devis, il est créé `provisoire: true` et
          // nettoyé automatiquement si le devis est annulé sans validation.
          const localId = 'local:' + Date.now().toString(36) + Math.random().toString(36).slice(2);
          const pseudo = isProduit
            ? { id: localId, designation: nom, prixVente: prix, unite, quantite: 0, __nouveau: true }
            : { id: localId, nom, prixDefaut: prix, unite, actif: true, __nouveau: true };
          (isProduit ? produits : services).push(pseudo);
          const label = isProduit ? nom + ' (nouveau)' : nom + ' (' + prix + ' Ar, nouveau)';
          options.push({ id: localId, label, prix });
          input.value = label;
          hiddenId.value = localId;
          closeModal2();
          toast('Ajouté — sera créé à l\'enregistrement du formulaire', 'success');
          recalcTotal();
        }}
      ]);
    });

    container.appendChild(row);
    renumeroterLignes();
    recalcTotal();
  }

  // Récupération des données saisies.
  // BUGFIX SÉCURITÉ : auparavant, toute ligne dont le texte tapé ne correspondait pas
  // EXACTEMENT à une option existante était silencieusement enregistrée comme un
  // "nouveau" produit/service — créant un doublon à chaque faute de frappe, casse
  // différente, ou simple oubli de sélectionner dans la liste. Désormais, seule une
  // sélection explicite (clic dans la liste déroulante, ou bouton « ➕ Nouveau », qui
  // renseigne lui-même un id réel) est acceptée ; toute ligne non résolue bloque
  // l'enregistrement avec un message clair plutôt que de polluer la base de données.
  function getItems() {
    const items = [];
    const erreurs = [];
    qsa('.line-item', body).forEach((row, index) => {
      const kind = row.dataset.kind;
      const hiddenId = qs('.combobox-hidden', row);
      const input = qs('.combobox-input', row);
      const qte = Number(qs('.l-qte', row).value) || 0;
      const remise = Number(qs('.l-remise', row).value) || 0;
      const detailsInput = qs('.l-details', row);
      const details = detailsInput ? detailsInput.value : '';
      const id = hiddenId ? hiddenId.value : '';
      const texteSaisi = input ? input.value.trim() : '';

      if (!id) {
        if (texteSaisi || qte) {
          erreurs.push(`Ligne ${index + 1} : sélectionnez un ${kind === 'produit' ? 'produit' : 'service'} dans la liste, ou utilisez « ➕ Nouveau »`);
        }
        return;
      }
      // CORRECTIF (audit — nouvelle passe, bug n°4) : une ligne créée via le
      // bouton « + Nouveau » porte un id local provisoire (préfixe "local:",
      // jamais persisté en base — voir plus haut). On la traduit ici en item
      // `nouveau: true`, résolu et persisté uniquement par le serveur au
      // moment de l'enregistrement (vente.service.js#construireLignesVente).
      const pseudo = (kind === 'produit' ? produits : services).find((x) => x.id === id && x.__nouveau);
      if (pseudo) {
        if (kind === 'produit') {
          items.push({ kind, nouveau: true, nom: pseudo.designation, unite: pseudo.unite, prix: pseudo.prixVente, quantite: qte, remise, details });
        } else {
          const prixInput = qs('.l-prix-service', row);
          const rawPrix = prixInput ? prixInput.value.trim() : '';
          const item = { kind, nouveau: true, nom: pseudo.nom, unite: pseudo.unite, prix: pseudo.prixDefaut, quantite: qte, remise, details };
          if (rawPrix !== '') item.prixUnitaire = Number(rawPrix);
          items.push(item);
        }
        return;
      }
      if (kind === 'produit') {
        items.push({ kind, produitId: id, quantite: qte, remise, details });
      } else {
        const prixInput = qs('.l-prix-service', row);
        // BUGFIX : un champ prix laissé vide était converti en 0 (`Number('') || 0`)
        // et donc envoyé tel quel au serveur, qui l'aurait pris comme un prix
        // délibéré de 0 Ar au lieu de retomber sur le prix par défaut du service.
        // On n'envoie désormais prixUnitaire QUE si l'utilisateur a saisi
        // quelque chose — un champ vide laisse le serveur appliquer
        // service.prixDefaut (voir vente.service.js#construireLignesVente).
        const rawPrix = prixInput ? prixInput.value.trim() : '';
        const item = { kind, serviceId: id, quantite: qte, remise, details };
        if (rawPrix !== '') item.prixUnitaire = Number(rawPrix);
        items.push(item);
      }
    });
    if (erreurs.length) throw new Error(erreurs.join(' ; '));
    return items.filter(l => l.quantite > 0);
  }

  // Attacher les boutons d'ajout (s'ils existent dans le body)
  const addProdBtn = qs('#add-produit', body);
  const addServBtn = qs('#add-service', body);
  if (addProdBtn) addProdBtn.addEventListener('click', () => addLigne('produit'));
  if (addServBtn) addServBtn.addEventListener('click', () => addLigne('service'));

  // Ajouter une ligne vide par défaut (uniquement en mode création, pas en mode édition
  // où les lignes existantes sont ajoutées explicitement par l'appelant).
  if (autoAddEmpty) {
    if (produits.length) addLigne('produit');
    else if (services.length) addLigne('service');
    else container.innerHTML = '<div class="muted">Créez d\'abord un produit ou un service.</div>';
  }

  // Retourner les fonctions nécessaires
  return { addLigne, recalcTotal, getItems };
}

