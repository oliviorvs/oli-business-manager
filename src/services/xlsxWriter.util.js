// src/services/xlsxWriter.util.js
//
// PHASE 3 — EXPORT COMPTABLE : générateur .xlsx SANS DÉPENDANCE NPM
// ============================================================
// Un fichier .xlsx est un simple .zip contenant quelques fichiers XML. Pour
// éviter d'ajouter une nouvelle dépendance npm (et le risque qui va avec —
// binaire natif, taille du bundle, npm install cassé sur un poste sans
// accès réseau) juste pour écrire un tableau de lignes/colonnes, ce module
// construit lui-même ce zip minimal (méthode "stored", sans compression —
// valide selon la spec ZIP, ouvrable tel quel par Excel/LibreOffice/Google
// Sheets) et le XML des feuilles, en pur Node.js (fs/zlib/crypto suffisent).
//
// Portée volontairement limitée aux besoins de l'export comptable : un
// classeur avec plusieurs feuilles, chacune une grille de cellules texte ou
// nombre, avec une ligne d'en-tête. Pas de styles, formules, fusion de
// cellules, etc. — inutile pour un export de journal comptable.
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Construit une archive ZIP (méthode "stored", sans compression) à partir
// d'une liste de { name, data: Buffer }. Implémentation minimale mais
// conforme à la spec ZIP (signatures locales + répertoire central + EOCD).
function creerZip(fichiers) {
  const morceauxLocaux = [];
  const entreesCentrales = [];
  let offset = 0;

  for (const fichier of fichiers) {
    const nomBuf = Buffer.from(fichier.name, 'utf-8');
    const data = fichier.data;
    const crc = crc32(data);

    const headerLocal = Buffer.alloc(30);
    headerLocal.writeUInt32LE(0x04034b50, 0);
    headerLocal.writeUInt16LE(20, 4); // version needed
    headerLocal.writeUInt16LE(0, 6); // flags
    headerLocal.writeUInt16LE(0, 8); // méthode : 0 = stored
    headerLocal.writeUInt16LE(0, 10); // heure
    headerLocal.writeUInt16LE(0x21, 12); // date (valeur arbitraire non nulle)
    headerLocal.writeUInt32LE(crc, 14);
    headerLocal.writeUInt32LE(data.length, 18); // taille compressée
    headerLocal.writeUInt32LE(data.length, 22); // taille non compressée
    headerLocal.writeUInt16LE(nomBuf.length, 26);
    headerLocal.writeUInt16LE(0, 28); // extra field

    morceauxLocaux.push(headerLocal, nomBuf, data);

    const headerCentral = Buffer.alloc(46);
    headerCentral.writeUInt32LE(0x02014b50, 0);
    headerCentral.writeUInt16LE(20, 4); // version made by
    headerCentral.writeUInt16LE(20, 6); // version needed
    headerCentral.writeUInt16LE(0, 8); // flags
    headerCentral.writeUInt16LE(0, 10); // méthode
    headerCentral.writeUInt16LE(0, 12); // heure
    headerCentral.writeUInt16LE(0x21, 14); // date
    headerCentral.writeUInt32LE(crc, 16);
    headerCentral.writeUInt32LE(data.length, 20);
    headerCentral.writeUInt32LE(data.length, 24);
    headerCentral.writeUInt16LE(nomBuf.length, 28);
    headerCentral.writeUInt16LE(0, 30); // extra
    headerCentral.writeUInt16LE(0, 32); // commentaire
    headerCentral.writeUInt16LE(0, 34); // disque de départ
    headerCentral.writeUInt16LE(0, 36); // attributs internes
    headerCentral.writeUInt32LE(0, 38); // attributs externes
    headerCentral.writeUInt32LE(offset, 42); // offset du header local

    entreesCentrales.push(headerCentral, nomBuf);

    offset += headerLocal.length + nomBuf.length + data.length;
  }

  const centralDir = Buffer.concat(entreesCentrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fichiers.length, 8);
  eocd.writeUInt16LE(fichiers.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...morceauxLocaux, centralDir, eocd]);
}

function echapperXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Les caractères de contrôle (hors tabulation/retour ligne) sont
    // invalides en XML 1.0 et feraient échouer l'ouverture du fichier.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function colonneLettre(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Construit le XML d'une feuille à partir d'une grille de valeurs
// (tableau de tableaux). Les valeurs numériques (`typeof === 'number'`)
// sont écrites comme nombres, tout le reste comme texte "inline" (pas de
// table de chaînes partagées — plus simple, largement suffisant pour la
// taille d'un export comptable de PME).
//
// SÉCURITÉ (audit — injection de formule) : une cellule texte commençant
// par =, +, -, @ (ex. un nom de client "comptoir" saisi comme
// `=HYPERLINK(...)`, ou une charge utile DDE) peut être interprétée comme
// une formule par Excel/LibreOffice à l'ouverture du fichier, même si le
// classeur généré ici type explicitement la cellule en texte ("inlineStr").
// Cette neutralisation est la même que celle déjà appliquée à l'export CSV
// des rapports (voir import.service.js#sanitizeCsvField, réutilisée ici
// pour rester cohérent) : un contenu dangereux est préfixé d'une apostrophe,
// qui force son interprétation comme texte littéral quel que soit le
// tableur qui l'ouvre.
function construireFeuilleXml(rows) {
  const { sanitizeCsvField } = require('./import.service');
  const lignesXml = rows.map((row, rIdx) => {
    const cells = row.map((val, cIdx) => {
      const ref = colonneLettre(cIdx) + (rIdx + 1);
      if (val === null || val === undefined || val === '') return `<c r="${ref}"/>`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${ref}"><v>${val}</v></c>`;
      }
      const texte = sanitizeCsvField(val);
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${echapperXml(texte)}</t></is></c>`;
    }).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${lignesXml}</sheetData>` +
    `</worksheet>`;
}

// Construit un classeur .xlsx complet (Buffer prêt à écrire sur disque) à
// partir de plusieurs feuilles : [{ name: 'Journal', rows: [[...],[...]] }].
function construireClasseur(sheets) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    `</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((s, i) => `<sheet name="${echapperXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    `</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `</Relationships>`;

  const fichiers = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf-8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf-8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf-8') }
  ];
  sheets.forEach((s, i) => {
    fichiers.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(construireFeuilleXml(s.rows), 'utf-8') });
  });

  return creerZip(fichiers);
}

module.exports = { construireClasseur };
