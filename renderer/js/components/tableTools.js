import { toast } from './toast.js';
import { PAGE_SIZES } from '../utils/constants.js';
import { esc, lsGet, lsSet, qs, qsa } from '../utils/helpers.js';

export function createColumnPicker(pageKey, columns) {
  const hidden = new Set(lsGet('columns:' + pageKey, []));
  return {
    cls(key) { return hidden.has(key) ? 'col-hidden' : ''; },
    html() {
      return `<div class="col-picker-wrap">
        <button type="button" class="btn btn-ghost btn-sm" id="col-picker-btn-${pageKey}" data-tip="Choisir les colonnes à afficher dans ce tableau">⚙ Colonnes</button>
        <div class="col-picker-menu" id="col-picker-menu-${pageKey}">
          ${columns.map((c) => `<label class="col-picker-item"><input type="checkbox" data-col="${c.key}" ${hidden.has(c.key) ? '' : 'checked'} /> ${esc(c.label)}</label>`).join('')}
        </div>
      </div>`;
    },
    bind(onChange) {
      const btn = qs('#col-picker-btn-' + pageKey);
      const menu = qs('#col-picker-menu-' + pageKey);
      if (!btn || btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
      document.addEventListener('click', () => menu.classList.remove('open'));
      qsa('[data-col]', menu).forEach((cb) => cb.addEventListener('change', (e) => {
        const key = e.target.dataset.col;
        if (e.target.checked) hidden.delete(key); else hidden.add(key);
        lsSet('columns:' + pageKey, Array.from(hidden));
        onChange();
      }));
    }
  };
}

export function createPager(pageKey, defaultSize = 20) {
  let size = lsGet('pagesize:' + pageKey, defaultSize);
  if (!PAGE_SIZES.includes(size)) size = defaultSize;
  let page = 1;
  return {
    // Rend la barre de pagination + retourne les éléments de la page courante.
    // buildTableHtml(pageItems) doit renvoyer le HTML du tableau (ou de l'état
    // vide) pour les seuls éléments de cette page.
    //
    // CORRECTIF : les boutons d'action des lignes (Modifier/Supprimer/Payer…)
    // cessaient de répondre après un changement de page ou de taille de page
    // (10/20/50). Cause : les clics "précédent/suivant/taille" internes à ce
    // composant rappelaient this.render(...) directement, ce qui régénère le
    // HTML du tableau mais ne réattache PAS les écouteurs posés par le module
    // appelant juste après son propre appel à render() (posés une seule fois,
    // sur les lignes de la page initiale). On accepte donc maintenant un
    // callback optionnel onRender(pageItems), appelé après CHAQUE rendu (le
    // premier comme les suivants), à qui les modules doivent déléguer le
    // rattachement de leurs écouteurs de ligne pour qu'il s'exécute aussi
    // après un changement de page/taille.
    render(wrap, allItems, buildTableHtml, onRender) {
      const totalPages = Math.max(1, Math.ceil(allItems.length / size));
      if (page > totalPages) page = totalPages;
      const start = (page - 1) * size;
      const pageItems = allItems.slice(start, start + size);
      const barHtml = allItems.length ? `
        <div class="pagination-bar">
          <div>${allItems.length} résultat(s) — page ${page}/${totalPages}</div>
          <div class="pagination-controls">
            <button type="button" data-pg="prev" ${page <= 1 ? 'disabled' : ''} data-tip="Page précédente">‹</button>
            <span>${page} / ${totalPages}</span>
            <button type="button" data-pg="next" ${page >= totalPages ? 'disabled' : ''} data-tip="Page suivante">›</button>
            <select class="pagination-size-select" data-pg="size" data-tip="Nombre de lignes affichées par page">
              ${PAGE_SIZES.map((s) => `<option value="${s}" ${s === size ? 'selected' : ''}>${s} / page</option>`).join('')}
            </select>
          </div>
        </div>` : '';
      wrap.innerHTML = buildTableHtml(pageItems) + barHtml;
      if (allItems.length) {
        qs('[data-pg="prev"]', wrap).addEventListener('click', () => { page--; this.render(wrap, allItems, buildTableHtml, onRender); });
        qs('[data-pg="next"]', wrap).addEventListener('click', () => { page++; this.render(wrap, allItems, buildTableHtml, onRender); });
        qs('[data-pg="size"]', wrap).addEventListener('change', (e) => {
          size = Number(e.target.value); lsSet('pagesize:' + pageKey, size); page = 1;
          this.render(wrap, allItems, buildTableHtml, onRender);
        });
      }
      if (onRender) onRender(pageItems);
      return pageItems;
    }
  };
}

// CORRECTIF : un import CSV (produits ou services) qui ignorait des lignes
// (doublons, désignation manquante, valeur négative…) ne le signalait
// auparavant que dans la console développeur (console.warn), invisible pour
// l'utilisateur final — qui voyait juste "3 doublon(s) ignoré(s)" dans un
// toast sans jamais savoir LESQUELLES. Cette modale affiche le détail complet
// (ligne par ligne) des lignes ignorées, pour permettre de corriger le
// fichier source si besoin.
