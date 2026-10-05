/**
 * Knowledge Base — how-to guides for Zahir ERP / ERP One / MRP (v4.42.0; Manufacturing merged into MRP in v4.45.1)
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
import { fetchRedmine } from '../redmine/client.js';
import { getIssueClientName } from './clients.js';
import {
  STRUCTURE_ID, GENERAL, PRODUCT_KEYS, canonicalProduct, newId, emptyStructure, normalizeStructure, cloneStructure,
  buildTree, moduleOptions, submenuOptions, structureFromArticles, validateStructure, planRenames, usage
} from './kb-structure.js';

const PRODUCTS = {
  erp: { label: 'Zahir ERP', short: 'ERP' },
  one: { label: 'Zahir ERP One', short: 'ERP One' },
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
  submenu: 'all',          // 'all' | submenu name | GENERAL (guides without a submenu)
  structure: emptyStructure(), // team-defined modules/submenus per product
  structureMeta: null,
  manage: null,            // { draft, product, prefilled:Set } while editing menus
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
    const structDoc = snap.docs.find(d => d.id === STRUCTURE_ID);
    S.structure = normalizeStructure(structDoc ? structDoc.data() : null);
    S.structureMeta = structDoc ? structDoc.data() : null;
    S.articles = snap.docs.filter(d => d.id !== STRUCTURE_ID).map(d => {
      const data = d.data();
      // guides saved under the retired "Zahir Manufacturing" show under Zahir MRP
      return { id: d.id, ...data, product: canonicalProduct(data.product) };
    });
    S.loaded = true;
    if(S.pendingDocId && S.articles.some(a => a.id === S.pendingDocId)){
      S.selectedId = S.pendingDocId;
      S.pendingDocId = null;
    }
    render();
  }, err => {
    console.error('KB snapshot error', err);
    S.loaded = true;
    const reader = $('kbPane');
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
  const hay = [a.title, a.module, a.submenu, a.client, a.summary, a.version, (a.tags || []).join(' '), a.content,
    PRODUCTS[a.product]?.label].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function byUpdated(a, b){ return (b.updatedAt || 0) - (a.updatedAt || 0); }
function moduleOf(a){ return a.module || 'Other'; }
function submenuOf(a){ return String(a.submenu || '').trim(); }
function submenuKey(a){ return submenuOf(a) || GENERAL; }
function submenuLabel(k){ return k === GENERAL ? 'General' : k; }
function visibleArticles(){
  const q = S.query.toLowerCase().trim();
  // search always looks through every guide, whatever is selected in the tree
  if(q) return S.articles.filter(a => matchesQuery(a, q)).sort(byUpdated);
  return S.articles
    .filter(a => S.product === 'all' || a.product === S.product)
    .filter(a => S.module === 'all' || moduleOf(a).toLowerCase() === S.module.toLowerCase())
    .filter(a => S.module === 'all' || S.submenu === 'all' || submenuKey(a).toLowerCase() === S.submenu.toLowerCase())
    .filter(a => matchesQuery(a, q))
    .sort(byUpdated);
}

/* Library tree: the team's defined menus (in their order) + names used by
 * guides that aren't defined yet. Respects the search query. */
function libraryTree(){
  const q = S.query.toLowerCase().trim();
  return buildTree(S.structure, S.articles.filter(a => matchesQuery(a, q)));
}

function moduleNode(tree, p, m){
  return tree.products.get(p)?.modules.find(x => x.name.toLowerCase() === String(m).toLowerCase()) || null;
}

