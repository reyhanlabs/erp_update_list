/**
 * Global search
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { State } from '../core/state.js';
import { $, escapeHtml, parseIssueLines } from '../core/helpers.js';
import { formatAssignee } from './tester/queue.js';
import { ISSUE_STATUS_DEFS } from './issue-status.js';
import { getNotes } from './notes.js';
import { getIssueClientName } from './clients.js';
import { getKbArticles, KB_PRODUCTS } from './kb.js';

/* ============================================================
   GLOBAL SEARCH (plans + notes + issue lines)
   ============================================================ */
function openGlobalSearch(){
  const modal = $('globalSearchModal');
  if(!modal) return;
  modal.classList.remove('hidden');
  const input = $('globalSearchInput');
  if(input){ input.value = ''; input.focus(); }
  renderGlobalSearchResults('');
}
function closeGlobalSearch(){
  const modal = $('globalSearchModal');
  if(modal) modal.classList.add('hidden');
}
function renderGlobalSearchResults(q){
  const el = $('globalSearchResults');
  if(!el) return;
  const raw = String(q || '').trim();
  q = raw.toLowerCase();
  if(!q){
    el.innerHTML = '<p class="muted" style="padding:12px;margin:0">Type issue #, subject, <b>client name</b>, plan, or note…</p>';
    return;
  }
  const hits = [];
  const seenIssueIds = new Set();

  // Shortcut: open By Client with this query
  const qEsc = raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  hits.push({
    type: 'Client',
    label: `Search client “${raw}”`,
    sub: 'Open By Client · Redmine Client Name',
    action: `closeGlobalSearch();searchClientFromGlobal('${qEsc}');`
  });

  // Plans
  State.plans.all().forEach(p => {
    const title = p.title || '';
    const issues = p.issues || '';
    if(title.toLowerCase().includes(q) || issues.toLowerCase().includes(q) || (p.note||'').toLowerCase().includes(q)){
      hits.push({ type: 'Plan', label: title || 'Untitled plan', sub: (p.date || ''), action: `switchView('plans');closeGlobalSearch();` });
    }
    parseIssueLines(issues).forEach(it => {
      if((it.number||'').includes(q) || (it.description||'').toLowerCase().includes(q)){
        hits.push({
          type: 'Issue',
          label: `#${it.number || '—'} ${it.description || ''}`.trim(),
          sub: title,
          action: it.url ? `window.open('${it.url.replace(/'/g, "\\'")}','_blank');closeGlobalSearch();` : `switchView('plans');closeGlobalSearch();`
        });
      }
    });
  });
  // Knowledge Base guides (only those already loaded this session)
  getKbArticles().forEach(a => {
    const hay = [a.title, a.module, a.summary, (a.tags || []).join(' ')].join(' ').toLowerCase();
    if(hay.includes(q)){
      const prod = KB_PRODUCTS[a.product]?.short || '';
      hits.push({
        type: 'Panduan',
        label: a.title || 'Tanpa judul',
        sub: [prod, a.module].filter(Boolean).join(' › '),
        action: `openKbArticle('${String(a.id).replace(/[^A-Za-z0-9_-]/g, '')}');closeGlobalSearch();`
      });
    }
  });
  getNotes().forEach(n => {
    if((n.title||'').toLowerCase().includes(q) || (n.body||'').toLowerCase().includes(q)){
      hits.push({ type: 'Note', label: n.title || 'Untitled', sub: (n.body||'').slice(0,80), action: `openNotesView();closeGlobalSearch();` });
    }
  });

  function pushIssueHit(type, i, subExtra){
    const id = String(i.id || '');
    if(!id || seenIssueIds.has(id)) return;
    const subj = i.subject || '';
    const client = (typeof getIssueClientName === 'function') ? getIssueClientName(i) : '';
    const hay = [id, subj, client, i._projectLabel || '', i.project?.name || '', i.status?.name || '', formatAssignee(i.assigned_to)]
      .map(x => String(x||'').toLowerCase()).join(' ');
    if(!hay.includes(q)) return;
    seenIssueIds.add(id);
    const clientBit = client ? ` · ${client}` : '';
    hits.push({
      type,
      label: `#${id} ${subj}`.trim(),
      sub: (subExtra || i._projectLabel || i.project?.name || '') + clientBit,
      action: `window.open('https://pjm.zahironline.com/issues/${id}','_blank');closeGlobalSearch();`
    });
  }

  // Tester Queue (RFT)
  (window.__testerIssues || []).forEach(i => pushIssueHit('RFT', i, i._projectLabel || ''));

  // Issue Status cache (all loaded statuses)
  const statusCache = window.__issueStatusCache || {};
  Object.keys(statusCache).forEach(sk => {
    const by = statusCache[sk] && statusCache[sk].byProject;
    if(!by) return;
    const typeLabel = (ISSUE_STATUS_DEFS[sk] && ISSUE_STATUS_DEFS[sk].label) || sk;
    Object.keys(by).forEach(projKey => {
      const block = by[projKey];
      (block && block.issues || []).forEach(i => pushIssueHit(typeLabel, i, block.projectName || block.label || ''));
    });
  });

  // Current new-issues memory
  const byNew = window.__newIssuesByProject || {};
  Object.keys(byNew).forEach(projKey => {
    const block = byNew[projKey];
    (block && block.issues || []).forEach(i => pushIssueHit('Status', i, block.projectName || block.label || ''));
  });

  // Active Work
  const aw = window.__activeWorkData || {};
  [['progress', 'Progress'], ['deploy', 'Deploy']].forEach(([key, label]) => {
    (aw[key] || []).forEach(i => pushIssueHit(label, i, i._projectLabel || i.project?.name || ''));
  });

  // Last By Client results
  (window.__clientIssues || []).forEach(i => pushIssueHit('Client', i, i._clientName || getIssueClientName(i) || ''));

  const top = hits.slice(0, 50);
  if(!top.length){
    el.innerHTML = '<p class="muted" style="padding:12px;margin:0">No matches. Try a Client Name → opens By Client search.</p>';
    return;
  }
  el.innerHTML = top.map(h => `
    <button type="button" class="gs-item" onclick="${h.action}">
      <span class="gs-type">${escapeHtml(h.type)}</span>
      <span class="gs-label">${escapeHtml(h.label)}</span>
      <span class="gs-sub">${escapeHtml(h.sub || '')}</span>
    </button>
  `).join('');
}
function onGlobalSearchInput(){
  renderGlobalSearchResults($('globalSearchInput')?.value || '');
}

export {
  closeGlobalSearch,
  onGlobalSearchInput,
  openGlobalSearch
};
