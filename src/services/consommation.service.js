// src/services/consommation.service.js
//
// MOTEUR DE CONSOMMATION (NOMENCLATURES / RECETTES)
// ============================================================
// Adapté depuis DEV_GUIDE_OLI_CONSUMPTION.txt (pensé à l'origine pour une
// stack PHP/Laravel + MySQL relationnel) vers l'architecture réelle du
// projet : store JSON en mémoire (better-sqlite3 en persistance), pas
// d'ORM, pas de transaction SQL par requête.
//
// CHOIX D'ADAPTATION IMPORTANTS (à lire avant de modifier ce fichier) :
// -----------------------------------------------------------------------
// 1. Pas de tables séparées "recipes" / "recipe_items" : une recette est UN
//    SEUL enregistrement dans la nouvelle collection `recettes`, avec ses
//    lignes embarquées dans un tableau `lignes` (même pattern que
//    ventes.lignes ou achats.lignes déjà dans ce projet). Pas de jointure à
//    faire, pas de migration SQL : le store persiste n'importe quel champ
//    JSON sans ALTER TABLE.
//
// 2. Pas de table `units`/`unit_conversions` séparée pour ce MVP : l'unité
//    d'une ligne de recette doit correspondre à l'unité de stock de
//    l'article consommé (produit.unite). Si un jour un vrai besoin de
//    conversion apparaît (ex. achat en ramette / consommation en feuille),
//    on ajoutera un simple objet de facteurs dans meta.parametres plutôt
//    qu'une table normalisée — mais ça reste HORS SCOPE de cette version.
//
// 3. Pas de "DB::beginTransaction()/COMMIT/ROLLBACK" multi-lignes : chaque
//    store.update()/store.insert() écrit désormais directement et
//    immédiatement en SQLite (voir PHASE 7 dans store.js — il n'y a plus de
//    copie mémoire ni d'écriture groupée différée). On obtient l'équivalent
//    d'un rollback en validant TOUTES les lignes AVANT de modifier quoi que
//    ce soit (même pattern que vente.service.js#annuler, qui fait
//    exactement ça pour la restitution de stock). Si une seule ligne échoue
//    à la vérification, aucune écriture n'a encore eu lieu.
//
// 4. Le "coût moyen pondéré" (CMP) n'existe pas encore dans ce projet :
//    produit.prixAchat est aujourd'hui une valeur figée saisie à la
//    création du produit, jamais recalculée par achat.service.js. Pour ce
//    MVP on utilise donc prixAchat tel quel comme coût unitaire de
//    consommation (= "dernier coût connu", pas un vrai CMP). Un vrai CMP
//    nécessiterait de modifier achat.service.js pour recalculer prixAchat
//    à chaque réception — proposé en TODO plus bas, mais volontairement
//    laissé hors de cette première version pour ne pas mélanger deux
//    fonctionnalités dans le même chantier.
//
// 5. Gestion du "delta" en cas de modification de quantité vendue (test 8
//    du guide d'origine) : vente.service.js ne permet aujourd'hui pas de
//    modifier les lignes d'une vente déjà créée (seul modifierClient()
//    existe). Cette fonctionnalité n'a donc pas d'équivalent à brancher
//    pour l'instant — à prévoir SEULEMENT si/quand une édition de lignes de
//    vente est ajoutée.

// AJOUT (audit) : une nomenclature peut désormais couvrir plusieurs cibles
// (voir recette.service.js#listeCibles) — un produit/matière première peut
// être consommé par plusieurs services sans dupliquer la nomenclature pour
// chacun d'eux.
const { recetteConcerneCible } = require('./recette.service');

// Renvoie la recette active pour une cible donnée (un produit ou un
// service vendu), ou null si aucune nomenclature n'est définie — ce qui
// est un cas NORMAL (ex. vente de WiFi, aucune matière consommée) et non
// une erreur.
async function getRecetteActive(store, cibleType, cibleId) {
  const actives = await store.list('recettes', (r) => r.actif);
  return actives.find((r) => recetteConcerneCible(r, cibleType, cibleId)) || null;
}