/* ---------------- rendering ---------------- */
function fmtDate(ms){
  if(!ms) return '';
  const d = new Date(ms);
  if(isNaN(d)) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

function productChip(p){
  const meta = PRODUCTS[p];
  return meta ? `<span class="kb-chip kb-chip-${p}">${escapeHtml(meta.short)}</span>` : '';
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
};

function render(){
  if(!$('view-kb')) return;
  renderNav();
  renderFilterSelect();
  renderPane();
}

/* Left library tree: All guides → products → modules → submenus */
function renderNav(){
  const el = $('kbNav');
  if(!el) return;
  const tree = libraryTree();
  const row = (attrs, label, n, cls) =>
    `<button type="button" class="kb-nav-row ${cls || ''}" ${attrs}><span class="kb-nav-label">${label}</span><span class="kb-nav-n">${n}</span></button>`;
  let html = row('data-kb-product="all"', 'All guides', tree.total, S.product === 'all' ? 'is-active' : '');
  html += '<div class="kb-nav-sep" role="presentation"></div>';
  for(const [p, prod] of tree.products){
    const open = S.product === p;
    const active = open && S.module === 'all';
    html += row(`data-kb-product="${p}" aria-expanded="${open}"`,
      `<span class="kb-dot kb-dot-${p}" aria-hidden="true"></span>${escapeHtml(PRODUCTS[p].label)}`,
      prod.count, `kb-nav-product${active ? ' is-active' : ''}${prod.count || prod.modules.length ? '' : ' is-empty'}`);
    if(!open) continue;
    if(!prod.modules.length){
      html += `<div class="kb-nav-mods"><button type="button" class="kb-nav-hint" data-kb-act="manage" data-kb-manage-product="${p}">+ Add modules</button></div>`;
      continue;
    }
    html += '<div class="kb-nav-mods">' + prod.modules.map(m => {
      const modOpen = S.module.toLowerCase() === m.name.toLowerCase();
      let out = row(`data-kb-product="${p}" data-kb-module="${escapeHtml(m.name)}"${m.subs.length ? ` aria-expanded="${modOpen}"` : ''}`,
        escapeHtml(m.name), m.count,
        `kb-nav-mod${modOpen && S.submenu === 'all' ? ' is-active' : ''}${modOpen ? ' is-open' : ''}${m.count ? '' : ' is-zero'}${m.defined ? '' : ' is-undefined'}`);
      if(modOpen && m.subs.length){
        out += '<div class="kb-nav-subs">' + m.subs.map(sub =>
          row(`data-kb-product="${p}" data-kb-module="${escapeHtml(m.name)}" data-kb-submenu="${escapeHtml(sub.key)}"`,
            escapeHtml(submenuLabel(sub.key)), sub.count,
            `kb-nav-sub${S.submenu === sub.key ? ' is-active' : ''}${sub.key === GENERAL ? ' is-general' : ''}${sub.count ? '' : ' is-zero'}${sub.defined || sub.key === GENERAL ? '' : ' is-undefined'}`)).join('') + '</div>';
      }
      return out;
    }).join('') + '</div>';
  }
  el.innerHTML = html;
}

/* Phone / narrow screens: the tree becomes one select */
function renderFilterSelect(){
  const sel = $('kbFilterSelect');
  if(!sel) return;
  const tree = libraryTree();
  const val = (p, m, sm) => [p, m, sm].map(encodeURIComponent).join('|');
  let opts = `<option value="${val('all', 'all', 'all')}">All guides (${tree.total})</option>`;
  for(const [p, prod] of tree.products){
    opts += `<option value="${val(p, 'all', 'all')}">${escapeHtml(PRODUCTS[p].label)} (${prod.count})</option>`;
    prod.modules.forEach(m => {
      opts += `<option value="${escapeHtml(val(p, m.name, 'all'))}">&nbsp;&nbsp;&nbsp;${escapeHtml(m.name)} (${m.count})</option>`;
      m.subs.forEach(sub => {
        opts += `<option value="${escapeHtml(val(p, m.name, sub.key))}">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;› ${escapeHtml(submenuLabel(sub.key))} (${sub.count})</option>`;
      });
    });
  }
  sel.innerHTML = opts;
  sel.value = val(S.product, S.module, S.module === 'all' ? 'all' : S.submenu);
}

function renderPane(){
  const el = $('kbPane');
  if(!el) return;
  const shell = $('kbBrowse');
  if(!S.loaded){
    el.innerHTML = '<div class="kb-state"><div class="spinner-sm"></div><p>Loading guides…</p></div>';
    return;
  }
  shell?.classList.toggle('kb-is-empty', !S.articles.length && !S.manage);
  if(!S.articles.length && !S.manage){
    el.innerHTML = `<div class="kb-welcome">
      <h2>Write your team's first guide</h2>
      <p>Keep how-to guides for Zahir ERP, ERP One, and MRP in one place, so everyone in support walks clients through the same steps.</p>
      <ol>
        <li>Click <b>Write guide</b> and choose the product and module.</li>
        <li>Write the steps. Paste screenshots straight in with <kbd>Ctrl</kbd>+<kbd>V</kbd>.</li>
        <li>Save. The guide is visible to everyone in the workspace right away.</li>
      </ol>
      <div class="kb-welcome-actions">
        <button type="button" class="btn btn-primary" data-kb-act="new">Write guide</button>
        <button type="button" class="btn btn-secondary" data-kb-act="manage">Set up menus first</button>
      </div>
    </div>`;
    return;
  }
  if(S.manage){ renderManager(); return; }
  const a = S.selectedId && S.articles.find(x => x.id === S.selectedId);
  if(a){ renderArticle(el, a); return; }
  renderList(el);
}

function listHeading(){
  if(S.query.trim()) return { title: 'Search results', sub: `for “${escapeHtml(S.query.trim())}”` };
  if(S.product === 'all') return { title: 'All guides', sub: '' };
  const p = PRODUCTS[S.product]?.label || '';
  if(S.module === 'all') return { title: escapeHtml(p), sub: '' };
  if(S.submenu === 'all') return { title: escapeHtml(S.module), sub: escapeHtml(p) };
  return { title: escapeHtml(submenuLabel(S.submenu)), sub: `${escapeHtml(p)} › ${escapeHtml(S.module)}` };
}

/* One guide in a list.
 * Left: title, summary, and a quiet meta line (product · Module › Submenu · client).
 * Right: only the date, in a fixed column, so every row lines up. */
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const ICON_CLIENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/></svg>';

function guideRow(a, { showProduct, showModule, showSubmenu }){
  const parts = [];
  if(showModule) parts.push(escapeHtml(moduleOf(a)));
  if(showSubmenu && submenuOf(a)) parts.push(escapeHtml(submenuOf(a)));
  const where = parts.join('<span class="kb-row-sep" aria-hidden="true">›</span>');
  const meta = [
    showProduct ? productChip(a.product) : '',
    where ? `<span class="kb-row-path" title="${escapeHtml([showModule ? moduleOf(a) : '', showSubmenu ? submenuOf(a) : ''].filter(Boolean).join(' › '))}">${ICON_FOLDER}<span>${where}</span></span>` : '',
    a.client ? `<span class="kb-row-client" title="Client: ${escapeHtml(a.client)}">${ICON_CLIENT}<span>${escapeHtml(a.client)}</span></span>` : ''
  ].filter(Boolean).join('');
  return `<button type="button" class="kb-row" data-kb-open="${escapeHtml(a.id)}">
    <span class="kb-row-main">
      <span class="kb-row-title">${escapeHtml(a.title || 'Untitled')}</span>
      ${a.summary ? `<span class="kb-row-sum">${escapeHtml(a.summary)}</span>` : ''}
      ${meta ? `<span class="kb-row-meta">${meta}</span>` : ''}
    </span>
    <span class="kb-row-date">${escapeHtml(fmtDate(a.updatedAt))}</span>
    <span class="kb-row-go" aria-hidden="true">${ICONS.chevron}</span>
  </button>`;
}

function renderList(el){
  const list = visibleArticles();
  const head = listHeading();
  const searching = !!S.query.trim();
  let body;
  if(!list.length){
    body = searching
      ? `<div class="kb-state kb-state-sm"><p>No guides match “${escapeHtml(S.query.trim())}”.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-kb-act="clear-search">Clear search</button></div>`
      : `<div class="kb-state kb-state-sm"><p>No guides here yet.</p>
          <button type="button" class="btn btn-primary btn-sm" data-kb-act="new">Write the first one</button></div>`;
  } else if(!searching && S.module !== 'all' && S.submenu === 'all' && list.some(a => submenuOf(a))){
    // inside a module: one group per submenu, "General" last
    const groups = new Map();
    list.forEach(a => { const k = submenuKey(a).toLowerCase(); if(!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
    const node = moduleNode(libraryTree(), S.product, S.module);
    const order = (node ? node.subs.map(x => x.key) : [...groups.keys()]).filter(k => groups.has(k.toLowerCase()));
    body = order.map(k => {
      const items = groups.get(k.toLowerCase());
      return `<section class="kb-group">
        <h3 class="kb-group-title kb-group-sub">${escapeHtml(submenuLabel(k))}<span>${items.length}</span></h3>
        ${items.map(a => guideRow(a, { showProduct: false, showModule: false, showSubmenu: false })).join('')}
      </section>`;
    }).join('');
  } else if(!searching && S.module === 'all'){
    // group: by product on "All guides", by module inside a product
    const key = S.product === 'all' ? (a => a.product) : moduleOf;
    const groups = new Map();
    list.forEach(a => { const k = key(a); if(!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
    const order = S.product === 'all'
      ? Object.keys(PRODUCTS).filter(k => groups.has(k))
      : (libraryTree().products.get(S.product)?.modules.map(m => m.name) || [...groups.keys()]).filter(k => groups.has(k));
    body = order.map(k => {
      const label = S.product === 'all' ? PRODUCTS[k].label : k;
      const items = groups.get(k);
      return `<section class="kb-group">
        <h3 class="kb-group-title">${S.product === 'all' ? `<span class="kb-dot kb-dot-${k}" aria-hidden="true"></span>` : ''}${escapeHtml(label)}<span>${items.length}</span></h3>
        ${items.map(a => guideRow(a, { showProduct: false, showModule: S.product === 'all', showSubmenu: true })).join('')}
      </section>`;
    }).join('');
  } else {
    body = `<section class="kb-group">${list.map(a => guideRow(a, { showProduct: searching || S.product === 'all', showModule: searching || S.module === 'all', showSubmenu: searching || S.submenu === 'all' })).join('')}</section>`;
  }
  el.innerHTML = `<header class="kb-list-head">
      <div><h2>${head.title}</h2>${head.sub ? `<p>${head.sub}</p>` : ''}</div>
      <span class="kb-list-count">${list.length} ${list.length === 1 ? 'guide' : 'guides'}</span>
    </header>${body}`;
}

function slugify(s){
  return String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
}

function renderArticle(el, a){
  const p = PRODUCTS[a.product];
  const tags = (a.tags || []).filter(Boolean);
  const backLabel = S.module !== 'all'
    ? (S.submenu !== 'all' ? submenuLabel(S.submenu) : S.module)
    : (S.product !== 'all' ? (p ? p.label : 'guides') : 'All guides');
  const meta = [
    a.client ? `<span class="kb-meta-client">Client <button type="button" class="kb-client-link" data-kb-client="${escapeHtml(a.client)}" title="Show Redmine issues for ${escapeHtml(a.client)}">${escapeHtml(a.client)}</button></span>` : '',
    a.version ? `<span>Applies to <b>${escapeHtml(a.version)}</b></span>` : '',
    `<span>Updated ${escapeHtml(fmtDate(a.updatedAt))}${a.updatedBy ? ` by ${escapeHtml(a.updatedBy)}` : ''}</span>`
  ].filter(Boolean).join('');

  el.innerHTML = `
    <div class="kb-article-wrap">
      <article class="kb-article">
        <button type="button" class="kb-back" data-kb-act="back">${ICONS.back}<span>${escapeHtml(backLabel)}</span></button>
        <p class="kb-crumb">${productChip(a.product)}<span>${escapeHtml(p ? p.label : '')}</span><span class="md-path">›</span><span>${escapeHtml(moduleOf(a))}</span>${submenuOf(a) ? `<span class="md-path">›</span><span>${escapeHtml(submenuOf(a))}</span>` : ''}</p>
        <h1 class="kb-title">${escapeHtml(a.title || 'Untitled')}</h1>
        ${a.summary ? `<p class="kb-lede">${escapeHtml(a.summary)}</p>` : ''}
        <div class="kb-meta">${meta}</div>
        ${tags.length ? `<p class="kb-tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</p>` : ''}
        <div class="kb-actions" role="toolbar" aria-label="Guide actions">
          <button type="button" class="kb-act kb-act-primary" data-kb-act="edit">${ICONS.edit}<span>Edit</span></button>
          <button type="button" class="kb-act" data-kb-act="copy-text" aria-label="Copy text" title="Copy text">${ICONS.copy}<span>Copy text</span></button>
          <button type="button" class="kb-act" data-kb-act="copy-link" aria-label="Copy link" title="Copy link">${ICONS.link}<span>Copy link</span></button>
          <button type="button" class="kb-act kb-act-danger" data-kb-act="delete" aria-label="Delete guide" title="Delete guide">${ICONS.trash}<span>Delete</span></button>
        </div>
        <nav class="kb-jump" id="kbJump" aria-label="Jump to section"></nav>
        <div class="md-body kb-md" id="kbArticleBody">${renderMarkdown(a.content || '')}</div>
      </article>
      <aside class="kb-toc" id="kbToc" aria-label="On this page"></aside>
    </div>`;
  buildToc(a);
  hydrateImages(el, a.id);
}

function buildToc(){
  const body = $('kbArticleBody');
  const toc = $('kbToc');
  if(!body || !toc) return;
  const heads = [...body.querySelectorAll('h2')];
  const used = new Set();
  heads.forEach(h => {
    let id = 'kb-' + slugify(h.textContent);
    while(used.has(id)) id += '-x';
    used.add(id);
    h.id = id;
  });
  const jump = $('kbJump');
  if(heads.length < 2){
    toc.innerHTML = ''; toc.classList.add('is-empty');
    if(jump) jump.innerHTML = '';
    return;
  }
  toc.classList.remove('is-empty');
  if(jump){
    jump.innerHTML = heads.map(h => `<a href="#${h.id}" data-kb-toc="${h.id}">${escapeHtml(h.textContent)}</a>`).join('');
  }
  toc.innerHTML = `<p>On this page</p>` + heads.map(h => {
    const steps = h.nextElementSibling?.matches?.('ol.md-steps') ? h.nextElementSibling.children.length : 0;
    return `<a href="#${h.id}" data-kb-toc="${h.id}">${escapeHtml(h.textContent)}${steps ? `<span>${steps} steps</span>` : ''}</a>`;
  }).join('');
}

function scrollPaneTo(target){
  const sc = document.querySelector('.content');
  if(!sc || !target) return;
  const top = target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sc.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
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
  try {
    const url = `${location.pathname}?view=kb&doc=${encodeURIComponent(id)}`;
    history.replaceState(history.state, '', url);
  } catch(_){}
  renderNav();
  renderPane();
  document.querySelector('.content')?.scrollTo({ top: 0 });
}

function backToList(){
  S.selectedId = null;
  try { history.replaceState(history.state, '', `${location.pathname}?view=kb`); } catch(_){}
  render();
  document.querySelector('.content')?.scrollTo({ top: 0 });
}

async function copyArticleText(){
  const a = S.articles.find(x => x.id === S.selectedId);
  if(!a) return;
  const p = PRODUCTS[a.product];
  const text = `*${a.title}*\n${p ? p.label : ''} › ${a.module || ''}${submenuOf(a) ? ` › ${submenuOf(a)}` : ''}${a.version ? ` (${a.version})` : ''}${a.client ? `\nClient: ${a.client}` : ''}\n\n${markdownToText(a.content)}`;
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
    toast('Guide deleted');
    backToList();
  } catch(err){
    console.error(err);
    toast('Failed to delete: ' + (err.message || err), 'error');
  }
}

/* ---------------- editor ---------------- */
/* Client name suggestions. The main source is the server's client catalogue
 * (every distinct "Client Name" value in Redmine issues, cached for 12 hours),
 * plus clients in issues loaded this session and clients already used in guides. */
const CLIENT_CACHE_KEY = 'erp_kb_client_names';
const CLIENT_CACHE_MS = 12 * 60 * 60 * 1000;
let redmineClients = null;      // [{ name, count }]
let redmineClientsLoading = null;

function readClientCache(){
  try {
    const c = JSON.parse(localStorage.getItem(CLIENT_CACHE_KEY) || 'null');
    if(c && Array.isArray(c.clients) && Date.now() - (c.at || 0) < CLIENT_CACHE_MS) return c.clients;
  } catch(_){}
  return null;
}

async function loadRedmineClients(force){
  if(!force){
    if(redmineClients) return redmineClients;
    const cached = readClientCache();
    if(cached){ redmineClients = cached; return cached; }
  }
  if(redmineClientsLoading) return redmineClientsLoading;
  redmineClientsLoading = (async () => {
    try {
      let cf = '';
      try { cf = localStorage.getItem('erp_client_cf_id') || ''; } catch(_){}
      const q = cf ? `&cf_id=${encodeURIComponent(cf)}` : '';
      const { data } = await fetchRedmine(`/api/redmine?resource=client_names${q}`, { force: true });
      const list = Array.isArray(data?.clients) ? data.clients.filter(c => c && c.name) : [];
      if(data?.fieldId){ try { localStorage.setItem('erp_client_cf_id', String(data.fieldId)); } catch(_){} }
      redmineClients = list;
      try { localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify({ at: Date.now(), clients: list, complete: !!data?.complete })); } catch(_){}
      return list;
    } catch(err){
      console.warn('kb client names', err);
      return redmineClients || [];
    } finally {
      redmineClientsLoading = null;
    }
  })();
  return redmineClientsLoading;
}

function clientsFromLoadedIssues(){
  const out = [];
  const add = (arr) => (Array.isArray(arr) ? arr : []).forEach(i => { const n = getIssueClientName(i); if(n) out.push(n); });
  add(window.__testerIssues);
  add(window.__clientIssues);
  Object.values(window.__newIssuesByProject || {}).forEach(b => add(b && b.issues));
  return out;
}

function renderClientOptions(fromRedmine){
  const counts = new Map();
  (fromRedmine || []).forEach(c => counts.set(c.name, c.count || 0));
  [...clientsFromLoadedIssues(), ...S.articles.map(a => a.client)]
    .map(v => String(v || '').trim()).filter(Boolean)
    .forEach(v => { if(!counts.has(v)) counts.set(v, 0); });
  const dl = $('kbClientList');
  if(dl){
    dl.innerHTML = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([v, n]) => `<option value="${escapeHtml(v)}"${n ? ` label="${n} issue${n === 1 ? '' : 's'}"` : ''}></option>`)
      .join('');
  }
  const hint = $('kbClientHint');
  if(hint) hint.innerHTML = counts.size
    ? `${counts.size} clients · <button type="button" class="kb-client-refresh" data-kb-act="refresh-clients" title="Reload the client list from Redmine">refresh</button>`
    : '';
}

async function fillClientSuggestions(){
  renderClientOptions(redmineClients || readClientCache() || []);
  const hint = $('kbClientHint');
  if(!redmineClients && !readClientCache() && hint) hint.textContent = 'loading clients…';
  renderClientOptions(await loadRedmineClients(false));
}

/* Module / Submenu dropdowns come from the team's menu structure.
 * Names used by older guides but not in the structure stay selectable,
 * marked "not in menus", so editing an old guide never loses its place. */
function optionHtml(value, label, selected){
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function fillModuleSelect(current){
  const sel = $('kbModule');
  if(!sel) return;
  const product = $('kbProduct').value;
  const cur = String(current ?? sel.value ?? '').trim();
  const hint = $('kbMenuHint');
  if(!product){
    sel.innerHTML = '<option value="">Choose a product first</option>';
    sel.disabled = true;
    if(hint) hint.innerHTML = '';
    fillSubmenuSelect('');
    return;
  }
  const { defined, extra } = moduleOptions(S.structure, S.articles, product);
  const all = [...defined, ...extra];
  let html = optionHtml('', all.length ? 'Choose a module' : 'No modules yet', !cur);
  html += defined.map(n => optionHtml(n, n, n.toLowerCase() === cur.toLowerCase())).join('');
  if(extra.length) html += `<optgroup label="Not in menus">${extra.map(n => optionHtml(n, n, n.toLowerCase() === cur.toLowerCase())).join('')}</optgroup>`;
  if(cur && !all.some(n => n.toLowerCase() === cur.toLowerCase())) html += optionHtml(cur, `${cur} (not in menus)`, true);
  sel.innerHTML = html;
  sel.disabled = false;
  if(hint){
    hint.innerHTML = defined.length ? '' :
      `No modules defined for ${escapeHtml(PRODUCTS[product]?.label || 'this product')}. <button type="button" class="kb-link-btn" data-kb-act="manage" data-kb-manage-product="${product}">Set up menus</button>`;
  }
  fillSubmenuSelect();
}

function fillSubmenuSelect(current){
  const sel = $('kbSubmenu');
  if(!sel) return;
  const product = $('kbProduct').value;
  const module = $('kbModule')?.value || '';
  const cur = String(current ?? sel.value ?? '').trim();
  if(!product || !module){
    sel.innerHTML = '<option value="">Choose a module first</option>';
    sel.disabled = true;
    return;
  }
  const { defined, extra } = submenuOptions(S.structure, S.articles, product, module);
  let html = optionHtml('', defined.length || extra.length ? 'None (General)' : 'No submenus', !cur);
  html += defined.map(n => optionHtml(n, n, n.toLowerCase() === cur.toLowerCase())).join('');
  if(extra.length) html += `<optgroup label="Not in menus">${extra.map(n => optionHtml(n, n, n.toLowerCase() === cur.toLowerCase())).join('')}</optgroup>`;
  if(cur && ![...defined, ...extra].some(n => n.toLowerCase() === cur.toLowerCase())) html += optionHtml(cur, `${cur} (not in menus)`, true);
  sel.innerHTML = html;
  sel.disabled = false;
}

function openEditor(article){
  if(S.manage) S.manage = null;
  let id;
  try { id = article ? article.id : kbRef().doc().id; }
  catch(err){ toast('Workspace not ready, try again shortly', 'error'); return; }
  S.editing = { id, isNew: !article, uploaded: new Set(), dirty: false };

  $('kbEditorHeading').textContent = article ? 'Edit guide' : 'Write new guide';
  $('kbTitle').value = article?.title || '';
  $('kbProduct').value = article?.product || (S.product !== 'all' ? S.product : '');
  fillModuleSelect(article ? (article.module || '') : (S.module !== 'all' ? S.module : ''));
  fillSubmenuSelect(article ? (article.submenu || '') : (S.module !== 'all' && S.submenu !== 'all' && S.submenu !== GENERAL ? S.submenu : ''));
  $('kbVersion').value = article?.version || '';
  $('kbClient').value = article?.client || '';
  $('kbSummary').value = article?.summary || '';
  $('kbTags').value = (article?.tags || []).join(', ');
  $('kbContent').value = article ? (article.content || '') : TEMPLATE;
  fillClientSuggestions();
  setEditorHint('');
  setTab(defaultTab());

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

/* Editor views: write only, side by side (wide screens), or preview only */
let editorTab = null;
let previewTimer = null;

function defaultTab(){
  return window.innerWidth >= 1200 ? 'split' : 'write';
}

function refreshPreview(){
  const prev = $('kbPreview');
  if(!prev || !S.editing || prev.classList.contains('hidden')) return;
  const keepScroll = prev.scrollTop;
  prev.innerHTML = renderMarkdown($('kbContent').value) || '<p class="kb-muted">The preview appears here as you write.</p>';
  hydrateImages(prev, S.editing.id);
  prev.scrollTop = keepScroll;
}

function schedulePreview(){
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 200);
}

function setTab(tab){
  if(tab === 'split' && window.innerWidth < 1200) tab = 'write';
  editorTab = tab;
  document.querySelectorAll('#kbEditor [data-kb-tab]').forEach(b => {
    const on = b.dataset.kbTab === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const body = $('kbComposeBody');
  body.classList.toggle('is-split', tab === 'split');
  $('kbContent').classList.toggle('hidden', tab === 'preview');
  $('kbMdTools').classList.toggle('is-disabled', tab === 'preview');
  $('kbPreview').classList.toggle('hidden', tab === 'write');
  refreshPreview();
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
  if(!module){ setEditorHint('Choose a module (set them up with Edit menus).', true); $('kbModule').focus(); return; }

  const btn = $('kbSaveBtn');
  btn.disabled = true;
  setEditorHint('Menyimpan…');
  const now = Date.now();
  const data = {
    title, product, module,
    version: $('kbVersion').value.trim(),
    client: $('kbClient').value.trim(),
    submenu: $('kbSubmenu').value.trim(),
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
  if(S.editing){ S.editing.dirty = true; schedulePreview(); }
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

/* ---------------- menu structure editor ("Edit menus") ---------------- */
function openManager(product){
  if(S.editing) return;
  const draft = cloneStructure(S.structure);
  // baseline = names as they are today; renames are measured against it
  const baseline = cloneStructure(S.structure);
  const prefilled = new Set();
  // first time: start from what existing guides already use
  PRODUCT_KEYS.forEach(p => {
    if(!draft[p].length){
      const fromGuides = structureFromArticles(S.articles, p);
      if(fromGuides.length){ draft[p] = fromGuides; baseline[p] = cloneStructure({ [p]: fromGuides })[p]; prefilled.add(p); }
    }
  });
  const first = PRODUCT_KEYS.includes(product) ? product
    : (S.product !== 'all' ? S.product : 'erp');
  S.manage = { draft, baseline, product: first, prefilled, error: '' };
  S.selectedId = null;
  renderPane();
  document.querySelector('.content')?.scrollTo({ top: 0 });
}

function closeManager(){
  S.manage = null;
  render();
}

function managerList(){ return S.manage.draft[S.manage.product]; }

function managerAddModule(){
  managerList().push({ id: newId(), name: '', subs: [] });
  renderManager(`[data-mi="${managerList().length - 1}"]:not([data-si])`);
}

function managerMoveModule(i, d){
  const list = managerList(); const j = i + d;
  if(j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  renderManager(`[data-kb-act="${d < 0 ? 'mod-up' : 'mod-down'}"][data-i="${j}"]`);
}

async function managerDeleteModule(i){
  const m = managerList()[i];
  const orig = (S.manage.baseline[S.manage.product] || []).find(x => x.id === m.id);
  const used = orig ? usage(S.articles, S.manage.product, orig.name) : 0;
  if(used) return;   // button is disabled in this case
  managerList().splice(i, 1);
  renderManager();
}

function managerAddSub(i){
  const m = managerList()[i];
  m.subs.push({ id: newId(), name: '' });
  renderManager(`[data-mi="${i}"][data-si="${m.subs.length - 1}"]`);
}

function managerMoveSub(i, j, d){
  const subs = managerList()[i].subs; const k = j + d;
  if(k < 0 || k >= subs.length) return;
  [subs[j], subs[k]] = [subs[k], subs[j]];
  renderManager(`[data-kb-act="${d < 0 ? 'sub-up' : 'sub-down'}"][data-i="${i}"][data-j="${k}"]`);
}

function managerDeleteSub(i, j){
  const m = managerList()[i];
  const sub = m.subs[j];
  const original = (S.manage.baseline[S.manage.product] || []).find(x => x.id === m.id);
  const os = original?.subs.find(x => x.id === sub.id);
  const used = (original && os) ? usage(S.articles, S.manage.product, original.name, os.name) : 0;
  if(used) return;
  m.subs.splice(j, 1);
  renderManager();
}

function managerPrefill(){
  const p = S.manage.product;
  S.manage.draft[p] = structureFromArticles(S.articles, p);
  S.manage.baseline[p] = cloneStructure({ [p]: S.manage.draft[p] })[p];
  S.manage.prefilled.add(p);
  renderManager();
}

const MI = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
};

function renderManager(focusSel){
  const el = $('kbPane');
  if(!el || !S.manage) return;
  const p = S.manage.product;
  const list = managerList();
  const original = S.manage.baseline[p] || [];
  const iconBtn = (act, attrs, icon, label, disabled) =>
    `<button type="button" class="kb-mg-icon" data-kb-act="${act}" ${attrs} aria-label="${label}" title="${label}"${disabled ? ' disabled' : ''}>${icon}</button>`;

  const tabs = PRODUCT_KEYS.map(k => {
    const n = S.manage.draft[k].length;
    return `<button type="button" role="tab" class="kb-mg-tab${k === p ? ' is-active' : ''}" aria-selected="${k === p}" data-kb-act="manage-tab" data-p="${k}">
      <span class="kb-dot kb-dot-${k}" aria-hidden="true"></span>${escapeHtml(PRODUCTS[k].label)}<span class="kb-mg-tab-n">${n}</span></button>`;
  }).join('');

  const modules = list.map((m, i) => {
    const orig = original.find(x => x.id === m.id);
    // only items that exist today can be in use (new rows never are)
    const used = orig ? usage(S.articles, p, orig.name) : 0;
    const subs = m.subs.map((sub, j) => {
      const os = orig?.subs.find(x => x.id === sub.id);
      const subUsed = (orig && os) ? usage(S.articles, p, orig.name, os.name) : 0;
      return `<li class="kb-mg-sub">
        <span class="kb-mg-branch" aria-hidden="true"></span>
        <input class="input kb-mg-input kb-mg-input-sub" data-mi="${i}" data-si="${j}" value="${escapeHtml(sub.name)}" placeholder="Submenu name, e.g. Contacts" maxlength="60" aria-label="Submenu name">
        <span class="kb-mg-used">${subUsed ? `${subUsed} guide${subUsed === 1 ? '' : 's'}` : ''}</span>
        ${iconBtn('sub-up', `data-i="${i}" data-j="${j}"`, MI.up, 'Move up', j === 0)}
        ${iconBtn('sub-down', `data-i="${i}" data-j="${j}"`, MI.down, 'Move down', j === m.subs.length - 1)}
        ${iconBtn('sub-del', `data-i="${i}" data-j="${j}"`, MI.x, subUsed ? 'Used by guides: move them first' : 'Remove submenu', !!subUsed)}
      </li>`;
    }).join('');
    return `<li class="kb-mg-mod">
      <div class="kb-mg-row">
        <input class="input kb-mg-input" data-mi="${i}" value="${escapeHtml(m.name)}" placeholder="Module name, e.g. Master Data" maxlength="60" aria-label="Module name">
        <span class="kb-mg-used">${used ? `${used} guide${used === 1 ? '' : 's'}` : ''}</span>
        ${iconBtn('mod-up', `data-i="${i}"`, MI.up, 'Move up', i === 0)}
        ${iconBtn('mod-down', `data-i="${i}"`, MI.down, 'Move down', i === list.length - 1)}
        ${iconBtn('mod-del', `data-i="${i}"`, MI.x, used ? 'Used by guides: move them first' : 'Remove module', !!used)}
      </div>
      <ul class="kb-mg-subs">${subs}</ul>
      <button type="button" class="kb-mg-add kb-mg-add-sub" data-kb-act="sub-add" data-i="${i}">+ Add submenu</button>
    </li>`;
  }).join('');

  const guidesHere = S.articles.filter(a => a.product === p).length;
  const note = S.manage.prefilled.has(p)
    ? `<p class="kb-mg-note">Filled in from the modules your guides already use. Rename, reorder, or add to it, then save.</p>`
    : (!list.length && guidesHere ? `<p class="kb-mg-note">${guidesHere} guide${guidesHere === 1 ? '' : 's'} already exist for this product. <button type="button" class="kb-link-btn" data-kb-act="manage-prefill">Start from their modules</button></p>` : '');

  el.innerHTML = `<div class="kb-mg">
    <header class="kb-list-head">
      <div><h2>Edit menus</h2><p>Define the modules and submenus for each product. The guide editor offers exactly these.</p></div>
    </header>
    <div class="kb-mg-tabs" role="tablist" aria-label="Product">${tabs}</div>
    ${note}
    <ol class="kb-mg-mods">${modules || '<li class="kb-mg-empty">No modules yet.</li>'}</ol>
    <button type="button" class="kb-mg-add" data-kb-act="mod-add">+ Add module</button>
    <p class="kb-mg-error" id="kbMgError" role="alert">${escapeHtml(S.manage.error || '')}</p>
    <div class="kb-mg-foot">
      <span class="kb-mg-foot-note">Renaming updates every guide that uses the old name. Items used by guides can't be removed.</span>
      <button type="button" class="btn btn-secondary btn-sm" data-kb-act="manage-cancel">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" data-kb-act="manage-save" id="kbMgSave">Save menus</button>
    </div>
  </div>`;
  if(focusSel){ el.querySelector(focusSel)?.focus(); }
}

async function saveManager(){
  if(!S.manage) return;
  const draft = S.manage.draft;
  // trim + drop rows left completely empty
  PRODUCT_KEYS.forEach(p => {
    draft[p] = draft[p]
      .map(m => ({ ...m, name: String(m.name || '').replace(/\s+/g, ' ').trim(),
        subs: m.subs.map(x => ({ ...x, name: String(x.name || '').replace(/\s+/g, ' ').trim() })).filter(x => x.name) }))
      .filter(m => m.name || m.subs.length);
  });
  const errors = validateStructure(draft);
  if(errors.length){
    S.manage.product = errors[0].product;
    S.manage.error = errors[0].msg;
    renderManager();
    return;
  }
  const btn = $('kbMgSave');
  if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const updates = planRenames(S.manage.baseline, draft, S.articles);
    const now = Date.now();
    const batch = db.batch();
    batch.set(kbRef().doc(STRUCTURE_ID), { products: draft, updatedAt: now, updatedBy: userLabel() });
    updates.slice(0, 450).forEach(u => batch.update(kbRef().doc(u.id), { module: u.module, submenu: u.submenu, updatedAt: now, updatedBy: userLabel() }));
    await batch.commit();
    // renamed items: go back to the product level so the tree stays valid
    if(updates.length){ S.module = 'all'; S.submenu = 'all'; }
    S.structure = normalizeStructure({ products: draft });
    S.manage = null;
    toast(updates.length ? `Menus saved · ${updates.length} guide${updates.length === 1 ? '' : 's'} updated` : 'Menus saved');
    render();
  } catch(err){
    console.error(err);
    if(S.manage){
      S.manage.error = err.code === 'permission-denied'
        ? 'Firestore denied the save. Publish the latest firestore.rules.'
        : 'Could not save: ' + (err.message || err);
      renderManager();
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
      if(a === 'back') return backToList();
      if(a === 'manage') return openManager(act.dataset.kbManageProduct);
      if(a === 'manage-cancel') return closeManager();
      if(a === 'manage-save') return saveManager();
      if(a === 'manage-tab'){ S.manage.product = act.dataset.p; return renderManager(); }
      if(a === 'mod-add') return managerAddModule();
      if(a === 'mod-up' || a === 'mod-down') return managerMoveModule(+act.dataset.i, a === 'mod-up' ? -1 : 1);
      if(a === 'mod-del') return managerDeleteModule(+act.dataset.i);
      if(a === 'sub-add') return managerAddSub(+act.dataset.i);
      if(a === 'sub-up' || a === 'sub-down') return managerMoveSub(+act.dataset.i, +act.dataset.j, a === 'sub-up' ? -1 : 1);
      if(a === 'sub-del') return managerDeleteSub(+act.dataset.i, +act.dataset.j);
      if(a === 'manage-prefill') return managerPrefill();
      if(a === 'refresh-clients'){
        e.preventDefault();
        const h = $('kbClientHint'); if(h) h.textContent = 'loading clients…';
        loadRedmineClients(true).then(renderClientOptions);
        return;
      }
      if(a === 'clear-search'){ S.query = ''; const i = $('kbSearch'); if(i) i.value = ''; return render(); }
      if(a === 'save') return saveEditor();
      if(a === 'cancel') return cancelEditor();
    }
    const nav = t.closest('[data-kb-product]');
    if(nav){
      const p = nav.dataset.kbProduct;
      const m = nav.dataset.kbModule || 'all';
      const sm = nav.dataset.kbSubmenu || 'all';
      // clicking the open product again collapses it back to "All guides"
      if(!nav.dataset.kbModule && p !== 'all' && S.product === p && S.module === 'all' && !S.selectedId){ S.product = 'all'; }
      else { S.product = p; }
      S.module = S.product === 'all' ? 'all' : m;
      S.submenu = S.module === 'all' ? 'all' : sm;
      if(S.manage && !S.manage.error){ S.manage = null; }
      S.selectedId = null;
      try { history.replaceState(history.state, '', `${location.pathname}?view=kb`); } catch(_){}
      render();
      document.querySelector('.content')?.scrollTo({ top: 0 });
      return;
    }
    const cl = t.closest('[data-kb-client]');
    if(cl){
      // open the Redmine issues of this client (By Client view)
      if(typeof window.searchClientFromGlobal === 'function') window.searchClientFromGlobal(cl.dataset.kbClient);
      return;
    }
    const toc = t.closest('[data-kb-toc]');
    if(toc){ e.preventDefault(); return scrollPaneTo(document.getElementById(toc.dataset.kbToc)); }
    const open = t.closest('[data-kb-open]');
    if(open) return selectArticle(open.dataset.kbOpen);
    const md = t.closest('[data-kb-md]');
    if(md){ e.preventDefault(); return mdAction(md.dataset.kbMd); }
    const tab = t.closest('[data-kb-tab]');
    if(tab) return setTab(tab.dataset.kbTab);
  });

  root.addEventListener('input', (e) => {
    const inp = e.target.closest('.kb-mg-input');
    if(!inp || !S.manage) return;
    const i = +inp.dataset.mi;
    const list = managerList();
    if(inp.dataset.si != null) list[i].subs[+inp.dataset.si].name = inp.value;
    else list[i].name = inp.value;
    if(S.manage.error){ S.manage.error = ''; const er = $('kbMgError'); if(er) er.textContent = ''; }
  });
  root.addEventListener('keydown', (e) => {
    const inp = e.target.closest('.kb-mg-input');
    if(!inp || e.key !== 'Enter') return;
    e.preventDefault();
    managerAddSub(+inp.dataset.mi);   // Enter = next submenu of this module
  });

  $('kbSearch')?.addEventListener('input', (e) => {
    S.query = e.target.value;
    if(S.query.trim()) S.selectedId = null;   // typing always shows results
    render();
  });
  $('kbSearch')?.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && e.target.value){ e.stopPropagation(); e.target.value = ''; S.query = ''; render(); }
  });
  $('kbFilterSelect')?.addEventListener('change', (e) => {
    const [p, m, sm] = e.target.value.split('|').map(decodeURIComponent);
    S.product = p; S.module = m || 'all'; S.submenu = (S.module === 'all' ? 'all' : (sm || 'all')); S.selectedId = null;
    render();
  });

  const ta = $('kbContent');
  $('kbProduct')?.addEventListener('change', () => fillModuleSelect(''));
  $('kbModule')?.addEventListener('change', () => fillSubmenuSelect(''));
  ['kbTitle', 'kbProduct', 'kbModule', 'kbSubmenu', 'kbClient', 'kbVersion', 'kbSummary', 'kbTags', 'kbContent'].forEach(id => {
    $(id)?.addEventListener('input', markDirty);
    $(id)?.addEventListener('change', markDirty);
  });
  ta.addEventListener('input', schedulePreview);
  window.addEventListener('resize', () => {
    if(S.editing && editorTab === 'split' && window.innerWidth < 1200) setTab('write');
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
