/**
 * Knowledge Base — how-to guides for Zahir ERP / ERP One / Manufacturing / MRP (v4.42.0)
 *
 * Articles live in the shared team workspace:
 *   workspaces/{ws}/kb/{articleId}                 → { title, product, module, version,
 *                                                     summary, tags[], content (markdown),
 *                                                     createdAt, createdBy, updatedAt, updatedBy }
 *   workspaces/{ws}/kb/{articleId}/images/{imgId}  → { data (data: URL), w, h, bytes, createdAt }
 * Screenshots are compressed in the browser and stored one per document so an
 * article never hits Firestore's 1 MB document limit.
 */
import { auth, db } from '../firebase.js';
import { CloudSync } from '../core/cloud-sync.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { renderMarkdown, markdownToText } from '../core/markdown.js';
import { confirmDialog } from '../ui/confirm.js';
import { switchView } from '../ui/navigation.js';

const PRODUCTS = {
  erp: { label: 'Zahir ERP', short: 'ERP' },
  one: { label: 'Zahir ERP One', short: 'ERP One' },
  mfg: { label: 'Zahir Manufacturing', short: 'Manufacturing' },
  mrp: { label: 'Zahir MRP', short: 'MRP' }
};
const DEFAULT_MODULES = [
  'Sales', 'Purchase', 'Inventory', 'Cash & Bank', 'General Ledger', 'Fixed Assets',
  'Production', 'Master Data', 'Reports', 'Settings', 'Import & Export'
];
const TEMPLATE = `## Goal
Briefly describe what this guide achieves.

## Before you start
- Required access rights
- Data that must already exist

## Steps
1. Open menu **Module > Sub menu**
2. Click **New**, then fill required fields
3. Click **Save**

> **Note:** points clients often ask about.

## Result
What you should see when the steps succeed.
`;
const MAX_IMG_EDGE = 1400;
const SAFE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG_BYTES = 850 * 1024;

const S = {
  articles: [],
  loaded: false,
  product: 'all',
  module: 'all',
  query: '',
  selectedId: null,
  pendingDocId: null,
  unsub: null,
  subscribedWs: null,
  wired: false,
  editing: null,      // { id, isNew, uploaded:Set, dirty }
  imgCache: new Map() // imgId → data URL
};

/* ---------------- data ---------------- */
function kbRef(){
  if(!CloudSync.workspaceId) throw new Error('Workspace not ready');
  return db.collection('workspaces').doc(CloudSync.workspaceId).collection('kb');
}

function subscribe(){
  const ws = CloudSync.workspaceId;
  if(!ws){
    // Auth/workspace still loading (e.g. reload on ?view=kb) — try again shortly
    setTimeout(() => { if(isVisible()) subscribe(); }, 400);
    return;
  }
  if(S.subscribedWs === ws && S.unsub) return;
  if(S.unsub){ try { S.unsub(); } catch(_){} }
  S.subscribedWs = ws;
  S.loaded = false;
  render();
  S.unsub = kbRef().onSnapshot(snap => {
    S.articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.loaded = true;
    if(S.pendingDocId && S.articles.some(a => a.id === S.pendingDocId)){
      S.selectedId = S.pendingDocId;
      S.pendingDocId = null;
    }
    render();
  }, err => {
    console.error('KB snapshot error', err);
    S.loaded = true;
    const reader = $('kbReader');
    if(reader){
      reader.innerHTML = `<div class="kb-state"><h3>Knowledge Base cannot be opened</h3>
        <p>${escapeHtml(err.code === 'permission-denied'
          ? 'Firestore denied access to the kb collection. Publish the latest firestore.rules in the Firebase Console (see FIRESTORE_RULES.md).'
          : (err.message || 'Failed to load data.'))}</p></div>`;
    }
  });
}

function isVisible(){
  return $('view-kb')?.classList.contains('active');
}

function getKbArticles(){
  return S.articles.slice();
}

