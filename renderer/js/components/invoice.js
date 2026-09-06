import { closeModal, openModal } from './modal.js';
import { call } from '../utils/api.js';
import { clientLabel, dateFr, dateOnlyFr, esc, h, money, montantEnLettres, qs, qsa } from '../utils/helpers.js';

export function setInvoiceAndPreview(container, html) {
  container.innerHTML = html;
  const preview = h(`<div class="print-preview-scale">${html}</div>`);
  openModal('Aperçu avant impression', preview, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: '🖨 Imprimer', cls: 'btn-primary', onClick: () => { closeModal(); window.print(); } }
  ], { wide: true });
}

// AJOUT (audit) : en-tête commun aux 4 documents imprimés (facture,
// facture groupée, devis pro-forma, bon de livraison), avec 2 modèles
// visuels au choix — réglage unique dans Paramètres (meta.modeleDocument),
// appliqué uniformément partout depuis ce seul point d'entrée plutôt que
// dupliqué et risquant de diverger entre les 4 fonctions d'impression.
// Le modèle "classique" reproduit exactement l'en-tête historique
// (comportement inchangé par défaut) ; "moderne" est un second habillage,
// inspiré d'un modèle de facture plus contemporain (bandeau coloré, bloc
// « Destinataire » séparé), sans être la copie conforme d'un visuel
// commercial existant.
//   meta            : réglages entreprise (call('settings:get'))
//   docTitle        : ex. 'FACTURE', 'FACTURE PRO-FORMA', 'BON DE LIVRAISON'
//   numero          : numéro du document (affiché dans le titre en mode moderne)
//   destinataireNom : nom du client / destinataire
//   destinataireExtra : lignes supplémentaires sous le nom (adresse, réf...)
//   infos           : [{ label, value }] — bloc Date/Référence/Terme de paiement...
//   classiqueHtml   : HTML déjà construit pour le modèle classique (inchangé)
function entete(meta, opts) {
  const { docTitle, numero, destinataireNom, destinataireExtra = [], infos = [], classiqueHtml } = opts;
  if (meta.modeleDocument === 'nomade') return enteteNomade(meta, opts);
  if (meta.modeleDocument === 'essentiel') return enteteEssentiel(meta, opts);
  if (meta.modeleDocument !== 'moderne') return classiqueHtml;
  return `
    <div class="doc-mod-top">
      <div class="doc-mod-title">${esc(docTitle)}${numero ? ` n° ${esc(numero)}` : ''}</div>
      ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="doc-mod-logo" />` : `<div class="doc-mod-badge">${esc((meta.entrepriseName || '?').trim().charAt(0).toUpperCase())}</div>`}
    </div>
    <div class="doc-mod-rule"></div>
    <div class="doc-mod-company">
      <div class="name">${esc(meta.entrepriseName)}</div>
      <div>STAT : ${esc(meta.stat)}</div>
      <div>NIF : ${esc(meta.nif)}</div>
      <div>${esc(meta.adresse)}</div>
      <div>${esc(meta.ville)}</div>
      <div>RIB : ${esc(meta.rib)}</div>
      <div>Téléphone : ${esc(meta.telephone)}</div>
      <div class="c-1155cc">${esc(meta.email)}</div>
    </div>
    <div class="doc-mod-row">
      <table class="doc-mod-infos">
        ${infos.map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.value)}</td></tr>`).join('')}
      </table>
      <div class="doc-mod-dest">
        <div class="lbl">Destinataire</div>
        <div class="fw-bold">${esc(destinataireNom)}</div>
        ${destinataireExtra.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('')}
      </div>
    </div>`;
}

// AJOUT (audit) : en-tête du 3e modèle « Nomade » — bandeau logo/brand à
// gauche, titre du document et son numéro à droite (plus de mention
// « Code », voir demande client), puis blocs ÉMETTEUR / DESTINATAIRE côte
// à côte. Le détail Total HT / TVA / Remise / Total TTC est affiché
// séparément après le tableau des lignes (voir totalsBlockApres()), et le
// bloc RÈGLEMENT / mentions légales après le total (voir reglementNomade()).
function enteteNomade(meta, { docTitle, numero, destinataireNom, destinataireExtra = [] }) {
  return `
    <div class="doc-nom-top">
      <div>
        ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="doc-nom-logo" />` : `<div class="doc-nom-badge">${esc((meta.entrepriseName || '?').trim().charAt(0).toUpperCase())}</div>`}
        <div class="doc-nom-brand-name mt-6">${esc(meta.entrepriseName)}</div>
      </div>
      <div>
        <div class="doc-nom-title">${esc(docTitle)}</div>
        ${numero ? `<div class="doc-nom-dates text-right">${esc(docTitle)} N° : ${esc(numero)}</div>` : ''}
      </div>
    </div>
    <div class="doc-nom-row">
      <div class="doc-nom-col">
        <div class="lbl">ÉMETTEUR</div>
        <div>STAT : ${esc(meta.stat)}</div>
        <div>NIF : ${esc(meta.nif)}</div>
        <div>${esc(meta.telephone)}</div>
        <div>${esc(meta.email)}</div>
        <div>${esc(meta.adresse)}</div>
        <div>${esc(meta.ville)}</div>
        <div>RIB : ${esc(meta.rib)}</div>
      </div>
      <div class="doc-nom-col right">
        <div class="lbl">DESTINATAIRE</div>
        <div class="fw-bold">${esc(destinataireNom)}</div>
        ${destinataireExtra.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('')}
      </div>
    </div>`;
}

// AJOUT (audit) : en-tête du 4e modèle « Essentiel » — logo/brand et bloc
// Destinataire groupés à gauche, date à droite, titre du document centré
// avec son numéro (plus de mention « Code »). La remise est affichée
// ligne par ligne dans le tableau (voir ligneRemiseEssentiel()) plutôt
// qu'en un total agrégé comme sur « Nomade ».
function enteteEssentiel(meta, { docTitle, numero, destinataireNom, destinataireExtra = [], infos = [] }) {
  const dateInfo = infos.find((i) => i.label === 'Date');
  return `
    <div class="doc-ess-top">
      <div>
        <div class="doc-ess-brand">
          ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="doc-ess-logo" />` : `<div class="doc-ess-badge">${esc((meta.entrepriseName || '?').trim().charAt(0).toUpperCase())}</div>`}
          <div class="doc-ess-brand-name">${esc(meta.entrepriseName)}</div>
        </div>
        <div class="doc-ess-dest">
          <div class="lbl">Destinataire :</div>
          <div class="fw-bold">${esc(destinataireNom)}</div>
          ${destinataireExtra.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('')}
        </div>
      </div>
      <div class="doc-ess-dates">
        ${dateInfo ? `<div>Date de facturation : ${esc(dateInfo.value)}</div>` : ''}
      </div>
    </div>
    <div class="doc-ess-title">${esc(docTitle)}${numero ? ` N° ${esc(numero)}` : ''}</div>`;
}

