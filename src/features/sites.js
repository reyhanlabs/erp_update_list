/**
 * Client Versions (v4.56.0)
 *
 * A list the team keeps by hand — client name + Zahir ERP URL (+ notes) —
 * while the version each site runs is read automatically from its public
 * login page (bottom-left), via /api/erp-version. Stored in the workspace:
 *   workspaces/{ws}/sites/{id}
 *   { name, url, notes, pinnedVersion,
 *     version, versionSource, confidence, checkedAt, checkError,
 *     prevVersion, versionChangedAt, createdAt, updatedAt }
 */
import { db } from '../firebase.js';
import { CloudSync } from '../core/cloud-sync.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { apiFetch } from '../api.js';
import { confirmDialog } from '../ui/confirm.js';
import { setNavCount } from '../ui/list-controls.js';

const STALE_MS = 6 * 60 * 60 * 1000;     // re-check sites older than 6 hours when the menu opens
const PARALLEL = 3;

const S = {
  sites: [], loaded: false, unsub: null, ws: null,
  query: '', versionFilter: 'all', sort: 'name',
  checking: new Set(), editing: null, open: null   // open = id whose details are expanded
};

function ref(){
  if(!CloudSync.workspaceId) throw new Error('Workspace not ready yet');
  return db.collection('workspaces').doc(CloudSync.workspaceId).collection('sites');
}