// Calcule les besoins bruts (quantités à déduire) pour une recette et une
// quantité vendue donnée, SANS toucher au stock. Utilisé à la fois par
// simulateConsommation() et par processConsommation() (étapes 1 à 3 du
// guide d'origine).
async function calculerBesoins(store, recette, quantiteVendue) {
  const besoins = [];
  for (const ligne of recette.lignes) {
    const materiel = await store.get('produits', ligne.materielId);
    if (!materiel) {
      throw new Error(`Article consommé introuvable dans la recette "${recette.nom}" (id: ${ligne.materielId})`);
    }
    // SIMPLIFICATION VOLONTAIRE (voir en-tête) : pas de conversion d'unité,
    // on exige que la ligne soit déjà exprimée dans l'unité de stock de
    // l'article. On alerte clairement si ce n'est pas le cas plutôt que de
    // consommer silencieusement une mauvaise quantité.
    if (ligne.unite && materiel.unite && ligne.unite.trim().toLowerCase() !== materiel.unite.trim().toLowerCase()) {
      throw new Error(
        `Unité incompatible pour "${materiel.designation}" : la recette utilise "${ligne.unite}" ` +
        `mais le stock de cet article est géré en "${materiel.unite}" (conversion non prise en charge pour l'instant)`
      );
    }
    const qteBase = quantiteVendue * Number(ligne.quantite);
    const qtePerte = qteBase * (Number(ligne.pertePourcentage || 0) / 100);
    const qteFinale = Math.round((qteBase + qtePerte) * 10000) / 10000;
    besoins.push({
      materielId: materiel.id,
      designation: materiel.designation,
      quantite: qteFinale,
      unite: materiel.unite,
      optionnel: !!ligne.optionnel,
      coutUnitaire: Number(materiel.prixAchat) || 0
    });
  }
  return besoins;
}

// CORRECTIF (audit — bug n°3) : agrège les besoins obligatoires d'un
// ensemble de "besoins" par materielId AVANT de les comparer au stock
// disponible. Sans ça, deux lignes d'une même recette (ou de deux recettes
// différentes) référençant la même matière première étaient vérifiées
// indépendamment l'une de l'autre contre le MÊME stock non encore décrémenté
// : chaque vérification isolée pouvait passer alors que le besoin cumulé
// dépassait le stock réel, laissant le stock final devenir négatif sans
// qu'aucune exception ne soit levée.
function agregerBesoinsParMateriel(besoins, accumulateur) {
  const parMateriel = accumulateur || new Map();
  for (const besoin of besoins) {
    if (besoin.optionnel) continue; // une ligne optionnelle ne bloque jamais, seule ou cumulée
    const cur = parMateriel.get(besoin.materielId) || { quantite: 0, designation: besoin.designation, unite: besoin.unite };
    cur.quantite = Math.round((cur.quantite + besoin.quantite) * 10000) / 10000;
    parMateriel.set(besoin.materielId, cur);
  }
  return parMateriel;
}

async function verifierStockPourBesoinsAgreges(store, parMateriel) {
  for (const [materielId, besoin] of parMateriel) {
    const materiel = await store.get('produits', materielId);
    if (!materiel) throw new Error(`Article consommé introuvable (id: ${materielId})`);
    if (materiel.quantite < besoin.quantite) {
      throw new Error(`Stock insuffisant pour "${besoin.designation}" (disponible : ${materiel.quantite} ${besoin.unite}, requis${parMateriel.size ? ' (cumulé)' : ''} : ${besoin.quantite} ${besoin.unite})`);
    }
  }
}

// ============================================================
// VARIANTES SYNCHRONES — pour utilisation À L'INTÉRIEUR d'une transaction
// SQLite (store.transaction(tx => ...)).
// ============================================================
// CORRECTIF (audit — atomicité des ventes) : vente.service.js#finaliserVente
// appelait jusqu'ici processConsommation() (async) en dehors de toute
// transaction, aux côtés d'autres écritures elles aussi non transactionnées
// (insert vente, décrément de stock, écriture de trésorerie...). Une erreur
// survenant sur une ligne tardive (ex. 2e ligne d'une vente multi-lignes en
// rupture de stock) laissait alors une vente partiellement écrite en base,
// sans rollback possible — exactement le problème que ce module dit avoir
// résolu ailleurs (voir "MOTEUR DE CONSOMMATION" en tête de fichier, point
// 3) mais qui subsistait dans ce chemin précis.
//
// Ces variantes reproduisent EXACTEMENT la même logique que
// getRecetteActive/calculerBesoins/verifierStockPourBesoinsAgreges/
// processConsommation ci-dessus, mais en s'appuyant sur l'objet `tx`
// synchrone exposé par store.transaction() (tx.get/tx.list/tx.ajusterChamp/
// tx.insert) plutôt que sur l'API publique asynchrone `store`. Une fonction
// passée à store.transaction() DOIT rester strictement synchrone (voir le
// commentaire de transaction() dans store.js) : pas de `async`, pas
// d'`await`, ici.
function getRecetteActiveSync(tx, cibleType, cibleId) {
  const actives = tx.list('recettes', (r) => r.actif);
  return actives.find((r) => recetteConcerneCible(r, cibleType, cibleId)) || null;
}