// ------------------------- Totaux (TVA / remise) -------------------------
// SYSTÈME TVA (§7/§15) : calcule le détail Total HT / remise / TVA / Total
// TTC utilisé par les 4 modèles de document, à partir des montants FIGÉS
// dans chaque ligne (l.vatRate/l.vatAmount, posés une fois pour toutes par
// taxService.js au moment de la vente/de l'achat) — jamais depuis le
// réglage ACTUEL de l'entreprise (taxSettings), qui peut avoir changé
// depuis. Les lignes de vente / devis stockent déjà un pourcentage de
// remise appliqué au prix unitaire (voir editorLignes.js) ; remiseTotal
// reconstitue le montant total de cette remise pour l'afficher
// explicitement — les modèles Classique/Moderne le laissent implicite dans
// le sous-total de chaque ligne. Pour un document sans aucune TVA figée
// (TVA désactivée à l'époque, ou document antérieur à ce système), tva = 0
// et totalHT = totalTTC : les modèles Classique/Moderne, qui réutilisent
// totalTTC pour rester identiques à avant, ne sont donc pas affectés.
//
// `total` (le paramètre reçu ici) est TOUJOURS le montant réellement
// enregistré par vente.service.js — c'est LUI qui sert de référence partout
// ailleurs dans l'application : montantPaye, solde restant dû
// (vente.service.js#payer), trésorerie, dashboard, rapports et écritures
// comptables (ecritureComptable.service.js) s'appuient tous sur ce même
// montant TTC. On ne le recalcule donc jamais ici : totalTTC = total, et
// totalHT/tva en sont dérivés par simple soustraction des montants déjà
// figés dans les lignes.
function calculTotaux(meta, lignes, total) {
  const totalTTC = Number(total) || 0;
  const remiseTotal = (lignes || []).reduce((s, l) => {
    const brut = Number(l.quantite) * Number(l.prixUnitaire);
    return s + Math.max(0, brut - Number(l.sousTotal));
  }, 0);
  // SYSTÈME TVA (§7/§15) : chaque ligne porte désormais son propre taux et
  // montant de TVA, FIGÉS au moment de la vente/de l'achat (voir
  // taxService.js#calculateLineFromHT) — on les additionne directement
  // plutôt que de les extraire par déduction depuis meta.tauxTva, qui ne
  // reflète que le réglage ACTUEL de l'entreprise et peut avoir changé
  // depuis l'émission de ce document. Un document antérieur à ce système
  // (lignes sans vatAmount) affiche naturellement 0 de TVA — comme avant
  // l'introduction de taxSettings, sans aucune régression pour l'historique.
  const tva = Math.round((lignes || []).reduce((s, l) => s + (Number(l.vatAmount) || 0), 0) * 100) / 100;
  const totalHT = Math.round((totalTTC - tva) * 100) / 100;
  // Détail par taux (§7 : une facture peut regrouper plusieurs ventes, donc
  // plusieurs taux différents — voir printFactureGroupee plus bas).
  const parTaux = new Map();
  (lignes || []).forEach((l) => {
    const t = Number(l.vatRate) || 0;
    const m = Number(l.vatAmount) || 0;
    parTaux.set(t, Math.round(((parTaux.get(t) || 0) + m) * 100) / 100);
  });
  const detailParTaux = Array.from(parTaux.entries())
    .filter(([t, m]) => t > 0 || m > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([taux, montant]) => ({ taux, montant }));
  // `taux` reste un simple nombre pour le cas le plus courant (un seul taux
  // sur tout le document) — conservé pour compatibilité d'affichage ; le
  // détail complet (utile si plusieurs taux coexistent) est dans
  // `detailParTaux`, utilisé par totalsBlockApres ci-dessous.
  const taux = detailParTaux.length === 1 ? detailParTaux[0].taux : 0;
  return { totalHT, remiseTotal, taux, tva, totalTTC, detailParTaux };
}