function userLabel(){
  const u = auth?.currentUser;
  return (u && (u.displayName || u.email)) || 'Guest';
}

/* ---------------- filtering ---------------- */
function matchesQuery(a, q){
  if(!q) return true;
  const hay = [a.title, a.module, a.summary, a.version, (a.tags || []).join(' '), a.content,
    PRODUCTS[a.product]?.label].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function visibleArticles(){
  const q = S.query.toLowerCase().trim();
  return S.articles
    .filter(a => S.product === 'all' || a.product === S.product)
    .filter(a => S.module === 'all' || (a.module || 'Other') === S.module)
    .filter(a => matchesQuery(a, q))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function moduleCounts(){
  const q = S.query.toLowerCase().trim();
  const counts = new Map();
  S.articles
    .filter(a => S.product === 'all' || a.product === S.product)
    .filter(a => matchesQuery(a, q))
    .forEach(a => {
      const m = a.module || 'Other';
      counts.set(m, (counts.get(m) || 0) + 1);
    });
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

/* ---------------- rendering ---------------- */
function fmtDate(ms){
  if(!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(_){ return ''; }
}

function productChip(p){
  const meta = PRODUCTS[p];
  return meta ? `<span class="kb-chip kb-chip-${p}">${escapeHtml(meta.short)}</span>` : '';
}

function render(){
  if(!$('view-kb')) return;
  renderProducts();
  renderModules();
  renderList();
  renderReader();
}

function renderProducts(){
  document.querySelectorAll('#view-kb [data-kb-product]').forEach(b => {
    const on = b.dataset.kbProduct === S.product;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderModules(){
  const el = $('kbModules');
  if(!el) return;
  const counts = moduleCounts();
  const total = counts.reduce((s, [, n]) => s + n, 0);
  if(S.module !== 'all' && !counts.some(([m]) => m === S.module)) S.module = 'all';
  const btn = (key, label, n) => `<button type="button" class="kb-mod${S.module === key ? ' is-active' : ''}" data-kb-module="${escapeHtml(key)}">
      <span>${escapeHtml(label)}</span><span class="kb-mod-n">${n}</span></button>`;
  el.innerHTML = `<p class="kb-mod-title">Modules</p>${btn('all', 'All modules', total)}${counts.map(([m, n]) => btn(m, m, n)).join('')}`;
  const sel = $('kbModuleSelect');
  if(sel){
    sel.innerHTML = `<option value="all">All modules (${total})</option>` +
      counts.map(([m, n]) => `<option value="${escapeHtml(m)}"${S.module === m ? ' selected' : ''}>${escapeHtml(m)} (${n})</option>`).join('');
    sel.value = S.module;
  }
}

function renderList(){
  const el = $('kbList');
  if(!el) return;
  if(!S.loaded){
    el.innerHTML = '<div class="kb-state kb-state-sm"><div class="spinner-sm"></div><p>Loading guides…</p></div>';
    return;
  }
  const list = visibleArticles();
  if(!S.articles.length){
    el.innerHTML = '';
    return;
  }
  if(!list.length){
    el.innerHTML = `<div class="kb-state kb-state-sm"><p>No matching guides${S.query ? ` for “${escapeHtml(S.query)}”` : ''}.</p></div>`;
    return;
  }
  el.innerHTML = list.map(a => `
    <button type="button" class="kb-item${a.id === S.selectedId ? ' is-active' : ''}" data-kb-open="${escapeHtml(a.id)}">
      <span class="kb-item-top">${S.product === 'all' ? productChip(a.product) : ''}<span class="kb-item-mod">${escapeHtml(a.module || 'Other')}</span></span>
      <span class="kb-item-title">${escapeHtml(a.title || 'Untitled')}</span>
      ${a.summary ? `<span class="kb-item-sum">${escapeHtml(a.summary)}</span>` : ''}
      <span class="kb-item-date">Updated ${escapeHtml(fmtDate(a.updatedAt))}</span>
    </button>`).join('');
}

function renderReader(){
  const el = $('kbReader');
  const main = $('kbMain');
  if(!el) return;
  if(!S.loaded){ el.innerHTML = ''; return; }

  if(!S.articles.length){
    main?.classList.add('kb-is-empty');
    el.innerHTML = `<div class="kb-welcome">
      <h3>Write the team’s first guide</h3>
      <p>Store how-to guides for Zahir ERP, ERP One, Manufacturing, and MRP in one place so support answers clients with the same steps.</p>
      <ol>
        <li>Click <b>Write guide</b>, then choose product and module.</li>
        <li>Write the steps. Paste screenshots with <kbd>Ctrl</kbd>+<kbd>V</kbd>.</li>
        <li>Save. Guides are visible to every workspace member.</li>
      </ol>
      <button type="button" class="btn btn-primary" data-kb-act="new">Write guide</button>
    </div>`;
    return;
  }
  main?.classList.remove('kb-is-empty');

  const a = S.articles.find(x => x.id === S.selectedId);
  if(!a){
    main?.classList.remove('kb-reading');
    el.innerHTML = `<div class="kb-state"><p>Select a guide from the list to read it.</p></div>`;
    return;
  }

  const p = PRODUCTS[a.product];
  const tags = (a.tags || []).filter(Boolean);
  const meta = [
    a.version ? `Applies to <b>${escapeHtml(a.version)}</b>` : '',
    `Updated ${escapeHtml(fmtDate(a.updatedAt))}${a.updatedBy ? ` by ${escapeHtml(a.updatedBy)}` : ''}`
  ].filter(Boolean).join('<span class="kb-sep" aria-hidden="true"></span>');

  el.innerHTML = `
    <div class="kb-read-top">
      <button type="button" class="kb-back" data-kb-act="back" aria-label="Back to list">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg> List
      </button>
      <div class="kb-read-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-kb-act="copy-text">Copy text</button>
        <button type="button" class="btn btn-secondary btn-sm" data-kb-act="copy-link">Copy link</button>
        <button type="button" class="btn btn-secondary btn-sm" data-kb-act="edit">Edit</button>
        <button type="button" class="btn btn-secondary btn-sm kb-danger" data-kb-act="delete" aria-label="Delete guide">Delete</button>
      </div>
    </div>
    <p class="kb-crumb">${productChip(a.product)}<span>${escapeHtml(p ? p.label : '')}</span><span class="md-path">›</span><span>${escapeHtml(a.module || 'Other')}</span></p>
    <h1 class="kb-title">${escapeHtml(a.title || 'Untitled')}</h1>
    ${a.summary ? `<p class="kb-lede">${escapeHtml(a.summary)}</p>` : ''}
    <p class="kb-meta">${meta}</p>
    ${tags.length ? `<p class="kb-tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</p>` : ''}
    <div class="md-body">${renderMarkdown(a.content || '')}</div>`;
  hydrateImages(el, a.id);
}

async function hydrateImages(root, articleId){
  const imgs = [...root.querySelectorAll('img[data-kbimg]')];
  for(const img of imgs){
    const id = img.dataset.kbimg;
    try {
      let data = S.imgCache.get(id);
      if(!data){
        const snap = await kbRef().doc(articleId).collection('images').doc(id).get();
        data = snap.exists ? snap.data().data : '';
        if(data) S.imgCache.set(id, data);
      }
      if(data && SAFE_DATA_URL.test(data)){
        img.src = data;
        img.addEventListener('click', () => openLightbox(data, img.alt), { once: false });
      } else {
        img.closest('figure')?.classList.add('md-figure-missing');
      }
    } catch(err){
      console.warn('kb image', id, err);
      img.closest('figure')?.classList.add('md-figure-missing');
    }
  }
}

function openLightbox(src, alt){
  const box = document.createElement('div');
  box.className = 'kb-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', alt || 'Image');
  const big = document.createElement('img');
  big.src = src;
  big.alt = alt || '';
  box.appendChild(big);
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if(e.key === 'Escape'){ e.stopPropagation(); close(); } };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
}

/* ---------------- reading actions ---------------- */
function selectArticle(id){
  S.selectedId = id;
  $('kbMain')?.classList.add('kb-reading');
  try {
    const url = `${location.pathname}?view=kb&doc=${encodeURIComponent(id)}`;
    history.replaceState(history.state, '', url);
  } catch(_){}
  renderList();
  renderReader();
  const sc = document.querySelector('.content');
  if(sc && window.innerWidth <= 860) sc.scrollTo({ top: 0 });
  const reader = $('kbReader');
  if(reader) reader.scrollTop = 0;
}

async function copyArticleText(){
  const a = S.articles.find(x => x.id === S.selectedId);
  if(!a) return;
  const p = PRODUCTS[a.product];
  const text = `*${a.title}*\n${p ? p.label : ''} › ${a.module || ''}${a.version ? ` (${a.version})` : ''}\n\n${markdownToText(a.content)}`;
  try { await navigator.clipboard.writeText(text); toast('Guide text copied'); }
  catch(_){ toast('Could not copy to clipboard', 'error'); }
}

async function copyArticleLink(){
  if(!S.selectedId) return;
  const url = `${location.origin}${location.pathname}?view=kb&doc=${encodeURIComponent(S.selectedId)}`;
  try { await navigator.clipboard.writeText(url); toast('Guide link copied'); }
  catch(_){ toast('Could not copy to clipboard', 'error'); }
}

async function deleteArticle(){
  const a = S.articles.find(x => x.id === S.selectedId);
  if(!a) return;
  const ok = await confirmDialog({
    type: 'danger',
    title: 'Delete guide?',
    message: `“${escapeHtml(a.title || 'Untitled')}” and all its images will be deleted for every workspace member.`,
    okText: 'Delete guide',
    cancelText: 'Cancel'
  });
  if(!ok) return;
  try {
    const imgs = await kbRef().doc(a.id).collection('images').get();
    await Promise.all(imgs.docs.map(d => d.ref.delete()));
    await kbRef().doc(a.id).delete();
    S.selectedId = null;
    $('kbMain')?.classList.remove('kb-reading');
    toast('Guide deleted');
  } catch(err){
    console.error(err);
    toast('Failed to delete: ' + (err.message || err), 'error');
  }
}

/* ---------------- editor ---------------- */
function moduleSuggestions(){
  const set = new Set(DEFAULT_MODULES);
  S.articles.forEach(a => a.module && set.add(a.module));
  return [...set].sort((a, b) => a.localeCompare(b, 'id'));
}

function openEditor(article){
  let id;
  try { id = article ? article.id : kbRef().doc().id; }
  catch(err){ toast('Workspace not ready, try again shortly', 'error'); return; }
  S.editing = { id, isNew: !article, uploaded: new Set(), dirty: false };

  $('kbEditorHeading').textContent = article ? 'Edit guide' : 'Write new guide';
  $('kbTitle').value = article?.title || '';
  $('kbProduct').value = article?.product || (S.product !== 'all' ? S.product : '');
  $('kbModule').value = article?.module || (S.module !== 'all' ? S.module : '');
  $('kbVersion').value = article?.version || '';
  $('kbSummary').value = article?.summary || '';
  $('kbTags').value = (article?.tags || []).join(', ');
  $('kbContent').value = article ? (article.content || '') : TEMPLATE;
  $('kbModuleList').innerHTML = moduleSuggestions().map(m => `<option value="${escapeHtml(m)}"></option>`).join('');
  setEditorHint('');
  setTab('write');

  $('kbBrowse').classList.add('hidden');
  $('kbEditor').classList.remove('hidden');
  document.querySelector('.content')?.scrollTo({ top: 0 });
  setTimeout(() => $('kbTitle').focus(), 30);
}

function closeEditor(){
  S.editing = null;
  $('kbEditor').classList.add('hidden');
  $('kbBrowse').classList.remove('hidden');
  render();
}

async function cancelEditor(){
  const ed = S.editing;
  if(!ed) return closeEditor();
  if(ed.dirty){
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'Unsaved changes will be lost.',
      okText: 'Discard', cancelText: 'Continue writing'
    });
    if(!ok) return;
  }
  if(ed.isNew && ed.uploaded.size){
    // screenshots uploaded for an article that was never saved
    try { await Promise.all([...ed.uploaded].map(imgId => kbRef().doc(ed.id).collection('images').doc(imgId).delete())); } catch(_){}
  }
  closeEditor();
}

function setEditorHint(msg, isError){
  const el = $('kbEditorHint');
  if(!el) return;
  el.textContent = msg || '';
  el.classList.toggle('is-error', !!isError);
}

function setTab(tab){
  document.querySelectorAll('#kbEditor [data-kb-tab]').forEach(b => {
    const on = b.dataset.kbTab === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const write = tab === 'write';
  $('kbContent').classList.toggle('hidden', !write);
  $('kbMdTools').classList.toggle('is-disabled', !write);
  const prev = $('kbPreview');
  prev.classList.toggle('hidden', write);
  if(!write && S.editing){
    prev.innerHTML = renderMarkdown($('kbContent').value) || '<p class="kb-muted">Nothing written yet.</p>';
    hydrateImages(prev, S.editing.id);
  }
}

async function saveEditor(){
  const ed = S.editing;
  if(!ed) return;
  const title = $('kbTitle').value.trim();
  const product = $('kbProduct').value;
  const module = $('kbModule').value.trim();
  const content = $('kbContent').value.replace(/\s+$/, '') + '\n';
  if(!title){ setEditorHint('Title is required.', true); $('kbTitle').focus(); return; }
  if(!PRODUCTS[product]){ setEditorHint('Select a product.', true); $('kbProduct').focus(); return; }
  if(!module){ setEditorHint('Module is required, e.g. Sales.', true); $('kbModule').focus(); return; }

  const btn = $('kbSaveBtn');
  btn.disabled = true;
  setEditorHint('Menyimpan…');
  const now = Date.now();
  const data = {
    title, product, module,
    version: $('kbVersion').value.trim(),
    summary: $('kbSummary').value.trim(),
    tags: $('kbTags').value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 12),
    content,
    updatedAt: now,
    updatedBy: userLabel()
  };
  if(ed.isNew){ data.createdAt = now; data.createdBy = userLabel(); }

  try {
    await kbRef().doc(ed.id).set(data, { merge: true });
    // drop screenshots that are no longer referenced in the text
    const used = new Set([...content.matchAll(/kbimg:([A-Za-z0-9_-]+)/g)].map(m => m[1]));
    try {
      const imgs = await kbRef().doc(ed.id).collection('images').get();
      await Promise.all(imgs.docs.filter(d => !used.has(d.id)).map(d => d.ref.delete()));
    } catch(e){ console.warn('kb image cleanup', e); }
    toast(ed.isNew ? 'Guide saved' : 'Changes saved');
    const id = ed.id;
    closeEditor();
    selectArticle(id);
  } catch(err){
    console.error(err);
    setEditorHint(err.code === 'permission-denied'
      ? 'Denied by Firestore. Publish the latest firestore.rules first (see FIRESTORE_RULES.md).'
      : 'Failed to save: ' + (err.message || err), true);
  } finally {
    btn.disabled = false;
  }
}

/* ---- markdown toolbar ---- */
function surround(before, after, placeholder){
  const ta = $('kbContent');
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || placeholder;
  ta.setRangeText(before + sel + after, s, e, 'end');
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  ta.focus();
  markDirty();
}

function insertBlock(text){
  const ta = $('kbContent');
  const { selectionStart: s, value } = ta;
  const prefix = s > 0 && value[s - 1] !== '\n' ? '\n\n' : (s > 1 && value[s - 2] !== '\n' ? '\n' : '');
  ta.setRangeText(prefix + text + '\n', s, ta.selectionEnd, 'end');
  ta.focus();
  markDirty();
}

/* Screenshot pasted while the cursor is on a numbered step → attach it under
 * that step (indented), so it renders inside the step instead of breaking the list. */
function insertImage(md){
  const ta = $('kbContent');
  const { value, selectionStart: pos } = ta;
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = value.indexOf('\n', pos);
  if(lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const inStep = /^\s*\d+[.)]\s+/.test(line) || (/^\s{2,}\S/.test(line) && /\n\s*\d+[.)]\s+[^\n]*\n?(\s{2,}[^\n]*\n)*$/.test(value.slice(0, lineStart)));
  if(inStep){
    ta.setRangeText(`\n   ${md}`, lineEnd, lineEnd, 'end');
    ta.focus();
    markDirty();
  } else {
    insertBlock(md);
  }
}

function prefixLines(prefixFn){
  const ta = $('kbContent');
  const { value } = ta;
  let s = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let e = value.indexOf('\n', ta.selectionEnd);
  if(e === -1) e = value.length;
  const lines = value.slice(s, e).split('\n');
  const out = lines.map((l, i) => prefixFn(i) + l.replace(/^(\d+[.)]|[-*]|>)\s+/, '')).join('\n');
  ta.setRangeText(out, s, e, 'end');
  ta.focus();
  markDirty();
}

function mdAction(kind){
  if(!S.editing) return;
  switch(kind){
    case 'bold': return surround('**', '**', 'bold text');
    case 'h': return prefixLines(() => '## ');
    case 'ul': return prefixLines(() => '- ');
    case 'ol': return prefixLines(i => `${i + 1}. `);
    case 'path': return surround('**', '**', 'Sales > Sales Invoice');
    case 'note': return insertBlock('> **Note:** ');
    case 'warn': return insertBlock('> **Important:** ');
    case 'table': return insertBlock('| Field | Description |\n|---|---|\n| Field name | Explanation |');
    case 'link': return surround('[', '](https://)', 'link text');
    case 'image': return $('kbImgInput').click();
  }
}

function markDirty(){
  if(S.editing) S.editing.dirty = true;
}

/* ---- screenshots ---- */
function loadImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File is not a valid image')); };
    img.src = url;
  });
}

async function compressImage(file){
  const img = await loadImage(file);
  let scale = Math.min(1, MAX_IMG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  for(let attempt = 0; attempt < 6; attempt++){
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const quality = attempt < 3 ? 0.85 - attempt * 0.1 : 0.6;
    let data = c.toDataURL('image/webp', quality);
    if(!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', quality);
    const bytes = Math.round(data.length * 0.75);
    if(bytes <= MAX_IMG_BYTES) return { data, w, h, bytes };
    if(attempt >= 2) scale *= 0.8;
  }
  throw new Error('Image too large after compression');
}

async function uploadImages(files){
  const ed = S.editing;
  if(!ed || !files.length) return;
  for(const file of files){
    if(!/^image\//.test(file.type)) continue;
    setEditorHint('Uploading image…');
    try {
      const { data, w, h, bytes } = await compressImage(file);
      const ref = kbRef().doc(ed.id).collection('images').doc();
      await ref.set({ data, w, h, bytes, createdAt: Date.now() });
      ed.uploaded.add(ref.id);
      S.imgCache.set(ref.id, data);
      const name = (file.name && !/^image\.\w+$/i.test(file.name)) ? file.name.replace(/\.[^.]+$/, '') : 'Screenshot';
      insertImage(`![${name}](kbimg:${ref.id})`);
      setEditorHint(`Image added (${Math.round(bytes / 1024)} KB).`);
    } catch(err){
      console.error(err);
      setEditorHint(err.code === 'permission-denied'
        ? 'Upload denied by Firestore. Publish the latest firestore.rules first.'
        : 'Failed to upload image: ' + (err.message || err), true);
    }
  }
}

/* ---------------- wiring ---------------- */
function wire(){
  if(S.wired) return;
  const root = $('view-kb');
  if(!root) return;
  S.wired = true;

  root.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-kb-act]');
    if(act){
      const a = act.dataset.kbAct;
      if(a === 'new') return openEditor(null);
      if(a === 'edit') return openEditor(S.articles.find(x => x.id === S.selectedId));
      if(a === 'delete') return deleteArticle();
      if(a === 'copy-text') return copyArticleText();
      if(a === 'copy-link') return copyArticleLink();
      if(a === 'back'){ S.selectedId = null; $('kbMain')?.classList.remove('kb-reading'); return render(); }
      if(a === 'save') return saveEditor();
      if(a === 'cancel') return cancelEditor();
    }
    const prod = t.closest('[data-kb-product]');
    if(prod){ S.product = prod.dataset.kbProduct; S.module = 'all'; return render(); }
    const mod = t.closest('[data-kb-module]');
    if(mod){ S.module = mod.dataset.kbModule; return render(); }
    const open = t.closest('[data-kb-open]');
    if(open) return selectArticle(open.dataset.kbOpen);
    const md = t.closest('[data-kb-md]');
    if(md){ e.preventDefault(); return mdAction(md.dataset.kbMd); }
    const tab = t.closest('[data-kb-tab]');
    if(tab) return setTab(tab.dataset.kbTab);
  });

  $('kbSearch')?.addEventListener('input', (e) => { S.query = e.target.value; render(); });
  $('kbModuleSelect')?.addEventListener('change', (e) => { S.module = e.target.value; render(); });

  const ta = $('kbContent');
  ['kbTitle', 'kbProduct', 'kbModule', 'kbVersion', 'kbSummary', 'kbTags', 'kbContent'].forEach(id => {
    $(id)?.addEventListener('input', markDirty);
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if(files.length){ e.preventDefault(); uploadImages(files); }
  });
  ta.addEventListener('dragover', (e) => { if(e.dataTransfer?.types?.includes('Files')){ e.preventDefault(); ta.classList.add('is-drop'); } });
  ta.addEventListener('dragleave', () => ta.classList.remove('is-drop'));
  ta.addEventListener('drop', (e) => {
    ta.classList.remove('is-drop');
    const files = [...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type));
    if(files.length){ e.preventDefault(); uploadImages(files); }
  });
  $('kbImgInput')?.addEventListener('change', (e) => {
    uploadImages([...e.target.files]);
    e.target.value = '';
  });
  $('kbEditor')?.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); saveEditor(); }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && e.target === ta){ e.preventDefault(); mdAction('bold'); }
  });
  window.addEventListener('beforeunload', (e) => {
    if(S.editing?.dirty){ e.preventDefault(); e.returnValue = ''; }
  });
}

/* Called by switchView('kb') */
function onKbShown(){
  wire();
  if(!S.selectedId){
    try {
      const doc = new URLSearchParams(location.search).get('doc');
      if(doc) S.pendingDocId = doc;
    } catch(_){}
  }
  subscribe();
  if(S.pendingDocId && S.articles.some(a => a.id === S.pendingDocId)){
    S.selectedId = S.pendingDocId;
    S.pendingDocId = null;
    $('kbMain')?.classList.add('kb-reading');
  }
  render();
}

function openKbView(){
  switchView('kb');
}

function openKbArticle(id){
  S.pendingDocId = id;
  switchView('kb');
  if(S.articles.some(a => a.id === id)) selectArticle(id);
}

export { onKbShown, openKbView, openKbArticle, getKbArticles, PRODUCTS as KB_PRODUCTS };
