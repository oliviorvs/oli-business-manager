import { attachLiveValidation } from '../components/formTools.js';
import { createCombobox } from '../components/combobox.js';
import { closeModal, openModal, openPaiementForm } from '../components/modal.js';
import { createPager } from '../components/tableTools.js';
import { toast } from '../components/toast.js';
import { call } from '../utils/api.js';
import { dateFr, esc, h, qs } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderStocks() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Mouvements de stock</h2><div class="sub">Entrées, sorties, ajustements et inventaires</div></div>
    <button class="btn btn-primary" id="btn-new-mv">+ Nouveau mouvement</button></div>
    <div class="card" id="mv-table-wrap">Chargement…</div>`;
  const [mouvements, produits] = await Promise.all([call('stocks:mouvements'), call('produits:list')]);
  state.cache.produits = produits;
  const pname = (id) => produits.find((p) => p.id === id)?.designation || 'Produit supprimé';
  const wrap = qs('#mv-table-wrap');
  const typeLabel = { entree: 'Entrée', sortie: 'Sortie', ajustement: 'Ajustement' };
  if (!mouvements.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">↕</div>Aucun mouvement enregistré.</div>`;
  } else {
    const mvTriés = mouvements.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const mvPager = createPager('mouvements-stock');
    mvPager.render(wrap, mvTriés, (list) => `<table><thead><tr><th>Date</th><th>Produit</th><th>Type</th><th>Quantité</th><th>Motif</th><th>Utilisateur</th></tr></thead>
      <tbody>${list.map((m) => `<tr><td>${dateFr(m.createdAt)}</td><td>${esc(pname(m.produitId))}</td><td>${typeLabel[m.type] || m.type}</td><td>${m.quantite}</td><td>${esc(m.motif) || '—'}</td><td>${esc(m.utilisateur) || '—'}</td></tr>`).join('')}</tbody></table>`);
  }
  qs('#btn-new-mv').addEventListener('click', () => openMouvementForm(produits));
}

export function openMouvementForm(produits) {
  const body = h(`<div>
    <div class="field"><label>Produit</label><div id="f-produit-combo-wrap"></div></div>
    <div class="two-col">
      <div class="field"><label>Type de mouvement</label><select id="f-type"><option value="entree">Entrée</option><option value="sortie">Sortie</option><option value="ajustement">Ajustement (inventaire)</option></select></div>
      <div class="field"><label>Quantité</label><input type="number" id="f-qte" value="1" min="0" /></div>
    </div>
    <div class="field"><label>Motif</label><input id="f-motif" placeholder="Ex. inventaire mensuel, casse, retour…" /></div>
  </div>`);
  // UX/UI : recherche combobox pour le produit (voir combobox.js).
  const options = produits.map((p) => ({ id: p.id, label: p.designation + ' (stock : ' + p.quantite + ')' }));
  const produitCombo = createCombobox(options, null, 'Rechercher un produit...');
  produitCombo.querySelector('.combobox-hidden').id = 'f-produit';
  qs('#f-produit-combo-wrap', body).appendChild(produitCombo);
  const checkMvQte = attachLiveValidation(qs('#f-qte', body), 'nonNegative');
  openModal('Nouveau mouvement de stock', body, [
    { label: 'Annuler', cls: 'btn-ghost', onClick: closeModal },
    { label: 'Enregistrer', cls: 'btn-primary', onClick: async () => {
      if (!checkMvQte()) { toast('Quantité invalide', 'error'); return; }
      if (!qs('#f-produit', body).value) { toast('Choisissez un produit', 'error'); return; }
      const payload = { produitId: qs('#f-produit', body).value, type: qs('#f-type', body).value, quantite: qs('#f-qte', body).value, motif: qs('#f-motif', body).value.trim() };
      await call('produits:ajusterStock', payload);
      toast('Mouvement enregistré', 'success'); closeModal(); renderStocks();
    } }
  ]);
}

// ------------------------- Page : Achats -------------------------

// CORRECTIF UX : "Payer" ouvrait systématiquement une fenêtre modale à
// remplir puis à valider (3 clics minimum) pour le cas le plus fréquent
// (encaissement du solde total). Un seul clic + confirmation suffit
// désormais pour ce cas ; le bouton "±" à côté reste disponible pour saisir
// un montant partiel via le formulaire complet (openPaiementForm).
