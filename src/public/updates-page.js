/**
 * Update history — /u/<token> (v4.79.0)
 * Every Update Summary (date, FE / V2 / V3 versions) with the issues of its Update
 * Plan, newest first. Search an issue number to see which version it went out in.
 * No Firebase, no sign-in: data from /api/report-share?u=<token>.
 */
import { escapeHtml, groupIssuesByKind, ISSUE_KIND_META } from '../core/helpers.js';

const REDMINE = 'https://pjm.zahironline.com/issues/';
const PRODUCTS = {
  'erp':     { label: 'Zahir ERP',     short: 'ERP', color: '#4f46e5' },
  'erp-one': { label: 'Zahir ERP One', short: 'ONE', color: '#0891b2' },
  'mfg':     { label: 'Manufacturing', short: 'MFG', color: '#7c3aed' },
  'mrp':     { label: 'Zahir MRP',     short: 'MRP', color: '#d97706' },
  '':        { label: 'Other',         short: '—',   color: '#64748b' }
};
const prodOf = (k) => PRODUCTS[k] || { label: k, short: String(k).slice(0, 3).toUpperCase(), color: '#64748b' };
const KIND_ORDER = ['feature', 'enhancement', 'optimization', 'bug', 'other'];
/* v4.79.1: each version part and each category has its own colour */
const ver = (kind, label, v, big) => v ? `<span class="up-ver is-${kind}${big ? ' is-big' : ''}"><b>${label}</b><code>${escapeHtml(v)}</code></span>` : '';
const catClass = (c) => /front|^fe\b/i.test(c) ? 'is-fe' : /back|^be\b|api/i.test(c) ? 'is-be' : /design|ui|ux/i.test(c) ? 'is-de' : '';

const host = document.getElementById('updBody');
const token = (location.pathname.match(/^\/u\/([A-Za-z0-9_-]+)/) || [])[1] || new URLSearchParams(location.search).get('u') || '';
const U = { data: null, q: '', product: 'all', client: '', open: new Set(), statuses: {}, asked: new Set(), showAll: false };
const PAGE = 15;

const fmtDate = (iso, long) => { const d = new Date(String(iso || '') + 'T00:00:00'); return isNaN(d) ? (iso || '—') : d.toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }); };
const monthOf = (iso) => { const d = new Date(String(iso || '') + 'T00:00:00'); return isNaN(d) ? 'No date' : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };

function fail(msg){
  host.innerHTML = `<div class="pr-state"><p><b>${escapeHtml(msg)}</b></p><p class="pr-muted">Ask the Zahir ERP team for a new link if you need this page.</p></div>`;
}