// Bloc de synthèse affiché après le tableau des lignes.
// CORRECTIF (audit) : la mention de la TVA (ligne « TVA x% » + distinction
// Total HT / Total TTC) ne doit apparaître que si la TVA est réellement
// applicable à CE document — c'est-à-dire si au moins une de ses lignes
// porte effectivement un montant de TVA figé (tva > 0), et non plus selon
// le réglage ACTUEL de l'entreprise (meta.tauxTva/taxSettings), qui peut
// avoir changé depuis l'émission du document (§15, gel historique).
function totalsBlockApres(meta, lignes, total) {
  const { totalHT, remiseTotal, taux, tva, totalTTC, detailParTaux } = calculTotaux(meta, lignes, total);
  const tvaApplicable = tva > 0;
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
  // Une ou plusieurs lignes « TVA x% » selon le nombre de taux distincts
  // réellement présents dans le document (§7 : un document peut regrouper
  // des lignes à des taux différents).
  const lignesTvaNomade = detailParTaux.map((d) => `<tr><td>TVA ${d.taux}%</td><td>${fmt(d.montant)}</td></tr>`).join('');
  const lignesTvaEssentiel = detailParTaux.map((d) => `<tr><td>TVA (${d.taux}%)</td><td>${fmt(d.montant)}</td></tr>`).join('');
  const lignesTvaClassique = detailParTaux.map((d) => `<tr><td>TVA (${d.taux}%)</td><td>${fmt(d.montant)}</td></tr>`).join('');
  // CORRECTIF (audit) : le libellé du total final (« TOTAL TTC ») n'a de
  // sens que si de la TVA entre effectivement dans le montant. Quand elle
  // n'est pas applicable, garder la mention « TTC » (toutes taxes comprises)
  // est trompeur — il n'y a alors qu'un seul montant, ni HT ni TTC. On
  // affiche donc « TOTAL » (Nomade) / « Total » (Essentiel) simple dans ce
  // cas, et on ne garde le suffixe « TTC » que lorsque tvaApplicable.
  if (meta.modeleDocument === 'nomade') {
    return `<table class="doc-nom-totals">
        ${tvaApplicable ? `<tr><td>TOTAL HT</td><td>${fmt(totalHT)}</td></tr>
        ${lignesTvaNomade}` : ''}
        <tr><td>REMISE</td><td>${remiseTotal > 0 ? '-' + fmt(remiseTotal) : '-'}</td></tr>
        <tr class="grand"><td>${tvaApplicable ? 'TOTAL TTC' : 'TOTAL'}</td><td>${fmt(totalTTC)}</td></tr>
      </table>
      ${reglementNomade(meta)}`;
  }
  if (meta.modeleDocument === 'essentiel') {
    return `<table class="doc-ess-totals">
      ${tvaApplicable ? `<tr><td>Total</td><td>${fmt(totalHT)}</td></tr>
      ${lignesTvaEssentiel}` : ''}
      <tr class="grand"><td>${tvaApplicable ? 'Total TTC' : 'Total'}</td><td>${fmt(totalTTC)}</td></tr>
    </table>
    ${footerEssentiel(meta)}`;
  }
  // Classique / Moderne : pas de bloc récapitulatif si la TVA n'est pas
  // applicable (la ligne « MONTANT TOTAL » déjà présente dans le tableau
  // des lignes suffit).
  if (!tvaApplicable) return '';
  return `<table class="inv-tva-recap">
      <tr><td>Total HT</td><td>${fmt(totalHT)}</td></tr>
      ${lignesTvaClassique}
      <tr class="grand"><td>Total TTC</td><td>${fmt(totalTTC)}</td></tr>
    </table>`;
}

// Bloc RÈGLEMENT + mention légale, affiché sous le total en modèle
// « Nomade » (voir image de référence : bandeau bancaire + mention de
// pénalité de retard).
function reglementNomade(meta) {
  return `<div class="doc-nom-reglement">
      <div class="lbl">RÈGLEMENT :</div>
      <div>Par virement bancaire</div>
      ${meta.banqueNom ? `<div>Banque : ${esc(meta.banqueNom)}</div>` : ''}
      ${meta.rib ? `<div>Compte : ${esc(meta.rib)}</div>` : ''}
    </div>
    <div class="doc-nom-footer">En cas de retard de paiement, une pénalité de retard ainsi que des frais de recouvrement pourront être appliqués, conformément aux conditions générales de vente.</div>`;
}

// Pied de page « Essentiel » : coordonnées complètes de l'entreprise +
// coordonnées bancaires, sur le modèle du bandeau à 3 colonnes de l'image
// de référence.
function footerEssentiel(meta) {
  return `<div class="doc-ess-footer">
      <div class="grp"><b>${esc(meta.entrepriseName)}</b><div>STAT : ${esc(meta.stat)}</div><div>NIF : ${esc(meta.nif)}</div><div>${esc(meta.adresse)}</div><div>${esc(meta.ville)}</div></div>
      <div class="grp"><b>Téléphone</b><div>${esc(meta.telephone)}</div><div>${esc(meta.email)}</div></div>
      <div class="grp"><b>${meta.banqueNom ? esc(meta.banqueNom) : 'Coordonnées bancaires'}</b><div>RIB : ${esc(meta.rib)}</div></div>
    </div>`;
}

// Ligne de remise affichée sous une ligne d'article en modèle « Essentiel »
// (remise ligne par ligne, plutôt qu'un total agrégé comme sur « Nomade »).
// colspan doit couvrir toutes les colonnes du tableau sauf la dernière
// (montant), pour s'aligner avec la ligne d'article correspondante.
function ligneRemiseEssentiel(meta, l, colspan) {
  if (meta.modeleDocument !== 'essentiel' || !l.remise) return '';
  const montantRemise = Math.round((Number(l.quantite) * Number(l.prixUnitaire) - Number(l.sousTotal)) * 100) / 100;
  if (montantRemise <= 0) return '';
  return `<tr class="remise-row"><td colspan="${colspan}" class="text-right">${esc(l.designation)} (Remise ${l.remise}%)</td><td class="text-right">-${montantRemise.toLocaleString('fr-FR')}</td></tr>`;
}

