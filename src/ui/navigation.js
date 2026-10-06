/**
 * Sidebar navigation, views & URL routing
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { $ } from '../core/helpers.js';
import { updateLastSync } from './sync-status.js';
import { refreshCounts } from '../features/dashboard.js';
import { updateBatchBar } from './batch-selection.js';
import { openTesterCategory, TESTER_CAT_LABELS } from '../features/tester/categories.js';
import { loadTesterReminder } from '../features/tester/queue.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { getIssueStatusDef } from '../features/issue-status.js';
import { openNewIssuesView, refreshDashNewIssueCounts } from '../features/new-issues.js';
import { openActiveWorkView } from '../features/active-work.js';
import { openWhatNextView, refreshDashAttention } from '../features/what-next.js';
import { renderNotes } from '../features/notes.js';
import { onDocsShown } from '../features/docs.js';
import { onKbShown } from '../features/kb.js';
import { onCreateIssueShown } from '../features/create-issue.js';

/* ============================================================
   NAVIGATION
   ============================================================ */
let currentView = 'dashboard';

const VIEW_META = {
  dashboard: { title:'Dashboard', sub:'Overview of your ERP update activity', addBtn:false },
  plans:     { title:'Update Plans', sub:'Manage plans & sync from Redmine', addBtn:true, addLabel:'Add New Plan' },
  summaries: { title:'Update Summaries', sub:'Summaries ready to share to the WA group', addBtn:true, addLabel:'Add New Summary' },
  tester:    { title:'Tester Queue', sub:'Issues Ready for Testing · filtered by category', addBtn:false },
  newissues:{ title:'Issue Status', sub:'New · On Progress · On Deploy · Rework · Feedback', addBtn:false },
  clients:  { title:'By Client', sub:'Search issues by Client Name', addBtn:false },
  activework:{ title:'Active Work', sub:'In Progress & On Deploy · who is working on what', addBtn:false },
  whatnext: { title:'What Next', sub:'Ranked New issues · which to work on first', addBtn:false },
  createissue:{ title:'New Issue', sub:'Create issue and push to Redmine', addBtn:false },
  notes:      { title:'Notes', sub:'Quick notes and reminders', addBtn:false },
  share:     { title:'Shared Plan', sub:'Read-only plan link', addBtn:false },
  settings:  { title:'Settings', sub:'Backup, restore, and data management', addBtn:false },
  docs:      { title:'Documentation', sub:'Complete guide to every feature', addBtn:false },
  kb:        { title:'Knowledge Base', sub:'How-to guides for Zahir ERP, ERP One & MRP', addBtn:false }
};

function toggleSyncPanel(force){
  const panel = $('syncPanel');
  const btn = $('btnToggleSyncPanel');
  if(!panel) return;
  const open = force !== undefined ? !!force : (panel.style.display === 'none' || !panel.style.display);
  // When display is '' (default visible after open), treat as open
  const currentlyOpen = panel.style.display !== 'none';
  const shouldOpen = force !== undefined ? !!force : !currentlyOpen;
  panel.style.display = shouldOpen ? '' : 'none';
  if(btn) btn.classList.toggle('active-sync', shouldOpen);
  if(shouldOpen){
    loadRedmineProjects();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function openPlansWithSync(){
  switchView('plans');
  setTimeout(()=> toggleSyncPanel(true), 60);
}

document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click', ()=> switchView(btn.dataset.view));
});


/* ============================================================
   URL ROUTING — shareable deep links
   Examples:
     /?view=dashboard
     /?view=tester&cat=frontend
     /?view=newissues
     /?view=activework
     /?view=whatnext
     /?view=plans
     /?view=summaries
     /?view=settings
   ============================================================ */
const VALID_VIEWS = new Set(['dashboard','plans','summaries','tester','newissues','activework','whatnext','createissue','notes','clients','share','settings','docs','kb']);
const VALID_TESTER_CATS = new Set(['all','frontend','backend','design','other']);
let __applyingRoute = false; // prevent pushState loop

