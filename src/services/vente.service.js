// src/services/vente.service.js
const { requireModule, requireAuth } = require('./auth.service');
const { uid, numeroSequentielMensuel, genererCodeSequentiel, nombrePositifOuZero } = require('../../utils/helpers');
const consommationService = require('./consommation.service');
const taxService = require('./taxService');

// CORRECTIF : la numérotation séquentielle mensuelle (ex. "003-06") est
// désormais calculée en UTC (voir utils/helpers.js#numeroSequentielMensuel)
// pour éviter les décalages de mois lorsque l'heure locale du poste est
// proche du changement de mois dans un fuseau différent d'UTC.
function numeroSequentiel(store, collection) {
  return numeroSequentielMensuel(store, collection);
}

async function construireLignesVente(store, items, options = {}) {
  const provisoire = !!options.provisoire;
  if (!items || !items.length) throw new Error('Ajoutez au moins un produit ou un service');
  // SÉCURITÉ : une quantité négative ou non numérique permettait de contourner
  // le contrôle de stock (produit.quantite < l.quantite devient faux) et de
  // faire AUGMENTER le stock via une "vente", et de fausser le total/le
  // montant payé. Une remise hors de [0, 100] permettait un total négatif.
  items.forEach((it, index) => {
    const q = Number(it.quantite);
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error(`Ligne ${index + 1} : quantité invalide`);
    }
    if (it.remise !== undefined && it.remise !== null && it.remise !== '') {
      const r = Number(it.remise);
      if (!Number.isFinite(r) || r < 0 || r > 100) {
        throw new Error(`Ligne ${index + 1} : remise invalide (doit être comprise entre 0 et 100)`);
      }
    }
    if (it.prixUnitaire !== undefined && it.prixUnitaire !== null && it.prixUnitaire !== '' && (isNaN(Number(it.prixUnitaire)) || Number(it.prixUnitaire) < 0)) {
      throw new Error(`Ligne ${index + 1} : prix unitaire invalide`);
    }
    // CORRECTIF (audit — bug n°1) : `it.prix` (prix d'un article "nouveau",
    // créé à la volée) n'était jamais borné, contrairement à `it.prixUnitaire`
    // (prix d'un article déjà existant) juste au-dessus — un article "nouveau"
    // avec un prix négatif passait donc la validation sans erreur.
    if (it.nouveau && it.prix !== undefined && it.prix !== null && it.prix !== '' && (isNaN(Number(it.prix)) || Number(it.prix) < 0)) {
      throw new Error(`Ligne ${index + 1} : prix invalide`);
    }
  });
  let total = 0;
  let totalHT = 0;
  let totalVat = 0;
  // SYSTÈME TVA (§7/§13) : les réglages de TVA de l'entreprise sont lus UNE
  // SEULE FOIS pour la construction de toute la vente/du devis — c'est ce
  // même objet `taxSettings` qui sert de base au calcul, PUIS le résultat
  // (vatRate/vatAmount) est figé dans chaque ligne. Si le taux change après
  // coup, cette vente ne le saura jamais : elle ne relit plus jamais
  // taxSettings (voir taxService.js, en-tête, "GEL HISTORIQUE").
  const meta = await store.getMeta();
  const taxSettings = meta.taxSettings || { vatEnabled: false, defaultVatRate: 0 };
  // BUGFIX ASYNC : cette boucle appelle store.insert()/store.get() (async
  // depuis la migration SQLite) — un .map() classique retournerait un
  // tableau de Promises non résolues au lieu des lignes elles-mêmes. On
  // utilise donc un for..of qui permet d'await chaque itération avant de
  // pousser le résultat dans `lignes`, tout en conservant l'ordre d'origine.
  const lignes = [];
  for (const it of items) {
    if (it.kind === 'service') {
      let service;
      if (it.nouveau) {
        const nom = (it.nom || '').trim();
        if (!nom) throw new Error('Le nom du nouveau service est requis');
        // CORRECTIF (audit — point n°16) : nombrePositifOuZero() remplace
        // `Number(it.prix) || 0`, qui n'écarte pas les valeurs négatives.
        service = await store.insert('services', { nom, unite: (it.unite || 'Prestation').trim(), prixDefaut: nombrePositifOuZero(it.prix), actif: true, provisoire });
      } else {
        service = await store.get('services', it.serviceId);
        if (!service) throw new Error('Service introuvable : ' + it.serviceId);
      }
      // BESOIN MÉTIER : le prix d'un service EXISTANT peut désormais être
      // saisi manuellement (ex. travaux d'impression/photocopie facturés au
      // cas par cas, dont le montant ne correspond à aucun tarif catalogue
      // fixe). Si un prixUnitaire est fourni, il est utilisé tel quel — il a
      // déjà été validé plus haut (fini, >= 0). Si le champ est vide/absent,
      // on retombe sur le prix par défaut du catalogue (service.prixDefaut).
      const pu = (it.prixUnitaire !== undefined && it.prixUnitaire !== null && it.prixUnitaire !== '')
        ? Number(it.prixUnitaire)
        : service.prixDefaut;
      const sousTotal = Math.round(it.quantite * pu * (1 - (it.remise || 0) / 100) * 100) / 100;
      // SYSTÈME TVA (§7) : `sousTotal` reste le montant HORS TAXE de la
      // ligne (le prix unitaire est désormais toujours HT — §1/§6) ; le
      // détail TVA/TTC est calculé UNE FOIS ici et figé dans la ligne.
      const tauxService = taxService.getEffectiveVatRate(service, taxSettings);
      const detailService = taxService.calculateLineFromHT(sousTotal, tauxService);
      total += detailService.totalTTC;
      totalHT += detailService.totalHT;
      totalVat += detailService.vatAmount;
      lignes.push({ kind: 'service', serviceId: service.id, designation: service.nom, details: it.details ? String(it.details).trim() : '', unite: service.unite || 'Prestation', quantite: Number(it.quantite), prixUnitaire: pu, remise: it.remise || 0, sousTotal: detailService.totalHT, vatRate: detailService.vatRate, vatAmount: detailService.vatAmount, totalTTC: detailService.totalTTC });
      continue;
    }
    let produit;
    if (it.nouveau) {
      const designation = (it.nom || '').trim();
      if (!designation) throw new Error('Le nom du nouveau produit est requis');
      // CORRECTIF (audit — bug n°6) : un code fabriqué à la main à partir de
      // Date.now() (sans vérification d'unicité) coexistait avec le mécanisme
      // séquentiel centralisé utilisé partout ailleurs pour produit.code — on
      // passe désormais par genererCodeSequentiel, comme la création directe
      // d'un produit (produit.service.js) et l'import CSV.
      const produitsExistants = await store.list('produits');
      const code = await genererCodeSequentiel(store, {
        sequenceKey: 'produits',
        prefixe: 'PR',
        longueur: 3,
        existants: produitsExistants.map((p) => p.code)
      });
      const quantiteInitiale = nombrePositifOuZero(it.quantite);
      // CORRECTIF (audit — bug n°5) : quand cette ligne est construite pour
      // un DEVIS (pro-forma) non encore validé, le produit "au vol" est
      // marqué `provisoire: true` — il n'est confirmé comme produit permanent
      // qu'à la validation effective du devis (voir proforma.service.js
      // #valider) et est supprimé automatiquement si le devis est supprimé
      // sans avoir été validé (voir proforma.service.js#supprimer). Pour une
      // vente directe (provisoire === false), le produit est permanent dès sa
      // création, comme avant.
      produit = await store.insert('produits', {
        code,
        designation,
        unite: (it.unite || 'Unité').trim(),
        categorieId: null,
        prixAchat: 0,
        // CORRECTIF (audit — bug n°1 et n°16) : prix borné (voir validation
        // en tête de fonction) et nombrePositifOuZero() en filet de sécurité.
        prixVente: nombrePositifOuZero(it.prix),
        quantite: quantiteInitiale,
        seuilMin: 0,
        provisoire
      });
      // CORRECTIF (audit — bug n°5) : contrairement à produit.service.js#create,
      // cette insertion "au vol" ne journalisait jusqu'ici aucun mouvement de
      // stock — le produit apparaissait avec un stock non nul sans aucune
      // trace justifiant d'où il venait.
      if (quantiteInitiale > 0) {
        await store.insert('mouvementsStock', {
          produitId: produit.id,
          type: 'entree',
          quantite: quantiteInitiale,
          motif: provisoire ? 'Stock initial (créé depuis un devis, provisoire)' : 'Stock initial (créé depuis une vente)',
          utilisateur: options.utilisateur || null
        });
      }
    } else {
      produit = await store.get('produits', it.produitId);
      if (!produit) throw new Error('Produit introuvable : ' + it.produitId);
    }
    const sousTotal = Math.round(it.quantite * produit.prixVente * (1 - (it.remise || 0) / 100) * 100) / 100;
    // SYSTÈME TVA (§7) : voir le même commentaire dans la branche "service"
    // ci-dessus — produit.prixVente est désormais HT, et le détail TVA/TTC
    // est figé une fois pour toutes dans la ligne.
    const tauxProduit = taxService.getEffectiveVatRate(produit, taxSettings);
    const detailProduit = taxService.calculateLineFromHT(sousTotal, tauxProduit);
    total += detailProduit.totalTTC;
    totalHT += detailProduit.totalHT;
    totalVat += detailProduit.vatAmount;
    lignes.push({ kind: 'produit', produitId: produit.id, designation: produit.designation, details: it.details ? String(it.details).trim() : '', unite: produit.unite || 'Unité', quantite: Number(it.quantite), prixUnitaire: produit.prixVente, remise: it.remise || 0, sousTotal: detailProduit.totalHT, vatRate: detailProduit.vatRate, vatAmount: detailProduit.vatAmount, totalTTC: detailProduit.totalTTC });
  }
  return {
    lignes,
    total: Math.round(total * 100) / 100, // TTC — montant réellement dû/encaissable (inchangé dans sa SIGNIFICATION : c'était déjà ce montant qui servait de référence partout ailleurs, voir finaliserVente)
    totalHT: Math.round(totalHT * 100) / 100,
    totalVat: Math.round(totalVat * 100) / 100
  };
}

