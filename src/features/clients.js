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
import { renderClientReport, resetClientReport } from './client-report.js';
import { siteForClient, ensureSitesLoaded, sitesLoaded } from './sites.js';

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
/* Called by switchView('clients') too, so reload / direct link shows the list */
let sitesListening = false;
function listenSites(){
  try { ensureSitesLoaded(); } catch(_){}
  if(sitesListening) return;
  sitesListening = true;
  window.addEventListener('sites:updated', () => {
    if(window.__clientQuery && document.getElementById('view-clients')?.classList.contains('active')) renderClientIssues();
  });
}
function onClientsShown(){
  listenSites();
  if(window.__clientQuery) renderClientIssues();
  else { renderClientIssues(); loadClientOverview(false); }
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
        params.set('with_description', '1');   // Client Report needs the request text
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
const OVERVIEW_KEY = 'erp_client_overview_v2';   // v2: per-product numbers
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
    if(nb){ const n = cached.clients.filter(c => sumProducts(c).open > 0).length; nb.textContent = String(n); nb.dataset.zero = n ? '0' : '1'; }
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
    try { window.dispatchEvent(new CustomEvent('clients:overview')); } catch(_){}
    // sidebar: number of clients that currently have open issues
    const nb = $('countClients');
    if(nb){ const n = ov.clients.filter(c => sumProducts(c).open > 0).length; nb.textContent = String(n); nb.dataset.zero = n ? '0' : '1'; }
  } catch(err){
    console.warn('client overview', err);
    window.__clientOverviewError = err.friendly || { title: 'Could not load clients', message: err.message || 'Load failed' };
  } finally {
    window.__clientOverviewLoading = false;
    if(btn) btn.disabled = false;
    if(!window.__clientQuery) renderClientIssues();
  }
}

/* ---- status buckets: Redmine status names → fixed columns (v4.52.0) ---- */
const CLIENT_BUCKETS = [
  { key: 'new',      label: 'New',               short: 'New',      re: /^new$|^baru$/i },
  { key: 'progress', label: 'In Progress',       short: 'Progress', re: /progress|proses|assigned|doing|working/i },
  { key: 'rft',      label: 'Ready for Testing', short: 'RFT',      re: /ready.*test|^rft$|testing/i },
  { key: 'resolved', label: 'Resolved',          short: 'Resolved', re: /resolved|fixed/i },
  { key: 'other',    label: 'Other open',        short: 'Other',    re: null },   // feedback, rework, on deploy, …
  { key: 'closed',   label: 'Closed',            short: 'Closed',   re: /closed|rejected|cancel|duplicate|won.?t|done|selesai/i }
];
function bucketOf(statusName){
  const n = String(statusName || '');
  for(const b of CLIENT_BUCKETS) if(b.re && b.re.test(n)) return b.key;
  return 'other';
}

const PRODUCT_LABEL = (p) => String(p || '').replace(/^Zahir\s+/i, '').replace(/^ERP\s+Manufacturing$/i, 'Manufacturing') || p;   // ERP · ERP One · Manufacturing

/* numbers for one client, optionally for one product only */
/* Only the three Zahir products count here (v4.52.1): Zahir ERP, Zahir ERP One,
 * Zahir ERP Manufacturing — matched by the same project list as Issue Status,
 * with name patterns as a fallback. Issues in other Redmine projects are ignored. */
const ZAHIR_PRODUCT_RES = [/^zahir\s*erp$/i, /^zahir\s*erp\s*one$/i, /manufactur/i];
function isZahirProduct(projectName){
  const n = String(projectName || '').trim();
  try {
    const targets = resolveNewIssueProjectIds();
    if(targets.some(t => t.projectName && t.projectName.toLowerCase() === n.toLowerCase())) return true;
  } catch(_){}
  return ZAHIR_PRODUCT_RES.some(re => re.test(n));
}

/* for Client Versions: every Redmine client with its open / total issues (Zahir products) */
function getClientIndex(){
  const ov = window.__clientOverview || readOverviewCache();
  if(!ov) return [];
  return ov.clients.map(c => { const n = sumProducts(c); return { name: c.name, open: n.open, total: n.total }; });
}
function ensureClientOverview(){
  if(!window.__clientOverview){ const c = readOverviewCache(); if(c) window.__clientOverview = c; }
  if(!window.__clientOverview || Date.now() - (window.__clientOverview.at || 0) > OVERVIEW_TTL) loadClientOverview(false);
}

