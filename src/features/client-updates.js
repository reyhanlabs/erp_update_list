/**
 * Client Updates (v5.4.0)
 *
 * For every update (Update Summary) — which clients have issues in it, and has each
 * client's own Zahir ERP server been updated to it yet? The answer comes from matching
 * the versions of the summary (FE / V2 / V3) with the versions Client Versions reads
 * from each client's site; the date is taken from that site's version history.
 *
 * Data: /api/report-share?history=1 (updates + issues with their Redmine client) and
 * the sites of Client Versions.
 */
import { apiFetch } from '../api.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';
import { setNavCount } from '../ui/list-controls.js';
import { cmpVersion, siteForClient, ensureSitesLoaded, sitesLoaded } from './sites.js';

const REDMINE = 'https://pjm.zahironline.com/issues/';
const PRODUCTS = { 'erp': 'Zahir ERP', 'erp-one': 'Zahir ERP One', 'mfg': 'Manufacturing', 'mrp': 'Zahir MRP', '': 'Other' };
const PARTS = [['fe', 'FE'], ['v2', 'V2'], ['v3', 'V3']];
const PAGE = 10, FRESH_MS = 60 * 1000;
const C = { data: null, at: 0, loading: false, error: '', q: '', status: 'all', client: '', showAll: false, open: new Set(), listening: false };