// ------------------------- Colonnes personnalisables (tableaux) -------------------------
// Permet de masquer/afficher des colonnes dans les grands tableaux, selon les
// besoins de l'utilisateur. Le choix est mémorisé par tableau et par
// utilisateur (localStorage).
export async function printFactureGroupee(ventesChoisies, client) {
  const meta = await call('settings:get');

  const derniereVente = [...ventesChoisies].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const numero = derniereVente.numero;
  const maintenant = new Date().toISOString();
  const clientNom = client ? (client.nom + ' ' + client.prenom).trim() : 'Client comptoir';
  const lignes = ventesChoisies.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).flatMap((v) => v.lignes);
  const total = ventesChoisies.reduce((s, v) => s + v.total, 0);
  const referencesVentes = ventesChoisies.map((v) => v.numero).join(', ');
  const largeurs = ['40%', '12%', '15%', '12%', '21%'];
  const { totalTTC, tva } = calculTotaux(meta, lignes, total);
  // CORRECTIF (demande) : quand la TVA est applicable, les modèles
  // Classique/Moderne n'affichent plus la ligne « MONTANT TOTAL » du
  // tableau — seul le bloc récapitulatif Total HT / TVA / Total TTC
  // (totalsBlockApres) est conservé, pour ne pas dupliquer le total.
  const tvaApplicable = tva > 0;

  const contenu = `
    ${entete(meta, {
      docTitle: 'FACTURE', numero, destinataireNom: clientNom,
      destinataireExtra: [`Regroupe les ventes : ${referencesVentes}`],
      infos: [{ label: 'Date', value: dateOnlyFr(maintenant) }],
      classiqueHtml: `
    <div class="flex justify-between items-start mb-18">
      <div class="flex gap-12 items-start">
        ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="w-76 h-76 object-contain" />` : ''}
        <div class="fs-11_5 text-center fw-bold lh-1_4">
          <div class="fs-13">${esc(meta.entrepriseName)}</div>
          <div>STAT : ${esc(meta.stat)}</div>
          <div>NIF : ${esc(meta.nif)}</div>
          <div>${esc(meta.adresse)}</div>
          <div>RIB : ${esc(meta.rib)}</div>
          <div>Tél : ${esc(meta.telephone)}</div>
          <div class="c-1155cc underline">${esc(meta.email)}</div>
        </div>
      </div>
      <div class="text-right minw-260">
        <div class="mb-6"><u><strong>Doit</strong></u> : <strong>${esc(clientNom)}</strong></div>
        <div class="mb-6"><strong><u>DATE :</u></strong> ${dateOnlyFr(maintenant)}</div>
        <div class="fs-11 c-555">Regroupe les ventes : ${esc(referencesVentes)}</div>
      </div>
    </div>
    <div class="text-center fs-26 fw-800 mb-14">FACTURE N° ${esc(numero)}</div>` })}
    <table class="w-100p border-collapse fs-12_5 mb-10 table-fixed">
      <colgroup>${largeurs.map((w) => `<col class="inv-col" style="--w:${w}">`).join('')}</colgroup>
      <thead><tr class="bg-f2f2f2">
        <th class="border-1px-solid-333 p-6 text-center">Désignation</th>
        <th class="border-1px-solid-333 p-6 text-center">Unité</th>
        <th class="border-1px-solid-333 p-6 text-center">Quantité</th>
        <th class="border-1px-solid-333 p-6 text-center">P.U</th>
        <th class="border-1px-solid-333 p-6 text-center">TOTAL EN ${(meta.devise === 'Ar' ? 'ARIARY' : esc(meta.devise))}</th>
      </tr></thead>
      <tbody>
        ${lignes.map((l) => `<tr>
          <td class="border-1px-solid-333 p-6">${esc(l.designation)}${l.details ? `<br/><span class="fs-10_5 c-555">${esc(l.details)}</span>` : ''}</td>
          <td class="border-1px-solid-333 p-6 text-center">${esc(l.unite || 'Unité')}</td>
          <td class="border-1px-solid-333 p-6 text-center">${l.quantite}</td>
          <td class="border-1px-solid-333 p-6 text-right">${Number(l.prixUnitaire).toLocaleString('fr-FR')}</td>
          <td class="border-1px-solid-333 p-6 text-right">${Number(l.sousTotal).toLocaleString('fr-FR')}</td>
        </tr>${ligneRemiseEssentiel(meta, l, 4)}`).join('')}
        ${(['nomade', 'essentiel'].includes(meta.modeleDocument) || tvaApplicable) ? '' : `<tr><td colspan="4" class="border-1px-solid-333 p-6 fw-bold text-center">MONTANT TOTAL</td><td class="border-1px-solid-333 p-6 text-right fw-bold ${meta.modeleDocument === 'moderne' ? 'doc-mod-total-ttc' : ''}">${Number(totalTTC).toLocaleString('fr-FR')}</td></tr>`}
      </tbody>
    </table>
    ${totalsBlockApres(meta, lignes, total)}
    <div class="mb-16 fs-12_5">Arrêtée la présente facture à la somme de : <strong><em>${montantEnLettres(totalTTC)} ${meta.devise === 'Ar' ? 'Ariary' : esc(meta.devise)} (${Number(totalTTC).toLocaleString('fr-FR')} ${esc(meta.devise)})</em></strong></div>
    <div class="flex justify-between fs-12_5">
      <div>Client(e)</div>
      <div class="text-right">
        <div>Fait à ${esc(meta.ville)}, le ${dateOnlyFr(maintenant)}</div>
        <div class="fw-bold">Le Fournisseur</div>
        <div class="h-40"></div>
        <div class="fw-bold">${esc(meta.gerantNom)}</div>
        <div class="fw-bold">${esc(meta.gerantTitre)}</div>
      </div>
    </div>`;
  const container = qs('#invoice-print');
  setInvoiceAndPreview(container, `<style>@page { size: A4 portrait; margin: 14mm; }</style><div class="font-print c-111">${contenu}</div>`);
}

export async function printProforma(proforma, clients) {
  const meta = await call('settings:get');
  const clientNom = clientLabel(proforma, clients);
  const modeLabel = { especes: 'Espèce', mobile_money: 'Mobile Money', carte: 'Carte bancaire', virement: 'Virement', mixte: 'Paiement mixte' }[proforma.modePaiement] || proforma.modePaiement;
  const { totalTTC, tva } = calculTotaux(meta, proforma.lignes, proforma.total);
  // CORRECTIF (demande) : voir printFactureGroupee — même règle pour la
  // ligne « MONTANT TOTAL » du tableau en Classique/Moderne.
  const tvaApplicable = tva > 0;
  const contenu = `
    ${entete(meta, {
      docTitle: 'FACTURE PRO-FORMA', numero: proforma.numero, destinataireNom: clientNom,
      infos: [{ label: 'Terme de paiement', value: modeLabel }],
      classiqueHtml: `
    <div class="flex justify-between items-start mb-14">
      <div class="flex gap-12 items-start">
        ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="w-76 h-76 object-contain" />` : ''}
        <div class="fs-11_5 text-center fw-bold lh-1_4">
          <div class="fs-13">${esc(meta.entrepriseName)}</div>
          <div>STAT : ${esc(meta.stat)}</div>
          <div>NIF : ${esc(meta.nif)}</div>
          <div>${esc(meta.adresse)}</div>
          <div>RIB : ${esc(meta.rib)}</div>
          <div>Tél : ${esc(meta.telephone)}</div>
          <div class="c-1155cc underline">${esc(meta.email)}</div>
        </div>
      </div>
      <div class="text-right minw-260">
        <div class="mb-5"><u><strong>Doit</strong></u> : <strong>${esc(clientNom)}</strong></div>
        <div><strong><u>Terme de paiement :</u></strong> ${esc(modeLabel)}</div>
      </div>
    </div>
    <div class="text-center fs-26 fw-800 mb-14">FACTURE PRO-FORMA N° ${esc(proforma.numero)}</div>` })}
    ${proforma.objet ? `<div class="mb-12 fs-12_5"><u><strong>OBJET</strong></u> : ${esc(proforma.objet)}</div>` : ''}
    <table class="w-100p border-collapse fs-12_5 mb-10 table-fixed">
      <colgroup><col class="w-8p"><col class="w-36p"><col class="w-10p"><col class="w-14p"><col class="w-14p"><col class="w-17p"></colgroup>
      <thead><tr class="bg-f2f2f2">
        <th class="border-1px-solid-333 p-6 text-center">N°</th>
        <th class="border-1px-solid-333 p-6 text-center">Désignation</th>
        <th class="border-1px-solid-333 p-6 text-center">Unité</th>
        <th class="border-1px-solid-333 p-6 text-center">Quantité</th>
        <th class="border-1px-solid-333 p-6 text-center">P.U</th>
        <th class="border-1px-solid-333 p-6 text-center">Montant</th>
      </tr></thead>
      <tbody>
        ${proforma.lignes.map((l, i) => `<tr>
          <td class="border-1px-solid-333 p-6 text-center">${String(i + 1).padStart(2, '0')}</td>
          <td class="border-1px-solid-333 p-6">${esc(l.designation)}${l.details ? `<br/><span class="fs-10_5 c-555">${esc(l.details)}</span>` : ''}</td>
          <td class="border-1px-solid-333 p-6 text-center">${esc(l.unite || 'Unité')}</td>
          <td class="border-1px-solid-333 p-6 text-center">${l.quantite}</td>
          <td class="border-1px-solid-333 p-6 text-right">${Number(l.prixUnitaire).toLocaleString('fr-FR')}</td>
          <td class="border-1px-solid-333 p-6 text-right">${Number(l.sousTotal).toLocaleString('fr-FR')}</td>
        </tr>${ligneRemiseEssentiel(meta, l, 5)}`).join('')}
        ${(['nomade', 'essentiel'].includes(meta.modeleDocument) || tvaApplicable) ? '' : `<tr><td colspan="5" class="border-1px-solid-333 p-6 fw-bold text-center">MONTANT TOTAL</td><td class="border-1px-solid-333 p-6 text-right fw-bold ${meta.modeleDocument === 'moderne' ? 'doc-mod-total-ttc' : ''}">${Number(totalTTC).toLocaleString('fr-FR')}</td></tr>`}
      </tbody>
    </table>
    ${totalsBlockApres(meta, proforma.lignes, proforma.total)}
    <div class="fact-espace"></div>
    <div class="mb-16 fs-12_5">Arrêtée la présente facture pro-forma à la somme de : <strong><em>${montantEnLettres(totalTTC)} ${meta.devise === 'Ar' ? 'Ariary' : esc(meta.devise)} (${Number(totalTTC).toLocaleString('fr-FR')} ${esc(meta.devise)})</em></strong></div>
    <div class="flex justify-between fs-12_5">
      <div>Client</div>
      <div class="text-right">
        <div>Fait à ${esc(meta.ville)}, le ${dateOnlyFr(proforma.createdAt)}</div>
        <div class="fw-bold">Le Fournisseur</div>
        <div class="h-40"></div>
        <div class="fw-bold">${esc(meta.gerantNom)}</div>
        <div class="fw-bold">${esc(meta.gerantTitre)}</div>
      </div>
    </div>`;
  const container = qs('#invoice-print');
  setInvoiceAndPreview(container, `<style>@page { size: A4 portrait; margin: 14mm; }</style><div class="font-print c-111">${contenu}</div>`);
}

// ------------------------- Page : Bon de livraison -------------------------
export async function printBonLivraison(bl) {
  const [meta, clients] = await Promise.all([call('settings:get'), call('clients:list')]);
  const clientNomAffiche = clientLabel(bl, clients);
  const contenu = `
    ${entete(meta, {
      docTitle: 'BON DE LIVRAISON', numero: bl.numero, destinataireNom: clientNomAffiche,
      destinataireExtra: [bl.contrat ? `Contrat n° ${bl.contrat}` : null, `Réf. facture ${bl.venteNumero}`],
      infos: [
        ...(bl.termePaiement ? [{ label: 'Terme de paiement', value: bl.termePaiement }] : [])
      ],
      classiqueHtml: `
    <div class="flex justify-between items-start mb-14">
      <div class="flex gap-12 items-start">
        ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="w-76 h-76 object-contain" />` : ''}
        <div class="fs-11_5 text-center fw-bold lh-1_4">
          <div class="fs-13">${esc(meta.entrepriseName)}</div>
          <div>STAT : ${esc(meta.stat)}</div>
          <div>NIF : ${esc(meta.nif)}</div>
          <div>${esc(meta.adresse)}</div>
          <div>RIB : ${esc(meta.rib)}</div>
          <div>Tél : ${esc(meta.telephone)}</div>
          <div class="c-1155cc underline">${esc(meta.email)}</div>
        </div>
      </div>
      <div class="mb-14">
        <div class="mb-5 fs-12_5"><u><strong>Doit</strong></u> : <strong>${esc(clientNomAffiche)}</strong></div>
        ${bl.contrat ? `<div class="mb-5 fs-12_5"><strong><u>Contrat- N</u></strong> ${esc(bl.contrat)}</div>` : ''}
        <div class="mb-5 fs-12_5 c-555">(réf. facture ${esc(bl.venteNumero)})</div>
        ${bl.termePaiement ? `<div class="fs-12_5"><strong><u>Terme de paiement :</u></strong> ${esc(bl.termePaiement)}</div>` : ''}
      </div>
    </div>
    <div class="text-center fs-26 fw-800 mb-14">BON DE LIVRAISON N° ${esc(bl.numero)}</div>` })}
    ${bl.objet ? `<div class="mb-12 fs-12_5"><u><strong>OBJET</strong></u> : ${esc(bl.objet)}</div>` : ''}
    <table class="w-100p border-collapse fs-12_5 mb-16 table-fixed">
      <colgroup><col class="w-8p"><col class="w-44p"><col class="w-14p"><col class="w-17p"><col class="w-17p"></colgroup>
      <thead><tr class="bg-f2f2f2">
        <th class="border-1px-solid-333 p-6 text-center">N°</th>
        <th class="border-1px-solid-333 p-6 text-center">Désignation</th>
        <th class="border-1px-solid-333 p-6 text-center">Unité</th>
        <th class="border-1px-solid-333 p-6 text-center">Quantité commandée</th>
        <th class="border-1px-solid-333 p-6 text-center">Quantité livrée</th>
      </tr></thead>
      <tbody>
        ${bl.lignes.map((l, i) => `<tr>
          <td class="border-1px-solid-333 p-6 text-center">${String(i + 1).padStart(2, '0')}</td>
          <td class="border-1px-solid-333 p-6">${esc(l.designation)} ${l.details ? `<br/><span class="fs-10_5 c-555">${esc(l.details)}</span>` : ''}</td>
          <td class="border-1px-solid-333 p-6 text-center">${esc(l.unite || 'Unité')}</td>
          <td class="border-1px-solid-333 p-6 text-center">${l.quantiteCommandee}</td>
          <td class="border-1px-solid-333 p-6 text-center">${l.quantiteLivree}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="fact-espace"></div>
    <div class="flex justify-between fs-12_5">
      <div>Client</div>
      <div class="text-right">
        <div>Fait à ${esc(meta.ville)}, le ${dateOnlyFr(bl.dateLivraison)}</div>
        <div class="fw-bold">Le Fournisseur</div>
        <div class="h-40"></div>
        <div class="fw-bold">${esc(meta.gerantNom)}</div>
        <div class="fw-bold">${esc(meta.gerantTitre)}</div>
      </div>
    </div>`;
  const container = qs('#invoice-print');
  setInvoiceAndPreview(container, `<style>@page { size: A4 portrait; margin: 14mm; }</style><div class="font-print c-111">${contenu}</div>`);
}

// ------------------------- Facture -------------------------

export function openFormatFactureChoix(vente, clients) {
  const body = h(`<div>
    <p class="muted mb-14">Choisissez la mise en page et la date d'impression pour cette facture.</p>
    <div class="field">
      <label>Date à afficher sur la facture</label>
      <div class="flex gap-10 flex-wrap">
        <button type="button" class="btn btn-ghost btn-sm date-choice active" data-mode="vente">Date de la vente (${dateOnlyFr(vente.createdAt)})</button>
        <button type="button" class="btn btn-ghost btn-sm date-choice" data-mode="aujourdhui">Date du jour (${dateOnlyFr(new Date().toISOString())})</button>
      </div>
    </div>
    <div class="field">
      <label>Format d'impression</label>
      <div class="flex flex-col gap-10">
        <button type="button" class="btn btn-ghost justify-start p-14-16 format-choice active" data-format="a4">
          <strong class="mr-8">A4</strong> — une facture, pleine page
        </button>
        <button type="button" class="btn btn-ghost justify-start p-14-16 format-choice" data-format="a5x2">
          <strong class="mr-8">A5 × 2</strong> — deux copies côte à côte sur une page A4
        </button>
      </div>
    </div>
  </div>`);

  let selectedDate = 'vente';
  let selectedFormat = 'a4';

  qsa('.date-choice', body).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.date-choice', body).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDate = btn.dataset.mode;
    });
  });

  qsa('.format-choice', body).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.format-choice', body).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = btn.dataset.format;
    });
  });

  openModal('Options d\'impression', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Imprimer', cls: 'btn-primary', onClick: () => { 
      closeModal(); 
      printInvoice(vente, clients, selectedFormat, selectedDate); 
    } }
  ]);
}