/* ---------------- versions ---------------- */
function cmpVersion(a, b){
  const pa = String(a || '').split(/[.\-+]/).map(x => (/^\d+$/.test(x) ? +x : x));
  const pb = String(b || '').split(/[.\-+]/).map(x => (/^\d+$/.test(x) ? +x : x));
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if(x === y) continue;
    if(typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}
const shownVersion = (s) => s.pinnedVersion || s.version || '';
function latestVersion(){
  return S.sites.map(shownVersion).filter(Boolean).sort(cmpVersion).pop() || '';
}

function ago(ms){
  if(!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if(m < 1) return 'just now';
  if(m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if(h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function hostOf(url){ try { return new URL(url).host; } catch(_){ return url; } }
function cleanUrl(raw){
  let s = String(raw || '').trim();
  if(!s) return '';
  if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    u.protocol = 'https:';
    if(u.pathname === '/' || !u.pathname) u.pathname = '/auth';   // the login page shows the version
    u.hash = '';
    return u.toString();
  } catch(_){ return ''; }
}

/* ---------------- data ---------------- */
function subscribe(){
  const ws = CloudSync.workspaceId;
  if(!ws){ setTimeout(() => { if(isVisible()) subscribe(); }, 400); return; }
  if(S.unsub && S.ws === ws) return;
  if(S.unsub){ try { S.unsub(); } catch(_){} }
  S.ws = ws;
  S.unsub = ref().onSnapshot(snap => {
    S.sites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.loaded = true;
    updateNavCount();
    render();
    autoCheckStale();
  }, err => {
    console.error('sites', err);
    S.loaded = true;
    // Firestore drops a listener after an error; forget it so the next visit subscribes again
    try { S.unsub && S.unsub(); } catch(_){}
    S.unsub = null; S.ws = null;
    const el = $('sitesBody');
    if(el) el.innerHTML = `<div class="kb-state"><h3>Client Versions cannot be opened</h3><p>${escapeHtml(err.code === 'permission-denied'
      ? 'Firestore denied access. Publish the latest firestore.rules in the Firebase Console.'
      : (err.message || 'Failed to load data.'))}</p></div>`;
  });
}
function isVisible(){ return !!document.getElementById('view-sites')?.classList.contains('active'); }

function updateNavCount(){
  const latest = latestVersion();
  const behind = latest ? S.sites.filter(s => shownVersion(s) && cmpVersion(shownVersion(s), latest) < 0).length : 0;
  const el = $('countSites');
  if(el) setNavCount(el, behind);
}

/* ---------------- version checks ---------------- */
async function checkSite(site, { quiet = false } = {}){
  if(S.checking.has(site.id)) return;
  S.checking.add(site.id);
  render();
  try {
    // where the version was found last time (webpack chunk id) — the same build is shared by most clients
    const hints = [...new Set([site.chunkHint, ...S.sites.map(x => x.chunkHint)].filter(Boolean))].slice(0, 3).join(',');
    const r = await apiFetch(`/api/erp-version?url=${encodeURIComponent(site.url)}${hints ? '&hint=' + encodeURIComponent(hints) : ''}`);
    const d = await r.json().catch(() => ({}));
    const now = Date.now();
    if(!r.ok || d.error){
      await ref().doc(site.id).set({ checkedAt: now, checkError: d.error || `HTTP ${r.status}`, checkHint: d.hint || '' }, { merge: true });
      if(!quiet) toast(`${site.name}: ${d.error || 'check failed'}`, 'error');
      return;
    }
    const patch = {
      checkedAt: now, checkError: d.version ? '' : 'Version not found on the login page', checkHint: '',
      confidence: d.confidence || '', versionSource: d.source || '',
      candidates: (d.candidates || []).slice(0, 6)
    };
    if(d.chunkHint) patch.chunkHint = String(d.chunkHint);
    if(d.version){
      patch.version = d.version;
      if(site.version && site.version !== d.version){ patch.prevVersion = site.version; patch.versionChangedAt = now; }
      if(!site.version) patch.versionChangedAt = now;
    }
    await ref().doc(site.id).set(patch, { merge: true });
    if(!quiet) toast(d.version ? `${site.name}: ${d.version}` : `${site.name}: version not found`, d.version ? undefined : 'error');
  } catch(err){
    if(!quiet) toast(`${site.name}: ${err.message || err}`, 'error');
  } finally {
    S.checking.delete(site.id);
    render();
  }
}

async function checkMany(list, opts){
  const queue = list.slice();
  const worker = async () => { while(queue.length) await checkSite(queue.shift(), opts); };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
}

let autoRan = false;
function autoCheckStale(){
  if(autoRan || !isVisible()) return;
  autoRan = true;
  const stale = S.sites.filter(s => s.url && Date.now() - (s.checkedAt || 0) > STALE_MS);
  if(stale.length) checkMany(stale, { quiet: true });
}

async function checkAllSites(){
  if(!S.sites.length) return;
  toast(`Checking ${S.sites.length} site(s)…`);
  await checkMany(S.sites, { quiet: true });
  const failed = S.sites.filter(s => s.checkError).length;
  toast(failed ? `Done · ${failed} could not be read` : 'All versions updated', failed ? 'error' : undefined);
}
function checkOneSite(id){ const s = S.sites.find(x => x.id === id); if(s) checkSite(s); }

/* ---------------- add / edit / delete ---------------- */
function openSiteForm(id){
  const s = id ? S.sites.find(x => x.id === id) : null;
  S.editing = { id: s ? s.id : null };
  const f = $('sitesForm');
  if(!f) return;
  $('siteName').value = s ? s.name || '' : '';
  $('siteUrl').value = s ? s.url || '' : '';
  $('siteNotes').value = s ? s.notes || '' : '';
  $('sitePinned').value = s ? s.pinnedVersion || '' : '';
  $('sitesFormTitle').textContent = s ? 'Edit client' : 'Add client';
  $('sitesBulk').classList.add('hidden');
  f.classList.remove('hidden');
  setTimeout(() => $('siteName').focus(), 30);
}
function closeSiteForm(){ S.editing = null; $('sitesForm')?.classList.add('hidden'); $('sitesBulk')?.classList.add('hidden'); }

async function saveSite(ev){
  if(ev) ev.preventDefault();
  const name = $('siteName').value.trim();
  const url = cleanUrl($('siteUrl').value);
  if(!name){ toast('Client name is required', 'error'); $('siteName').focus(); return; }
  if(!url){ toast('Enter the Zahir ERP address, e.g. apt.zahirerp.com', 'error'); $('siteUrl').focus(); return; }
  const dup = S.sites.find(s => s.id !== S.editing?.id && hostOf(s.url) === hostOf(url));
  if(dup){ toast(`${hostOf(url)} is already listed as ${dup.name}`, 'error'); return; }
  const now = Date.now();
  const data = { name: name.slice(0, 120), url, notes: $('siteNotes').value.trim().slice(0, 500),
    pinnedVersion: $('sitePinned').value.trim().replace(/^v/i, '').slice(0, 40), updatedAt: now };
  try {
    const id = S.editing?.id;
    const before = id ? S.sites.find(x => x.id === id) : null;
    const docRef = id ? ref().doc(id) : ref().doc();
    if(!id) data.createdAt = now;
    if(before && before.url !== url) Object.assign(data, { version: '', checkedAt: 0, checkError: '', prevVersion: '', candidates: [] });
    await docRef.set(data, { merge: true });
    closeSiteForm();
    toast(id ? 'Client updated' : 'Client added');
    if(!id || (before && before.url !== url)) checkSite({ id: docRef.id, ...data, version: '' }, { quiet: false });
  } catch(err){
    toast('Could not save: ' + (err.code === 'permission-denied' ? 'publish the latest firestore.rules first' : (err.message || err)), 'error');
  }
}

async function deleteSite(id){
  const s = S.sites.find(x => x.id === id);
  if(!s) return;
  const ok = await confirmDialog({ title: 'Remove client?', message: `Remove <b>${escapeHtml(s.name)}</b> (${escapeHtml(hostOf(s.url))}) from the list?`, okText: 'Remove', cancelText: 'Cancel', type: 'danger' });
  if(!ok) return;
  try { await ref().doc(id).delete(); toast('Client removed'); } catch(err){ toast('Could not remove: ' + (err.message || err), 'error'); }
}

/* bulk add: one client per line — "Name, URL" / "Name<TAB>URL" / "Name URL" */
function openBulk(){
  closeSiteForm();
  $('sitesBulk')?.classList.remove('hidden');
  setTimeout(() => $('sitesBulkText')?.focus(), 30);
}
async function saveBulk(){
  const lines = String($('sitesBulkText').value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const known = new Set(S.sites.map(s => hostOf(s.url)));
  const add = []; const skipped = [];
  lines.forEach(line => {
    const m = line.match(/^(.*?)[\s,;\t|]+((?:https?:\/\/)?[\w.\-]+\.[a-z]{2,}(?:\/\S*)?)\s*$/i);
    if(!m){ skipped.push(line); return; }
    const url = cleanUrl(m[2]);
    const name = m[1].replace(/[,;|\t]+$/, '').trim() || hostOf(url).split('.')[0];
    if(!url || known.has(hostOf(url))){ skipped.push(line); return; }
    known.add(hostOf(url));
    add.push({ name, url });
  });
  if(!add.length){ toast(skipped.length ? 'No new clients found (already listed or not "Name, URL")' : 'Nothing to add', 'error'); return; }
  try {
    const batch = db.batch(); const now = Date.now(); const ids = [];
    add.forEach(a => { const r = ref().doc(); ids.push({ id: r.id, ...a }); batch.set(r, { ...a, notes: '', pinnedVersion: '', createdAt: now, updatedAt: now }); });
    await batch.commit();
    $('sitesBulkText').value = '';
    closeSiteForm();
    toast(`Added ${add.length} client(s)${skipped.length ? ` · ${skipped.length} line(s) skipped` : ''}`);
    checkMany(ids, { quiet: true });
  } catch(err){ toast('Could not add: ' + (err.message || err), 'error'); }
}

/* ---------------- export ---------------- */
function exportSites(){
  const rows = [['Client', 'URL', 'Version', 'Pinned version', 'Detected version', 'Last checked', 'Previous version', 'Changed', 'Notes']];
  sorted(filtered()).forEach(s => rows.push([s.name, s.url, shownVersion(s), s.pinnedVersion || '', s.version || '',
    s.checkedAt ? new Date(s.checkedAt).toLocaleString() : '', s.prevVersion || '', s.versionChangedAt ? new Date(s.versionChangedAt).toLocaleDateString() : '', s.notes || '']));
  const cell = (v) => { const t = String(v ?? ''); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `client-versions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- render ---------------- */
function filtered(){
  const q = S.query.trim().toLowerCase();
  return S.sites.filter(s => !q || `${s.name} ${s.url} ${s.notes || ''} ${shownVersion(s)}`.toLowerCase().includes(q))
    .filter(s => S.versionFilter === 'all' ? true
      : S.versionFilter === '__error' ? !!s.checkError && !s.pinnedVersion
      : S.versionFilter === '__behind' ? (latestVersion() && shownVersion(s) && cmpVersion(shownVersion(s), latestVersion()) < 0)
      : shownVersion(s) === S.versionFilter);
}
function sorted(list){
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    version: (a, b) => cmpVersion(shownVersion(a), shownVersion(b)) || a.name.localeCompare(b.name),
    versionDesc: (a, b) => cmpVersion(shownVersion(b), shownVersion(a)) || a.name.localeCompare(b.name),
    changed: (a, b) => (b.versionChangedAt || 0) - (a.versionChangedAt || 0)
  }[S.sort] || (() => 0);
  return list.slice().sort(by);
}

function render(){
  const el = $('sitesBody');
  if(!el || !isVisible()) return;
  if(!S.loaded){ el.innerHTML = '<div class="kb-state"><div class="spinner-sm"></div><p>Loading…</p></div>'; return; }
  if(!S.sites.length){
    el.innerHTML = `<div class="kb-welcome">
      <h2>List your clients' Zahir ERP sites</h2>
      <p>Add each client with the address of their Zahir ERP (for example <b>apt.zahirerp.com</b>). The version is read automatically from the login page, so you only type the name and the address.</p>
      <div class="kb-welcome-actions">
        <button type="button" class="btn btn-primary" onclick="openSiteForm()">Add client</button>
        <button type="button" class="btn btn-secondary" onclick="openSitesBulk()">Paste a list</button>
      </div>
    </div>`;
    return;
  }
  const latest = latestVersion();
  const groups = new Map();
  S.sites.forEach(s => { const v = shownVersion(s) || '—'; groups.set(v, (groups.get(v) || 0) + 1); });
  const versions = [...groups.keys()].filter(v => v !== '—').sort(cmpVersion).reverse();
  const behind = latest ? S.sites.filter(s => shownVersion(s) && cmpVersion(shownVersion(s), latest) < 0).length : 0;
  const errors = S.sites.filter(s => s.checkError && !s.pinnedVersion).length;
  const chip = (val, label, n, cls = '') => `<button type="button" class="sv-chip ${cls}${S.versionFilter === val ? ' is-active' : ''}" onclick="setSitesFilter(${escapeHtml(JSON.stringify(val))})">${label}<b>${n}</b></button>`;

  const list = sorted(filtered());
  const rows = list.map(s => {
    const v = shownVersion(s);
    const isLatest = v && latest && cmpVersion(v, latest) === 0;
    const isBehind = v && latest && cmpVersion(v, latest) < 0;
    const busy = S.checking.has(s.id);
    const changed = s.prevVersion && s.versionChangedAt && Date.now() - s.versionChangedAt < 30 * 86400000
      ? `<span class="sv-changed" title="Changed ${new Date(s.versionChangedAt).toLocaleDateString()}">from ${escapeHtml(s.prevVersion)} · ${escapeHtml(ago(s.versionChangedAt))}</span>` : '';
    const status = busy ? '<span class="sv-status is-busy">checking…</span>'
      : s.checkError && !s.pinnedVersion ? `<span class="sv-status is-error" title="${escapeHtml(s.checkError + (s.checkHint ? ' — ' + s.checkHint : ''))}">couldn't read · ${escapeHtml(ago(s.checkedAt))}</span>`
      : `<span class="sv-status">${escapeHtml(ago(s.checkedAt))}</span>`;
    const open = S.open === s.id;
    const details = open ? `<div class="sv-details">
        ${s.pinnedVersion ? `<p><b>Version set by hand:</b> ${escapeHtml(s.pinnedVersion)}${s.version ? ` (detected: ${escapeHtml(s.version)})` : ''}</p>` : ''}
        ${s.checkError ? `<p class="sv-err"><b>Last check:</b> ${escapeHtml(s.checkError)}${s.checkHint ? ` — ${escapeHtml(s.checkHint)}` : ''}</p>` : ''}
        ${s.versionSource ? `<p><b>Found in:</b> <code>${escapeHtml(s.versionSource)}</code> · confidence ${escapeHtml(s.confidence || '-')}</p>` : ''}
        ${(s.candidates || []).length ? `<p><b>Other values seen:</b> ${(s.candidates || []).slice(1).map(c => `<code title="${escapeHtml(c.context || '')}">${escapeHtml(c.value)}</code>`).join(' ') || '—'}</p>` : ''}
        ${s.notes ? `<p><b>Notes:</b> ${escapeHtml(s.notes)}</p>` : ''}
      </div>` : '';
    return `<div class="sv-row${open ? ' is-open' : ''}">
      <div class="sv-main">
        <button type="button" class="sv-name" onclick="toggleSiteDetails('${s.id}')" aria-expanded="${open}">${escapeHtml(s.name)}</button>
        <a class="sv-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(s.url))}</a>
        ${s.notes ? `<span class="sv-notes" title="${escapeHtml(s.notes)}">${escapeHtml(s.notes)}</span>` : ''}
      </div>
      <div class="sv-ver">
        ${v ? `<span class="sv-badge${isLatest ? ' is-latest' : isBehind ? ' is-behind' : ''}">${escapeHtml(v)}${s.pinnedVersion ? '<small>manual</small>' : ''}</span>` : '<span class="sv-badge is-none">unknown</span>'}
        ${changed}
      </div>
      <div class="sv-checked">${status}</div>
      <div class="sv-acts">
        <button type="button" class="sv-icon" onclick="checkOneSite('${s.id}')" title="Check version now" aria-label="Check version of ${escapeHtml(s.name)}"${busy ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></svg></button>
        <button type="button" class="sv-icon" onclick="openSiteForm('${s.id}')" title="Edit" aria-label="Edit ${escapeHtml(s.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="sv-icon is-danger" onclick="deleteSite('${s.id}')" title="Remove" aria-label="Remove ${escapeHtml(s.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div>
      ${details}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sv-chips" role="group" aria-label="Filter by version">
      ${chip('all', 'All', S.sites.length)}
      ${versions.map(v => chip(v, escapeHtml(v) + (v === latest ? ' <i>latest</i>' : ''), groups.get(v), v === latest ? 'is-latest' : 'is-behind')).join('')}
      ${behind ? chip('__behind', 'Behind latest', behind, 'is-warn') : ''}
      ${errors ? chip('__error', "Couldn't read", errors, 'is-error') : ''}
    </div>
    <div class="sv-table">
      <div class="sv-head" aria-hidden="true">
        <button type="button" class="sv-th" onclick="setSitesSort('name')">Client${S.sort === 'name' ? ' ↓' : ''}</button>
        <button type="button" class="sv-th" onclick="setSitesSort(${S.sort === 'versionDesc' ? "'version'" : "'versionDesc'"})">Version${S.sort === 'version' ? ' ↑' : S.sort === 'versionDesc' ? ' ↓' : ''}</button>
        <button type="button" class="sv-th" onclick="setSitesSort('changed')">Checked${S.sort === 'changed' ? ' · recently changed' : ''}</button>
        <span></span>
      </div>
      ${rows || '<div class="kb-state kb-state-sm"><p>No client matches this filter.</p></div>'}
    </div>`;
}

function setSitesFilter(v){ S.versionFilter = v; render(); }
function setSitesSort(v){ S.sort = v; render(); }
function toggleSiteDetails(id){ S.open = S.open === id ? null : id; render(); }

/* ---------------- view ---------------- */
let wired = false;
function wire(){
  if(wired) return;
  wired = true;
  $('sitesSearch')?.addEventListener('input', (e) => { S.query = e.target.value; render(); });
  $('sitesForm')?.addEventListener('submit', saveSite);
  $('sitesForm')?.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeSiteForm(); });
}
function onSitesShown(){
  wire();
  subscribe();
  render();
  autoCheckStale();
}
function getAllSites(){ return S.sites.map(({ id, ...rest }) => ({ id, ...rest })); }

export {
  onSitesShown, openSiteForm, closeSiteForm, openBulk as openSitesBulk, saveBulk as saveSitesBulk,
  checkAllSites, checkOneSite, deleteSite, exportSites, setSitesFilter, setSitesSort, toggleSiteDetails,
  getAllSites, cmpVersion
};