/* versions are written "V2.26.11.061430" in a summary and "2.26.11.061430" on a site */
const nv = (v) => String(v || '').trim().replace(/^[^\d]+/, '');
const reached = (have, want) => cmpVersion(nv(have), nv(want)) >= 0;
const siteVersion = (s, part) => part === 'fe' ? (s.pinnedVersion || s.version || '') : (s[part] || '');
const fmtDate = (x) => { const d = typeof x === 'number' ? new Date(x) : new Date(String(x || '') + 'T00:00:00'); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtWhen = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pill = (kind, label, v, extra) => v ? `<span class="up-ver is-${kind}${extra || ''}"><b>${label}</b><code>${escapeHtml(v)}</code></span>` : '';

/* has this client's server reached the versions of this update? */
function judge(site, u){
  if(!site) return { state: 'nosite', parts: [] };
  const parts = PARTS.filter(([k]) => u[k]).map(([k, label]) => {
    const have = siteVersion(site, k);
    return { key: k, label, have, want: u[k], ok: have ? reached(have, u[k]) : null };
  });
  const known = parts.filter(p => p.ok !== null);
  if(!known.length) return { state: 'unknown', parts };
  if(known.some(p => !p.ok)) return { state: 'pending', parts };
  // when: taken from the site's version history in Client Versions
  let at = 0, recorded = true;
  known.forEach(p => {
    // the recorded change that crossed the update's version (before: older, after: this version or newer)
    const hit = (site.history || []).filter(c => c.part === p.key && reached(c.to, p.want) && !reached(c.from, p.want)).sort((a, b) => a.at - b.at)[0];
    if(hit) at = Math.max(at, hit.at); else recorded = false;
  });
  return { state: 'updated', parts, at: recorded && at ? at : 0 };
}

/* updates → clients of each update, with the state of each client's server */
function build(){
  const ready = new Set(), seen = new Set();
  (C.data.updates || []).forEach(u => { if(!seen.has(u.project)){ seen.add(u.project); ready.add(u.id); } });
  return (C.data.updates || []).map(u => {
    const by = new Map();
    let noClient = 0;
    u.issues.forEach(i => {
      const name = String(i.client || '').trim();
      if(!name){ noClient++; return; }
      const key = name.toLowerCase();
      if(!by.has(key)) by.set(key, { name, issues: [] });
      by.get(key).issues.push(i);
    });
    const clients = [...by.values()].map(c => { const site = siteForClient(c.name); return { ...c, site, ...judge(site, u) }; })
      .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
    return { u, ready: ready.has(u.id), clients, noClient };
  }).filter(x => x.clients.length);
}
const ORDER = { pending: 0, unknown: 1, nosite: 2, updated: 3 };
const STATE = {
  updated: { label: 'Updated', cls: 'is-updated' },
  pending: { label: 'Not updated yet', cls: 'is-pending' },
  unknown: { label: 'Version unknown', cls: 'is-unknown' },
  nosite:  { label: 'No site listed', cls: 'is-unknown' }
};

function matches(c){
  if(C.status !== 'all' && (C.status === 'other' ? !['unknown', 'nosite'].includes(c.state) : c.state !== C.status)) return false;
  if(C.client && c.name.toLowerCase() !== C.client.toLowerCase()) return false;
  const q = C.q.trim().toLowerCase();
  if(!q) return true;
  const no = (q.match(/^#?(\d{3,7})$/) || [])[1];
  if(no) return c.issues.some(i => String(i.id) === no);
  return `${c.name} ${(c.site && c.site.url) || ''} ${c.issues.map(i => `#${i.id} ${i.subject}`).join(' ')}`.toLowerCase().includes(q);
}

function clientRow(x, c){
  const st = STATE[c.state], key = `${x.u.id}|${c.name.toLowerCase()}`, open = C.open.has(key);
  const running = c.site
    ? (c.parts.filter(p => p.have).map(p => pill(p.key, p.label, p.have, p.ok === false ? ' is-behind' : '')).join('') || '<span class="cu-muted">not read yet</span>')
    : '<span class="cu-muted">—</span>';
  const note = c.state === 'updated' ? (c.at ? `since ${escapeHtml(fmtWhen(c.at))}` : 'date not recorded')
    : c.state === 'pending' ? `needs ${c.parts.filter(p => p.ok === false).map(p => `${p.label} ${escapeHtml(p.want)}`).join(' · ')}`
    : c.state === 'nosite' ? 'add this client in Client Versions' : 'open Client Versions and check the site';
  return `<div class="cu-row${open ? ' is-open' : ''}">
    <button type="button" class="cu-row-main" onclick="cuToggle('${escapeHtml(key).replace(/'/g, '&#39;')}')" aria-expanded="${open}">
      <span class="cu-client"><b>${escapeHtml(c.name)}</b>${c.site ? `<small>${escapeHtml(String(c.site.url || '').replace(/^https?:\/\//, ''))}${c.site.isTest ? ' · test server' : ''}</small>` : ''}</span>
      <span class="cu-running">${running}</span>
      <span class="cu-state"><span class="cu-chip ${st.cls}">${st.label}</span><small>${note}</small></span>
      <span class="cu-n">${c.issues.length}<small>issue${c.issues.length === 1 ? '' : 's'}</small></span>
    </button>
    ${open ? `<ul class="cu-issues">${c.issues.map(i => `<li><a href="${REDMINE}${escapeHtml(String(i.id))}" target="_blank" rel="noopener">#${escapeHtml(String(i.id))}</a><span>${escapeHtml(i.subject || '')}</span>${i.status ? `<small>${escapeHtml(i.status)}</small>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function updateCard(x){
  const rows = x.clients.filter(matches);
  if(!rows.length) return '';
  const done = x.clients.filter(c => c.state === 'updated').length, total = x.clients.length;
  return `<article class="cu-card">
    <header class="cu-head">
      <div class="cu-head-main">
        <div class="cu-head-top"><b>${escapeHtml(PRODUCTS[x.u.project] || x.u.project || 'Other')}</b><span>${escapeHtml(fmtDate(x.u.date))}</span>${x.ready ? '<span class="summary-ready"><i aria-hidden="true"></i>Ready for update</span>' : '<span class="stage-chip is-released">Earlier update</span>'}</div>
        <div class="cu-vers">${pill('fe', 'FE', x.u.fe)}${pill('v2', 'V2', x.u.v2)}${pill('v3', 'V3', x.u.v3)}</div>
      </div>
      <div class="cu-progress" title="${done} of ${total} clients updated">
        <span><b>${done}</b> of ${total} client${total === 1 ? '' : 's'} updated</span>
        <i role="img" aria-label="${done} of ${total} clients updated"><em style="width:${Math.round(done / total * 100)}%"></em></i>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="cuCopy('${escapeHtml(x.u.id)}')">Copy report</button>
    </header>
    <div class="cu-cols" aria-hidden="true"><span>Client</span><span>Running now</span><span>Status</span><span>Issues</span></div>
    ${rows.map(c => clientRow(x, c)).join('')}
    ${x.noClient ? `<p class="cu-foot">${x.noClient} issue${x.noClient === 1 ? '' : 's'} in this update ${x.noClient === 1 ? 'has' : 'have'} no client set in Redmine.</p>` : ''}
  </article>`;
}

function render(){
  const box = $('clientUpdatesBody');
  if(!box) return;
  if(!C.data){
    box.innerHTML = C.error
      ? `<div class="kb-state"><p><b>${escapeHtml(C.error)}</b></p><button type="button" class="btn btn-secondary btn-sm" onclick="openClientUpdatesView(true)">Try again</button></div>`
      : '<div class="kb-state"><p>Loading the updates…</p></div>';
    return;
  }
  const all = build();
  // headline: the ready updates only — that is what still has to reach the clients
  const readyClients = all.filter(x => x.ready).flatMap(x => x.clients);
  const n = (s) => readyClients.filter(c => c.state === s).length;
  const pending = n('pending'), other = n('unknown') + n('nosite');
  try { setNavCount('countClientUpdates', pending); } catch(_){}
  const names = [...new Map(all.flatMap(x => x.clients).map(c => [c.name.toLowerCase(), c.name])).values()].sort((a, b) => a.localeCompare(b));
  const seg = [['all', 'All'], ['pending', 'Not updated yet'], ['updated', 'Updated'], ['other', 'Unknown']];
  const list = all.map(x => ({ x, html: updateCard(x) })).filter(y => y.html);
  const shown = C.showAll || C.q || C.client ? list : list.slice(0, PAGE);
  const active = document.activeElement && document.activeElement.id === 'cuSearch';
  const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  box.innerHTML = `
    <div class="cu-stats">
      <button type="button" class="cu-stat" onclick="cuStatus('pending')"><span>Waiting for update</span><b>${pending}</b><small>client${pending === 1 ? '' : 's'} not on the ready installer yet</small></button>
      <button type="button" class="cu-stat" onclick="cuStatus('updated')"><span>Updated</span><b>${n('updated')}</b><small>client${n('updated') === 1 ? '' : 's'} already on the ready installer</small></button>
      <button type="button" class="cu-stat" onclick="cuStatus('other')"><span>Unknown</span><b>${other}</b><small>no site listed, or version not read</small></button>
    </div>
    <div class="cu-toolbar">
      <div class="up-search"><span aria-hidden="true">⌕</span><input class="input" id="cuSearch" type="search" value="${escapeHtml(C.q)}" placeholder="Search client, site or issue number…" oninput="cuSearch(this.value)" autocomplete="off" aria-label="Search"></div>
      <select class="select" aria-label="Client" onchange="cuClient(this.value)"><option value="">All clients</option>${names.map(nm => `<option value="${escapeHtml(nm)}"${nm.toLowerCase() === C.client.toLowerCase() ? ' selected' : ''}>${escapeHtml(nm)}</option>`).join('')}</select>
      <div class="up-stage" role="group" aria-label="Status">${seg.map(([k, l]) => `<button type="button" class="up-stage-btn${C.status === k ? ' is-active' : ''}" aria-pressed="${C.status === k}" onclick="cuStatus('${k}')">${l}</button>`).join('')}</div>
    </div>
    ${sitesLoaded() < 0 ? '<p class="cu-foot">Reading the client sites…</p>' : ''}
    <div class="cu-list">${shown.map(y => y.html).join('') || `<div class="kb-state"><p>${all.length ? 'No client matches these filters.' : 'No update has issues with a client set in Redmine yet.'}</p></div>`}</div>
    ${shown.length < list.length ? `<button type="button" class="btn btn-secondary up-more" onclick="cuShowAll()">Show ${list.length - shown.length} older update${list.length - shown.length === 1 ? '' : 's'}</button>` : ''}
    <p class="cu-foot">A client counts as updated when the versions read from its site are the same as, or newer than, the versions of the update. Updated ${escapeHtml(fmtWhen(C.at))}.</p>`;
  if(active){ const el = $('cuSearch'); if(el){ el.focus(); try { el.setSelectionRange(sel[0], sel[1]); } catch(_){} } }
}

async function openClientUpdatesView(force){
  ensureSitesLoaded();
  if(!C.listening){ C.listening = true; window.addEventListener('sites:updated', () => { if(C.data) render(); }); }
  render();
  if(C.loading || (C.data && !force && Date.now() - C.at < FRESH_MS)) return;
  C.loading = true; C.error = '';
  try {
    const r = await apiFetch('/api/report-share?history=1');
    const d = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(d.error || 'The updates could not be loaded');
    C.data = d; C.at = Date.now();
  } catch(err){ C.error = err.message || 'The updates could not be loaded'; }
  C.loading = false;
  render();
}

/* a short text report of one update, for WhatsApp / Telegram */
function reportText(x){
  const u = x.u, vers = PARTS.filter(([k]) => u[k]).map(([k, l]) => `${l} ${u[k]}`).join(' · ');
  const names = (s) => x.clients.filter(c => c.state === s);
  const lines = [`*${PRODUCTS[u.project] || 'Update'} — ${fmtDate(u.date)}*`, vers, ''];
  const up = names('updated'), pe = names('pending'), ot = [...names('unknown'), ...names('nosite')];
  if(up.length) lines.push(`✅ Updated (${up.length}):`, ...up.map(c => `• ${c.name}${c.at ? ` — ${fmtDate(c.at)}` : ''}`), '');
  if(pe.length) lines.push(`⏳ Not updated yet (${pe.length}):`, ...pe.map(c => `• ${c.name} — running ${c.parts.filter(p => p.have).map(p => `${p.label} ${p.have}`).join(' · ')}`), '');
  if(ot.length) lines.push(`❔ Unknown (${ot.length}):`, ...ot.map(c => `• ${c.name}`), '');
  return lines.join('\n').trim();
}

let searchTimer = null;
const cuSearch = (v) => { C.q = String(v || ''); clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); };
const cuStatus = (k) => { C.status = C.status === k && k !== 'all' ? 'all' : k; render(); };
const cuClient = (v) => { C.client = String(v || ''); render(); };
const cuShowAll = () => { C.showAll = true; render(); };
const cuToggle = (key) => { if(C.open.has(key)) C.open.delete(key); else C.open.add(key); render(); };
async function cuCopy(id){
  const x = build().find(y => y.u.id === id);
  if(!x) return;
  try { await writeClipboard(reportText(x)); toast('Report copied'); } catch(_){ toast('Could not copy the report', 'error'); }
}

export { openClientUpdatesView, cuSearch, cuStatus, cuClient, cuShowAll, cuToggle, cuCopy, judge, nv };