function calculerBesoinsSync(tx, recette, quantiteVendue) {
  const besoins = [];
  for (const ligne of recette.lignes) {
    const materiel = tx.get('produits', ligne.materielId);
    if (!materiel) {
      throw new Error(`Article consommé introuvable dans la recette "${recette.nom}" (id: ${ligne.materielId})`);
    }
    if (ligne.unite && materiel.unite && ligne.unite.trim().toLowerCase() !== materiel.unite.trim().toLowerCase()) {
      throw new Error(
        `Unité incompatible pour "${materiel.designation}" : la recette utilise "${ligne.unite}" ` +
        `mais le stock de cet article est géré en "${materiel.unite}" (conversion non prise en charge pour l'instant)`
      );
    }
    const qteBase = quantiteVendue * Number(ligne.quantite);
    const qtePerte = qteBase * (Number(ligne.pertePourcentage || 0) / 100);
    const qteFinale = Math.round((qteBase + qtePerte) * 10000) / 10000;
    besoins.push({
      materielId: materiel.id,
      designation: materiel.designation,
      quantite: qteFinale,
      unite: materiel.unite,
      optionnel: !!ligne.optionnel,
      coutUnitaire: Number(materiel.prixAchat) || 0
    });
  }
  return besoins;
}

function verifierStockPourBesoinsAgregesSync(tx, parMateriel) {
  for (const [materielId, besoin] of parMateriel) {
    const materiel = tx.get('produits', materielId);
    if (!materiel) throw new Error(`Article consommé introuvable (id: ${materielId})`);
    if (materiel.quantite < besoin.quantite) {
      throw new Error(`Stock insuffisant pour "${besoin.designation}" (disponible : ${materiel.quantite} ${besoin.unite}, requis${parMateriel.size ? ' (cumulé)' : ''} : ${besoin.quantite} ${besoin.unite})`);
    }
  }
}

// Équivalent synchrone de processConsommation(), à appeler UNIQUEMENT
// depuis l'intérieur d'un store.transaction(tx => ...). Même comportement :
// pré-vérifie tous les besoins de la recette (agrégés par matière première),
// puis décrémente chaque matière (avec le même filet `validate` anti-stock-
// négatif que la version async), en tolérant les lignes optionnelles en
// rupture.
function processConsommationSync(tx, { cibleType, cibleId, quantite, referenceType, referenceId }, userEmail) {
  const recette = getRecetteActiveSync(tx, cibleType, cibleId);
  if (!recette) return { statut: 'AUCUNE_CONSOMMATION' };

  const besoins = calculerBesoinsSync(tx, recette, Number(quantite));
  const parMateriel = agregerBesoinsParMateriel(besoins);
  verifierStockPourBesoinsAgregesSync(tx, parMateriel);

  let coutTotal = 0;
  const mouvements = [];
  for (const besoin of besoins) {
    const materielAvant = tx.get('produits', besoin.materielId);
    if (besoin.optionnel && materielAvant && materielAvant.quantite < besoin.quantite) continue; // rupture tolérée
    const coutLigne = Math.round(besoin.quantite * besoin.coutUnitaire * 100) / 100;
    tx.ajusterChamp('produits', besoin.materielId, 'quantite', -besoin.quantite, {
      validate: (valeurActuelle, nouvelleValeur, p) => {
        if (nouvelleValeur < 0) {
          throw new Error(`Stock insuffisant pour la matière première "${p.designation}"`);
        }
      }
    });
    const mv = tx.insert('mouvementsStock', {
      produitId: besoin.materielId,
      type: 'consommation',
      quantite: besoin.quantite,
      coutUnitaire: besoin.coutUnitaire,
      coutTotal: coutLigne,
      motif: `Consommation recette "${recette.nom}"`,
      referenceType: referenceType || null,
      referenceId: referenceId || null,
      utilisateur: userEmail
    });
    coutTotal += coutLigne;
    mouvements.push(mv);
  }
  coutTotal = Math.round(coutTotal * 100) / 100;

  return { statut: 'SUCCES', recetteId: recette.id, coutTotal, mouvements };
}

