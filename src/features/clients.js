/**
 * By Client view
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { RedmineState } from '../core/state.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { issueSelectCell, issueSelectHeader, updateBatchBar } from '../ui/batch-selection.js';
import { emptyState, matchesQuickFilter } from '../ui/list-controls.js';
import { fetchRedmine } from '../redmine/client.js';
import { fetchRedmineAllIssues, genericLoadingSkeleton, priorityBadge } from './tester/queue.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { issueDescriptionCell, resolveNewIssueProjectIds } from './new-issues.js';

/* ============================================================
   BY CLIENT — Redmine custom field "Client Name"
   ============================================================ */
window.__clientCfId = window.__clientCfId || null;
window.__clientIssues = window.__clientIssues || [];
window.__clientMeta = null;
window.__clientError = null;
window.__clientQuery = window.__clientQuery || '';

function getIssueClientName(issue){
  const fields = issue && issue.custom_fields;
  if(!Array.isArray(fields)) return '';
  const f = fields.find(cf => {
    const n = String(cf.name || '').toLowerCase().trim();
    return n === 'client name' || n === 'client' || n === 'customer' || n === 'customer name';
  });
  if(!f) return '';
  const v = f.value;
  if(Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v || '').trim();
}

async function resolveClientNameFieldId(force){
  if(!force && window.__clientCfId) return window.__clientCfId;
  try {
    const cached = localStorage.getItem('erp_client_cf_id');
    if(!force && cached){
      window.__clientCfId = cached;
      return cached;
    }
  } catch(_){}
  try {
    const { data } = await fetchRedmine('/api/redmine?resource=custom_fields', { force: !!force });
    const list = data.custom_fields || data || [];
    const arr = Array.isArray(list) ? list : [];
    const found = arr.find(cf => {
      const n = String(cf.name || '').toLowerCase().trim();
      return n === 'client name' || n === 'client' || n === 'customer name';
    });
    if(found && found.id){
      window.__clientCfId = String(found.id);
      try { localStorage.setItem('erp_client_cf_id', window.__clientCfId); } catch(_){}
      return window.__clientCfId;
    }
  } catch(err){
    console.warn('resolveClientNameFieldId', err);
  }
  return null;
}

function searchClientFromGlobal(name){
  const q = String(name || '').trim();
  openClientsView();
  const input = $('clientSearchInput');
  if(input) input.value = q;
  if(q) loadClientIssues(q, true);
}
function openClientsView(){
  switchView('clients');
  try {
    if($('pageTitle')) $('pageTitle').textContent = 'By Client';
    if($('pageSubtitle')) $('pageSubtitle').textContent = 'All clients from Redmine, and their issues';
  } catch(_){}
  const q = window.__clientQuery || '';
  if(q) loadClientIssues(q, false);
  else { renderClientIssues(); loadClientOverview(false); }
  setTimeout(() => { try { $('clientSearchInput')?.focus(); } catch(_){} }, 100);
}