/* the client's Zahir ERP versions (Client Versions), shown above its issues */
function clientVersionsLine(name){
  const s = siteForClient(name);
  if(!s){
    // only say so once Client Versions is loaded and has sites
    return sitesLoaded() > 0 ? `<div class="cl-versions is-empty"><span class="cl-versions-lbl">Zahir ERP versions</span>
      <span>Not linked to a site in Client Versions — open Client Versions, Edit the client's site and pick “${escapeHtml(name)}” as Redmine client name.</span></div>` : '';
  }
  const parts = [['FE', s.pinnedVersion || s.version], ['V2', s.v2], ['V3', s.v3]].filter(x => x[1]);
  if(!parts.length) return '';
  const when = s.checkedAt ? new Date(s.checkedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="cl-versions" title="From Client Versions">
      <span class="cl-versions-lbl">Zahir ERP versions</span>
      ${parts.map(([k, v]) => `<span class="cl-ver-chip"><b>${k}</b> ${escapeHtml(v)}</span>`).join('')}
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="cl-versions-host">${escapeHtml((() => { try { return new URL(s.url).host; } catch(_){ return s.url; } })())}</a>
      ${(s.failCount || 0) >= 2 ? '<span class="cl-versions-down">● not reachable</span>' : ''}
      ${when ? `<span class="cl-versions-when">checked ${escapeHtml(when)}</span>` : ''}
    </div>`;
}

function sumProducts(c){
  const out = { total: 0, open: 0, statuses: {}, updated: '' };
  Object.entries(c.byProject || {}).forEach(([p, bp]) => {
    if(!isZahirProduct(p)) return;
    out.total += bp.total || 0; out.open += bp.open || 0;
    Object.entries(bp.statuses || {}).forEach(([k, v]) => { out.statuses[k] = (out.statuses[k] || 0) + v; });
    if(String(bp.updated || '') > out.updated) out.updated = String(bp.updated || '');
  });
  return out;
}

function clientNumbers(c, product){
  const src = product && product !== 'all'
    ? (c.byProject && c.byProject[product]) || null
    : sumProducts(c);
  const out = { total: 0, open: 0, updated: '', new: 0, progress: 0, rft: 0, resolved: 0, other: 0, closed: 0, otherNames: {} };
  if(!src) return out;
  out.total = src.total || 0; out.open = src.open || 0; out.updated = src.updated || '';
  Object.entries(src.statuses || {}).forEach(([name, n]) => {
    const k = bucketOf(name);
    out[k] += n;
    if(k === 'other') out.otherNames[name] = (out.otherNames[name] || 0) + n;
  });
  return out;
}

function clientProducts(){
  const set = new Set();
  (window.__clientOverview?.clients || []).forEach(c => Object.keys(c.byProject || {}).forEach(p => { if(isZahirProduct(p)) set.add(p); }));
  const rank = (p) => { const l = PRODUCT_LABEL(p); return l === 'ERP' ? 0 : l === 'ERP One' ? 1 : l === 'Manufacturing' ? 2 : 3; };
  return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function ovUi(){
  const ui = window.__clientOvUi || (window.__clientOvUi = {});
  if(ui.product && ui.product !== 'all' && !isZahirProduct(ui.product)) ui.product = 'all';
  ui.sort = ui.sort || 'open'; ui.dir = ui.dir || 'desc';
  ui.product = ui.product || 'all'; ui.show = ui.show || 'all';
  return ui;
}

function overviewList(){
  const ov = window.__clientOverview;
  if(!ov) return [];
  const ui = ovUi();
  const q = ($('clientSearchInput')?.value || '').trim().toLowerCase();
  const rows = ov.clients
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .map(c => ({ c, n: clientNumbers(c, ui.product) }))
    .filter(r => r.n.total > 0)                                   // not in this product
    .filter(r => ui.show === 'all' ? true
      : ui.show === 'open' ? r.n.open > 0 : (r.n[ui.show] || 0) > 0);
  const dir = ui.dir === 'asc' ? 1 : -1;
  const val = (r) => ui.sort === 'name' ? r.c.name.toLowerCase() : ui.sort === 'updated' ? r.n.updated : (r.n[ui.sort] || 0);
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if(x < y) return -1 * dir;
    if(x > y) return 1 * dir;
    return a.c.name.localeCompare(b.c.name);
  });
  return rows;
}

function fmtShortDate(iso){
  if(!iso) return '';
  const d = new Date(iso); if(isNaN(d)) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

function setClientOv(key, value){
  const ui = ovUi();
  if(key === 'sort'){
    // clicking the same column flips the direction
    if(ui.sort === value) ui.dir = ui.dir === 'desc' ? 'asc' : 'desc';
    else { ui.sort = value; ui.dir = value === 'name' ? 'asc' : 'desc'; }
  } else ui[key] = value;
  renderClientIssues();
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
  const ui = ovUi();
  const rows = overviewList();
  const tb = $('clientsTotalBadge'); if(tb) tb.textContent = String(ov.clients.filter(c => sumProducts(c).total > 0).length);
  const d = new Date(ov.at);
  const upd = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  // totals for what is shown
  const sum = { new: 0, progress: 0, rft: 0, resolved: 0, other: 0, open: 0 };
  rows.forEach(r => Object.keys(sum).forEach(k => { sum[k] += r.n[k] || 0; }));

  const products = clientProducts();
  const prodBtns = [['all', 'All products'], ...products.map(p => [p, PRODUCT_LABEL(p)])]
    .map(([v, l]) => `<button type="button" class="cl-seg${ui.product === v ? ' is-active' : ''}" aria-pressed="${ui.product === v}" onclick="setClientOv('product', ${escapeHtml(JSON.stringify(v))})">${escapeHtml(l)}</button>`).join('');
  const showOpts = [['all', 'All clients'], ['open', 'With open issues'], ['new', 'With New'], ['progress', 'With In Progress'], ['rft', 'With Ready for Testing'], ['resolved', 'With Resolved']]
    .map(([v, l]) => `<option value="${v}"${ui.show === v ? ' selected' : ''}>${l}</option>`).join('');

  const COLS = [
    ['new', 'New'], ['progress', 'In Progress'], ['rft', 'Ready for Testing'], ['resolved', 'Resolved'], ['other', 'Other open'], ['open', 'Open'], ['total', 'Total']
  ];
  const sortHead = (key, label, cls = '') => {
    const on = ui.sort === key;
    const arrow = on ? (ui.dir === 'desc' ? '↓' : '↑') : '';
    return `<button type="button" class="cl-th ${cls}${on ? ' is-sorted' : ''}" onclick="setClientOv('sort', '${key}')" aria-sort="${on ? (ui.dir === 'desc' ? 'descending' : 'ascending') : 'none'}">${label}<span class="cl-th-arrow">${arrow}</span></button>`;
  };
  const num = (n, key, title) => `<span class="cl-num cl-num-${key}${n ? ' has' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${n || '–'}</span>`;

  const body = rows.map(({ c, n }) => {
    const prods = ui.product === 'all'
      ? Object.keys(c.byProject || {}).filter(isZahirProduct).map(p => `<span class="cl-prod">${escapeHtml(PRODUCT_LABEL(p))}</span>`).join('')
      : '';
    const otherTitle = Object.entries(n.otherNames).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `<button type="button" class="cl-row" data-client="${escapeHtml(c.name)}" onclick="openClientIssues(this.dataset.client)">
      <span class="cl-cell-name"><span class="cl-name">${escapeHtml(c.name)}</span>${prods ? `<span class="cl-prods">${prods}</span>` : ''}</span>
      ${num(n.new, 'new')}${num(n.progress, 'progress')}${num(n.rft, 'rft')}${num(n.resolved, 'resolved')}${num(n.other, 'other', otherTitle)}
      ${num(n.open, 'open')}<span class="cl-num cl-num-total has">${n.total}</span>
      <span class="cl-date">${escapeHtml(fmtShortDate(n.updated))}</span>
    </button>`;
  }).join('');

  el.innerHTML = `
    <div class="cl-filters">
      <div class="cl-seg-group" role="group" aria-label="Product">${prodBtns}</div>
      <select class="input cl-show" onchange="setClientOv('show', this.value)" aria-label="Which clients">${showOpts}</select>
      <span class="cl-note">${rows.length} of ${ov.clients.filter(c => sumProducts(c).total > 0).length} clients · updated ${upd}${ov.complete ? '' : ` · first ${ov.scanned} of ${ov.total} issues scanned`}</span>
    </div>
    <div class="cl-summary" aria-label="Totals for the clients shown">
      <div class="cl-sum cl-sum-new"><b>${sum.new}</b><span>New</span></div>
      <div class="cl-sum cl-sum-progress"><b>${sum.progress}</b><span>In Progress</span></div>
      <div class="cl-sum cl-sum-rft"><b>${sum.rft}</b><span>Ready for Testing</span></div>
      <div class="cl-sum cl-sum-resolved"><b>${sum.resolved}</b><span>Resolved</span></div>
      <div class="cl-sum cl-sum-other"><b>${sum.other}</b><span>Other open</span></div>
    </div>
    <div class="cl-table">
      <div class="cl-head">
        ${sortHead('name', 'Client', 'cl-th-name')}
        ${COLS.map(([k, l]) => sortHead(k, l, `cl-th-num cl-th-${k}`)).join('')}
        ${sortHead('updated', 'Last update', 'cl-th-date')}
      </div>
      <div class="cl-body">${body || `<div class="kb-state kb-state-sm"><p>No client matches these filters.</p></div>`}</div>
    </div>`;
}

function rememberOverviewUi(){ /* state lives in window.__clientOvUi (v4.52.0) */ }

function setClientTab(tab){
  window.__clientTab = tab === 'report' ? 'report' : 'issues';
  renderClientIssues();
}

function openClientIssues(name){
  listenSites();
  if(name !== window.__clientQuery) resetClientReport();
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
  const prod = ovUi().product;
  const list = (window.__clientIssues || []).filter(i => matchesQuickFilter(i))
    .filter(i => prod === 'all' || (i.project && i.project.name) === prod);
  if(!list.length){
    if(filtersBar) filtersBar.classList.add('hidden');
    el.innerHTML = emptyState(ICON.inbox, 'No issues', `No issues matched “${escapeHtml(q)}”. Try the exact Client Name from Redmine.`, [
      { label: 'All clients', action: 'backToClientOverview()', primary: true },
      { label: 'Search again', action: "loadClientIssues(window.__clientQuery, true)" }
    ]);
    return;
  }
  if(filtersBar) filtersBar.classList.remove('hidden');

  const tabs = `<div class="cr-tabs" role="tablist" aria-label="Client view">
      <button type="button" role="tab" class="cr-tab${window.__clientTab !== 'report' ? ' is-active' : ''}" aria-selected="${window.__clientTab !== 'report'}" onclick="setClientTab('issues')">Issues</button>
      <button type="button" role="tab" class="cr-tab${window.__clientTab === 'report' ? ' is-active' : ''}" aria-selected="${window.__clientTab === 'report'}" onclick="setClientTab('report')">Report</button>
    </div>`;
  const backRow = `<div class="list-meta-row cl-ov-back-row" style="padding:4px 4px 10px">
      <button type="button" class="cl-ov-back" onclick="backToClientOverview()">← All clients</button>
      <span>Client <b>${escapeHtml(q)}</b>${prod !== 'all' ? ` · ${escapeHtml(PRODUCT_LABEL(prod))}` : ''} · <b>${list.length}</b> issue(s)</span>
      ${prod !== 'all' ? `<button type="button" class="cl-ov-back" onclick="setClientOv('product','all')">Show all products</button>` : ''}
      ${tabs}
    </div>${clientVersionsLine(q)}`;
  if(window.__clientTab === 'report'){
    // report covers every issue of the client (quick-filter chips don't apply)
    const all = (window.__clientIssues || []).filter(i => prod === 'all' || (i.project && i.project.name) === prod);
    el.innerHTML = backRow + '<div id="clientReportBody" class="cr-body"></div>';
    renderClientReport($('clientReportBody'), q, all);
    if(filtersBar) filtersBar.classList.add('hidden');
    return;
  }

  // Group by status
  const groups = {};
  list.forEach(i => {
    const st = i.status?.name || 'Unknown';
    if(!groups[st]) groups[st] = [];
    groups[st].push(i);
  });
  const order = CLIENT_BUCKETS.map(b => b.key);
  const keys = Object.keys(groups).sort((a, b) => order.indexOf(bucketOf(a)) - order.indexOf(bucketOf(b)) || groups[b].length - groups[a].length || a.localeCompare(b));

  el.innerHTML = `
    ${backRow}
    <div class="cl-detail-sum">${(() => {
      const c = { new: 0, progress: 0, rft: 0, resolved: 0, other: 0, closed: 0 };
      list.forEach(i => { c[bucketOf(i.status?.name)]++; });
      return CLIENT_BUCKETS.map(b => `<span class="cl-pill cl-pill-${b.key}${c[b.key] ? ' has' : ''}">${b.label} <b>${c[b.key]}</b></span>`).join('');
    })()}</div>
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
  setClientTab,
  onClientsShown,
  setClientOv,
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
  searchClientFromGlobal,
  getClientIndex,
  ensureClientOverview
};