module.exports = {
  // Simule le calcul sans écrire en base — utile pour afficher un aperçu
  // du coût matière avant validation d'une vente/prestation.
  //
  // CORRECTIF (audit — bug n°4) : chaque ligne de besoin porte désormais un
  // indicateur `disponible` (stock suffisant ou non), et le `coutTotal`
  // exclut les lignes OPTIONNELLES dont le stock est insuffisant — car
  // processConsommation() les ignorera silencieusement à l'exécution (voir
  // plus bas). Sans ce correctif, l'aperçu de coût pouvait annoncer un
  // montant supérieur à ce qui serait réellement consommé/facturé.
  async simulateConsommation(store, cibleType, cibleId, quantite) {
    const recette = await getRecetteActive(store, cibleType, cibleId);
    if (!recette) return { statut: 'AUCUNE_CONSOMMATION' };
    const besoins = await calculerBesoins(store, recette, Number(quantite));
    let coutTotal = 0;
    for (const besoin of besoins) {
      const materiel = await store.get('produits', besoin.materielId);
      besoin.disponible = !!materiel && materiel.quantite >= besoin.quantite;
      if (besoin.optionnel && !besoin.disponible) continue;
      coutTotal += besoin.quantite * besoin.coutUnitaire;
    }
    coutTotal = Math.round(coutTotal * 100) / 100;
    return { statut: 'OK', recetteId: recette.id, coutTotal, lignes: besoins };
  },

  // CORRECTIF (audit — bug n°1) : vraie pré-validation de disponibilité du
  // stock matière pour UN ENSEMBLE de lignes vendues (produits et/ou
  // services), à appeler AVANT toute écriture (avant `store.insert('ventes',
  // ...)`). Contrairement à `simulateConsommation()` — qui ne fait que
  // calculer un coût prévisionnel et ne vérifiait jamais le stock — cette
  // fonction lève réellement une exception si le stock matière est
  // insuffisant, en agrégeant les besoins de TOUTES les lignes (et de toutes
  // leurs recettes) par matière première, pour éviter le sous-comptage entre
  // lignes (bug n°3). Si elle ne lève rien, l'appelant peut créer la vente en
  // toute sécurité : aucune écriture n'a eu lieu ici.
  //
  // `lignes` : tableau de { kind: 'produit'|'service', produitId?, serviceId?, quantite }
  async verifierStockDisponible(store, lignes) {
    let parMateriel = new Map();
    for (const l of lignes || []) {
      const cibleType = l.kind;
      const cibleId = l.kind === 'service' ? l.serviceId : l.produitId;
      const recette = await getRecetteActive(store, cibleType, cibleId);
      if (!recette) continue;
      const besoins = await calculerBesoins(store, recette, Number(l.quantite));
      parMateriel = agregerBesoinsParMateriel(besoins, parMateriel);
    }
    await verifierStockPourBesoinsAgreges(store, parMateriel);
    return true;
  },

  // Point d'entrée principal : déduit le stock des matières premières d'une
  // recette lors de la vente d'un produit/service, et journalise le coût.
  // `referenceType`/`referenceId` permettent de retrouver puis d'annuler
  // ces mouvements plus tard (ex. 'VENTE', vente.id).
  //
  // IMPORTANT : cette fonction reste protégée par son propre pré-flight
  // (défense en profondeur, y compris pour un appel direct hors du flux
  // vente.service.js), mais l'appelant DOIT désormais appeler
  // `verifierStockDisponible()` sur l'ensemble des lignes AVANT de créer
  // l'enregistrement de vente — voir vente.service.js#finaliserVente et le
  // correctif du bug n°1.
  async processConsommation(store, { cibleType, cibleId, quantite, referenceType, referenceId }, userEmail) {
    const recette = await getRecetteActive(store, cibleType, cibleId);
    if (!recette) return { statut: 'AUCUNE_CONSOMMATION' };

    const besoins = await calculerBesoins(store, recette, Number(quantite));

    // ÉTAPE "PRÉ-FLIGHT" (équivalent du BEGIN TRANSACTION du guide d'origine) :
    // on vérifie TOUTES les lignes avant d'écrire quoi que ce soit. Une
    // ligne optionnelle en rupture est ignorée silencieusement (elle ne
    // sera simplement pas déduite) ; une ligne obligatoire en rupture fait
    // échouer l'ensemble de l'opération AVANT toute modification, ce qui
    // nous dispense d'un vrai rollback SQL.
    // CORRECTIF (bug n°3) : les besoins de CETTE recette sont d'abord
    // agrégés par matière première, pour le cas où une même matière est
    // référencée par plusieurs lignes de la recette elle-même.
    const parMateriel = agregerBesoinsParMateriel(besoins);
    await verifierStockPourBesoinsAgreges(store, parMateriel);

    // ÉCRITURE : à partir d'ici, plus aucune vérification ne doit échouer.
    let coutTotal = 0;
    const mouvements = [];
    for (const besoin of besoins) {
      // CORRECTIF (audit — bug n°2) : store.ajusterChamp() remplace l'ancien
      // couple get()/update() sur produits.quantite — décrément atomique
      // dans une seule transaction SQLite, sans fenêtre de concurrence
      // entre la lecture de la quantité disponible et son écriture (deux
      // ventes/consommations concurrentes sur la même matière première ne
      // peuvent plus s'écraser mutuellement).
      const materielAvant = await store.get('produits', besoin.materielId);
      if (besoin.optionnel && materielAvant && materielAvant.quantite < besoin.quantite) continue; // rupture tolérée
      const coutLigne = Math.round(besoin.quantite * besoin.coutUnitaire * 100) / 100;
      // CORRECTIF (audit — bug n°3) : `verifierStockPourBesoinsAgreges()`
      // ci-dessus n'est qu'une PRÉ-vérification optimiste (lecture séparée de
      // l'écriture) — rien n'empêchait, sous charge, une deuxième
      // consommation concurrente sur la même matière première de s'intercaler
      // entre cette lecture et l'écriture réelle. On ajoute ici le même
      // filet de sécurité `validate`, exécuté DANS la même transaction
      // SQLite que le décrément, que celui déjà utilisé par
      // vente.service.js/achat.service.js/produit.service.js pour tous les
      // autres retraits de stock du projet — une ligne obligatoire ne peut
      // désormais plus faire passer le stock sous zéro, même en cas de
      // concurrence. La tolérance actuelle pour les lignes optionnelles est
      // conservée (déjà filtrée juste au-dessus).
      await store.ajusterChamp('produits', besoin.materielId, 'quantite', -besoin.quantite, {
        validate: (valeurActuelle, nouvelleValeur, p) => {
          if (nouvelleValeur < 0) {
            throw new Error(`Stock insuffisant pour la matière première "${p.designation}"`);
          }
        }
      });
      const mv = await store.insert('mouvementsStock', {
        produitId: besoin.materielId,
        type: 'consommation',
        quantite: besoin.quantite,
        coutUnitaire: besoin.coutUnitaire,
        coutTotal: coutLigne,
        motif: `Consommation recette "${recette.nom}"`,
        referenceType: referenceType || null,
        referenceId: referenceId || null,
        utilisateur: userEmail
      });
      coutTotal += coutLigne;
      mouvements.push(mv);
    }
    coutTotal = Math.round(coutTotal * 100) / 100;

    return { statut: 'SUCCES', recetteId: recette.id, coutTotal, mouvements };
  },

  // Annule une consommation déjà enregistrée pour une référence donnée
  // (ex. annulation d'une vente) : restitue le stock et journalise un
  // mouvement d'annulation. Idempotent — un appel répété sur une
  // consommation déjà annulée ne restitue pas le stock une seconde fois.
  async reverseConsommation(store, referenceType, referenceId, userEmail) {
    const mouvements = await store.list('mouvementsStock', (m) =>
      m.type === 'consommation' && m.referenceType === referenceType && m.referenceId === referenceId && !m.annule
    );
    if (!mouvements.length) return false;
    for (const mv of mouvements) {
      // CORRECTIF (audit — bug n°2) : ajusterChamp() atomique, voir plus haut.
      const materiel = await store.ajusterChamp('produits', mv.produitId, 'quantite', mv.quantite);
      if (materiel) {
        await store.insert('mouvementsStock', {
          produitId: mv.produitId,
          type: 'annulation_consommation',
          quantite: mv.quantite,
          coutUnitaire: mv.coutUnitaire,
          coutTotal: mv.coutTotal,
          motif: `Annulation consommation — ${mv.motif}`,
          referenceType,
          referenceId,
          utilisateur: userEmail
        });
      }
      await store.update('mouvementsStock', mv.id, { annule: true });
    }
    return true;
  },

  // Variante synchrone de processConsommation(), pour utilisation À
  // L'INTÉRIEUR d'un store.transaction(tx => ...) (voir commentaire plus
  // haut). Ne PAS appeler en dehors d'une transaction : `tx` n'est pas
  // l'API `store` habituelle.
  processConsommationSync,

  _getRecetteActive: getRecetteActive,
  _calculerBesoins: calculerBesoins,
  _agregerBesoinsParMateriel: agregerBesoinsParMateriel
};
