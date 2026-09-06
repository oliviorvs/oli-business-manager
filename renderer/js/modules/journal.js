import { createColumnPicker, createPager } from '../components/tableTools.js';
import { call } from '../utils/api.js';
import { dateFr, esc, qs } from '../utils/helpers.js';
import { state } from '../utils/state.js';

export async function renderJournal() {
  const main = qs('#main-content');
  main.innerHTML = `<div class="topbar"><div><h2>Journal d'activité</h2><div class="sub">Historique des actions du système</div></div>
    <div class="toolbar-actions"><div id="j-col-picker"></div></div></div>
    <div class="card" id="j-wrap">Chargement…</div>`;
  const [logs, users] = await Promise.all([call('journal:list', { limit: 300 }), call('utilisateurs:list')]);
  const nomParEmail = {};
  users.forEach((u) => { nomParEmail[u.email.toLowerCase()] = ((u.prenom ? u.prenom + ' ' : '') + u.nom).trim(); });
  const afficherUtilisateur = (email) => (email && nomParEmail[email.toLowerCase()]) || email || '—';
  const wrap = qs('#j-wrap');
  if (!logs.length) { wrap.innerHTML = `<div class="empty-state"><div class="big">▦</div>Aucune activité enregistrée.</div>`; return; }

  // PHASE 4 : colonnes personnalisables + pagination 10/20/50 (mêmes
  // composants que Ventes/Achats/Services/Trésorerie).
  const journalCols = createColumnPicker('journal', [
    { key: 'date', label: 'Date' }, { key: 'utilisateur', label: 'Utilisateur' }, { key: 'action', label: 'Action' }
  ]);
  qs('#j-col-picker').innerHTML = journalCols.html();
  journalCols.bind(() => journalPager.render(wrap, logs, buildJournalTableHtml));
  const journalPager = createPager('journal');

  function buildJournalTableHtml(list) {
    return `<table><thead><tr>
        <th class="${journalCols.cls('date')}">Date</th><th class="${journalCols.cls('utilisateur')}">Utilisateur</th><th class="${journalCols.cls('action')}">Action</th></tr></thead>
      <tbody>${list.map((l) => `<tr>
        <td class="${journalCols.cls('date')}">${dateFr(l.date)}</td><td class="${journalCols.cls('utilisateur')}">${esc(afficherUtilisateur(l.utilisateur))}</td>
        <td class="${journalCols.cls('action')}">${esc(l.action)}</td></tr>`).join('')}</tbody></table>`;
  }
  journalPager.render(wrap, logs, buildJournalTableHtml);
}

// ============================================================
// PAGE : SAUVEGARDE
// ============================================================