async function finaliserVente(store, { lignes, total, totalHT, totalVat, clientId, clientNom, vendeur, modePaiement, montantPaye, numero }) {
  // NOTE (audit — bug n°2, portée résiduelle) : cette pré-vérification reste
  // une lecture "optimiste" (get() séparé de l'écriture) pour donner un
  // message d'erreur clair AVANT tout travail (numérotation, moteur de
  // consommation, etc.). Le vrai verrou anti-stock-négatif est désormais
  // dans la boucle de décrément plus bas, qui utilise store.ajusterChamp()
  // avec un `validate` exécuté DANS la même transaction SQLite que
  // l'écriture — c'est cette étape-là qui empêche réellement une vente
  // concurrente de faire passer le stock sous zéro, pas cette boucle-ci.
  for (const l of lignes) {
    if (l.kind !== 'produit') continue;
    const produit = await store.get('produits', l.produitId);
    if (!produit) throw new Error('Produit introuvable : ' + l.designation);
    if (produit.quantite < l.quantite) throw new Error('Stock insuffisant pour ' + produit.designation);
  }
  // CORRECTIF SÉCURITÉ : ce contrôle n'existait qu'au niveau de
  // ventes:create (payload contrôlé par le renderer) et non ici, dans
  // finaliserVente() elle-même. Or proforma.service.js#valider appelle
  // directement _finaliserVente() en court-circuitant cette validation —
  // un montantPaye négatif ou supérieur au total pouvait donc être injecté
  // via la validation d'une facture pro-forma (le champ "Montant réglé
  // maintenant" du formulaire n'étant borné ni côté client ni côté
  // serveur), faussant la trésorerie et le statut de la vente générée.
  // En validant ici, tous les points d'entrée (ventes:create ET
  // proformas:valider) sont désormais protégés.
  const montantPayeFinal = Math.round(Number(montantPaye != null ? montantPaye : total) * 100) / 100;
  if (!Number.isFinite(montantPayeFinal) || montantPayeFinal < 0) {
    throw new Error('Le montant payé doit être un nombre positif ou nul');
  }
  if (montantPayeFinal > total) {
    throw new Error(`Le montant payé (${montantPayeFinal}) ne peut pas dépasser le total de la vente (${total})`);
  }
  // MOTEUR DE CONSOMMATION (nomenclatures) : on valide le stock des matières
  // premières éventuellement rattachées à un produit/service AVANT de créer
  // la vente.
  //
  // CORRECTIF (audit — bug n°1) : cette étape appelait auparavant
  // `simulateConsommation()`, en croyant à tort que cette fonction levait une
  // exception en cas de stock matière insuffisant. Ce n'est PAS le cas :
  // `simulateConsommation()` ne fait que calculer un coût prévisionnel, sans
  // aucun contrôle de stock. En pratique, la vente et la déduction du stock
  // du produit vendu lui-même étaient déjà écrites AVANT que le vrai contrôle
  // (interne à `processConsommation()`) échoue sur une ligne tardive,
  // laissant une vente "fantôme" (statut payée, stock déjà décrémenté,
  // aucune trésorerie enregistrée) dans le store malgré l'erreur affichée à
  // l'écran.
  //
  // On utilise désormais `verifierStockDisponible()`, qui vérifie
  // RÉELLEMENT la disponibilité du stock matière, en une seule passe pour
  // TOUTES les lignes de la vente (elle agrège aussi les besoins portant sur
  // une même matière première entre plusieurs lignes — voir bug n°3), et
  // lève une exception AVANT toute écriture si un besoin obligatoire dépasse
  // le stock disponible. Une cible sans nomenclature active ne contribue
  // simplement aucun besoin et ne bloque rien (ex. vente d'un service sans
  // recette).
  await consommationService.verifierStockDisponible(store, lignes);
  // CORRECTIF (audit — atomicité) : `numero` reste alloué AVANT la
  // transaction (allouerSequence a sa propre atomicité indépendante, même
  // pattern que achat.service.js#create), puis TOUTE la séquence d'écriture
  // (insert vente + prestations + décrément de stock + mouvements +
  // nomenclatures/consommation + trésorerie) est désormais regroupée en UNE
  // SEULE transaction SQLite (store.transaction) : soit tout est écrit, soit
  // rien ne l'est.
  //
  // AVANT ce correctif, ces écritures s'enchaînaient hors transaction,
  // chacune committée immédiatement en base. Une erreur survenant en cours
  // de route (ex. stock insuffisant détecté seulement à l'écriture sur la
  // 2e ligne d'une vente multi-lignes, ou échec du moteur de consommation
  // sur une ligne tardive) laissait alors une vente partiellement écrite :
  // enregistrement "ventes" créé, stock décrémenté pour certaines lignes
  // seulement, aucune écriture de trésorerie cohérente — sans possibilité de
  // rollback. C'est le même type de "vente fantôme" que le bug n°1
  // ci-dessus dit avoir corrigé pour le moteur de consommation seul ; il
  // subsistait pour l'ensemble de la séquence d'écriture de la vente.
  //
  // IMPORTANT : le callback passé à store.transaction() doit rester
  // strictement synchrone (voir store.js#transaction) — on utilise donc
  // `tx.insert`/`tx.ajusterChamp` (synchrones) et
  // consommationService.processConsommationSync() (variante synchrone de
  // processConsommation(), voir consommation.service.js) plutôt que l'API
  // publique asynchrone `store`.
  const numeroFinal = numero || await numeroSequentiel(store, 'ventes');
  const rec = await store.transaction((tx) => {
    const inserted = tx.insert('ventes', {
      numero: numeroFinal,
      clientId: clientId || null,
      clientNom: clientNom || '',
      vendeur,
      lignes,
      total,
      // SYSTÈME TVA (§7) : agrégats HT/TVA calculés une fois pour toutes par
      // construireLignesVente — voir taxService.js. `total` reste le TTC
      // (montant dû/encaissé), inchangé dans son usage par tout le reste de
      // l'application (montantPaye, statut, trésorerie...).
      totalHT: totalHT != null ? totalHT : total,
      totalVat: totalVat != null ? totalVat : 0,
      modePaiement: modePaiement || 'especes',
      montantPaye: montantPayeFinal,
      statut: montantPayeFinal >= total ? 'payee' : (montantPayeFinal > 0 ? 'partiellement_payee' : 'en_attente')
    });
    for (const l of lignes) {
      if (l.kind === 'service') {
        tx.insert('prestations', { numero: inserted.numero, serviceId: l.serviceId, serviceNom: l.designation, details: l.details, clientId: inserted.clientId, clientNom: inserted.clientNom, employe: vendeur, quantite: l.quantite, prixUnitaire: l.prixUnitaire, remise: l.remise, totalHT: l.sousTotal, vatRate: l.vatRate, vatAmount: l.vatAmount, total: l.totalTTC, venteId: inserted.id, statut: 'active' });
      } else {
        // CORRECTIF (audit — bug n°2) : tx.ajusterChamp() lit et décrémente
        // 'quantite' dans UNE SEULE transaction SQLite (au lieu de l'ancien
        // get() puis update() en deux appels distincts), ce qui élimine la
        // fenêtre entre les deux où une autre vente concurrente sur le même
        // produit pouvait lire la même quantité de départ et écraser cette
        // écriture. Le `validate` referme aussi, ici, une deuxième source de
        // sur-vente possible : deux ventes simultanées passant chacune la
        // pré-vérification "optimiste" de plus haut (basée sur une lecture
        // antérieure à l'écriture) avant qu'aucune des deux n'ait déjà décrémenté.
        tx.ajusterChamp('produits', l.produitId, 'quantite', -l.quantite, {
          validate: (valeurActuelle, nouvelleValeur, p) => {
            if (nouvelleValeur < 0) throw new Error('Stock insuffisant pour ' + p.designation);
          }
        });
        tx.insert('mouvementsStock', { produitId: l.produitId, type: 'sortie', quantite: l.quantite, motif: 'Vente ' + inserted.numero, utilisateur: vendeur });
      }
      // NOMENCLATURES : déduit la/les matière(s) premières éventuellement
      // rattachées à ce produit/service vendu (ex. papier consommé par une
      // photocopie). Déjà validé en amont (voir plus haut) — ne devrait pas
      // échouer ici, sauf cas exceptionnel (données modifiées entre-temps) ;
      // si ça échoue malgré tout, toute la transaction (vente comprise) est
      // annulée grâce au rollback automatique de store.transaction().
      consommationService.processConsommationSync(tx, {
        cibleType: l.kind,
        cibleId: l.kind === 'service' ? l.serviceId : l.produitId,
        quantite: l.quantite,
        referenceType: 'VENTE',
        referenceId: inserted.id
      }, vendeur);
    }
    if (inserted.montantPaye > 0) {
      tx.insert('operationsTresorerie', { type: 'entree', categorie: 'Vente', montant: inserted.montantPaye, reference: inserted.numero, description: 'Encaissement vente' });
    }
    return inserted;
  });
  return rec;
}