function getRouteFromLocation(){
  const params = new URLSearchParams(window.location.search || '');
  // Support hash fallback: #/tester/frontend or #tester/frontend
  let view = (params.get('view') || '').toLowerCase().trim();
  let cat = (params.get('cat') || '').toLowerCase().trim();

  const hash = (window.location.hash || '').replace(/^#\/?/, '').trim();
  if(hash){
    const parts = hash.split('/').filter(Boolean);
    if(parts[0] && !view) view = parts[0].toLowerCase();
    if(parts[1] && !cat) cat = parts[1].toLowerCase();
  }

  if(!VALID_VIEWS.has(view)) view = 'dashboard';
  if(view === 'notes'){ try{ renderNotes(); }catch(_){ } }
  if(view === 'tester'){
    if(!VALID_TESTER_CATS.has(cat)) cat = window.__testerCategory || 'all';
  } else {
    cat = '';
  }
  return { view, cat };
}

function buildRouteUrl(view, cat){
  const params = new URLSearchParams();
  params.set('view', view || 'dashboard');
  if(view === 'tester' && cat) params.set('cat', cat);
  const qs = params.toString();
  return `${window.location.pathname}?${qs}`;
}

function syncUrlToRoute(view, cat, { replace = false } = {}){
  if(__applyingRoute) return;
  const url = buildRouteUrl(view, cat);
  const current = window.location.pathname + window.location.search;
  if(current === url) return;
  try {
    if(replace) history.replaceState({ view, cat }, '', url);
    else history.pushState({ view, cat }, '', url);
  } catch(err){
    console.warn('syncUrlToRoute', err);
  }
}

function applyRouteFromUrl({ replaceUrl = true } = {}){
  const { view, cat } = getRouteFromLocation();
  __applyingRoute = true;
  try {
    if(view === 'notes'){
      switchView('notes');
      try { renderNotes(); } catch(_){}
    } else if(view === 'tester'){
      // openTesterCategory will call switchView('tester')
      if(typeof openTesterCategory === 'function'){
        openTesterCategory(cat || 'all');
      } else {
        window.__testerCategory = cat || 'all';
        switchView('tester');
      }
    } else if(view === 'newissues' && typeof openNewIssuesView === 'function'){
      openNewIssuesView();
    } else if(view === 'activework' && typeof openActiveWorkView === 'function'){
      openActiveWorkView();
    } else if(view === 'whatnext' && typeof openWhatNextView === 'function'){
      openWhatNextView();
    } else {
      switchView(view);
    }
    if(replaceUrl) syncUrlToRoute(view, view === 'tester' ? (cat || window.__testerCategory || 'all') : '', { replace: true });
  } finally {
    __applyingRoute = false;
  }
}

function initRouter(){
  window.addEventListener('popstate', () => {
    applyRouteFromUrl({ replaceUrl: false });
  });
}

function switchView(view){
  currentView = view;
  try { updateBatchBar(); } catch(_){}
  // Keep URL in sync for shareable links
  try {
    const cat = view === 'tester' ? (window.__testerCategory || 'all') : '';
    syncUrlToRoute(view, cat);
  } catch(_){}
  document.querySelectorAll('.nav-item').forEach(b => {
    if(view === 'tester' && b.dataset.testerCat){
      b.classList.toggle('active', b.dataset.testerCat === (window.__testerCategory || 'all'));
    } else if(view === 'newissues' && b.dataset.issueStatus){
      b.classList.toggle('active', b.dataset.issueStatus === (window.__issueStatusKey || 'new'));
    } else if(b.dataset.testerCat || b.dataset.issueStatus){
      b.classList.remove('active');
    } else {
      b.classList.toggle('active', b.dataset.view === view);
    }
  });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-'+view));
  if(view === 'dashboard'){
    try { refreshDashNewIssueCounts(); } catch(_){}
    try { refreshDashAttention(false); } catch(_){}
  }
  const meta = VIEW_META[view] || VIEW_META.dashboard;
  if(view === 'newissues' && typeof getIssueStatusDef === 'function'){
    const def = getIssueStatusDef(window.__issueStatusKey || 'new');
    $('pageTitle').textContent = def.label;
    $('pageSubtitle').textContent = `Status "${def.label}" · Zahir ERP / One / Manufacturing`;
  } else {
    $('pageTitle').textContent = meta.title;
    $('pageSubtitle').textContent = meta.sub;
  }

  const btn = $('btnAdd');
  if(meta.addBtn){
    btn.classList.remove('hidden');
    btn.querySelector('.btn-text').textContent = meta.addLabel;
  } else {
    btn.classList.add('hidden');
  }

  if(window.innerWidth <= 860) toggleSidebar(false);
  refreshCounts();
  if(view === 'settings') updateLastSync();
  if(view === 'docs'){ try { onDocsShown(); } catch(_){} }
  if(view === 'kb'){ try { onKbShown(); } catch(e){ console.error('kb', e); } }
  if(view === 'createissue'){ try { onCreateIssueShown(); } catch(e){ console.error('create issue', e); } }
  if(view === 'plans') loadRedmineProjects();
  if(view === 'notes'){ try{ renderNotes(); }catch(_){ } }
  if(view === 'tester'){
    const cat = window.__testerCategory || 'all';
    const label = TESTER_CAT_LABELS[cat] || 'Tester Queue';
    if($('pageTitle')) $('pageTitle').textContent = label;
    if($('pageSubtitle')) $('pageSubtitle').textContent = 'Ready for Testing · ' + label;
    if($('testerCategoryTitle')) $('testerCategoryTitle').textContent = label + ' · Ready for Testing';
    loadTesterReminder();
  }
}

const SIDEBAR_COLLAPSED_KEY = 'erp_sidebar_collapsed';
const MOBILE_BREAKPOINT = 860;

function isMobileLayout(){
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/* Desktop: collapse to an icon-only rail (remembered across visits).
 * Labels become native tooltips so the menu stays usable when collapsed. */
function setSidebarCollapsed(collapsed, { persist = true } = {}){
  document.body.classList.toggle('sidebar-collapsed', !!collapsed);
  document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
    const label = btn.querySelector('.label')?.textContent?.trim() || '';
    if(collapsed && label) btn.setAttribute('title', label);
    else btn.removeAttribute('title');
  });
  const tg = $('menuToggle');
  if(tg){
    tg.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    tg.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
  if(persist){
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch(_){}
  }
}

/* Tooltip = label + count, built on hover so it always shows the latest number */
function navTooltip(btn){
  const label = btn.querySelector('.label')?.textContent?.trim() || '';
  const countEl = btn.querySelector('.count');
  const n = countEl && countEl.dataset.zero !== '1' ? countEl.textContent.trim() : '';
  return n ? `${label} (${n})` : label;
}

function initSidebarCollapse(){
  const sb = $('sidebar');
  if(sb && !sb.dataset.tipWired){
    sb.dataset.tipWired = '1';
    sb.addEventListener('mouseover', (e) => {
      if(!document.body.classList.contains('sidebar-collapsed')) return;
      const btn = e.target.closest('.nav-item');
      if(btn) btn.setAttribute('title', navTooltip(btn));
    });
  }
  let saved = false;
  try { saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch(_){}
  setSidebarCollapsed(saved, { persist: false });
}

function toggleSidebar(force){
  // Desktop hamburger → collapse / expand the rail
  if(force === undefined && !isMobileLayout()){
    setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
    return;
  }
  // Mobile → slide-in drawer (unchanged)
  const sb = $('sidebar'), ov = $('overlay');
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov.classList.toggle('show', open);
}

export {
  initSidebarCollapse,
  setSidebarCollapsed,
  applyRouteFromUrl,
  currentView,
  initRouter,
  openPlansWithSync,
  switchView,
  syncUrlToRoute,
  toggleSidebar,
  toggleSyncPanel
};
