// src/services/import.service.js
const fs = require('fs');
const path = require('path');
const taxService = require('./taxService');

// Note: xlsx doit être installé : npm install xlsx
// Version simplifiée avec CSV pour éviter la dépendance

// SÉCURITÉ : neutralise l'injection de formule CSV. Si une valeur importée
// commence par =, +, -, @, tab ou retour chariot, un tableur (Excel, LibreOffice,
// Google Sheets) l'interprète comme une formule à l'ouverture — un attaquant
// pourrait ainsi faire exécuter du code ou exfiltrer des données au moment où
// quelqu'un ré-exporte/rouvre les données (ex : =HYPERLINK(...), =cmd|'/c ...'!A1).
// On préfixe d'une apostrophe pour forcer une interprétation en texte brut.
const CSV_DANGEROUS_PREFIX = /^[=+\-@\t\r]/;
function sanitizeCsvField(value) {
  const str = String(value == null ? '' : value);
  return CSV_DANGEROUS_PREFIX.test(str) ? "'" + str : str;
}

// SÉCURITÉ : limite la taille des fichiers importés pour éviter qu'un fichier
// volumineux (accidentel ou malveillant) ne sature la mémoire du processus.
const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo
const MAX_IMPORT_ROWS = 20000;

function checkImportFile(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_IMPORT_SIZE_BYTES) {
    throw new Error('Le fichier est trop volumineux (limite : 10 Mo)');
  }
}

async function importProduitsFromCSV(filePath, store, userEmail) {
  checkImportFile(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error('Le fichier CSV doit contenir un en-tête et au moins une ligne de données');
  }
  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`Le fichier contient trop de lignes (limite : ${MAX_IMPORT_ROWS})`);
  }
  
  const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
  const produits = [];
  const errors = [];
  const doublons = [];
  
  // Mapper les colonnes
  const colMap = {
    'code': headers.indexOf('code'),
    'designation': headers.indexOf('designation') !== -1 ? headers.indexOf('designation') : headers.indexOf('désignation'),
    'unite': headers.indexOf('unite') !== -1 ? headers.indexOf('unite') : headers.indexOf('unité'),
    'prixachat': headers.indexOf('prix achat') !== -1 ? headers.indexOf('prix achat') : headers.indexOf('prixachat'),
    'prixvente': headers.indexOf('prix vente') !== -1 ? headers.indexOf('prix vente') : headers.indexOf('prixvente'),
    'quantite': headers.indexOf('quantite') !== -1 ? headers.indexOf('quantite') : headers.indexOf('quantité'),
    'seuilmin': headers.indexOf('seuil min') !== -1 ? headers.indexOf('seuil min') : headers.indexOf('seuilmin'),
    'tva': headers.indexOf('tva'),
    'description': headers.indexOf('description')
  };
  
  // Vérifier les colonnes obligatoires
  if (colMap.designation === -1) {
    throw new Error('Colonne "designation" ou "désignation" obligatoire');
  }
  
  // BUGFIX MAJEUR : importer 100 fois le même fichier créait 100 fois le même produit.
  // Aucune détection de doublon n'existait — un code déjà pris était simplement remplacé
  // par un code aléatoire, et la désignation n'était jamais comparée aux produits déjà en
  // base. On construit ici les index (code + désignation normalisée) des produits déjà
  // existants ET de ceux déjà traités dans CE MÊME fichier, pour ignorer proprement tout
  // doublon plutôt que de créer un nouveau produit à chaque fois.
  const produitsExistants = await store.list('produits');
  const codesExistants = new Set(produitsExistants.map(p => String(p.code || '').toLowerCase()));
  const designationsExistantes = new Set(produitsExistants.map(p => String(p.designation || '').trim().toLowerCase()));
  const designationsDuFichier = new Set();
  
  for (let i = 1; i < lines.length; i++) {
    try {
      const cols = lines[i].split(';').map(c => c.trim());
      const codeSaisi = colMap.code !== -1 && cols[colMap.code] ? sanitizeCsvField(cols[colMap.code]).slice(0, 50) : '';
      const designation = sanitizeCsvField(cols[colMap.designation] || '').slice(0, 200);
      const designationNorm = designation.trim().toLowerCase();

      if (!designation) {
        errors.push(`Ligne ${i + 1} : Désignation manquante`);
        continue;
      }

      // Doublon avec un produit déjà existant en base (par code explicite ou désignation)
      if ((codeSaisi && codesExistants.has(codeSaisi.toLowerCase())) || designationsExistantes.has(designationNorm)) {
        doublons.push(`Ligne ${i + 1} : « ${designation} » existe déjà — ignoré`);
        continue;
      }
      // Doublon à l'intérieur du fichier importé lui-même (même désignation répétée)
      if (designationsDuFichier.has(designationNorm)) {
        doublons.push(`Ligne ${i + 1} : « ${designation} » est en double dans le fichier — ignoré`);
        continue;
      }

      const produit = {
        code: codeSaisi || ('PR' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100)),
        designation,
        unite: colMap.unite !== -1 && cols[colMap.unite] ? sanitizeCsvField(cols[colMap.unite]).slice(0, 50) : 'Unité',
        prixAchat: colMap.prixachat !== -1 ? Number(cols[colMap.prixachat]) || 0 : 0,
        prixVente: colMap.prixvente !== -1 ? Number(cols[colMap.prixvente]) || 0 : 0,
        quantite: colMap.quantite !== -1 ? Number(cols[colMap.quantite]) || 0 : 0,
        seuilMin: colMap.seuilmin !== -1 ? Number(cols[colMap.seuilmin]) || 0 : 0,
        // SYSTÈME TVA : une colonne "tva" positive dans le CSV devient un
        // taux SPÉCIFIQUE pour ce produit (comportement le plus proche de
        // l'ancien champ) ; absente ou à 0, le produit suit le taux général
        // de l'entreprise — voir taxService.js#normaliserVat. Une valeur
        // hors 0-100 lève une erreur, capturée par le try/catch de la ligne
        // (voir plus bas), comme n'importe quelle autre ligne invalide.
        vat: (colMap.tva !== -1 && Number(cols[colMap.tva]) > 0)
          ? taxService.normaliserVat({ mode: 'custom', rate: Number(cols[colMap.tva]) })
          : { mode: 'default', rate: null },
        description: colMap.description !== -1 ? sanitizeCsvField(cols[colMap.description] || '').slice(0, 1000) : ''
      };

      if (produit.prixAchat < 0 || produit.prixVente < 0 || produit.quantite < 0 || produit.seuilMin < 0) {
        errors.push(`Ligne ${i + 1} : valeurs numériques négatives ignorées`);
        continue;
      }

      designationsDuFichier.add(designationNorm);
      if (produit.code) codesExistants.add(produit.code.toLowerCase());
      produits.push(produit);
    } catch (err) {
      errors.push(`Ligne ${i + 1} : ${err.message}`);
    }
  }
  
  // Insérer les produits
  // BUGFIX ASYNC : for..of (et non .forEach()) pour pouvoir await
  // store.insert() sur chaque produit dans l'ordre du fichier importé.
  const inserted = [];
  for (const p of produits) {
    const rec = await store.insert('produits', p);
    if (rec) {
      await store.insert('mouvementsStock', {
        produitId: rec.id,
        type: 'entree',
        quantite: rec.quantite,
        motif: 'Import CSV',
        utilisateur: userEmail
      });
      inserted.push(rec);
    }
  }
  
  return { inserted: inserted.length, doublons, errors };
}