/* ---------- filtering ---------- */
const issueNo = (q) => { const m = String(q || '').trim().match(/^#?(\d{3,7})$/) || String(q || '').match(/issues\/(\d{1,7})/); return m ? m[1] : ''; };
function visible(){
  const q = U.q.trim().toLowerCase(), no = issueNo(U.q);
  return U.data.updates.filter(u => {
    if(U.product !== 'all' && u.project !== U.product) return false;
    if(U.client && !u.issues.some(i => sameClient(i.client, U.client))) return false;
    if(!q) return true;
    if(no) return u.issues.some(i => i.id === no);
    const hay = [u.fe, u.v2, u.v3, u.plan, u.date, prodOf(u.project).label, ...u.issues.map(i => `#${i.id} ${i.subject} ${i.client || ''}`)].join(' ').toLowerCase();
    return q.split(/\s+/).every(w => hay.includes(w));
  });
}
const issueMatches = (i) => { const q = U.q.trim().toLowerCase(); if(!q) return false; const no = issueNo(U.q); return no ? i.id === no : `#${i.id} ${i.subject} ${i.client || ''}`.toLowerCase().includes(q); };
/* v4.80.0: clients (Redmine "Client Name" field) */
const sameClient = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
function clientsOf(issues){
  const m = new Map();
  issues.forEach(i => { if(i.client) m.set(i.client.toLowerCase(), { name: i.client, n: ((m.get(i.client.toLowerCase()) || {}).n || 0) + 1 }); });
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/* ---------- pieces ---------- */
function latestCards(){
  const seen = new Map();
  U.data.updates.forEach(u => { if(!seen.has(u.project)) seen.set(u.project, u); });
  const order = ['erp', 'erp-one', 'mrp', 'mfg', ''];
  const list = [...seen.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return `<div class="up-latest">${list.map(([k, u]) => { const p = prodOf(k); return `<button type="button" class="up-lcard${U.product === k ? ' is-active' : ''}" style="--pc:${p.color}" onclick="upProduct('${k}')">
      <span class="up-lcard-top"><span class="up-ic">${escapeHtml(p.short)}</span><span><b>${escapeHtml(p.label)}</b><small>Latest · ${escapeHtml(fmtDate(u.date))}</small></span></span>
      <span class="up-lcard-fe">${ver('fe', 'FE', u.fe || '—', true)}</span>
      <span class="up-lcard-be">${ver('v2', 'V2', u.v2)}${ver('v3', 'V3', u.v3)}</span>
      <span class="up-lcard-n">${u.issues.length} issue${u.issues.length === 1 ? '' : 's'} in this update</span>
    </button>`; }).join('')}</div>`;
}

function toolbar(){
  const counts = {};
  U.data.updates.forEach(u => { counts[u.project] = (counts[u.project] || 0) + 1; });
  const chips = [['all', 'All', U.data.updates.length], ...Object.keys(PRODUCTS).filter(k => counts[k]).map(k => [k, prodOf(k).label, counts[k]])];
  return `<div class="up-toolbar">
    <div class="up-search"><span aria-hidden="true">⌕</span><input class="input" id="upSearch" type="search" value="${escapeHtml(U.q)}" placeholder="Search issue number (e.g. 32312), subject or version…" oninput="upSearch(this.value)" autocomplete="off"></div>
    ${allClients().length ? `<select class="select up-client-sel" aria-label="Client" onchange="upClient(this.value)"><option value="">All clients</option>${allClients().map(c => `<option value="${escapeHtml(c.name)}"${sameClient(c.name, U.client) ? ' selected' : ''}>${escapeHtml(c.name)} (${c.n})</option>`).join('')}</select>` : ''}
    <div class="up-chips">${chips.map(([k, l, n]) => `<button type="button" class="up-chip${U.product === k ? ' is-active' : ''}" style="--pc:${k === 'all' ? 'var(--brand)' : prodOf(k).color}" onclick="upProduct('${k}')">${escapeHtml(l)}<span>${n}</span></button>`).join('')}</div>
  </div>`;
}

function allClients(){ return clientsOf(U.data.updates.flatMap(u => u.issues)); }

function answerBanner(list){
  const no = issueNo(U.q);
  if(!no) return '';
  if(!list.length) return `<div class="up-answer is-none"><b>#${escapeHtml(no)}</b> is not in any update yet${U.product !== 'all' ? ` for ${escapeHtml(prodOf(U.product).label)}` : ''}.</div>`;
  const first = list[list.length - 1], it = first.issues.find(i => i.id === no);
  return `<div class="up-answer" style="--pc:${prodOf(first.project).color}">
    <span class="up-answer-ic" aria-hidden="true">✓</span>
    <div><b><a href="${REDMINE}${no}" target="_blank" rel="noopener">#${escapeHtml(no)}</a>${it && it.subject ? ` ${escapeHtml(it.subject)}` : ''}</b>
    <p>Went out in ${ver('fe', 'FE', first.fe || '—')} ${ver('v2', 'V2', first.v2)} — ${escapeHtml(prodOf(first.project).label)}, ${escapeHtml(fmtDate(first.date, true))}${list.length > 1 ? ` <span class="up-muted">(also in ${list.length - 1} later update${list.length - 1 === 1 ? '' : 's'})</span>` : ''}</p></div>
  </div>`;
}

function statusChip(id){
  const s = U.statuses[id];
  if(!s) return U.asked.has(id) ? '' : '<span class="up-st is-wait">…</span>';
  return `<span class="up-st${s.closed || /closed|resolved|done|finish|selesai/i.test(s.status) ? ' is-done' : /deploy/i.test(s.status) ? ' is-deploy' : ''}">${escapeHtml(s.status)}</span>`;
}

function updateCard(u, idx){
  const p = prodOf(u.project);
  const open = U.open.has(u.id) || (!U.q && idx < 3 && !U.closedTop?.has(u.id)) || (U.q && u.issues.some(issueMatches));
  const rows = U.client ? u.issues.filter(i => sameClient(i.client, U.client)) : u.issues;
  const groups = groupIssuesByKind(rows.map(i => ({ ...i, desc: i.subject, description: i.subject })));
  const kinds = KIND_ORDER.filter(k => groups[k] && groups[k].length);
  return `<article class="up-card${open ? ' is-open' : ''}" id="u-${escapeHtml(u.id)}" style="--pc:${p.color}">
    <header class="up-head" onclick="if(!event.target.closest('a,button.up-copy'))upToggle('${u.id}')">
      <span class="up-date"><small>${escapeHtml(new Date(u.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' }))}</small><b>${escapeHtml(String(new Date(u.date + 'T00:00:00').getDate() || '?'))}</b></span>
      <span class="up-head-main">
        <span class="up-head-top"><span class="up-prod">${escapeHtml(p.label)}</span><span class="up-when">${escapeHtml(fmtDate(u.date, true))}</span></span>
        <span class="up-vers">${ver('fe', 'FE', u.fe || '—', true)}${ver('v2', 'V2', u.v2)}${ver('v3', 'V3', u.v3)}</span>
        <span class="up-kinds">${kinds.map(k => `<span class="up-kind is-${k}">${ISSUE_KIND_META[k].emoji} ${groups[k].length} ${escapeHtml(ISSUE_KIND_META[k].title)}</span>`).join('')}${!u.issues.length ? '<span class="up-muted">No issues listed</span>' : ''}</span>
      </span>
      <span class="up-head-acts">
        <button type="button" class="up-copy" onclick="upCopyLink('${u.id}')" title="Copy a link to this update">Copy link</button>
        <span class="up-n">${u.issues.length}<small>issue${u.issues.length === 1 ? '' : 's'}</small></span>
        <span class="up-caret" aria-hidden="true">▾</span>
      </span>
    </header>
    ${open && u.issues.length ? `<div class="up-body"><div class="up-cols" aria-hidden="true"><span>No.</span><span>Description</span><span>Client</span><span>Category</span><span>Status</span></div>${kinds.map(k => `<section class="up-group is-${k}"><h4>${ISSUE_KIND_META[k].emoji} ${escapeHtml(ISSUE_KIND_META[k].title)} <span>${groups[k].length}</span></h4>
        <ul>${groups[k].map(i => `<li class="${issueMatches(i) ? 'is-hit' : ''}"><a class="up-id" href="${REDMINE}${escapeHtml(i.id)}" target="_blank" rel="noopener">#${escapeHtml(i.id)}</a><span class="up-subj">${escapeHtml(i.subject || 'Issue ' + i.id)}</span><span class="up-cl">${i.client ? `<span class="up-client is-row" title="${escapeHtml(i.client)}">${escapeHtml(i.client)}</span>` : '<span class="up-none">—</span>'}</span><span class="up-catc">${i.category ? `<span class="up-cat ${catClass(i.category)}">${escapeHtml(i.category)}</span>` : ''}</span><span class="up-stw" data-st="${escapeHtml(i.id)}">${statusChip(i.id)}</span></li>`).join('')}</ul>
      </section>`).join('')}${U.client && rows.length < u.issues.length ? `<p class="up-plan">Showing ${rows.length} of ${u.issues.length} issues — only ${escapeHtml(U.client)}. <button type="button" class="up-linkbtn" onclick="upClient('')">Show all clients</button></p>` : ''}${u.plan ? `<p class="up-plan">Update plan: ${escapeHtml(u.plan)}</p>` : ''}</div>` : ''}
  </article>`;
}

/* ---------- render ---------- */
function render(){
  const list = visible();
  const shown = U.showAll || U.q ? list : list.slice(0, PAGE);
  let month = '';
  const cards = shown.map((u, i) => { const m = monthOf(u.date); const sep = m !== month ? `<div class="up-month">${escapeHtml(m)}</div>` : ''; month = m; return sep + updateCard(u, i); }).join('');
  const active = document.activeElement && document.activeElement.id === 'upSearch';
  const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  host.innerHTML = `${latestCards()}${toolbar()}${answerBanner(list)}
    <div class="up-list">${cards || (U.q && !issueNo(U.q) ? '<div class="pr-state"><p>No update matches the search.</p></div>' : '')}</div>
    ${!U.showAll && !U.q && list.length > PAGE ? `<button type="button" class="btn btn-secondary up-more" onclick="upShowAll()">Show ${list.length - PAGE} older update${list.length - PAGE === 1 ? '' : 's'}</button>` : ''}`;
  if(active){ const x = document.getElementById('upSearch'); x.focus(); try { x.setSelectionRange(sel[0], sel[1]); } catch(_){} }
  loadStatuses();
}

/* statuses of the issues on screen, 100 per call */
let stTimer = null;
function loadStatuses(){
  clearTimeout(stTimer);
  stTimer = setTimeout(async () => {
    const ids = [...new Set([...host.querySelectorAll('[data-st]')].map(x => x.dataset.st))].filter(id => !U.asked.has(id));
    for(let n = 0; n < ids.length; n += 100){
      const batch = ids.slice(n, n + 100);
      batch.forEach(id => U.asked.add(id));
      try {
        const r = await fetch(`/api/report-share?u=${encodeURIComponent(token)}&ids=${batch.join(',')}`, { cache: 'no-store' });
        const d = await r.json();
        Object.assign(U.statuses, d.statuses || {});
      } catch(_){}
      host.querySelectorAll('[data-st]').forEach(x => { if(batch.includes(x.dataset.st)) x.innerHTML = statusChip(x.dataset.st); });
    }
  }, 120);
}

let searchTimer = null;
Object.assign(window, {
  upSearch(v){ U.q = String(v || ''); clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); },
  upProduct(k){ U.product = U.product === k && k !== 'all' ? 'all' : k; render(); },
  upClient(c){ U.client = String(c || ''); render(); },
  upToggle(id){
    const idx = visible().findIndex(u => u.id === id);
    const isOpen = U.open.has(id) || (!U.q && idx < 3 && !(U.closedTop && U.closedTop.has(id)));
    if(isOpen){ U.open.delete(id); if(idx < 3){ U.closedTop = U.closedTop || new Set(); U.closedTop.add(id); } }
    else { U.open.add(id); if(U.closedTop) U.closedTop.delete(id); }
    render();
  },
  upShowAll(){ U.showAll = true; render(); },
  async upCopyLink(id){
    const url = `${location.origin}${location.pathname}${location.search}#u-${id}`;
    try { await navigator.clipboard.writeText(url); toastMsg('Link to this update copied'); } catch(_){ prompt('Copy this link', url); }
  }
});
function toastMsg(t){ const el = document.getElementById('toast'); if(!el) return; el.textContent = t; el.className = 'toast show'; clearTimeout(toastMsg.t); toastMsg.t = setTimeout(() => { el.className = 'toast'; }, 2200); }

async function load(){
  if(!token){ fail('This link is incomplete.'); return; }
  try {
    const r = await fetch(`/api/report-share?u=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if(!r.ok){ fail(d.error || 'The page could not be loaded.'); return; }
    U.data = d;
  } catch(_){ fail('The page could not be loaded. Check your connection and refresh.'); return; }
  document.getElementById('prMeta').innerHTML = `<span class="pr-live"><i></i>Live</span><span>Updated ${escapeHtml(new Date(U.data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span><button type="button" class="btn btn-secondary btn-sm" onclick="location.reload()">Refresh</button>`;
  U.data.updates.forEach(u => u.issues.forEach(i => { if(i.status !== undefined){ U.statuses[i.id] = { status: i.status, closed: i.closed }; U.asked.add(i.id); } }));
  if(!U.data.updates.length){ host.innerHTML = '<div class="pr-state"><p><b>No updates yet.</b></p></div>'; return; }
  render();
  goToHash();
  window.addEventListener('hashchange', goToHash);
}
/* /u/<token>#u-<id> opens that update and scrolls to it */
function goToHash(){
  const id = decodeURIComponent((location.hash.match(/^#u-(.+)$/) || [])[1] || '');
  if(!id || !U.data) return;
  U.q = ''; U.product = 'all'; U.showAll = true; U.open.add(id); if(U.closedTop) U.closedTop.delete(id);
  render();
  const el = document.getElementById('u-' + id);
  if(el){ el.scrollIntoView({ block: 'start' }); el.classList.add('is-flash'); }
}
load();