async function loadClientIssues(clientName, force){
  const q = String(clientName || $('clientSearchInput')?.value || '').trim();
  window.__clientQuery = q;
  const el = $('clientsBody');
  const btn = $('btnRefreshClients');
  if(!q){
    window.__clientIssues = [];
    window.__clientError = null;
    window.__clientMeta = null;
    renderClientIssues();
    loadClientOverview(!!force);
    return;
  }
  if(el) el.innerHTML = (typeof genericLoadingSkeleton === 'function')
    ? genericLoadingSkeleton('Loading issues for client…')
    : '<p style="padding:16px">Loading…</p>';
  if(btn) btn.disabled = true;

  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const cfId = await resolveClientNameFieldId(!!force);
    const targets = (typeof resolveNewIssueProjectIds === 'function') ? resolveNewIssueProjectIds() : [];
    const merged = [];
    let anyOk = false;

    // Prefer server-side cf filter when we know the field id
    await Promise.all((targets.length ? targets : [{ projectId: null, label: 'All' }]).map(async (t) => {
      try {
        const params = new URLSearchParams();
        params.set('status_id', '*'); // all statuses
        params.set('sort', 'updated_on:desc');
        if(t.projectId) params.set('project_id', String(t.projectId));
        if(cfId){
          params.set('client_cf_id', String(cfId));
          params.set('client_name', q);
        }
        const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 4 });
        anyOk = true;
        (result.issues || []).forEach(i => {
          const client = getIssueClientName(i) || (cfId ? q : '');
          // If no cf filter worked, filter client-side
          if(!cfId){
            const name = getIssueClientName(i).toLowerCase();
            if(!name.includes(q.toLowerCase())) return;
          } else if(client && !String(client).toLowerCase().includes(q.toLowerCase())){
            // extra client-side safety
            const name = getIssueClientName(i).toLowerCase();
            if(name && !name.includes(q.toLowerCase())) return;
          }
          merged.push({
            ...i,
            _clientName: getIssueClientName(i) || q,
            _projectLabel: t.projectName || t.label || i.project?.name || ''
          });
        });
      } catch(err){
        console.warn('loadClientIssues project', t.label, err);
      }
    }));

    // Deduplicate by id
    const byId = new Map();
    merged.forEach(i => { if(i && i.id != null) byId.set(String(i.id), i); });
    let list = Array.from(byId.values());

    // If cf filter returned nothing, fallback: fetch open issues and filter by custom field client-side
    if(!list.length){
      const fallback = [];
      await Promise.all((targets.length ? targets : [{ projectId: null }]).map(async (t) => {
        if(!t.projectId) return;
        try {
          const params = new URLSearchParams();
          params.set('status_id', 'open');
          params.set('sort', 'updated_on:desc');
          params.set('project_id', String(t.projectId));
          const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 3 });
          (result.issues || []).forEach(i => {
            const name = getIssueClientName(i);
            if(name && name.toLowerCase().includes(q.toLowerCase())){
              fallback.push({
                ...i,
                _clientName: name,
                _projectLabel: t.projectName || t.label || i.project?.name || ''
              });
            }
          });
        } catch(_){}
      }));
      fallback.forEach(i => byId.set(String(i.id), i));
      list = Array.from(byId.values());
    }

    list.sort((a, b) => String(b.updated_on || '').localeCompare(String(a.updated_on || '')));
    window.__clientIssues = list;
    window.__clientError = null;
    window.__clientMeta = { q, total: list.length, at: Date.now(), cfId };
    const tb = $('clientsTotalBadge');
    if(tb) tb.textContent = String(list.length);
    renderClientIssues();
    if(!list.length) toast('No issues found for this client', 'error');
  } catch(err){
    console.error(err);
    window.__clientError = err.friendly || { title: 'Failed', message: err.message || 'Load failed' };
    renderClientIssues();
  } finally {
    if(btn) btn.disabled = false;
  }
}

/* ============================================================
   ALL CLIENTS OVERVIEW (v4.51.0)
   One request: the server scans Redmine and returns, per client, the
   number of issues / open issues, statuses, projects and last update.
   The browser only receives that summary (a few KB), cached for an hour,
   so listing every client stays light. Click a client to load its issues.
   ============================================================ */
const OVERVIEW_KEY = 'erp_client_overview_v1';
const OVERVIEW_TTL = 60 * 60 * 1000;

function readOverviewCache(){
  try {
    const c = JSON.parse(localStorage.getItem(OVERVIEW_KEY) || 'null');
    if(c && Array.isArray(c.clients)) return c;
  } catch(_){}
  return null;
}

async function loadClientOverview(force){
  const cached = readOverviewCache();
  if(cached && !force){
    window.__clientOverview = cached;
    const nb = $('countClients');
    if(nb){ const n = cached.clients.filter(c => (c.open || 0) > 0).length; nb.textContent = String(n); nb.dataset.zero = n ? '0' : '1'; }
    if(!window.__clientQuery) renderClientIssues();
    if(Date.now() - (cached.at || 0) < OVERVIEW_TTL) return;
  }
  if(window.__clientOverviewLoading) return;
  window.__clientOverviewLoading = true;
  if(!window.__clientOverview && !window.__clientQuery){
    const el = $('clientsBody');
    if(el) el.innerHTML = genericLoadingSkeleton('Collecting clients from Redmine…');
  }
  const btn = $('btnRefreshClients'); if(btn) btn.disabled = true;
  try {
    let cf = '';
    try { cf = localStorage.getItem('erp_client_cf_id') || ''; } catch(_){}
    const { data } = await fetchRedmine(`/api/redmine?resource=client_names${cf ? `&cf_id=${encodeURIComponent(cf)}` : ''}`, { force: true });
    const ov = { at: Date.now(), clients: (data && data.clients || []).filter(c => c && c.name),
      scanned: data?.scanned || 0, total: data?.total || 0, complete: data?.complete !== false };
    if(data?.fieldId){ try { localStorage.setItem('erp_client_cf_id', String(data.fieldId)); } catch(_){} }
    try { localStorage.setItem(OVERVIEW_KEY, JSON.stringify(ov)); } catch(_){}
    window.__clientOverview = ov;
    window.__clientOverviewError = null;
    // sidebar: number of clients that currently have open issues
    const nb = $('countClients');
    if(nb){ const n = ov.clients.filter(c => (c.open || 0) > 0).length; nb.textContent = String(n); nb.dataset.zero = n ? '0' : '1'; }
  } catch(err){
    console.warn('client overview', err);
    window.__clientOverviewError = err.friendly || { title: 'Could not load clients', message: err.message || 'Load failed' };
  } finally {
    window.__clientOverviewLoading = false;
    if(btn) btn.disabled = false;
    if(!window.__clientQuery) renderClientIssues();
  }
}