async function importProduitsFromExcel(filePath, store, userEmail) {
  // SÉCURITÉ : la dépendance "xlsx" a été retirée de package.json — la
  // dernière version publiée sur le registre npm (0.18.5) contient des
  // vulnérabilités connues et non corrigées côté npm (pollution de
  // prototype, ReDoS). Ne pas la réintroduire sans utiliser une version
  // corrigée distribuée directement par SheetJS (cf. leurs instructions
  // officielles post-0.19.3, hors registre npm), et revalider ce point avant
  // d'activer l'import Excel.
  throw new Error('L\'import Excel n\'est pas disponible. Utilisez le format CSV.');
}

async function importServicesFromCSV(filePath, store, userEmail) {
  checkImportFile(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) throw new Error('Le CSV doit contenir un en-tête et des données');
  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    throw new Error(`Le fichier contient trop de lignes (limite : ${MAX_IMPORT_ROWS})`);
  }
  
  const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
  const colMap = {
    'nom': headers.indexOf('nom'),
    'prixdefaut': headers.indexOf('prixdefaut') !== -1 ? headers.indexOf('prixdefaut') : headers.indexOf('prix'),
    'unite': headers.indexOf('unite') !== -1 ? headers.indexOf('unite') : headers.indexOf('unité'),
    'actif': headers.indexOf('actif')
  };
  if (colMap.nom === -1) throw new Error('Colonne "nom" obligatoire');
  
  const services = [];
  const errors = [];
  const doublons = [];
  // BUGFIX : même faille que pour les produits — aucune détection de doublon.
  const nomsExistants = new Set((await store.list('services')).map(s => String(s.nom || '').trim().toLowerCase()));
  const nomsDuFichier = new Set();
  for (let i = 1; i < lines.length; i++) {
    try {
      const cols = lines[i].split(';').map(c => c.trim());
      const nom = sanitizeCsvField(cols[colMap.nom] || '').slice(0, 200);
      const nomNorm = nom.trim().toLowerCase();
      if (!nom) { errors.push(`Ligne ${i+1} : nom manquant`); continue; }
      if (nomsExistants.has(nomNorm)) { doublons.push(`Ligne ${i+1} : « ${nom} » existe déjà — ignoré`); continue; }
      if (nomsDuFichier.has(nomNorm)) { doublons.push(`Ligne ${i+1} : « ${nom} » est en double dans le fichier — ignoré`); continue; }
      const service = {
        nom,
        prixDefaut: colMap.prixdefaut !== -1 ? Number(cols[colMap.prixdefaut]) || 0 : 0,
        unite: colMap.unite !== -1 ? sanitizeCsvField(cols[colMap.unite] || 'Prestation').slice(0, 50) : 'Prestation',
        actif: colMap.actif !== -1 ? cols[colMap.actif].toLowerCase() !== 'false' : true
      };
      if (service.prixDefaut < 0) { errors.push(`Ligne ${i+1} : prix négatif ignoré`); continue; }
      nomsDuFichier.add(nomNorm);
      services.push(service);
    } catch (err) {
      errors.push(`Ligne ${i+1} : ${err.message}`);
    }
  }
  
  // BUGFIX ASYNC : voir importProduitsFromCSV ci-dessus.
  const inserted = [];
  for (const s2 of services) {
    const rec = await store.insert('services', s2);
    if (rec) inserted.push(rec);
  }
  return { inserted: inserted.length, doublons, errors };
}

module.exports = { importProduitsFromCSV, importProduitsFromExcel, importServicesFromCSV, sanitizeCsvField };