module.exports = {
  async list(store) {
    requireModule('ventes');
    return (await store.list('ventes')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async create(store, payload, userEmail) {
    requireModule('ventes');
    const items = payload.items || payload.lignes || [];
    const { lignes, total, totalHT, totalVat } = await construireLignesVente(store, items, { utilisateur: userEmail });
    const clientId = payload.clientId || null;
    const clientNom = !clientId && payload.clientNom ? String(payload.clientNom).trim() : '';
    // SÉCURITÉ : un montantPaye négatif ou non numérique aurait pu générer une
    // écriture de trésorerie négative ou un statut de paiement incohérent.
    if (payload.montantPaye !== undefined && payload.montantPaye !== null && payload.montantPaye !== '') {
      const mp = Number(payload.montantPaye);
      if (!Number.isFinite(mp) || mp < 0) throw new Error('Le montant payé doit être un nombre positif ou nul');
      // CORRECTIF : sans ce contrôle, un montant payé supérieur au total de
      // la vente était accepté tel quel — la vente passait "payée" avec un
      // montantPaye incohérent (> total), faussant la trésorerie et les
      // rapports (rendu final au client jamais calculé/affiché).
      if (Math.round(mp * 100) / 100 > total) {
        throw new Error(`Le montant payé (${mp}) ne peut pas dépasser le total de la vente (${total})`);
      }
    }
    const rec = await finaliserVente(store, { lignes, total, totalHT, totalVat, clientId, clientNom, vendeur: userEmail, modePaiement: payload.modePaiement, montantPaye: payload.montantPaye });
    await store.logJournal({ utilisateur: userEmail, action: 'creation_vente', cible: rec.id });
    return rec;
  },

  async annuler(store, id, userEmail) {
    const vente = await store.get('ventes', id);
    if (!vente) throw new Error('Vente introuvable');
    if (vente.statut === 'annulee') throw new Error('Cette vente est déjà annulée');
    // CORRECTIF (audit — bug n°2 et n°3) : la boucle de restitution de stock
    // ne contient que des écritures pures (ajusterChamp + insert), donc
    // regroupable en UNE SEULE transaction SQLite : soit toutes les lignes
    // sont restituées, soit aucune ne l'est si l'une échoue (ex. quantité
    // invalide) — restaure le comportement "tout ou rien" de l'ancienne
    // version à deux boucles, mais avec la vérification faite DANS la même
    // transaction que l'écriture (donc plus jamais sur une valeur pouvant
    // être rendue obsolète par une opération concurrente entre la
    // vérification et l'écriture).
    await store.transaction((tx) => {
      for (const l of vente.lignes) {
        if (l.kind === 'service') continue;
        const qte = Number(l.quantite);
        const produit = tx.ajusterChamp('produits', l.produitId, 'quantite', qte, {
          validate: (valeurActuelle, nouvelleValeur, p) => {
            if (!Number.isFinite(qte) || qte <= 0 || nouvelleValeur < 0) {
              throw new Error(
                `Impossible d'annuler cette vente : la ligne "${p.designation}" a une quantité invalide ` +
                `et son annulation ferait passer le stock en dessous de zéro.`
              );
            }
          }
        });
        if (produit) {
          tx.insert('mouvementsStock', { produitId: l.produitId, type: 'entree', quantite: l.quantite, motif: 'Annulation ' + vente.numero, utilisateur: userEmail });
        }
      }
    });
    // NOMENCLATURES : restitue la/les matière(s) premières consommées par
    // cette vente (idempotent — voir consommation.service.js).
    await consommationService.reverseConsommation(store, 'VENTE', id, userEmail);
    if (vente.montantPaye > 0) {
      await store.insert('operationsTresorerie', { type: 'sortie', categorie: 'Annulation vente', montant: vente.montantPaye, reference: vente.numero, description: 'Annulation de la vente ' + vente.numero });
    }
    const prestationsLiees = await store.list('prestations', (pr) => pr.venteId === id);
    for (const pr of prestationsLiees) await store.update('prestations', pr.id, { statut: 'annulee' });
    await store.update('ventes', id, { statut: 'annulee' });
    await store.logJournal({ utilisateur: userEmail, action: 'annulation_vente', cible: id });
    return true;
  },

  async payer(store, id, montant, userEmail) {
    requireModule('ventes');
    const vente = await store.get('ventes', id);
    if (!vente) throw new Error('Vente introuvable');
    if (vente.statut === 'annulee') throw new Error('Impossible d\'encaisser une vente annulée');
    const reste = Math.round((vente.total - vente.montantPaye) * 100) / 100;
    montant = Math.round(Number(montant) * 100) / 100;
    if (!montant || montant <= 0) throw new Error('Montant invalide');
    if (montant > reste) throw new Error('Le montant dépasse le solde restant dû (' + reste + ')');
    const montantPaye = Math.round((vente.montantPaye + montant) * 100) / 100;
    const statut = montantPaye >= vente.total ? 'payee' : 'partiellement_payee';
    // CORRECTIF (audit — bug n°3) : regroupé en une seule transaction.
    await store.transaction((tx) => {
      tx.update('ventes', id, { montantPaye, statut });
      tx.insert('operationsTresorerie', { type: 'entree', categorie: 'Vente', montant, reference: vente.numero, description: 'Règlement client — ' + vente.numero });
      tx.logJournal({ utilisateur: userEmail, action: 'paiement_vente', cible: id });
    });
    return store.get('ventes', id);
  },

  async supprimer(store, id, userEmail) {
    const vente = await store.get('ventes', id);
    if (!vente) throw new Error('Vente introuvable');
    if (vente.statut !== 'annulee') throw new Error('Seule une vente déjà annulée peut être supprimée définitivement');
    await store.transaction((tx) => {
      tx.removeWhere('prestations', (pr) => pr.venteId === vente.id);
      tx.removeWhere('operationsTresorerie', (o) => o.reference === vente.numero);
      tx.remove('ventes', id);
      tx.logJournal({ utilisateur: userEmail, action: 'suppression_definitive_vente', cible: vente.numero });
    });
    return true;
  },

  async modifierClient(store, id, { clientId, clientNom }, userEmail) {
    requireModule('ventes');
    const vente = await store.get('ventes', id);
    if (!vente) throw new Error('Vente introuvable');
    clientId = clientId || null;
    clientNom = !clientId && clientNom ? String(clientNom).trim() : '';
    await store.update('ventes', id, { clientId, clientNom });
    await store.logJournal({ utilisateur: userEmail, action: 'modification_client_vente', cible: vente.numero });
    return store.get('ventes', id);
  },

  // Exporter les fonctions internes pour réutilisation (par ex. dans proforma)
  _construireLignesVente: construireLignesVente,
  _finaliserVente: finaliserVente,
  _numeroSequentiel: numeroSequentiel
};