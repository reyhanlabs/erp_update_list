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
import { canEdit } from '../core/team.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { apiFetch } from '../api.js';
import { confirmDialog } from '../ui/confirm.js';
import { setNavCount } from '../ui/list-controls.js';
import { switchView } from '../ui/navigation.js';
import { getClientIndex, ensureClientOverview, openClientIssues } from './clients.js';

const STALE_MS = 6 * 60 * 60 * 1000;     // re-check sites older than 6 hours when the menu opens
const PARALLEL = 6;
const AUTO_MAX = 100;                     // stale sites re-checked automatically per visit (oldest first); "Check all" does the rest

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
function subscribe(background){
  const ws = CloudSync.workspaceId;
  if(!ws){ setTimeout(() => { if(background || isVisible()) subscribe(background); }, 400); return; }
  if(S.unsub && S.ws === ws) return;
  if(S.unsub){ try { S.unsub(); } catch(_){} }
  S.ws = ws;
  S.unsub = ref().onSnapshot(snap => {
    S.sites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.loaded = true;
    updateNavCount();
    render();
    try { window.dispatchEvent(new CustomEvent('sites:updated')); } catch(_){}
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

/* front-end, API V2 and API V3: value per site, highest value across sites */
const PARTS = [
  { key: 'fe', label: 'Front-end', get: (s) => shownVersion(s) },
  { key: 'v2', label: 'API V2', get: (s) => s.v2 || '' },
  { key: 'v3', label: 'API V3', get: (s) => s.v3 || '' }
];
// Test / internal servers (e.g. a dev server) run builds no client has yet, so
// they don't set "latest" and aren't counted as behind or in the rollout.
const counted = () => { const live = S.sites.filter(s => !s.isTest); return live.length ? live : S.sites; };
function latestOf(part){ return counted().map(part.get).filter(Boolean).sort(cmpVersion).pop() || ''; }
function latestAll(){ return Object.fromEntries(PARTS.map(p => [p.key, latestOf(p)])); }
function onLatest(s, part, top){ const v = part.get(s); return !!(v && top && cmpVersion(v, top) === 0); }
function behindParts(s, tops){ if(s.isTest) return []; return PARTS.filter(p => { const v = p.get(s); return v && tops[p.key] && cmpVersion(v, tops[p.key]) < 0; }); }

/* Build date from a Zahir version: FE/V2 "2.26.10.081600" = major.yy.mm.ddhhmm,
   V3 "26.10.061632" = yy.mm.ddhhmm. Returns a timestamp or 0. */
function buildDate(v){
  const t = String(v || '');
  const m = t.match(/^\d{1,2}\.(\d{2})\.(\d{2})\.(\d{2})(\d{2})(\d{2})$/) || t.match(/^(\d{2})\.(\d{2})\.(\d{2})(\d{2})(\d{2})$/);
  if(!m) return 0;
  const [yy, mm, dd, hh, mi] = m.slice(1).map(Number);
  if(mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return 0;
  return new Date(2000 + yy, mm - 1, dd, hh, mi).getTime();
}
const fmtBuild = (ms) => ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/* Parts built far apart on one site usually mean a half-finished deploy. */
const MISMATCH_DAYS = 14;
function mismatch(s){
  const dated = PARTS.map(p => ({ p, v: p.get(s), at: buildDate(p.get(s)) })).filter(x => x.at);
  if(dated.length < 2) return null;
  const min = Math.min(...dated.map(x => x.at)), max = Math.max(...dated.map(x => x.at));
  const days = Math.round((max - min) / 86400000);
  if(days <= MISMATCH_DAYS) return null;
  const oldest = dated.find(x => x.at === min), newest = dated.find(x => x.at === max);
  return { days, text: `${oldest.p.label} ${oldest.v} is ${days} days older than ${newest.p.label} ${newest.v}` };
}

function updateNavCount(){
  const tops = latestAll();
  const behind = S.sites.filter(s => behindParts(s, tops).length).length;
  const el = $('countSites');
  if(el) setNavCount(el, behind);
}

/* release date of an API answer ("release_date":"2026-10-06"); also read from the
   stored raw answer so sites checked before this version show it too */
function releaseOf(raw){
  const m = String(raw || '').match(/"(?:release_?date|releaseDate|released_?at|build_?date|date)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : '';
}
const apiRelease = (s, k) => s[k + 'Release'] || releaseOf(s[k + 'Raw']);
const fmtDay = (iso) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

/* ---------------- version checks ---------------- */
const API_KEYS = ['v2', 'v3'];                // backend versions: /api/v2/versions/dev and /api/v3/version
function backendPatch(site, backend, now){
  const patch = {};
  if(!backend) return patch;
  API_KEYS.forEach(k => {
    const b = backend[k];
    if(!b) return;
    patch[k + 'Raw'] = b.raw || '';
    if(b.version) patch[k + 'Release'] = b.releaseDate || releaseOf(b.raw);
    patch[k + 'Error'] = b.version ? '' : (b.error || 'not found');
    if(b.version){                              // keep the last known value when a check fails
      patch[k] = b.version;
      if(site[k] && site[k] !== b.version){ patch[k + 'Prev'] = site[k]; patch[k + 'ChangedAt'] = now; }
    }
  });
  return patch;
}

/* ---------------- change notices (toast + optional Telegram) ---------------- */
const TG_CHAT_KEY = 'erp_telegram_chat_id';           // shared with the briefing / RFT alerts
const TG_VERSIONS_KEY = 'erp_telegram_versions_notif';
const partLabel = (k) => ({ fe: 'FE', v2: 'V2', v3: 'V3' }[k] || k.toUpperCase());
function isTelegramVersionsEnabled(){
  try { return !!(localStorage.getItem(TG_CHAT_KEY) || '').trim() && localStorage.getItem(TG_VERSIONS_KEY) === '1'; } catch(_){ return false; }
}
function setTelegramVersionsEnabled(on){
  try { localStorage.setItem(TG_VERSIONS_KEY, on ? '1' : '0'); } catch(_){}
  const el = $('telegramVersionsToggle');
  if(el) el.checked = !!on;
  if(on && !(localStorage.getItem(TG_CHAT_KEY) || '').trim()) toast('Set the Telegram Chat ID above first', 'error');
}
function initSitesSettings(){
  const el = $('telegramVersionsToggle');
  if(el) try { el.checked = localStorage.getItem(TG_VERSIONS_KEY) === '1'; } catch(_){}
}

// changes found by one "Check all" arrive one by one; collect them and send one message
let noticeQueue = [], noticeTimer = null;
function queueChangeNotice(site, changes){
  noticeQueue.push({ name: site.name, host: hostOf(site.url), changes });
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(flushChangeNotices, 4000);
}
function changeLines(item){
  return item.changes.map(c => `  ${partLabel(c.part)} ${c.from} → ${c.to}`).join('\n');
}
async function flushChangeNotices(){
  const items = noticeQueue; noticeQueue = [];
  if(!items.length) return;
  toast(items.length === 1
    ? `Version changed · ${items[0].name}: ${items[0].changes.map(c => `${partLabel(c.part)} ${c.to}`).join(', ')}`
    : `${items.length} clients changed version — see Recent changes`);
  if(!isTelegramVersionsEnabled()) return;
  const chatId = (localStorage.getItem(TG_CHAT_KEY) || '').trim();
  let text = `🔄 Zahir ERP version changes — ${items.length} client${items.length === 1 ? '' : 's'}\n\n`;
  items.slice(0, 30).forEach(it => { text += `${it.name} (${it.host})\n${changeLines(it)}\n\n`; });
  if(items.length > 30) text += `…and ${items.length - 30} more\n`;
  try {
    const r = await apiFetch('/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, text: text.trim() }) });
    if(!r.ok){ const d = await r.json().catch(() => ({})); toast('Telegram: ' + (d.hint || d.error || r.status), 'error'); }
  } catch(err){ console.warn('[telegram versions]', err); }
}
async function testTelegramVersions(){
  const chatId = (localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId){ toast('Set Telegram Chat ID first', 'error'); return; }
  const r = await apiFetch('/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, text: '🔄 Test from Zahir ERP Update Manager — client version change alerts are working.\n\nExample\nAptekindo (apt.zahirerp.com)\n  FE 2.26.10.061600 → 2.26.10.081600' }) }).catch(() => null);
  toast(r && r.ok ? 'Test sent to Telegram' : 'Telegram test failed', r && r.ok ? undefined : 'error');
}

/* what changed in this check (only real changes, not the first reading) */
function changesOf(site, patch, now){
  const out = [];
  const add = (part, from, to) => { if(from && to && from !== to) out.push({ at: now, part, from, to }); };
  add('fe', site.version, patch.version);
  API_KEYS.forEach(k => add(k, site[k], patch[k]));
  return out;
}
const HISTORY_MAX = 50;
function withHistory(site, patch, now){
  const ch = changesOf(site, patch, now);
  if(ch.length){
    patch.history = [...(site.history || []), ...ch].slice(-HISTORY_MAX);
    queueChangeNotice(site, ch);
  }
  return patch;
}

async function checkSite(site, { quiet = false } = {}){
  if(S.checking.has(site.id) || !canEdit()) return;
  S.checking.add(site.id);
  render();
  try {
    // where the version was found last time (webpack chunk id) — the same build is shared by most clients
    const hints = [...new Set([site.chunkHint, ...S.sites.map(x => x.chunkHint)].filter(Boolean))].slice(0, 3).join(',');
    const r = await apiFetch(`/api/erp-version?url=${encodeURIComponent(site.url)}${hints ? '&hint=' + encodeURIComponent(hints) : ''}`);
    const d = await r.json().catch(() => ({}));
    const now = Date.now();
    if(!r.ok || d.error){
      // failCount / downSince: the server check (api/cron-sites.js) alerts after 2 failures in a row
      await ref().doc(site.id).set(withHistory(site, { checkedAt: now, checkedBy: 'app', checkError: d.error || `HTTP ${r.status}`, checkHint: d.hint || '',
        failCount: (site.failCount || 0) + 1, downSince: site.downSince || now, ...backendPatch(site, d.backend, now) }, now), { merge: true });
      if(!quiet) toast(`${site.name}: ${d.error || 'check failed'}`, 'error');
      return;
    }
    const patch = {
      checkedAt: now, checkedBy: 'app', failCount: 0, downSince: null,
      checkError: d.version ? '' : 'Version not found on the login page', checkHint: '',
      confidence: d.confidence || '', versionSource: d.source || '', tlsNote: d.tlsNote || '',
      candidates: (d.candidates || []).slice(0, 6),
      ...backendPatch(site, d.backend, now)
    };
    if(d.chunkHint) patch.chunkHint = String(d.chunkHint);
    if(d.version){
      patch.version = d.version;
      if(site.version && site.version !== d.version){ patch.prevVersion = site.version; patch.versionChangedAt = now; }
      if(!site.version) patch.versionChangedAt = now;
    }
    await ref().doc(site.id).set(withHistory(site, patch, now), { merge: true });
    const api = API_KEYS.map(k => d.backend?.[k]?.version ? ` · ${k.toUpperCase()} ${d.backend[k].version}` : '').join('');
    if(!quiet) toast(d.version ? `${site.name}: ${d.version}${api}` : `${site.name}: front-end version not found${api}`, d.version ? undefined : 'error');
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
  if(autoRan || !isVisible() || !canEdit()) return;   // viewers only read (v4.64.0)
  autoRan = true;
  const stale = S.sites.filter(s => s.url && Date.now() - (s.checkedAt || 0) > STALE_MS)
    .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0)).slice(0, AUTO_MAX);
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
  if($('siteIsTest')) $('siteIsTest').checked = !!(s && s.isTest);
  if($('siteRedmine')){
    $('siteRedmine').value = s ? s.redmineClient || (redmineOf(s)?.name || '') : '';
    const dl = $('siteRedmineList');
    if(dl) dl.innerHTML = getClientIndex().map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('');
  }
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
  if(!url){ toast('Enter the Zahir ERP address, e.g. apt.zahirerp.com or erp.client.com', 'error'); $('siteUrl').focus(); return; }
  const dup = S.sites.find(s => s.id !== S.editing?.id && hostOf(s.url) === hostOf(url));
  if(dup){ toast(`${hostOf(url)} is already listed as ${dup.name}`, 'error'); return; }
  const now = Date.now();
  const data = { name: name.slice(0, 120), url, notes: $('siteNotes').value.trim().slice(0, 500),
    pinnedVersion: $('sitePinned').value.trim().replace(/^v/i, '').slice(0, 40), isTest: !!$('siteIsTest')?.checked,
    redmineClient: ($('siteRedmine')?.value || '').trim().slice(0, 120), updatedAt: now };
  try {
    const id = S.editing?.id;
    const before = id ? S.sites.find(x => x.id === id) : null;
    const docRef = id ? ref().doc(id) : ref().doc();
    if(!id) data.createdAt = now;
    if(before && before.url !== url) Object.assign(data, { version: '', checkedAt: 0, checkError: '', prevVersion: '', candidates: [], v2: '', v3: '', history: [] });
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
    // Firestore takes at most 500 writes per batch
    const now = Date.now(); const ids = [];
    for(let i = 0; i < add.length; i += 400){
      const batch = db.batch();
      add.slice(i, i + 400).forEach(a => { const r = ref().doc(); ids.push({ id: r.id, ...a }); batch.set(r, { ...a, notes: '', pinnedVersion: '', createdAt: now, updatedAt: now }); });
      await batch.commit();
    }
    $('sitesBulkText').value = '';
    closeSiteForm();
    toast(`Added ${add.length} client(s)${skipped.length ? ` · ${skipped.length} line(s) skipped` : ''}`);
    checkMany(ids, { quiet: true });
  } catch(err){ toast('Could not add: ' + (err.message || err), 'error'); }
}

/* ---------------- export ---------------- */
function exportSites(){
  const rows = [['Client', 'URL', 'Front-end version', 'API V2', 'API V3', 'Parts out of step', 'Test server', 'Redmine client', 'Open issues', 'Pinned version', 'Detected version', 'Last checked', 'Last change', 'Notes']];
  sorted(filtered()).forEach(s => { const mm = mismatch(s), lc = lastChange(s); rows.push([s.name, s.url, shownVersion(s), s.v2 || '', s.v3 || '', mm ? mm.text : '', s.isTest ? 'yes' : '', redmineOf(s)?.name || '', redmineOf(s) ? redmineOf(s).open : '', s.pinnedVersion || '', s.version || '',
    s.checkedAt ? new Date(s.checkedAt).toLocaleString() : '', lc ? new Date(lc).toLocaleString() : '', s.notes || '']); });
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
  const tops = latestAll();
  if(S.versionFilter === '__latest') S.versionFilter = '__latest_fe';
  return S.sites.filter(s => !q || `${s.name} ${s.url} ${s.notes || ''} ${shownVersion(s)} ${s.v2 || ''} ${s.v3 || ''}`.toLowerCase().includes(q))
    .filter(s => S.versionFilter === 'all' ? true
      : S.versionFilter === '__error' ? !!s.checkError && !s.pinnedVersion
      : S.versionFilter.startsWith('__latest_') ? onLatest(s, PARTS.find(p => '__latest_' + p.key === S.versionFilter), tops[S.versionFilter.slice(9)])
      : S.versionFilter === '__behind' ? behindParts(s, tops).length > 0
      : S.versionFilter === '__mismatch' ? !!mismatch(s)
      : S.versionFilter === '__down' ? (s.failCount || 0) >= 2
      : shownVersion(s) === S.versionFilter);
}
const lastChange = (s) => Math.max(s.versionChangedAt || 0, ...(s.history || []).map(c => c.at || 0));
function sorted(list){
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    version: (a, b) => cmpVersion(shownVersion(a), shownVersion(b)) || a.name.localeCompare(b.name),
    versionDesc: (a, b) => cmpVersion(shownVersion(b), shownVersion(a)) || a.name.localeCompare(b.name),
    changed: (a, b) => lastChange(b) - lastChange(a)
  }[S.sort] || (() => 0);
  return list.slice().sort(by);
}

// many checks finish close together (hundreds of sites): draw at most once per frame
// While checks run, the table is redrawn after every result. A redraw between
// mouse-down and mouse-up swaps the button under the pointer and the click is
// lost, so redraws wait while a button is pressed inside the list.
// Background updates use render() (batched); anything the user does calls
// renderNow() directly so the screen answers at once. requestAnimationFrame
// can be paused by the browser (window covered, screen sharing, background
// tab), so a timer backs it up.
let renderQueued = false, pointerHeld = false, renderPending = false, heldSince = 0;
function render(){
  if(pointerHeld && Date.now() - heldSince < 1500){ renderPending = true; return; }
  pointerHeld = false;
  if(renderQueued) return;
  renderQueued = true;
  let done = false;
  const run = () => { if(done) return; done = true; renderQueued = false; renderNow(); };
  try { window.requestAnimationFrame(run); } catch(_){}
  setTimeout(run, 120);
}
function renderNow(){
  const el = $('sitesBody');
  if(!el || !isVisible()) return;
  if(S.cmpOpen) renderCompare();
  if(!S.loaded){ el.innerHTML = '<div class="kb-state"><div class="spinner-sm"></div><p>Loading…</p></div>'; return; }
  if(!S.sites.length){
    el.innerHTML = `<div class="kb-welcome">
      <h2>List your clients' Zahir ERP sites</h2>
      <p>Add each client with the address of their Zahir ERP (for example <b>apt.zahirerp.com</b> or the client's own domain such as <b>erp.client.com</b>). The version is read automatically from the login page, so you only type the name and the address.</p>
      <div class="kb-welcome-actions">
        <button type="button" class="btn btn-primary" data-perm="edit" onclick="openSiteForm()">Add client</button>
        <button type="button" class="btn btn-secondary" data-perm="edit" onclick="openSitesBulk()">Paste a list</button>
      </div>
    </div>`;
    return;
  }
  const tops = latestAll();
  const latest = tops.fe;
  const groups = new Map();
  S.sites.forEach(s => { const v = shownVersion(s) || '—'; groups.set(v, (groups.get(v) || 0) + 1); });
  const versions = [...groups.keys()].filter(v => v !== '—').sort(cmpVersion).reverse();
  const errors = S.sites.filter(s => s.checkError && !s.pinnedVersion).length;
  const behindAny = S.sites.filter(x => behindParts(x, tops).length).length;
  const mismatches = S.sites.filter(x => mismatch(x)).length;
  const downCount = S.sites.filter(x => (x.failCount || 0) >= 2).length;
  const chip = (val, label, n, cls = '', title = '') => `<button type="button" class="sv-chip ${cls}${S.versionFilter === val ? ' is-active' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''} onclick="setSitesFilter(${escapeHtml(JSON.stringify(val))})">${label}<b>${n}</b></button>`;

  // green = latest, amber = behind, blue = newer than any client (test server)
  const tone = (v, top) => !v ? ' is-none' : !top ? '' : cmpVersion(v, top) === 0 ? ' is-latest' : cmpVersion(v, top) > 0 ? ' is-ahead' : ' is-behind';
  const builtTitle = (v) => { const at = buildDate(v); return at ? `Built ${fmtBuild(at)}` : ''; };
  const apiCell = (s, k) => {
    const v = s[k];
    const title = [builtTitle(v), v && apiRelease(s, k) ? `Released ${fmtDay(apiRelease(s, k))}` : '', s[k + 'Error'] ? `Last check: ${s[k + 'Error']}` : '', s[k + 'Prev'] ? `Previously ${s[k + 'Prev']}` : ''].filter(Boolean).join(' · ');
    return `<div class="sv-api"><span class="sv-api-label">API ${k.toUpperCase()}</span><span class="sv-badge sv-badge-sm${tone(v, tops[k])}"${title ? ` title="${escapeHtml(title)}"` : ''}>${v ? escapeHtml(v) : '—'}</span></div>`;
  };
  const historyHtml = (s) => {
    const h = (s.history || []).slice().reverse();
    if(!h.length) return '<p><b>Version history:</b> no change seen yet (changes are recorded from now on).</p>';
    return `<div class="sv-hist"><b>Version history</b><ul>${h.map(c => `<li><span>${escapeHtml(new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span><b>${partLabel(c.part)}</b> ${escapeHtml(c.from)} → <b>${escapeHtml(c.to)}</b></li>`).join('')}</ul></div>`;
  };

  const rowHtml = (s) => {
    const v = shownVersion(s);
    const busy = S.checking.has(s.id);
    const mm = mismatch(s);
    // last change goes in the badge tooltip (the row stays one line); full list in Version history
    const changedTip = s.prevVersion && s.versionChangedAt ? `Changed from ${s.prevVersion} · ${ago(s.versionChangedAt)}` : '';
    const feTitle = [builtTitle(v), changedTip].filter(Boolean).join(' · ');
    const by = s.checkedBy === 'server' ? ' (server)' : '';
    const isDown = (s.failCount || 0) >= 2 && s.downSince;
    const status = busy ? '<span class="sv-status is-busy">checking…</span>'
      : isDown ? `<span class="sv-status is-error is-down" title="${escapeHtml(s.checkError || '')}">● down since ${escapeHtml(new Date(s.downSince).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}<small>${s.failCount} failed checks · last ${escapeHtml(ago(s.checkedAt))}${by}</small></span>`
      : s.checkError && !s.pinnedVersion ? `<span class="sv-status is-error" title="${escapeHtml(s.checkError + (s.checkHint ? ' — ' + s.checkHint : ''))}">couldn't read · ${escapeHtml(ago(s.checkedAt))}${by}</span>`
      : `<span class="sv-status" title="${s.checkedBy === 'server' ? 'Checked by the scheduled server check' : 'Checked from the app'}">${escapeHtml(ago(s.checkedAt))}${by}</span>`;
    const open = S.open === s.id;
    const details = open ? `<div class="sv-details">
        ${s.isTest ? '<p><b>Test / internal server:</b> not used for Latest, rollout or Behind latest.</p>' : ''}
        ${mm ? `<p class="sv-warn"><b>Parts out of step:</b> ${escapeHtml(mm.text)} — possibly an unfinished deploy.</p>` : ''}
        ${s.pinnedVersion ? `<p><b>Version set by hand:</b> ${escapeHtml(s.pinnedVersion)}${s.version ? ` (detected: ${escapeHtml(s.version)})` : ''}</p>` : ''}
        ${s.checkError ? `<p class="sv-err"><b>Last check:</b> ${escapeHtml(s.checkError)}${s.checkHint ? ` — ${escapeHtml(s.checkHint)}` : ''}</p>` : ''}
        ${s.tlsNote ? `<p class="sv-err"><b>Certificate:</b> ${escapeHtml(s.tlsNote)}</p>` : ''}
        ${s.versionSource ? `<p><b>Found in:</b> <code>${escapeHtml(s.versionSource)}</code> · confidence ${escapeHtml(s.confidence || '-')}</p>` : ''}
        ${API_KEYS.map(k => `<p><b>API ${k.toUpperCase()}:</b> ${s[k] ? escapeHtml(s[k]) : '—'}${s[k] && apiRelease(s, k) ? ` | Released ${escapeHtml(fmtDay(apiRelease(s, k)))}` : ''}${s[k + 'Error'] ? ` <span class="sv-err">| ${escapeHtml(s[k + 'Error'])}</span>` : ''}</p>`).join('')}
        ${(() => { const c = redmineOf(s); return c
          ? `<p><b>Redmine client:</b> ${escapeHtml(c.name)} | ${c.open} open of ${c.total} issue${c.total === 1 ? '' : 's'} <button type="button" class="btn btn-secondary btn-xs" onclick="openSiteClientIssues('${s.id}')">Open in By Client</button></p>`
          : `<p><b>Redmine client:</b> <span class="sv-muted">not linked — pick the Redmine client name in Edit</span></p>`; })()}
        ${historyHtml(s)}
        <p><button type="button" class="btn btn-secondary btn-xs" onclick="openSitesCompare('${s.id}')">Compare this site…</button></p>
        ${s.notes ? `<p><b>Notes:</b> ${escapeHtml(s.notes)}</p>` : ''}
      </div>` : '';
    return `<div class="sv-row${open ? ' is-open' : ''}${s.isTest ? ' is-test' : ''}" onclick="siteRowClick(event,'${s.id}')">
      <div class="sv-main">
        <div class="sv-name-line">
          <button type="button" class="sv-name" aria-expanded="${open}" title="Show details">${escapeHtml(s.name)}</button>
          ${s.isTest ? '<span class="sv-tag" title="Test / internal server: not used for Latest, rollout or Behind latest">test</span>' : ''}
        </div>
        <a class="sv-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(s.url))}</a>
        ${s.notes ? `<span class="sv-notes" title="${escapeHtml(s.notes)}">${escapeHtml(s.notes)}</span>` : ''}
      </div>
      <div class="sv-ver">
        ${v ? `<span class="sv-badge${tone(v, latest)}"${feTitle ? ` title="${escapeHtml(feTitle)}"` : ''}>${escapeHtml(v)}${s.pinnedVersion ? '<small>manual</small>' : ''}</span>` : '<span class="sv-badge is-none">unknown</span>'}
      </div>
      ${apiCell(s, 'v2')}
      ${apiCell(s, 'v3')}
      <div class="sv-checked">${status}</div>
      <div class="sv-acts">
        <button type="button" class="sv-icon" data-perm="edit" onclick="checkOneSite('${s.id}')" title="Check version now" aria-label="Check version of ${escapeHtml(s.name)}"${busy ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/></svg></button>
        <button type="button" class="sv-icon" data-perm="edit" onclick="openSiteForm('${s.id}')" title="Edit" aria-label="Edit ${escapeHtml(s.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="sv-icon is-danger" data-perm="edit" onclick="deleteSite('${s.id}')" title="Remove" aria-label="Remove ${escapeHtml(s.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div>
      ${details}
    </div>`;
  };

  // Test / internal servers sit in their own block on top (by name), whatever the
  // sort or version filter: they are the reference the clients are compared to.
  const q = S.query.trim().toLowerCase();
  const matchesQuery = (x) => !q || `${x.name} ${x.url} ${x.notes || ''} ${shownVersion(x)} ${x.v2 || ''} ${x.v3 || ''}`.toLowerCase().includes(q);
  const testSites = S.sites.filter(x => x.isTest && matchesQuery(x)).sort((a, b) => a.name.localeCompare(b.name));
  const clientSites = sorted(filtered().filter(x => !x.isTest));
  const group = (label, n, cls) => `<div class="sv-group ${cls}"><span>${label}</span><b>${n}</b></div>`;
  const rows = (testSites.length
      ? group('Test servers · reference for the tester version', testSites.length, 'is-test') + testSites.map(rowHtml).join('')
        + group('Clients', clientSites.length, '')
      : '')
    + (clientSites.length ? clientSites.map(rowHtml).join('') : (testSites.length ? '<div class="kb-state kb-state-sm"><p>No client matches this filter.</p></div>' : ''));

  el.innerHTML = `
    ${rolloutHtml(tops)}
    ${recentChangesHtml()}
    <div class="sv-chips" role="group" aria-label="Filter by version">
      ${chip('all', 'All', S.sites.length)}
      ${PARTS.map(p => tops[p.key] ? chip('__latest_' + p.key, `Latest ${p.key.toUpperCase()} <i>${escapeHtml(tops[p.key])}</i>`, S.sites.filter(x => onLatest(x, p, tops[p.key])).length, 'is-latest', `Clients on the highest ${p.label} version`) : '').join('')}
      ${chip('__behind', 'Behind latest', behindAny, 'is-warn', 'Clients behind the highest version on front-end, API V2 or API V3')}
      ${mismatches ? chip('__mismatch', 'Parts out of step', mismatches, 'is-warn', `Front-end, API V2 and API V3 built more than ${MISMATCH_DAYS} days apart on the same site`) : ''}
      ${downCount ? chip('__down', 'Down', downCount, 'is-error', 'Not reachable for 2 or more checks in a row') : ''}
      ${errors ? chip('__error', "Couldn't read", errors, 'is-error') : ''}
      ${versions.length > 1 ? `<select class="sv-verselect${versions.includes(S.versionFilter) ? ' is-active' : ''}" aria-label="Show one version" onchange="setSitesFilter(this.value)">
        <option value="all">Specific version…</option>
        ${versions.map(v => `<option value="${escapeHtml(v)}"${S.versionFilter === v ? ' selected' : ''}>${escapeHtml(v)} · ${groups.get(v)} client${groups.get(v) === 1 ? '' : 's'}${v === latest ? ' (latest)' : ''}</option>`).join('')}
      </select>` : ''}
    </div>
    <div class="sv-table">
      <div class="sv-head" aria-hidden="true">
        <button type="button" class="sv-th" onclick="setSitesSort('name')">Client${S.sort === 'name' ? ' ↓' : ''}</button>
        <button type="button" class="sv-th" onclick="setSitesSort(${S.sort === 'versionDesc' ? "'version'" : "'versionDesc'"})">Front-end${S.sort === 'version' ? ' ↑' : S.sort === 'versionDesc' ? ' ↓' : ''}</button>
        <span class="sv-th">API V2</span>
        <span class="sv-th">API V3</span>
        <button type="button" class="sv-th" onclick="setSitesSort('changed')">Checked${S.sort === 'changed' ? ' · recently changed' : ''}</button>
        <span></span>
      </div>
      ${rows || '<div class="kb-state kb-state-sm"><p>No client matches this filter.</p></div>'}
    </div>`;
}

/* rollout: how many clients already run the latest of each part */
function rolloutHtml(tops){
  const live = counted();
  const cards = PARTS.map(p => {
    const top = tops[p.key];
    const known = live.filter(x => p.get(x));
    if(!top || !known.length) return '';
    const done = known.filter(x => cmpVersion(p.get(x), top) === 0).length;
    const pct = Math.round(done / known.length * 100);
    const unknown = live.length - known.length;
    const at = buildDate(top);
    return `<div class="sv-roll">
      <div class="sv-roll-top"><span>${p.label}</span><b>${pct}%</b></div>
      <div class="sv-roll-ver" title="${escapeHtml(at ? 'Built ' + fmtBuild(at) : '')}">${escapeHtml(top)}</div>
      <div class="sv-roll-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${escapeHtml(p.label)} rollout"><i style="width:${pct}%"></i></div>
      <div class="sv-roll-sub">${done} of ${known.length} client${known.length === 1 ? '' : 's'} on latest${unknown ? ` · ${unknown} unknown` : ''}</div>
    </div>`;
  }).join('');
  return cards ? `<div class="sv-rollout">${cards}</div>` : '';
}

/* every version change seen in the last 30 days, newest first */
function recentChangesHtml(){
  const since = Date.now() - 30 * 86400000;
  const all = [];
  S.sites.forEach(s => (s.history || []).forEach(c => { if(c.at >= since) all.push({ ...c, site: s }); }));
  if(!all.length) return '';
  all.sort((a, b) => b.at - a.at);
  const week = all.filter(c => c.at >= Date.now() - 7 * 86400000).length;
  const shown = S.showAllChanges ? all : all.slice(0, 8);
  const open = S.recentOpen ?? week > 0;      // open by itself when something changed this week
  return `<details class="sv-recent"${open ? ' open' : ''} ontoggle="setSitesRecentOpen(this.open)">
    <summary>Recent changes <b>${week}</b> this week · ${all.length} in 30 days</summary>
    <ul>${shown.map(c => `<li>
      <span class="sv-recent-when">${escapeHtml(ago(c.at))}</span>
      <button type="button" class="sv-recent-name" onclick="toggleSiteDetails('${c.site.id}')">${escapeHtml(c.site.name)}</button>
      <span><b>${partLabel(c.part)}</b> ${escapeHtml(c.from)} → <b>${escapeHtml(c.to)}</b></span>
    </li>`).join('')}</ul>
    ${all.length > shown.length ? `<button type="button" class="btn btn-ghost btn-sm" onclick="showAllSiteChanges()">Show all ${all.length}</button>` : ''}
  </details>`;
}
function setSitesRecentOpen(open){ S.recentOpen = !!open; }
function showAllSiteChanges(){ S.showAllChanges = true; S.recentOpen = true; renderNow(); }

function setSitesFilter(v){ S.versionFilter = v; renderNow(); }
function setSitesSort(v){ S.sort = v; renderNow(); }
/* the whole row opens / closes the details, except links, action buttons and the details box itself */
function siteRowClick(ev, id){
  const t = ev && ev.target;
  if(t && t.closest && t.closest('a, .sv-acts, .sv-details, .sv-issues, input, select, textarea')) return;
  if(window.getSelection && String(window.getSelection()).length > 2) return;   // selecting text, not clicking
  toggleSiteDetails(id);
}
function toggleSiteDetails(id){ S.open = S.open === id ? null : id; renderNow(); }

/* ---------------- link to By Client (Redmine "Client Name") ---------------- */
// A site is linked to the Redmine client set in Edit, or else to the Redmine
// client whose name matches the site name (ignoring PT/CV/Tbk, case, spaces).
const normName = (n) => String(n || '').toLowerCase().replace(/\b(pt|cv|ud|tbk|persero)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
// Name set in Edit → exact match only. Otherwise the site name: exact match first,
// then the single Redmine client whose name contains it (or is contained in it),
// e.g. "Aptekindo" ↔ "PT Aptekindo Nusantara". Test servers only link when set in Edit.
function redmineOf(site){
  const idx = getClientIndex();
  if(!idx.length || !site) return null;
  if(site.redmineClient){
    const want = normName(site.redmineClient);
    return idx.find(c => normName(c.name) === want) || null;
  }
  if(site.isTest) return null;
  const want = normName(site.name);
  if(want.length < 3) return null;
  const exact = idx.find(c => normName(c.name) === want);
  if(exact) return exact;
  if(want.length < 5) return null;
  const near = idx.filter(c => { const n = normName(c.name); return n.length >= 5 && (n.includes(want) || want.includes(n)); });
  return near.length === 1 ? near[0] : null;
}
function siteForClient(name){
  const n = normName(name);
  if(!n) return null;
  return S.sites.find(s => { const c = redmineOf(s); return c && normName(c.name) === n; })
    || S.sites.find(s => !s.isTest && normName(s.redmineClient || s.name) === n) || null;
}
function sitesLoaded(){ return S.loaded ? S.sites.length : -1; }
function ensureSitesLoaded(){ if(!S.unsub) subscribe(true); }
function openSiteClientIssues(id){
  const s = S.sites.find(x => x.id === id);
  const c = s && redmineOf(s);
  if(!c){ toast('This site is not linked to a Redmine client yet — set it in Edit', 'error'); return; }
  switchView('clients');
  openClientIssues(c.name);
}

/* ---------------- compare 2–4 sites side by side ---------------- */
// Columns are site ids; the first column is the reference (e.g. DEV) and every
// other column shows how far each part is behind or ahead of it.
const CMP_KEY = 'erp_sites_compare_v1';
const CMP_MAX = 4;
function loadCompareIds(){ try { return JSON.parse(localStorage.getItem(CMP_KEY) || '[]').filter(x => typeof x === 'string').slice(0, CMP_MAX); } catch(_){ return []; } }
function saveCompareIds(){ try { localStorage.setItem(CMP_KEY, JSON.stringify(S.cmpIds)); } catch(_){} }
S.cmpIds = loadCompareIds();
S.cmpOpen = false;

function defaultCompareIds(){
  // test servers first (DEV), then the most common front-end version (≈ production), then empty
  const tests = S.sites.filter(x => x.isTest).map(x => x.id);
  const ids = [...tests.slice(0, 1)];
  const live = S.sites.filter(x => !x.isTest && shownVersion(x));
  if(live.length){
    const count = new Map(); live.forEach(x => count.set(shownVersion(x), (count.get(shownVersion(x)) || 0) + 1));
    const common = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const prod = live.find(x => shownVersion(x) === common && !ids.includes(x.id));
    if(prod) ids.push(prod.id);
  }
  return ids;
}
function openSitesCompare(id){
  S.cmpIds = S.cmpIds.filter(x => S.sites.some(s => s.id === x));
  if(!S.cmpIds.length) S.cmpIds = defaultCompareIds();
  if(id && !S.cmpIds.includes(id)){
    if(S.cmpIds.length >= CMP_MAX) S.cmpIds[CMP_MAX - 1] = id; else S.cmpIds.push(id);
  }
  if(S.cmpIds.length < 2) S.cmpIds.push('');
  saveCompareIds();
  S.cmpOpen = true;
  renderCompare();
  $('sitesCompare')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeSitesCompare(){ S.cmpOpen = false; renderCompare(); }
function setCompareSite(i, id){ S.cmpIds[i] = id; S.cmpIds = S.cmpIds.slice(0, CMP_MAX); saveCompareIds(); renderCompare(); }
function addCompareColumn(){ if(S.cmpIds.length < CMP_MAX){ S.cmpIds.push(''); renderCompare(); } }
function removeCompareColumn(i){ S.cmpIds.splice(i, 1); if(S.cmpIds.length < 2) S.cmpIds.push(''); saveCompareIds(); renderCompare(); }
function moveCompareFirst(i){ const [x] = S.cmpIds.splice(i, 1); S.cmpIds.unshift(x); saveCompareIds(); renderCompare(); }
async function checkComparedSites(){
  const list = S.cmpIds.map(id => S.sites.find(s => s.id === id)).filter(Boolean);
  if(!list.length) return;
  toast(`Checking ${list.length} site(s)…`);
  await checkMany(list, { quiet: true });
  renderCompare();
}

function diffLabel(v, refV){
  if(!v || !refV) return { cls: 'is-none', text: '' };
  if(cmpVersion(v, refV) === 0) return { cls: 'is-same', text: 'same' };
  const a = buildDate(v), b = buildDate(refV);
  const newer = cmpVersion(v, refV) > 0;
  let gap = '';
  if(a && b){
    const h = Math.round(Math.abs(a - b) / 3600000);
    gap = h >= 48 ? `${Math.round(h / 24)} days` : h >= 1 ? `${h} h` : 'minutes';
  }
  return { cls: newer ? 'is-newer' : 'is-older', text: gap ? `${gap} ${newer ? 'newer' : 'older'}` : (newer ? 'newer' : 'older') };
}
function compareCols(){ return S.cmpIds.map(id => S.sites.find(s => s.id === id) || null); }

function compareText(){
  const cols = compareCols().filter(Boolean);
  if(cols.length < 2) return '';
  const ref = cols[0];
  let t = `Zahir ERP version compare (vs ${ref.name})\n`;
  PARTS.forEach(p => {
    t += `\n${p.label}\n`;
    cols.forEach((c, i) => {
      const v = p.get(c);
      const d = i ? diffLabel(v, p.get(ref)).text : 'reference';
      t += `  ${c.name}: ${v || '—'}${d ? ` (${d})` : ''}\n`;
    });
  });
  return t.trim();
}
async function copyCompare(){
  const text = compareText();
  if(!text){ toast('Pick at least two sites', 'error'); return; }
  try { await navigator.clipboard.writeText(text); toast('Comparison copied'); }
  catch(_){ toast('Could not copy', 'error'); }
}

function renderCompare(){
  const box = $('sitesCompare');
  if(!box) return;
  if(!S.cmpOpen || !S.sites.length){ box.classList.add('hidden'); box.innerHTML = ''; return; }
  // don't rebuild while a site picker is open / focused (background checks re-render often)
  if(box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  box.classList.remove('hidden');
  const cols = compareCols();
  const ref = cols[0];
  const options = (sel) => {
    const list = S.sites.slice().sort((a, b) => (b.isTest ? 1 : 0) - (a.isTest ? 1 : 0) || a.name.localeCompare(b.name));
    return `<option value="">Choose a site…</option>` + list.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${escapeHtml(x.name)}${x.isTest ? ' (test)' : ''} — ${escapeHtml(hostOf(x.url))}</option>`).join('');
  };
  const head = cols.map((c, i) => `<th scope="col">
      <div class="svc-pick">
        <span class="svc-role">${i === 0 ? 'Reference' : 'Compared'}</span>
        <select aria-label="Site ${i + 1}" onchange="setCompareSite(${i}, this.value)">${options(c ? c.id : '')}</select>
        <span class="svc-tools">
          ${i > 0 && c ? `<button type="button" class="btn btn-ghost btn-xs" onclick="moveCompareFirst(${i})" title="Use as reference">Set as reference</button>` : ''}
          ${cols.length > 2 ? `<button type="button" class="btn btn-ghost btn-xs" onclick="removeCompareColumn(${i})" aria-label="Remove column">✕</button>` : ''}
        </span>
      </div>
    </th>`).join('');
  const body = PARTS.map(p => `<tr>
      <th scope="row">${p.label}</th>
      ${cols.map((c, i) => {
        if(!c) return '<td class="svc-empty">—</td>';
        const v = p.get(c);
        const at = buildDate(v);
        const d = i && ref ? diffLabel(v, p.get(ref)) : { cls: 'is-ref', text: '' };
        return `<td class="${d.cls}">
          <div class="svc-ver">${v ? escapeHtml(v) : '—'}</div>
          ${at ? `<div class="svc-date">Built ${escapeHtml(fmtBuild(at))}</div>` : ''}
          ${p.key !== 'fe' && v && apiRelease(c, p.key) ? `<div class="svc-date">Released ${escapeHtml(fmtDay(apiRelease(c, p.key)))}</div>` : ''}
          ${d.text ? `<div class="svc-diff">${escapeHtml(d.text)}</div>` : ''}
        </td>`;
      }).join('')}
    </tr>`).join('') + `<tr class="svc-meta"><th scope="row">Last checked</th>${cols.map(c => `<td>${c ? `${escapeHtml(ago(c.checkedAt))}${c.checkError ? ` <span class="sv-err" title="${escapeHtml(c.checkError)}">· couldn't read</span>` : ''}` : ''}</td>`).join('')}</tr>`;

  // one-line verdict per compared site
  const verdicts = ref ? cols.slice(1).filter(Boolean).map(c => {
    const parts = PARTS.map(p => ({ p, d: diffLabel(p.get(c), p.get(ref)) })).filter(x => x.d.cls === 'is-older' || x.d.cls === 'is-newer');
    if(!parts.length) return `<li><b>${escapeHtml(c.name)}</b> runs the same front-end, API V2 and API V3 as ${escapeHtml(ref.name)}.</li>`;
    return `<li><b>${escapeHtml(c.name)}</b> vs ${escapeHtml(ref.name)}: ${parts.map(x => `${x.p.label} <span class="${x.d.cls}">${escapeHtml(x.d.text)}</span>`).join(', ')}.</li>`;
  }).join('') : '';

  box.innerHTML = `
    <div class="svc-head">
      <h4>Compare versions</h4>
      <div class="svc-actions">
        ${cols.length < CMP_MAX ? '<button type="button" class="btn btn-secondary btn-sm" onclick="addCompareColumn()">+ Add site</button>' : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-perm="edit" onclick="checkComparedSites()">Check these now</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="copyCompare()">Copy</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="closeSitesCompare()" aria-label="Close compare">Close</button>
      </div>
    </div>
    <div class="svc-scroll"><table class="svc-table">
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${verdicts ? `<ul class="svc-verdict">${verdicts}</ul>` : ''}`;
}

/* ---------------- view ---------------- */
let wired = false;
function wire(){
  if(wired) return;
  wired = true;
  $('sitesSearch')?.addEventListener('input', (e) => { S.query = e.target.value; renderNow(); });
  const body = $('sitesBody');
  if(body){
    const release = () => {
      if(!pointerHeld) return;
      pointerHeld = false;
      // let the click handler run first, then draw what was held back
      setTimeout(() => { if(renderPending){ renderPending = false; render(); } }, 0);
    };
    body.addEventListener('pointerdown', () => { pointerHeld = true; heldSince = Date.now(); }, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
  }
  $('sitesForm')?.addEventListener('submit', saveSite);
  $('sitesForm')?.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeSiteForm(); });
}
let clientsListening = false;
function onSitesShown(){
  if(!clientsListening){ clientsListening = true; window.addEventListener('clients:overview', () => render()); }
  try { ensureClientOverview(); } catch(_){}
  wire();
  subscribe();
  render();
  autoCheckStale();
}
function getAllSites(){ return S.sites.map(({ id, ...rest }) => ({ id, ...rest })); }

export {
  onSitesShown, openSiteForm, closeSiteForm, openBulk as openSitesBulk, saveBulk as saveSitesBulk,
  checkAllSites, checkOneSite, deleteSite, exportSites, setSitesFilter, setSitesSort, toggleSiteDetails, siteRowClick,
  getAllSites, cmpVersion, setSitesRecentOpen, showAllSiteChanges,
  setTelegramVersionsEnabled, testTelegramVersions, initSitesSettings,
  siteForClient, ensureSitesLoaded, openSiteClientIssues, sitesLoaded,
  openSitesCompare, closeSitesCompare, setCompareSite, addCompareColumn, removeCompareColumn, moveCompareFirst, checkComparedSites, copyCompare
};