export async function printInvoice(vente, clients, format = 'a4', dateMode = 'vente') {
  const meta = await call('settings:get');
  const clientNom = clients ? clientLabel(vente, clients) : (vente.clientNom || 'Client comptoir');
  const modeLabel = { especes: 'Espèce', mobile_money: 'Mobile Money', carte: 'Carte bancaire', virement: 'Virement', mixte: 'Paiement mixte' }[vente.modePaiement] || vente.modePaiement;
  const compact = format === 'a5x2';
  
  // Date à afficher
  const dateAffichage = dateMode === 'aujourdhui' ? new Date().toISOString() : vente.createdAt;
  
  const largeurs = ['40%', '12%', '15%', '12%', '21%'];
  const { totalTTC, tva } = calculTotaux(meta, vente.lignes, vente.total);
  // CORRECTIF (demande) : voir printFactureGroupee — même règle pour la
  // ligne « MONTANT TOTAL » du tableau en Classique/Moderne.
  const tvaApplicable = tva > 0;

  function bloc() {
    return `
    ${entete(meta, {
      docTitle: 'FACTURE', numero: vente.numero, destinataireNom: clientNom,
      infos: [
        { label: 'Date', value: dateOnlyFr(dateAffichage) },
        { label: 'Terme de paiement', value: modeLabel }
      ],
      classiqueHtml: `
    <div class="inv-head">
      <div class="inv-brand">
        ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="inv-logo" />` : ''}
        <div class="inv-company">
          <div class="inv-company-name">${esc(meta.entrepriseName)}</div>
          <div>STAT : ${esc(meta.stat)}</div>
          <div>NIF : ${esc(meta.nif)}</div>
          <div>${esc(meta.adresse)}</div>
          <div>RIB : ${esc(meta.rib)}</div>
          <div>Tél : ${esc(meta.telephone)}</div>
          <div class="c-1155cc underline">${esc(meta.email)}</div>
        </div>
      </div>
      <div class="inv-meta">
        <div class="inv-meta-line"><u><strong>Doit</strong></u> : <strong>${esc(clientNom)}</strong></div>
        <div class="inv-meta-line"><strong><u>DATE :</u></strong> ${dateOnlyFr(dateAffichage)}</div>
        <div><strong><u>Terme de paiement :</u></strong> ${esc(modeLabel)}</div>
      </div>
    </div>
    <div class="inv-title">FACTURE N° ${esc(vente.numero)}</div>` })}
    <table class="inv-table">
      <colgroup>${largeurs.map((w) => `<col class="inv-col" style="--w:${w}">`).join('')}</colgroup>
      <thead><tr class="bg-f2f2f2">
        <th class="text-center">Désignation</th>
        <th class="text-center">Unité</th>
        <th class="text-center">Quantité</th>
        <th class="text-center">P.U</th>
        <th class="text-center">TOTAL EN ${(meta.devise === 'Ar' ? 'ARIARY' : esc(meta.devise))}</th>
      </tr></thead>
      <tbody>
        ${vente.lignes.map((l) => `<tr>
          <td class="inv-cell-wrap">${esc(l.designation)}${l.details ? `<br/><span class="inv-detail">${esc(l.details)}</span>` : ''}</td>
          <td class="text-center">${esc(l.unite || 'Unité')}</td>
          <td class="text-center">${l.quantite}</td>
          <td class="text-right">${Number(l.prixUnitaire).toLocaleString('fr-FR')}</td>
          <td class="text-right">${Number(l.sousTotal).toLocaleString('fr-FR')}</td>
        </tr>${ligneRemiseEssentiel(meta, l, 4)}`).join('')}
        ${(['nomade', 'essentiel'].includes(meta.modeleDocument) || tvaApplicable) ? '' : `<tr><td colspan="4" class="fw-bold text-center">MONTANT TOTAL</td><td class="text-right fw-bold ${meta.modeleDocument === 'moderne' ? 'doc-mod-total-ttc' : ''}">${Number(totalTTC).toLocaleString('fr-FR')}</td></tr>`}
      </tbody>
    </table>
    ${totalsBlockApres(meta, vente.lignes, vente.total)}
    <div class="fact-espace"></div>
    <div class="inv-total-line">Arrêtée la présente facture à la somme de : <strong><em>${montantEnLettres(totalTTC)} ${meta.devise === 'Ar' ? 'Ariary' : esc(meta.devise)} (${Number(totalTTC).toLocaleString('fr-FR')} ${esc(meta.devise)})</em></strong></div>
    <div class="flex justify-between">
      <div>Client(e)</div>
      <div class="text-right">
        <div>Fait à ${esc(meta.ville)}, le ${dateOnlyFr(dateAffichage)}</div>
        <div class="fw-bold">Le Fournisseur</div>
        <div class="inv-sign-gap"></div>
        <div class="fw-bold">${esc(meta.gerantNom)}</div>
        <div class="fw-bold">${esc(meta.gerantTitre)}</div>
      </div>
    </div>`;
  }

  const container = qs('#invoice-print');
  const styleAPage = compact
    ? `@page { size: A4 landscape; margin: 8mm; }`
    : `@page { size: A4 portrait; margin: 14mm; }`;
  const blocClass = 'inv-block' + (compact ? ' compact' : '');
  const contenu = compact
    ? `<div class="flex">
         <div class="w-50p box-border pr-6mm ${blocClass}">${bloc()}</div>
         <div class="w-50p box-border pl-6mm bl-1px-dashed-999 ${blocClass}">${bloc()}</div>
       </div>`
    : `<div class="${blocClass}">${bloc()}</div>`;
  setInvoiceAndPreview(container, `<style>${styleAPage}</style><div class="font-print c-111">${contenu}</div>`);
}

// ------------------------- Page : Services -------------------------
export async function imprimerEtatFinancier(data, periodeLabel) {
  const meta = await call('settings:get');
  const ligne = (label, valeur, gras) => `<tr><td class="p-5-0${gras ? ' fw-bold' : ''}">${esc(label)}</td><td class="p-5-0 text-right${gras ? ' fw-bold' : ''}">${valeur}</td></tr>`;
  const section = (titre) => `<tr><td colspan="2" class="p-14-0-4 fw-bold fs-13 bb-1px-solid-333">${esc(titre)}</td></tr>`;
  const contenu = `
    <div class="font-print c-111 maxw-720">
      <div class="flex justify-between items-center mb-6 bb-2px-solid-333 pb-10">
        <div class="flex gap-10 items-center">
          ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="w-52 h-52 object-contain" />` : ''}
          <div class="fw-bold fs-14">${esc(meta.entrepriseName)}</div>
        </div>
        <div class="text-right">
          <div class="fs-20 fw-800">ÉTAT FINANCIER</div>
          <div class="fs-11 c-555">${esc(periodeLabel)}</div>
        </div>
      </div>
      <table class="w-100p border-collapse fs-12_5">
        ${section("Produits d'exploitation")}
        ${ligne('Ventes de produits', money(data.produits.ventesProduits))}
        ${ligne('Ventes de services', money(data.produits.ventesServices))}
        ${ligne('Total produits', money(data.produits.total), true)}
        ${section("Charges d'exploitation")}
        ${ligne('Coût des marchandises vendues', money(data.charges.coutMarchandisesVendues))}
        ${data.charges.depensesParCategorie.map((d) => ligne(d.categorie, money(d.montant))).join('')}
        ${ligne('Total charges', money(data.charges.totalCharges), true)}
        ${section('Résultat')}
        ${ligne('Bénéfice brut', money(data.resultat.beneficeBrut))}
        ${ligne('Résultat net', money(data.resultat.resultatNet), true)}
        ${ligne('Marge nette', data.resultat.marge.toFixed(1) + ' %')}
        ${section('Trésorerie de la période')}
        ${ligne('Solde avant la période', money(data.tresorerie.soldeAvantPeriode))}
        ${ligne('Recettes', '+' + money(data.tresorerie.recettesPeriode))}
        ${ligne('Dépenses (décaissements)', '−' + money(data.tresorerie.depensesPeriode))}
        ${ligne('Solde en fin de période', money(data.tresorerie.soldeFinPeriode), true)}
        ${section('Achats fournisseurs')}
        ${ligne('Total achats de la période', money(data.achats.total))}
        ${ligne('Payé', money(data.achats.paye))}
        ${ligne('Reste à payer', money(data.achats.resteAPayer))}
        ${data.tva && (data.tva.collectee || data.tva.deductible) ? `
        ${section('TVA de la période')}
        ${ligne('TVA collectée (sur ventes)', money(data.tva.collectee))}
        ${ligne('TVA déductible (sur achats)', money(data.tva.deductible))}
        ${ligne(data.tva.aPayer >= 0 ? 'TVA à reverser' : 'TVA à récupérer (crédit)', money(Math.abs(data.tva.aPayer)), true)}` : ''}
        ${data.bilan ? `
        ${section(`Bilan au ${dateOnlyFr(data.bilan.date)}`)}
        ${ligne('Trésorerie (caisse + banque)', money(data.bilan.actif.tresorerie))}
        ${ligne('Créances clients (impayés)', money(data.bilan.actif.creancesClients))}
        ${ligne('Valeur du stock', money(data.bilan.actif.valeurStock))}
        ${ligne('Total actif', money(data.bilan.actif.total), true)}
        ${ligne('Dettes fournisseurs (impayés)', money(data.bilan.passif.dettesFournisseurs))}
        ${ligne('Capitaux propres (résultat cumulé)', money(data.bilan.passif.capitauxPropres))}
        ${ligne('Total passif', money(data.bilan.passif.total), true)}` : ''}
      </table>
      ${data.bilan ? `<div class="mt-8 fs-10_5 c-777">${esc(data.bilan.avertissement)}</div>` : ''}
      <div class="mt-22 fs-11 c-777">Document généré le ${dateFr(new Date().toISOString())} — usage interne.</div>
    </div>`;
  const container = qs('#invoice-print');
  setInvoiceAndPreview(container, `<style>@page { size: A4 portrait; margin: 16mm; }</style>${contenu}`);
}

