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
import { viewHtml, reportText, markReady, ORDER, PARTS } from './client-updates-view.js';
import { writeClipboard } from '../core/clipboard.js';
import { setNavCount } from '../ui/list-controls.js';
import { cmpVersion, siteForClient, ensureSitesLoaded, sitesLoaded } from './sites.js';

const FRESH_MS = 60 * 1000;
const C = { data: null, at: 0, loading: false, error: '', q: '', status: 'all', client: '', showAll: false, open: new Set(), listening: false };

/* versions are written "V2.26.11.061430" in a summary and "2.26.11.061430" on a site */
const nv = (v) => String(v || '').trim().replace(/^[^\d]+/, '');
const reached = (have, want) => cmpVersion(nv(have), nv(want)) >= 0;
const siteVersion = (s, part) => part === 'fe' ? (s.pinnedVersion || s.version || '') : (s[part] || '');

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
  const ready = markReady(C.data.updates || []);
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
function render(){
  const box = $('clientUpdatesBody');
  if(!box) return;
  if(!C.data){
    box.innerHTML = C.error
      ? `<div class="kb-state"><p><b>${escapeHtml(C.error)}</b></p><button type="button" class="btn btn-secondary btn-sm" onclick="openClientUpdatesView(true)">Try again</button></div>`
      : '<div class="kb-state"><p>Loading the updates…</p></div>';
    return;
  }
  C.sitesLoading = sitesLoaded() < 0;
  const active = document.activeElement && document.activeElement.id === 'cuSearch';
  const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const { html, pending } = viewHtml(C, build());
  try { setNavCount('countClientUpdates', pending); } catch(_){}
  box.innerHTML = html;
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