function overviewList(){
  const ov = window.__clientOverview;
  if(!ov) return [];
  const q = ($('clientSearchInput')?.value || '').trim().toLowerCase();
  const ui = window.__clientOvUi || {};
  const openOnly = $('clientsOpenOnly') ? $('clientsOpenOnly').checked : !!ui.openOnly;
  const sort = ($('clientsSort') && $('clientsSort').value) || ui.sort || 'open';
  const list = ov.clients
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .filter(c => !openOnly || (c.open || 0) > 0);
  const by = {
    open: (a, b) => (b.open || 0) - (a.open || 0) || b.count - a.count || a.name.localeCompare(b.name),
    count: (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    updated: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')),
    name: (a, b) => a.name.localeCompare(b.name)
  }[sort] || ((a, b) => 0);
  return list.sort(by);
}

function fmtShortDate(iso){
  if(!iso) return '';
  const d = new Date(iso); if(isNaN(d)) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

function renderClientOverview(el){
  const ov = window.__clientOverview;
  if(window.__clientOverviewError && !ov){
    el.innerHTML = emptyState(ICON.alert, window.__clientOverviewError.title, window.__clientOverviewError.message, [
      { label: 'Try again', action: 'loadClientOverview(true)', primary: true }
    ]);
    return;
  }
  if(!ov){ el.innerHTML = genericLoadingSkeleton('Collecting clients from Redmine…'); return; }
  const list = overviewList();
  const tb = $('clientsTotalBadge'); if(tb) tb.textContent = String(ov.clients.length);
  const d = new Date(ov.at);
  const upd = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const shortProj = (p) => String(p).replace(/^Zahir\s+ERP\s+/i, '').replace(/^Zahir\s+/i, '');
  const rows = list.map(c => {
    const statuses = Object.entries(c.statuses || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([n, k]) => `<span class="cl-ov-st">${escapeHtml(n)} <b>${k}</b></span>`).join('');
    const projects = Object.keys(c.projects || {}).map(p => `<span class="cl-ov-proj">${escapeHtml(shortProj(p))}</span>`).join('');
    return `<button type="button" class="cl-ov-row" data-client="${escapeHtml(c.name)}" onclick="openClientIssues(this.dataset.client)">
      <span class="cl-ov-main">
        <span class="cl-ov-name">${escapeHtml(c.name)}</span>
        <span class="cl-ov-meta">${projects}${statuses}</span>
      </span>
      <span class="cl-ov-open${c.open ? ' has-open' : ''}" title="Open issues">${c.open || 0}<small>open</small></span>
      <span class="cl-ov-total" title="All issues">${c.count}<small>total</small></span>
      <span class="cl-ov-date">${escapeHtml(fmtShortDate(c.updated))}</span>
    </button>`;
  }).join('');
  el.innerHTML = `
    <div class="cl-ov-bar">
      <select class="input cl-ov-sort" id="clientsSort" onchange="renderClientIssues()" aria-label="Sort clients">
        <option value="open">Most open issues</option>
        <option value="count">Most issues</option>
        <option value="updated">Recently updated</option>
        <option value="name">Name A–Z</option>
      </select>
      <label class="cl-ov-toggle"><input type="checkbox" id="clientsOpenOnly" onchange="renderClientIssues()"> With open issues only</label>
      <span class="cl-ov-note">${list.length} of ${ov.clients.length} clients · updated ${upd}${ov.complete ? '' : ` · first ${ov.scanned} of ${ov.total} issues scanned`}</span>
    </div>
    <div class="cl-ov-head" aria-hidden="true"><span>Client</span><span>Open</span><span>Total</span><span>Last update</span></div>
    <div class="cl-ov-list">${rows || `<div class="kb-state kb-state-sm"><p>No client matches “${escapeHtml($('clientSearchInput')?.value || '')}”.</p></div>`}</div>`;
  // keep the controls' state across re-renders
  const st = window.__clientOvUi || {};
  if(st.sort) $('clientsSort').value = st.sort;
  if(st.openOnly) $('clientsOpenOnly').checked = true;
}

function rememberOverviewUi(){
  // only while the overview controls are on screen (not while a client's issues are shown)
  if(!$('clientsSort')) return;
  window.__clientOvUi = { sort: $('clientsSort').value, openOnly: !!$('clientsOpenOnly')?.checked };
}

function openClientIssues(name){
  const input = $('clientSearchInput');
  if(input) input.value = name;
  loadClientIssues(name, false);
}

function backToClientOverview(){
  window.__clientQuery = '';
  window.__clientIssues = [];
  const input = $('clientSearchInput');
  if(input) input.value = '';
  renderClientIssues();
  if(!window.__clientOverview) loadClientOverview(false);
}

/* typing filters the overview; Enter opens the only/exact match, else searches Redmine */
function onClientSearchKey(e){
  const input = e.target;
  if(e.key === 'Enter'){
    e.preventDefault();
    const q = input.value.trim();
    if(!q) return backToClientOverview();
    const list = window.__clientOverview ? overviewList() : [];
    const exact = list.find(c => c.name.toLowerCase() === q.toLowerCase());
    openClientIssues(exact ? exact.name : (list.length === 1 ? list[0].name : q));
    return;
  }
  if(e.key === 'Escape' && input.value){ input.value = ''; backToClientOverview(); }
}
function onClientSearchInput(){
  if(window.__clientQuery){ window.__clientQuery = ''; window.__clientIssues = []; }
  rememberOverviewUi();
  renderClientIssues();
}

function renderClientIssues(){
  const el = $('clientsBody');
  if(!el) return;
  const filtersBar = $('clientsFiltersBar');
  if(window.__clientError){
    if(filtersBar) filtersBar.classList.add('hidden');
    el.innerHTML = emptyState(ICON.alert, window.__clientError.title || 'Error', window.__clientError.message || '', [
      { label: 'Try again', action: "loadClientIssues(window.__clientQuery, true)", primary: true }
    ]);
    return;
  }
  const q = window.__clientQuery || '';
  if(!q){
    if(filtersBar) filtersBar.classList.add('hidden');
    rememberOverviewUi();
    renderClientOverview(el);
    return;
  }
  const list = (window.__clientIssues || []).filter(i => matchesQuickFilter(i));
  if(!list.length){
    if(filtersBar) filtersBar.classList.add('hidden');
    el.innerHTML = emptyState(ICON.inbox, 'No issues', `No issues matched “${escapeHtml(q)}”. Try the exact Client Name from Redmine.`, [
      { label: 'All clients', action: 'backToClientOverview()', primary: true },
      { label: 'Search again', action: "loadClientIssues(window.__clientQuery, true)" }
    ]);
    return;
  }
  if(filtersBar) filtersBar.classList.remove('hidden');

  // Group by status
  const groups = {};
  list.forEach(i => {
    const st = i.status?.name || 'Unknown';
    if(!groups[st]) groups[st] = [];
    groups[st].push(i);
  });
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));

  el.innerHTML = `
    <div class="list-meta-row cl-ov-back-row" style="padding:4px 4px 10px">
      <button type="button" class="cl-ov-back" onclick="backToClientOverview()">← All clients</button>
      <span>Client <b>${escapeHtml(q)}</b> · <b>${list.length}</b> issue(s)</span>
    </div>
    ${keys.map(st => `
      <div class="tester-group">
        <div class="tester-group-head">
          <span class="tester-group-title">${escapeHtml(st)}</span>
          <span class="badge badge-cyan">${groups[st].length}</span>
        </div>
        ${renderClientTable(groups[st])}
      </div>
    `).join('')}`;
  try { updateBatchBar(); } catch(_){}
}

function renderClientTable(issues){
  const rows = issues.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const pri = issue.priority?.name || '—';
    const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
    const st = issue.status?.name || '—';
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      ${issueSelectCell(issue.id)}
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">${issueDescriptionCell(issue, { showProject: true })}</td>
      <td class="col-priority">${priHtml}</td>
      <td class="col-tracker">${escapeHtml(st)}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');
  return `<div class="tester-table-wrap">
    <table class="tester-table">
      <thead><tr>
        ${issueSelectHeader()}
        <th class="col-id">Issue</th>
        <th class="col-subject">Description</th>
        <th class="col-priority">Priority</th>
        <th class="col-tracker">Status</th>
        <th class="col-open"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export {
  backToClientOverview,
  loadClientOverview,
  onClientSearchInput,
  onClientSearchKey,
  openClientIssues,
  getIssueClientName,
  loadClientIssues,
  openClientsView,
  renderClientIssues,
  resolveClientNameFieldId,
  searchClientFromGlobal
};
