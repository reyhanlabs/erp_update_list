/**
 * Client Updates — the view (v5.5.0)
 *
 * Draws the Client Updates list from ready-made data, so the menu inside the app
 * (src/features/client-updates.js, data worked out from Client Versions) and the public
 * link /c/<token> (src/public/client-updates-page.js, data worked out on the server)
 * show exactly the same page.
 *
 *   S   = { q, status, client, showAll, open:Set, at, pub?, sitesLoading? }
 *   all = [{ u:{id,date,fe,v2,v3,project}, ready, clients:[{name,state,at,parts,issues,site}], noClient }]
 * The page that hosts it puts cuSearch / cuStatus / cuClient / cuShowAll / cuToggle / cuCopy on window.
 */
import { escapeHtml } from '../core/helpers.js';

const REDMINE = 'https://pjm.zahironline.com/issues/';
const PRODUCTS = { 'erp': 'Zahir ERP', 'erp-one': 'Zahir ERP One', 'mfg': 'Manufacturing', 'mrp': 'Zahir MRP', '': 'Other' };
const PARTS = [['fe', 'FE'], ['v2', 'V2'], ['v3', 'V3']];
const PAGE = 10;
const fmtDate = (x) => { const d = typeof x === 'number' ? new Date(x) : new Date(String(x || '') + 'T00:00:00'); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtWhen = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pill = (kind, label, v, extra) => v ? `<span class="up-ver is-${kind}${extra || ''}"><b>${label}</b><code>${escapeHtml(v)}</code></span>` : '';

const ORDER = { pending: 0, unknown: 1, nosite: 2, updated: 3 };
const STATE = {
  updated: { label: 'Updated', cls: 'is-updated' },
  pending: { label: 'Not updated yet', cls: 'is-pending' },
  unknown: { label: 'Version unknown', cls: 'is-unknown' },
  nosite:  { label: 'No site listed', cls: 'is-unknown' }
};

function matches(S, c){
  if(S.status !== 'all' && (S.status === 'other' ? !['unknown', 'nosite'].includes(c.state) : c.state !== S.status)) return false;
  if(S.client && c.name.toLowerCase() !== S.client.toLowerCase()) return false;
  const q = S.q.trim().toLowerCase();
  if(!q) return true;
  const no = (q.match(/^#?(\d{3,7})$/) || [])[1];
  if(no) return c.issues.some(i => String(i.id) === no);
  return `${c.name} ${(c.site && c.site.url) || ''} ${c.issues.map(i => `#${i.id} ${i.subject}`).join(' ')}`.toLowerCase().includes(q);
}

function clientRow(S, x, c){
  const st = STATE[c.state], key = `${x.u.id}|${c.name.toLowerCase()}`, open = S.open.has(key);
  const running = c.site
    ? (c.parts.filter(p => p.have).map(p => pill(p.key, p.label, p.have, p.ok === false ? ' is-behind' : '')).join('') || '<span class="cu-muted">not read yet</span>')
    : '<span class="cu-muted">—</span>';
  const note = c.state === 'updated' ? (c.at ? `since ${escapeHtml(fmtWhen(c.at))}` : 'date not recorded')
    : c.state === 'pending' ? `needs ${c.parts.filter(p => p.ok === false).map(p => `${p.label} ${escapeHtml(p.want)}`).join(' · ')}`
    : c.state === 'nosite' ? (S.pub ? 'not in Client Versions' : 'add this client in Client Versions') : (S.pub ? 'version not read yet' : 'open Client Versions and check the site');
  return `<div class="cu-row${open ? ' is-open' : ''}">
    <button type="button" class="cu-row-main" onclick="cuToggle('${escapeHtml(key).replace(/'/g, '&#39;')}')" aria-expanded="${open}">
      <span class="cu-client"><b>${escapeHtml(c.name)}</b>${c.site && (c.site.url || c.site.isTest) ? `<small>${escapeHtml([String(c.site.url || '').replace(/^https?:\/\//, ''), c.site.isTest ? 'test server' : ''].filter(Boolean).join(' · '))}</small>` : ''}</span>
      <span class="cu-running">${running}</span>
      <span class="cu-state"><span class="cu-chip ${st.cls}">${st.label}</span><small>${note}</small></span>
      <span class="cu-n">${c.issues.length}<small>issue${c.issues.length === 1 ? '' : 's'}</small></span>
    </button>
    ${open ? `<ul class="cu-issues">${c.issues.map(i => `<li><a href="${REDMINE}${escapeHtml(String(i.id))}" target="_blank" rel="noopener">#${escapeHtml(String(i.id))}</a><span>${escapeHtml(i.subject || '')}</span>${i.status ? `<small>${escapeHtml(i.status)}</small>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function updateCard(S, x){
  const rows = x.clients.filter(c => matches(S, c));
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
    ${rows.map(c => clientRow(S, x, c)).join('')}
    ${x.noClient ? `<p class="cu-foot">${x.noClient} issue${x.noClient === 1 ? '' : 's'} in this update ${x.noClient === 1 ? 'has' : 'have'} no client set in Redmine.</p>` : ''}
  </article>`;
}

/* { html, pending } — pending = clients still waiting for a ready installer (the sidebar count) */
function viewHtml(S, all){
  // headline: the ready updates only — that is what still has to reach the clients
  const readyClients = all.filter(x => x.ready).flatMap(x => x.clients);
  const n = (s) => readyClients.filter(c => c.state === s).length;
  const pending = n('pending'), other = n('unknown') + n('nosite');
  const names = [...new Map(all.flatMap(x => x.clients).map(c => [c.name.toLowerCase(), c.name])).values()].sort((a, b) => a.localeCompare(b));
  const seg = [['all', 'All'], ['pending', 'Not updated yet'], ['updated', 'Updated'], ['other', 'Unknown']];
  const list = all.map(x => ({ x, html: updateCard(S, x) })).filter(y => y.html);
  const shown = S.showAll || S.q || S.client ? list : list.slice(0, PAGE);
  const html = `
    <div class="cu-stats">
      <button type="button" class="cu-stat" onclick="cuStatus('pending')"><span>Waiting for update</span><b>${pending}</b><small>client${pending === 1 ? '' : 's'} not on the ready installer yet</small></button>
      <button type="button" class="cu-stat" onclick="cuStatus('updated')"><span>Updated</span><b>${n('updated')}</b><small>client${n('updated') === 1 ? '' : 's'} already on the ready installer</small></button>
      <button type="button" class="cu-stat" onclick="cuStatus('other')"><span>Unknown</span><b>${other}</b><small>no site listed, or version not read</small></button>
    </div>
    <div class="cu-toolbar">
      <div class="up-search"><span aria-hidden="true">⌕</span><input class="input" id="cuSearch" type="search" value="${escapeHtml(S.q)}" placeholder="Search client, site or issue number…" oninput="cuSearch(this.value)" autocomplete="off" aria-label="Search"></div>
      <select class="select" aria-label="Client" onchange="cuClient(this.value)"><option value="">All clients</option>${names.map(nm => `<option value="${escapeHtml(nm)}"${nm.toLowerCase() === S.client.toLowerCase() ? ' selected' : ''}>${escapeHtml(nm)}</option>`).join('')}</select>
      <div class="up-stage" role="group" aria-label="Status">${seg.map(([k, l]) => `<button type="button" class="up-stage-btn${S.status === k ? ' is-active' : ''}" aria-pressed="${S.status === k}" onclick="cuStatus('${k}')">${l}</button>`).join('')}</div>
    </div>
    ${S.sitesLoading ? '<p class="cu-foot">Reading the client sites…</p>' : ''}
    <div class="cu-list">${shown.map(y => y.html).join('') || `<div class="kb-state"><p>${all.length ? 'No client matches these filters.' : 'No update has issues with a client set in Redmine yet.'}</p></div>`}</div>
    ${shown.length < list.length ? `<button type="button" class="btn btn-secondary up-more" onclick="cuShowAll()">Show ${list.length - shown.length} older update${list.length - shown.length === 1 ? '' : 's'}</button>` : ''}
    <p class="cu-foot">A client counts as updated when the versions read from its site are the same as, or newer than, the versions of the update. Updated ${escapeHtml(fmtWhen(S.at))}.</p>`;
  return { html, pending };
}

/* newest update of each product = the installer users can be updated to now */
function markReady(updates){
  const seen = new Set(), ready = new Set();
  updates.forEach(u => { if(!seen.has(u.project)){ seen.add(u.project); ready.add(u.id); } });
  return ready;
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

export { viewHtml, reportText, markReady, ORDER, PARTS, fmtWhen };