// ------------------------- Page : Services et produits vendus (rapport) -------------------------
// PHASE 3 : reproduit le format du relevé "Rapports.pdf" habituel de
// l'établissement — un bandeau Date/Montant en tête, puis un tableau
// chronologique de chaque ligne vendue (produits ET services) sur la
// période, avec les colonnes Date de création / Numéro / Service-Produits /
// Détails / Montant (Ar). Imprimé via window.print() (comme les autres
// documents de l'application) : l'utilisateur choisit "Enregistrer en PDF"
// dans la boîte de dialogue d'impression pour obtenir le fichier .pdf.
export async function imprimerServicesProduits(data, periodeLabel) {
  const meta = await call('settings:get');
  const dateLabel = periodeLabel || 'Depuis le début de l\'activité';
  const deviseLabel = meta.devise === 'Ar' ? 'Ariary' : esc(meta.devise);
  const lignesHtml = data.lignes.map((l) => `
    <tr>
      <td class="border-1px-solid-333 p-6">${dateFr(l.createdAt)}</td>
      <td class="border-1px-solid-333 p-6">${esc(l.numero)}</td>
      <td class="border-1px-solid-333 p-6">${esc(l.designation)}</td>
      <td class="border-1px-solid-333 p-6">${esc(l.details)}</td>
      <td class="border-1px-solid-333 p-6 text-right">${Number(l.montant).toLocaleString('fr-FR')}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="border-1px-solid-333 p-6 text-center muted">Aucune donnée pour cette période</td></tr>`;
  const contenu = `
    <div class="font-print c-111 maxw-720">
      <div class="flex justify-between items-center mb-6 bb-2px-solid-333 pb-10">
        <div class="flex gap-10 items-center">
          ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" class="w-52 h-52 object-contain" />` : ''}
          <div class="fw-bold fs-14">${esc(meta.entrepriseName)}</div>
        </div>
        <div class="text-right">
          <div class="fs-20 fw-800">RAPPORTS</div>
          <div class="fs-11 c-555">${esc(dateLabel)}</div>
        </div>
      </div>
      <table class="w-100p border-collapse fs-12 mb-14">
        <tbody>
          <tr><td class="p-4-0 fw-bold">Date</td><td class="p-4-0">${esc(dateLabel)}</td></tr>
          <tr><td class="p-4-0 fw-bold">Montant</td><td class="p-4-0">${Number(data.total).toLocaleString('fr-FR')} ${deviseLabel}</td></tr>
        </tbody>
      </table>
      <table class="w-100p border-collapse fs-11_5">
        <thead>
          <tr class="bg-f2f2f2">
            <th class="border-1px-solid-333 p-6 text-center">Date de création</th>
            <th class="border-1px-solid-333 p-6 text-center">Numéro</th>
            <th class="border-1px-solid-333 p-6 text-center">Service/Produits</th>
            <th class="border-1px-solid-333 p-6 text-center">Détails</th>
            <th class="border-1px-solid-333 p-6 text-center">Montant (Ar)</th>
          </tr>
        </thead>
        <tbody>${lignesHtml}</tbody>
      </table>
      <div class="mt-22 fs-11 c-777">Document généré le ${dateFr(new Date().toISOString())} — Rapports.</div>
    </div>`;
  const container = qs('#invoice-print');
  setInvoiceAndPreview(container, `<style>@page { size: A4 portrait; margin: 14mm; }</style>${contenu}`);
}

// ------------------------- Page : Utilisateurs -------------------------
