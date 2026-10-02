/**
 * Application logic (modular entry — imported from main.js)
 * Large UI/feature surface kept cohesive; shared pieces live in sibling modules.
 */
import { APP_VERSION, APP_VERSION_DATE, APP_VERSION_NOTE, RFT_STATUS_CACHE_KEY, MIGRATE_SNAP_KEY, REDMINE_STORAGE_KEY } from './config.js';
import { ICON } from './icons.js';
import { auth, db } from './firebase.js';

/* ============================================================
   ZAHIR ERP UPDATE MANAGER — APP LOGIC
   ============================================================ */

/* APP_VERSION imported from ./config.js */
/* Plan list filter state */
window.__planFilter = window.__planFilter || 'all';
window.__expandedPlans = window.__expandedPlans || new Set();

/* Firebase: auth & db from initFirebase() in main.js */
/* ============================================================
   REDMINE STATE
   ============================================================ */
const RedmineState = {
  projects: [],
  selectedProjectId: null,
  loaded: false
};


/* Track which copy dropdown is currently open (survives re-render) */
window.__openCopyMenuId = window.__openCopyMenuId || null;

/* ============================================================
   HELPERS
   ============================================================ */
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const todayISO = () => new Date().toISOString().split('T')[0];

function toast(msg, type='info'){
  const t = $('toast');
  if(!t) return;
  const icons = {
    error: '✕',
    success: '✓',
    info: 'ℹ'
  };
  const icon = icons[type] || icons.info;
  t.className = 'toast show' + (type === 'error' ? ' error' : type === 'success' ? ' success' : type === 'info' ? ' info' : '');
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  clearTimeout(window.__toastTimer);
  const ms = type === 'error' ? 5200 : type === 'success' ? 3800 : 3200;
  window.__toastTimer = setTimeout(() => { t.classList.remove('show'); }, ms);
}

/** Disable button + show loading label while async work runs */
async function withBusy(btn, label, fn){
  if(!btn) return fn();
  const prev = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('is-busy');
  if(label) btn.innerHTML = `<span class="spinner-sm"></span> ${escapeHtml(label)}`;
  try {
    return await fn();
  } finally {
    btn.disabled = wasDisabled;
    btn.classList.remove('is-busy');
    btn.innerHTML = prev;
  }
}

function formatDate(iso){
  if(!iso) return '-';
  if(typeof iso === 'object' && iso.seconds){
    iso = new Date(iso.seconds * 1000).toISOString().split('T')[0];
  }
  if(typeof iso !== 'string' || !iso.includes('-')) return String(iso);
  const [y,m,d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function countIssues(text){
  return (text||'').split('\n').map(s=>s.trim()).filter(Boolean).length;
}

function extractIssueNumber(url){
  if(!url) return '';
  const m = String(url).match(/issues\/(\d+)/);
  return m ? m[1] : '';
}

function parseIssueLine(line){
  if(!line) return { url:'', description:'', category:'', tracker:'' };
  const trimmed = String(line).trim();
  const parts = trimmed.split('|').map(s => s.trim());
  if(parts.length >= 2){
    return {
      url: parts[0] || '',
      description: parts[1] || '',
      category: parts[2] || '',
      tracker: parts[3] || ''
    };
  }
  return { url: trimmed, description: '', category: '', tracker: '' };
}

function inferCategoryFromText(text){
  // Only strong prefixes at the START of the subject — never match words mid-sentence
  const s = String(text || '').trim();
  if(!s) return '';
  if(/^(FE|Front\s*-?\s*End)([\s\-–—:,.]|$)/i.test(s)) return 'Front End';
  if(/^(BE|Back\s*-?\s*End)([\s\-–—:,.]|$)/i.test(s)) return 'Backend';
  if(/^(DE|Design)([\s\-–—:,.]|$)/i.test(s)) return 'Design';
  return '';
}

function parseIssueLines(text){
  return (text||'').split('\n').map(s=>s.trim()).filter(Boolean).map(line => {
    const { url, description, category, tracker } = parseIssueLine(line);
    const number = extractIssueNumber(url);
    const cat = resolveIssueCategory(number, category, description);
    const trk = resolveIssueTracker(number, tracker, description);
    return { url, description, category: cat, tracker: trk, number };
  });
}

/** Cache Redmine category + tracker by issue id */
function rememberIssueMeta(issues){
  if(!window.__issueCategoryById) window.__issueCategoryById = {};
  if(!window.__issueTrackerById) window.__issueTrackerById = {};
  (issues || []).forEach(i => {
    if(!i || i.id == null) return;
    const id = String(i.id);
    const cat = i.category?.name;
    if(cat && String(cat).trim()) window.__issueCategoryById[id] = String(cat).trim();
    const tr = i.tracker?.name;
    if(tr && String(tr).trim()) window.__issueTrackerById[id] = String(tr).trim();
  });
}

function rememberIssueCategories(issues){
  rememberIssueMeta(issues);
}

function resolveIssueCategory(number, storedCategory, description){
  if(storedCategory && String(storedCategory).trim()) return String(storedCategory).trim();
  const id = number != null ? String(number) : '';
  if(id && window.__issueCategoryById && window.__issueCategoryById[id]){
    return window.__issueCategoryById[id];
  }
  return inferCategoryFromText(description) || '';
}

function resolveIssueTracker(number, storedTracker, description){
  if(storedTracker && String(storedTracker).trim()) return String(storedTracker).trim();
  const id = number != null ? String(number) : '';
  if(id && window.__issueTrackerById && window.__issueTrackerById[id]){
    return window.__issueTrackerById[id];
  }
  return '';
}

/** Classify for summary sections: feature / enhancement / optimization / bug / other */
function classifyIssueKind(trackerName, subject){
  const t = String(trackerName || '').toLowerCase().trim();
  const s = String(subject || '').toLowerCase().trim();

  // --- Tracker name (authoritative when present) ---
  if(t){
    if(/bug|defect|hotfix|error/.test(t)) return 'bug';
    if(/optim/.test(t)) return 'optimization';
    if(/enhanc|improve/.test(t)) return 'enhancement';
    if(/new\s*feature|feature|story|epic/.test(t)) return 'feature';
    if(/task|support|concept|documentation|doc/.test(t)) return 'other';
    // Unknown tracker name — still try subject, else other
  }

  // --- Subject heuristics (ID + EN) ---
  if(/\b(bug|defect|error|fix|gagal|tidak\s*(bisa|muncul|tampil)|broken|crash|exception|eror)\b/.test(s)
      || /^(fix|perbaiki|perbaikan)\b/.test(s)) return 'bug';
  if(/\b(optimasi|optimization|performance|perf|percepat|ringan(kan)?)\b/.test(s)) return 'optimization';
  if(/\b(enhance|enhancement|improvement|penyesuaian|sesuaikan|perbaiki\s*ui|ux)\b/.test(s)
      || /^(penyesuaian|sesuaikan)\b/.test(s)) return 'enhancement';
  if(/\b(new\s*feature|fitur\s*baru|penambahan|tambah(kan)?\s|implementasi)\b/.test(s)
      || /^(tambah|penambahan|implementasi|fitur)\b/.test(s)) return 'feature';

  // No signal → Other (do NOT dump everything into New Features)
  return 'other';
}

const ISSUE_KIND_META = {
  feature:      { title: 'New Features', emoji: '✨', order: 1 },
  enhancement:  { title: 'Enhancements', emoji: '🔧', order: 2 },
  optimization: { title: 'Optimizations', emoji: '⚡', order: 3 },
  bug:          { title: 'Bug Fixes', emoji: '🐛', order: 4 },
  other:        { title: 'Other', emoji: '📌', order: 5 }
};

function groupIssuesByKind(issueLines){
  const groups = { feature:[], enhancement:[], optimization:[], bug:[], other:[] };
  issueLines.forEach(it => {
    const kind = classifyIssueKind(it.tracker, it.desc || it.description);
    (groups[kind] || groups.other).push(it);
  });
  return groups;
}

function formatGroupedIssueSections(issueLines, lineFn){
  const groups = groupIssuesByKind(issueLines);
  const order = ['feature','enhancement','optimization','bug','other'];
  let out = '';
  order.forEach(k => {
    const list = groups[k];
    if(!list || !list.length) return;
    const meta = ISSUE_KIND_META[k];
    out += `${meta.emoji} *${meta.title}*\n`;
    list.forEach(it => { out += lineFn(it) + '\n'; });
    out += '\n';
  });
  return out.trimEnd();
}


/* ICON imported from ./icons.js */
/* ============================================================
   STATE
   ============================================================ */
const State = {
  _plans: [],
  _summaries: [],
  plans: {
    all(){ return State._plans; },
    get(id){ return State._plans.find(x => x.id === id); },
    set(arr){ State._plans = arr; }
  },
  summaries: {
    all(){ return State._summaries; },
    get(id){ return State._summaries.find(x => x.id === id); },
    set(arr){ State._summaries = arr; }
  }
};

/* ============================================================
   CLOUD SYNC
   ============================================================ */
const CloudSync = {
  uid: null,
  plansRef: null,
  summariesRef: null,
  unsubPlans: null,
  unsubSummaries: null,

  workspaceId: null,

  async init(uid){
    this.uid = uid;
    const uidEl = $('userUID');
    if(uidEl) uidEl.textContent = uid;

    // Resolve shared workspace (team) or personal default
    this.workspaceId = await this.resolveWorkspaceId(uid);
    this.plansRef = db.collection('workspaces').doc(this.workspaceId).collection('plans');
    this.summariesRef = db.collection('workspaces').doc(this.workspaceId).collection('summaries');

    // One-time migrate from legacy users/{uid}/… if workspace is empty
    await this.maybeMigrateLegacyUserData(uid);

    const wsEl = $('workspaceIdLabel');
    if(wsEl) wsEl.textContent = this.workspaceId;

    setSyncStatus('syncing', 'Syncing');
    await this.pullAll();
    this.subscribe();
    setSyncStatus('online', 'Synced');
    updateLastSync();
  },

  async resolveWorkspaceId(uid){
    try {
      const userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();
      let ws = snap.exists ? (snap.data().workspaceId || null) : null;
      if(!ws){
        try { ws = localStorage.getItem('erp_workspace_id') || null; } catch(_){}
      }
      if(!ws) ws = uid; // personal workspace = uid
      await userRef.set({
        workspaceId: ws,
        email: (auth.currentUser && auth.currentUser.email) || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      try { localStorage.setItem('erp_workspace_id', ws); } catch(_){}
      return ws;
    } catch(err){
      console.warn('resolveWorkspaceId', err);
      return uid;
    }
  },

  async maybeMigrateLegacyUserData(uid){
    try {
      const [wsPlans, legacyPlans] = await Promise.all([
        this.plansRef.limit(1).get(),
        db.collection('users').doc(uid).collection('plans').limit(1).get()
      ]);
      if(!wsPlans.empty || legacyPlans.empty) return;
      // Copy legacy personal data into workspace
      const [allPlans, allSums] = await Promise.all([
        db.collection('users').doc(uid).collection('plans').get(),
        db.collection('users').doc(uid).collection('summaries').get()
      ]);
      const batch = db.batch();
      allPlans.docs.forEach(d => batch.set(this.plansRef.doc(d.id), d.data(), { merge: true }));
      allSums.docs.forEach(d => batch.set(this.summariesRef.doc(d.id), d.data(), { merge: true }));
      await batch.commit();
      console.log('Migrated legacy user data → workspace', this.workspaceId);
      toast('Personal data moved into workspace');
    } catch(err){
      console.warn('legacy migrate skipped', err);
    }
  },

  async joinWorkspace(code){
    const id = String(code || '').trim();
    if(!id){
      toast('Enter a workspace code', 'error');
      return;
    }
    if(!this.uid){
      toast('Sign in first', 'error');
      return;
    }
    setSyncStatus('syncing', 'Switching workspace');
    try {
      await db.collection('users').doc(this.uid).set({ workspaceId: id }, { merge: true });
      try { localStorage.setItem('erp_workspace_id', id); } catch(_){}
      // Re-bind listeners
      if(this.unsubPlans) this.unsubPlans();
      if(this.unsubSummaries) this.unsubSummaries();
      await this.init(this.uid);
      toast('Joined workspace: ' + id);
    } catch(err){
      console.error(err);
      setSyncStatus('error', 'Workspace error');
      toast(err.message || 'Could not join workspace', 'error');
    }
  },

  async usePersonalWorkspace(){
    if(!this.uid) return;
    await this.joinWorkspace(this.uid);
  },

  async pullAll(){
    try {
      setSyncStatus('syncing', 'Syncing');
      const [plansSnap, sumsSnap] = await Promise.all([
        this.plansRef.get(),
        this.summariesRef.get()
      ]);
      State.plans.set(plansSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      State.summaries.set(sumsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderAll();
      setSyncStatus('online', 'Synced');
      updateLastSync();
      toast('Data synced from cloud');
    } catch(err){
      console.error('Pull failed:', err);
      setSyncStatus('error', 'Sync error');
      toast('Failed to load from cloud', 'error');
    }
  },

  subscribe(){
    if(this.unsubPlans) this.unsubPlans();
    if(this.unsubSummaries) this.unsubSummaries();

    this.unsubPlans = this.plansRef.onSnapshot(snap => {
      State.plans.set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderPlans();
      refreshCounts();
      setSyncStatus('online', 'Synced');
      updateLastSync();
    }, err => {
      console.error('Plans snapshot error:', err);
      setSyncStatus('error', 'Sync error');
    });

    this.unsubSummaries = this.summariesRef.onSnapshot(snap => {
      State.summaries.set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderSummaries();
      renderPlans();
      refreshCounts();
      setSyncStatus('online', 'Synced');
      updateLastSync();
    }, err => {
      console.error('Summaries snapshot error:', err);
      setSyncStatus('error', 'Sync error');
    });
  },

  async addPlan(data){
    setSyncStatus('syncing', 'Saving');
    try {
      const ref = await this.plansRef.add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
      return ref.id;
    } catch(err){
      console.error('addPlan failed:', err);
      setSyncStatus('error', 'Save error');
      throw err;
    }
  },

  async updatePlan(id, data){
    setSyncStatus('syncing', 'Saving');
    try {
      await this.plansRef.doc(id).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('updatePlan failed:', err);
      setSyncStatus('error', 'Update error');
      throw err;
    }
  },

  async deletePlan(id){
    setSyncStatus('syncing', 'Deleting');
    try {
      const linked = State.summaries.all().filter(s => s.planId === id);
      const batch = db.batch();
      batch.delete(this.plansRef.doc(id));
      linked.forEach(s => batch.delete(this.summariesRef.doc(s.id)));
      await batch.commit();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('deletePlan failed:', err);
      setSyncStatus('error', 'Delete error');
      throw err;
    }
  },

  async addSummary(data){
    setSyncStatus('syncing', 'Saving');
    try {
      const ref = await this.summariesRef.add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
      return ref.id;
    } catch(err){
      console.error('addSummary failed:', err);
      setSyncStatus('error', 'Save error');
      throw err;
    }
  },

  async updateSummary(id, data){
    setSyncStatus('syncing', 'Saving');
    try {
      await this.summariesRef.doc(id).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('updateSummary failed:', err);
      setSyncStatus('error', 'Update error');
      throw err;
    }
  },

  async deleteSummary(id){
    setSyncStatus('syncing', 'Deleting');
    try {
      await this.summariesRef.doc(id).delete();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('deleteSummary failed:', err);
      setSyncStatus('error', 'Delete error');
      throw err;
    }
  },

  async bulkImport(plans, summaries){
    setSyncStatus('syncing', 'Importing');
    try {
      const batch = db.batch();
      plans.forEach(p => {
        const id = p.id || uid();
        batch.set(this.plansRef.doc(id), { ...p, id });
      });
      summaries.forEach(s => {
        const id = s.id || uid();
        batch.set(this.summariesRef.doc(id), { ...s, id });
      });
      await batch.commit();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('bulkImport failed:', err);
      setSyncStatus('error', 'Import error');
      throw err;
    }
  },

  async wipeAll(){
    setSyncStatus('syncing', 'Clearing');
    try {
      const [plansSnap, sumsSnap] = await Promise.all([
        this.plansRef.get(),
        this.summariesRef.get()
      ]);
      const batch = db.batch();
      plansSnap.docs.forEach(d => batch.delete(d.ref));
      sumsSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('wipeAll failed:', err);
      setSyncStatus('error', 'Clear error');
      throw err;
    }
  }
};

/* ============================================================
   SYNC STATUS UI
   ============================================================ */
function setSyncStatus(status, label){
  const ind = $('syncIndicator');
  const dot = $('statusDot');
  const pill = $('cloudStatusPill');
  const pillText = $('cloudStatusText');

  if(ind){
    ind.className = 'sync-indicator ' + (status === 'online' ? '' : status);
    const lbl = $('syncLabel');
    if(lbl) lbl.textContent = label;
  }
  if(dot){
    dot.className = 'dot-status ' + (status === 'online' ? '' : status);
    dot.textContent = status === 'online' ? 'Synced' : (status === 'syncing' ? 'Syncing' : 'Error');
  }
  if(pill){
    pill.className = 'status-pill ' + (status === 'online' ? '' : (status === 'syncing' ? 'syncing' : 'error'));
    if(pillText){
      pillText.textContent = status === 'online' ? 'Connected'
        : status === 'syncing' ? 'Syncing'
        : status === 'offline' ? 'Offline'
        : 'Error';
    }
  }
}

function setRedmineStatus(status, label){
  const pill = $('redmineStatusPill');
  const text = $('redmineStatusText');
  if(!pill || !text) return;
  if(status === 'loading'){
    pill.className = 'status-pill syncing';
    text.textContent = label || 'Loading';
  } else if(status === 'error'){
    pill.className = 'status-pill error';
    text.textContent = label || 'Error';
  } else {
    pill.className = 'status-pill';
    text.textContent = label || 'Ready';
  }
}

function updateLastSync(){
  const el = $('lastSyncTime');
  if(!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  el.textContent = `${hh}:${mm}:${ss}`;
}

function copyUID(){
  const uidText = $('userUID')?.textContent;
  if(!uidText || uidText === '—') return;
  navigator.clipboard.writeText(uidText).then(()=>{
    toast('UID copied to clipboard');
  }).catch(()=>{
    toast('Failed to copy', 'error');
  });
}

/* ============================================================
   THEME MANAGER
   ============================================================ */
const ThemeManager = {
  STORAGE_KEY: 'zahir-theme',
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
  getPreference(){ return localStorage.getItem(this.STORAGE_KEY) || 'auto'; },
  resolve(pref){ return pref === 'auto' ? (this.mediaQuery.matches ? 'dark' : 'light') : pref; },
  apply(pref){
    const resolved = this.resolve(pref);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-pref', pref);
    localStorage.setItem(this.STORAGE_KEY, pref);
    this.updateUI(pref);
  },
  updateUI(pref){
    document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('active', b.dataset.themeSet === pref));
  },
  init(){
    this.apply(this.getPreference());
    this.mediaQuery.addEventListener('change', ()=>{
      if(this.getPreference() === 'auto'){
        document.documentElement.setAttribute('data-theme', this.resolve('auto'));
      }
    });
    document.querySelectorAll('[data-theme-set]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        this.apply(btn.dataset.themeSet);
        toast(`Switched to ${btn.dataset.themeSet} theme`);
      });
    });
  }
};

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */
let _confirmResolve = null;

function confirmDialog(opts){
  return new Promise(resolve => {
    const overlay = $('confirmModal');
    const box = $('confirmBox');
    const icon = $('confirmIcon');
    const titleEl = $('confirmTitle');
    const msgEl = $('confirmMessage');
    const okBtn = $('confirmOkBtn');
    const cancelBtn = $('confirmCancelBtn');

    const type = opts.type || 'warning';
    box.classList.toggle('danger', type === 'danger');
    icon.innerHTML = type === 'danger' ? ICON.danger : ICON.warning;
    titleEl.textContent = opts.title || 'Are you sure?';
    msgEl.innerHTML = opts.message || 'This action cannot be undone.';
    okBtn.textContent = opts.okText || 'Confirm';
    cancelBtn.textContent = opts.cancelText || 'Cancel';

    okBtn.className = 'btn ' + (type === 'danger' ? 'btn-danger-solid' : 'btn-primary');

    _confirmResolve = resolve;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(()=> okBtn.focus(), 50);
  });
}

function _closeConfirm(result){
  const overlay = $('confirmModal');
  overlay.classList.remove('show');
  document.body.style.overflow = '';
  if(_confirmResolve){
    _confirmResolve(result);
    _confirmResolve = null;
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
let currentView = 'dashboard';

const VIEW_META = {
  dashboard: { title:'Dashboard', sub:'Overview of your ERP update activity', addBtn:false },
  plans:     { title:'Update Plans', sub:'Manage plans & sync from Redmine', addBtn:true, addLabel:'Add New Plan' },
  summaries: { title:'Update Summaries', sub:'Summaries ready to share to the WA group', addBtn:true, addLabel:'Add New Summary' },
  tester:    { title:'Tester Queue', sub:'Issues Ready for Testing · filtered by category', addBtn:false },
  newissues:{ title:'New Issues', sub:'Filter by status · Zahir ERP One, Zahir ERP, Manufacturing', addBtn:false },
  activework:{ title:'Active Work', sub:'In Progress & On Deploy · who is working on what', addBtn:false },
  whatnext: { title:'What Next', sub:'Ranked New issues · which to work on first', addBtn:false },
  createissue:{ title:'New Issue', sub:'Create issue and push to Redmine', addBtn:false },
  share:     { title:'Shared Plan', sub:'Read-only plan link', addBtn:false },
  settings:  { title:'Settings', sub:'Backup, restore, and data management', addBtn:false }
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
const VALID_VIEWS = new Set(['dashboard','plans','summaries','tester','newissues','activework','whatnext','createissue','share','settings']);
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
    if(view === 'tester'){
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
  // Keep URL in sync for shareable links
  try {
    const cat = view === 'tester' ? (window.__testerCategory || 'all') : '';
    syncUrlToRoute(view, cat);
  } catch(_){}
  document.querySelectorAll('.nav-item').forEach(b => {
    if(view === 'tester' && b.dataset.testerCat){
      b.classList.toggle('active', b.dataset.testerCat === (window.__testerCategory || 'frontend'));
    } else {
      b.classList.toggle('active', b.dataset.view===view && !b.dataset.testerCat);
    }
  });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-'+view));
  if(view === 'dashboard'){
    try { refreshDashNewIssueCounts(); } catch(_){}
  }
  const meta = VIEW_META[view] || VIEW_META.dashboard;
  $('pageTitle').textContent = meta.title;
  $('pageSubtitle').textContent = meta.sub;

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
  if(view === 'plans') loadRedmineProjects();
  if(view === 'tester'){
    const cat = window.__testerCategory || 'all';
    const label = TESTER_CAT_LABELS[cat] || 'Tester Queue';
    if($('pageTitle')) $('pageTitle').textContent = label;
    if($('pageSubtitle')) $('pageSubtitle').textContent = 'Ready for Testing · ' + label;
    if($('testerCategoryTitle')) $('testerCategoryTitle').textContent = label + ' · Ready for Testing';
    loadTesterReminder();
  }
}

function toggleSidebar(force){
  const sb = $('sidebar'), ov = $('overlay');
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov.classList.toggle('show', open);
}

/* ============================================================
   MODAL CONTROL
   ============================================================ */
function openModal(id){ $(id).classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeModal(id){ $(id).classList.remove('show'); document.body.style.overflow = ''; }

/* ============================================================
   ADD NEW
   ============================================================ */
function openAddModal(event){
  if(event) event.preventDefault();
  if(currentView === 'plans'){
    resetPlanForm();
    $('planModalTitle').textContent = 'Add Update Plan';
    openModal('planModal');
  } else if(currentView === 'summaries'){
    resetSummaryForm();
    $('summaryModalTitle').textContent = 'Add Summary';
    populatePlanDropdown();
    openModal('summaryModal');
  } else {
    switchView('plans');
    setTimeout(()=>{
      resetPlanForm();
      $('planModalTitle').textContent = 'Add Update Plan';
      openModal('planModal');
    }, 50);
  }
}

/* ============================================================
   EXPAND/COLLAPSE PLAN CARD
   ============================================================ */
window.__expandedPlans = window.__expandedPlans || new Set();

async function togglePlanCard(planId, event){
  if(event){
    event.stopPropagation();
  }
  if(window.__expandedPlans.has(planId)){
    window.__expandedPlans.delete(planId);
    renderPlans();
    return;
  }
  window.__expandedPlans.add(planId);
  renderPlans(); // expand immediately
  const plan = State.plans.get(planId);
  if(plan){
    const updated = await enrichPlanIssueCategories(plan);
    if(updated) renderPlans(); // refresh labels from Redmine category cache
  }
}

/* ============================================================
   COPY DROPDOWN
   ============================================================ */
function buildCopyText(plan, format){
  const parsed = parseIssueLines(plan.issues);
  const title = plan.title || 'Update Plan';
  const dateStr = formatDate(plan.date);

  if(format === 'plain') {
    return parsed.map(p => p.url).join('\n');
  }

  if(format === 'numbered'){
    let out = `${title}\n`;
    out += `Date: ${dateStr}\n`;
    out += `Total: ${parsed.length} issues\n\n`;
    parsed.forEach((p, i)=>{
      const num = p.number || '—';
      out += `${i+1}. [#${num}] ${p.url}\n`;
    });
    return out.trim();
  }

  if(format === 'markdown'){
    let out = `*${title}*\n`;
    out += `_${dateStr} · ${parsed.length} issues_\n\n`;
    parsed.forEach((p)=>{
      const num = p.number || '—';
      out += `• [#${num}](${p.url})\n`;
    });
    return out.trim();
  }

  if(format === 'telegram-links'){
    // SDET: links only
    let out = `📋 *${title}*\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${parsed.length} issues\n\n`;
    parsed.forEach((p)=>{ out += `${p.url}\n`; });
    return out.trim();
  }

  if(format === 'telegram-full' || format === 'telegram'){
    // Link + description
    let out = `📋 *${title}*\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${parsed.length} issues\n\n`;
    parsed.forEach((p)=>{
      out += `${p.url}\n`;
      if(p.description) out += `${p.description}\n`;
      out += `\n`;
    });
    return out.trim();
  }

  return parsed.map(p => p.url).join('\n');
}

async function copyPlan(id, format){
  const plan = State.plans.get(id);
  if(!plan){ toast('Plan not found', 'error'); return; }
  const text = buildCopyText(plan, format);
  if(!text){ toast('No content to copy', 'error'); return; }

  const formatLabels = {
    plain: 'Plain URLs',
    numbered: 'Numbered list',
    markdown: 'Markdown links',
    telegram: 'Telegram (link + desc)',
    'telegram-links': 'Telegram (links only)',
    'telegram-full': 'Telegram (link + desc)'
  };

  try {
    await navigator.clipboard.writeText(text);
    toast(`${formatLabels[format]} copied — ready to paste`);
  } catch(e){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(`${formatLabels[format]} copied`);
    } catch(err){
      toast('Failed to copy', 'error');
    }
    ta.remove();
  }
  closeAllCopyMenus();
}

function toggleCopyMenu(btn, event){
  if(event){
    event.stopPropagation();
    if(event.preventDefault) event.preventDefault();
  }

  const wrapper = btn.closest('.copy-menu-wrap');
  if(!wrapper) return;

  const planId = btn.getAttribute('data-plan-id');
  const menu = wrapper.querySelector('.copy-menu');
  const card = btn.closest('.plan-card');
  const isOpen = menu.classList.contains('open');

  if(isOpen && window.__openCopyMenuId === planId){
    closeAllCopyMenus();
    return;
  }

  closeAllCopyMenus();
  menu.classList.add('open');
  btn.classList.add('active');
  wrapper.classList.add('is-open');
  if(card) card.classList.add('menu-open');
  window.__openCopyMenuId = planId;
}

function closeAllCopyMenus(){
  document.querySelectorAll('.copy-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.copy-menu-wrap .btn.active').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.copy-menu-wrap.is-open').forEach(w => w.classList.remove('is-open'));
  document.querySelectorAll('.plan-card.menu-open').forEach(c => c.classList.remove('menu-open'));
  window.__openCopyMenuId = null;
}

function restoreOpenCopyMenu(){
  const openId = window.__openCopyMenuId;
  if(!openId) return;

  const btn = document.querySelector(`.copy-menu-wrap .btn[data-plan-id="${openId}"]`);
  if(!btn){ window.__openCopyMenuId = null; return; }

  const wrapper = btn.closest('.copy-menu-wrap');
  const menu = wrapper?.querySelector('.copy-menu');
  const card = btn.closest('.plan-card');
  if(menu){
    menu.classList.add('open');
    btn.classList.add('active');
    wrapper.classList.add('is-open');
    if(card) card.classList.add('menu-open');
  }
}

document.addEventListener('click', (e) => {
  if(e.target.closest('.copy-menu-wrap')) return;
  closeAllCopyMenus();
});

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){
    closeAllCopyMenus();
  }
});

/* ============================================================
   ISSUE EDITOR
   ============================================================ */
function addIssueRow(fullLine){
  const body = $('issueEditorBody');
  if(!body) return;
  const parsed = parseIssueLine(fullLine || '');
  const urlVal = parsed.url || '';
  const descVal = parsed.description || '';
  const catVal = parsed.category || '';
  const trkVal = parsed.tracker || '';

  const row = document.createElement('div');
  row.className = 'issue-row-input';
  if(catVal) row.dataset.category = catVal;
  if(trkVal) row.dataset.tracker = trkVal;
  row.innerHTML = `
    <div class="row-num empty">#—</div>
    <input type="text" placeholder="https://pjm.zahironline.com/issues/32685" value="${escapeHtml(urlVal)}" oninput="onIssueInput(this)" data-url="true"/>
    <button type="button" class="row-delete" onclick="removeIssueRow(this)" title="Remove">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <input type="text" class="row-desc" placeholder="Description (optional, from Redmine)" value="${escapeHtml(descVal)}" data-desc="true" style="grid-column:1 / -1; margin-top:2px"/>
    <input type="hidden" data-cat="true" value="${escapeHtml(catVal)}"/>
    <input type="hidden" data-tracker="true" value="${escapeHtml(trkVal)}"/>
  `;
  body.appendChild(row);
  if(urlVal) onIssueInput(row.querySelector('input[data-url]'));
  updateIssueCountBadge();
  setTimeout(()=>{
    row.scrollIntoView({block:'nearest', behavior:'smooth'});
    const inp = row.querySelector('input[data-url]');
    if(inp) inp.focus();
  }, 30);
}

function removeIssueRow(btn){
  const row = btn.closest('.issue-row-input');
  if(row){
    row.style.opacity = '0';
    row.style.transform = 'translateX(-10px)';
    row.style.transition = 'all .15s ease';
    setTimeout(()=>{
      row.remove();
      updateIssueCountBadge();
    }, 150);
  }
}

function onIssueInput(input){
  const row = input.closest('.issue-row-input');
  if(!row) return;
  const numEl = row.querySelector('.row-num');
  const num = extractIssueNumber(input.value.trim());
  if(num){
    numEl.textContent = '#' + num;
    numEl.classList.remove('empty');
  } else {
    numEl.textContent = '#—';
    numEl.classList.add('empty');
  }
  updateIssueCountBadge();
}

function updateIssueCountBadge(){
  const body = $('issueEditorBody');
  const badge = $('issueCountBadge');
  if(!body || !badge) return;
  const total = body.querySelectorAll('.issue-row-input').length;
  const filled = [...body.querySelectorAll('.issue-row-input input[data-url]')].filter(i=>i.value.trim()).length;
  badge.textContent = filled === total ? total : `${filled}/${total}`;
}

function getIssueLines(){
  const body = $('issueEditorBody');
  if(!body) return [];
  const rows = [...body.querySelectorAll('.issue-row-input')];
  const out = [];
  rows.forEach(row => {
    const url = (row.querySelector('input[data-url]')?.value || '').trim();
    const desc = (row.querySelector('input[data-desc]')?.value || '').trim();
    const cat = (row.querySelector('input[data-cat]')?.value || row.dataset.category || '').trim();
    const trk = (row.querySelector('input[data-tracker]')?.value || row.dataset.tracker || '').trim();
    if(!url) return;
    if(desc && cat && trk) out.push(`${url} | ${desc} | ${cat} | ${trk}`);
    else if(desc && cat) out.push(`${url} | ${desc} | ${cat}`);
    else if(desc && trk) out.push(`${url} | ${desc} |  | ${trk}`);
    else if(desc) out.push(`${url} | ${desc}`);
    else out.push(url);
  });
  return out;
}

function setIssueLines(lines){
  const body = $('issueEditorBody');
  if(!body) return;
  body.innerHTML = '';
  if(!lines || !lines.length){
    addIssueRow('');
  } else {
    lines.forEach(l => addIssueRow(l));
  }
  updateIssueCountBadge();
  setTimeout(()=>{ body.scrollTop = body.scrollHeight; }, 50);
}

/* ============================================================
   PLANS CRUD
   ============================================================ */
async function savePlan(e){
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const id = $('planEditId').value;
  const issues = getIssueLines();

  const data = {
    title: $('planTitle').value.trim(),
    date: $('planDate').value,
    projectKey: ($('planProject')?.value || '').trim(),
    issues: issues.join('\n'),
    note: $('planNote').value.trim()
  };
  if(!data.projectKey){
    toast('Please select a project', 'error');
    btn.disabled = false;
    return;
  }

  try {
    if(id){
      await CloudSync.updatePlan(id, data);
      toast('Plan updated successfully');
    } else {
      await CloudSync.addPlan(data);
      toast('New plan added');
    }
    closeModal('planModal');
    resetPlanForm();
  } catch(err){
    toast('Failed to save plan', 'error');
  } finally {
    btn.disabled = false;
  }
}

function resetPlanForm(){
  $('planForm').reset();
  $('planEditId').value = '';
  $('planDate').value = todayISO();
  if($('planProject')) $('planProject').value = '';
  $('planModalTitle').textContent = 'Add Update Plan';
  setIssueLines([]);
}

function editPlan(id){
  const d = State.plans.get(id);
  if(!d) return;
  $('planForm').reset();
  $('planEditId').value = d.id;
  $('planTitle').value = d.title;
  $('planDate').value = d.date;
  $('planNote').value = d.note || '';
  setIssueLines((d.issues||'').split('\n').map(s=>s.trim()).filter(Boolean));
  $('planModalTitle').textContent = 'Edit Update Plan';
  openModal('planModal');
}

async function deletePlan(id){
  const plan = State.plans.get(id);
  const linked = State.summaries.all().filter(s=>s.planId===id).length;

  const message = linked
    ? `Plan <b>"${escapeHtml(plan?.title || 'this plan')}"</b> has <b>${linked} linked summary(ies)</b>. They will also be deleted.<br><br>This action cannot be undone.`
    : `Delete <b>"${escapeHtml(plan?.title || 'this plan')}"</b>?<br><br>This action cannot be undone.`;

  const ok = await confirmDialog({
    title: 'Delete this plan?',
    message: message,
    okText: 'Delete Plan',
    cancelText: 'Cancel',
    type: 'danger'
  });
  if(!ok) return;

  try {
    await CloudSync.deletePlan(id);
    toast('Plan deleted');
  } catch(err){
    toast('Failed to delete plan', 'error');
  }
}

/* ============================================================
   RENDER PLANS
   ============================================================ */
function setPlanFilter(filter){
  window.__planFilter = filter || 'all';
  document.querySelectorAll('#planFilters .filter-chip').forEach(chip=>{
    chip.classList.toggle('active', chip.dataset.filter === window.__planFilter);
  });
  renderPlans();
}

function planHasSummary(planId){
  return State.summaries.all().some(s => s.planId === planId);
}

function planIsRedmine(plan){
  return (plan.note || '').toLowerCase().includes('synced from redmine');
}


function projectKeyLabel(key){
  const map = {
    'erp': 'Zahir ERP',
    'erp-one': 'Zahir ERP One',
    'mfg': 'Manufacturing',
    'mrp': 'Zahir MRP'
  };
  return map[key] || (key ? String(key) : 'No project');
}

function getPlanProjectKey(plan){
  if(!plan) return '';
  if(plan.projectKey) return plan.projectKey;
  const t = String(plan.title || '').toLowerCase();
  if(/erp\s*one|\bone\b/.test(t) && /zahir|erp|one/.test(t)) return 'erp-one';
  if(/manufactur|\bmfg\b/.test(t)) return 'mfg';
  if(/\bmrp\b/.test(t)) return 'mrp';
  return '';
}

function renderPlans(){
  const q = ($('planSearch')?.value || '').toLowerCase().trim();
  const sort = $('planSort')?.value || 'desc';
  const filter = window.__planFilter || 'all';
  const projFilter = ($('planProjectFilter')?.value || 'all');
  let list = [...State.plans.all()];

  if(q){
    list = list.filter(x =>
      (x.title||'').toLowerCase().includes(q) ||
      (x.date||'').includes(q) ||
      (x.issues||'').toLowerCase().includes(q) ||
      (x.note||'').toLowerCase().includes(q) ||
      projectKeyLabel(getPlanProjectKey(x)).toLowerCase().includes(q)
    );
  }

  if(projFilter === 'none') list = list.filter(p => !getPlanProjectKey(p));
  else if(projFilter !== 'all') list = list.filter(p => getPlanProjectKey(p) === projFilter);

  if(filter === 'no-summary') list = list.filter(p => !planHasSummary(p.id));
  else if(filter === 'has-summary') list = list.filter(p => planHasSummary(p.id));
  else if(filter === 'redmine') list = list.filter(p => planIsRedmine(p));

  list.sort((a,b)=>{
    const ta = new Date(a.date || (a.createdAt?.seconds*1000) || 0).getTime();
    const tb = new Date(b.date || (b.createdAt?.seconds*1000) || 0).getTime();
    return sort==='asc' ? ta-tb : tb-ta;
  });

  const el = $('planList');
  if(!el) return;

  if(!list.length){
    const total = State.plans.all().length;
    if(!total){
      el.innerHTML = emptyState(ICON.inbox, 'No Update Plans yet', 'Create your first plan or sync from Redmine.', [
        { label: 'Add Plan', action: "openAddModal()", primary: true },
        { label: 'Sync Redmine', action: "openPlansWithSync()" }
      ]);
    } else {
      el.innerHTML = emptyState(ICON.inbox, 'No matching plans', 'Try changing the filter or search keywords.', [
        { label: 'Reset filter', action: "setPlanFilter('all')" }
      ]);
    }
    return;
  }

  // Group by project when showing all projects
  if(projFilter === 'all' && list.length){
    const groups = {};
    list.forEach(p => {
      const k = getPlanProjectKey(p) || 'none';
      if(!groups[k]) groups[k] = [];
      groups[k].push(p);
    });
    const order = ['erp','erp-one','mfg','mrp','none'];
    const keys = Object.keys(groups).sort((a,b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    el.innerHTML = keys.map(k => `
      <div class="new-proj-block" style="margin-bottom:16px">
        <div class="new-proj-head" style="padding:8px 0">
          <div class="new-proj-title">
            <span>${escapeHtml(projectKeyLabel(k === 'none' ? '' : k))}</span>
            <span class="badge badge-cyan">${groups[k].length}</span>
          </div>
        </div>
        <div class="plan-list">${groups[k].map(d => renderPlanCard(d)).join('')}</div>
      </div>
    `).join('');
  } else {
    el.innerHTML = `<div class="plan-list">` + list.map(d => renderPlanCard(d)).join('') + `</div>`;
  }
  restoreOpenCopyMenu();
}

/** Stable pastel tone index 0–5 from plan date (same date → same color) */
function planDateTone(dateStr){
  const s = String(dateStr || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return 0;
  const n = parseInt(m[1], 10) * 372 + parseInt(m[2], 10) * 31 + parseInt(m[3], 10);
  return Math.abs(n) % 6;
}


async function enrichPlanIssueCategories(plan){
  if(!plan) return false;
  const parsed = parseIssueLines(plan.issues);
  const ids = [...new Set(parsed.map(p => p.number).filter(Boolean).map(String))];
  if(!ids.length) return false;

  // Skip fetch if every id already has tracker in cache
  const missing = ids.filter(id => !(window.__issueTrackerById && window.__issueTrackerById[id]));
  if(!missing.length && ids.every(id => window.__issueCategoryById && window.__issueCategoryById[id])){
    return true;
  }

  try {
    // Redmine supports issue_id=1,2,3 — fetch in chunks of 50
    const chunkSize = 50;
    for(let i = 0; i < ids.length; i += chunkSize){
      const chunk = ids.slice(i, i + chunkSize);
      const params = new URLSearchParams();
      params.set('issue_id', chunk.join(','));
      params.set('status_id', '*');
      params.set('limit', String(chunk.length));
      try {
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: true });
        rememberIssueCategories(data.issues || []);
      } catch(err){
        console.warn('enrich chunk failed', err);
      }
    }
    return true;
  } catch(err){
    console.warn('enrichPlanIssueCategories', err);
    return false;
  }
}


function renderPlanCard(d){
  const parsed = parseIssueLines(d.issues);
  const totalIssue = parsed.length;
  const linkedSummaries = State.summaries.all().filter(s=>s.planId===d.id).length;
  const isRedmineSynced = (d.note || '').toLowerCase().includes('synced from redmine');
  const isExpanded = window.__expandedPlans.has(d.id);

  const issueRows = parsed.map(p=>{
    const num = p.number || '—';
    const desc = p.description || '';
    const url = p.url || '#';
    const cat = p.category || '';
    const catKey = cat && typeof normalizeTesterCategory === 'function' ? normalizeTesterCategory(cat) : '';
    const catHtml = cat
      ? `<span class="pi-cat pi-cat-${catKey || 'other'}" title="${escapeHtml(cat)}">${escapeHtml(cat)}</span>`
      : `<span class="pi-cat pi-cat-none">—</span>`;
    return `<div class="plan-issue-row">
      <a class="pi-num" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open in Redmine">#${escapeHtml(num)}</a>
      <span class="pi-desc">${escapeHtml(desc || url)}</span>
      ${catHtml}
      <a class="pi-open" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open in Redmine">${ICON.externalLink}</a>
    </div>`;
  }).join('');

  const noteHtml = d.note
    ? `<div class="plan-details-note">${ICON.messageSquare}<span>${escapeHtml(d.note)}</span></div>`
    : '';

  const issuesSection = totalIssue > 0
    ? `<div class="plan-details-issues">
        <div class="issues-block">
          <div class="issues-block-head">
            <span>Issue List</span>
            <span class="count-pill">${totalIssue}</span>
          </div>
          <div class="plan-issue-list">${issueRows}</div>
        </div>
      </div>`
    : '';

  const detailsHtml = `
    <div class="plan-details">
      ${noteHtml}
      ${issuesSection}
      <div class="plan-details-foot">
        <div class="copy-menu-wrap">
          <button type="button" class="btn btn-secondary btn-sm" data-plan-id="${d.id}" onclick="toggleCopyMenu(this, event)">
            ${ICON.clipboard}Copy for Telegram
            ${ICON.chevronDown}
          </button>
          <div class="copy-menu" onclick="event.stopPropagation()">
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlanShareLink('${d.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Copy share link (no login)
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'telegram-links')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 3.5L2.5 10.5l6.5 2.5L11 20l3.5-4.5 6.5 3z"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Telegram — links only</span>
                <span class="mi-desc">For SDET · URLs only, no description</span>
              </span>
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'telegram-full')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 3.5L2.5 10.5l6.5 2.5L11 20l3.5-4.5 6.5 3z"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Telegram — link + description</span>
                <span class="mi-desc">URL and subject under each link</span>
              </span>
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'markdown')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Markdown links</span>
                <span class="mi-desc">Clickable [#issue](url) + desc</span>
              </span>
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'numbered')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/>
                  <line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/>
                  <line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Numbered list</span>
                <span class="mi-desc">Numbered [#issue] + description</span>
              </span>
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'plain')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                  <rect x="8" y="2" width="8" height="4" rx="1"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Plain URLs</span>
                <span class="mi-desc">Just the URLs, one per line</span>
              </span>
            </button>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="quickSummary('${d.id}')">${ICON.plus}Create Summary</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="editPlan('${d.id}')">${ICON.edit}Edit</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="deletePlan('${d.id}')">${ICON.trash}Delete</button>
      </div>
    </div>
  `;

  const cardClasses = [
    'plan-card',
    'tone-' + planDateTone(d.date),
    isExpanded ? 'expanded' : '',
    isRedmineSynced ? 'from-redmine' : '',
    linkedSummaries > 0 ? 'has-summary' : ''
  ].filter(Boolean).join(' ');

  return `
    <div class="${cardClasses}">
      <div class="plan-card-main" onclick="togglePlanCard('${d.id}', event)">
        <div class="plan-card-left">
          <div class="plan-card-title">${escapeHtml(d.title)}</div>
          <div class="plan-card-meta">
            <span class="meta-chip">${ICON.calendar}${escapeHtml(formatDate(d.date))}</span>
            <span class="meta-divider"></span>
            <span class="badge badge-cyan">${escapeHtml(projectKeyLabel(getPlanProjectKey(d)))}</span>
            <span class="badge badge-cyan">${ICON.hash}${totalIssue} issues</span>
            ${isRedmineSynced ? `<span class="badge badge-redmine">🔴 Redmine</span>` : ''}
            ${linkedSummaries
              ? `<span class="badge badge-violet badge-click" onclick="event.stopPropagation(); viewPlanSummaries('${d.id}')" title="View summaries">${ICON.fileText}${linkedSummaries} summaries</span>`
              : `<span class="badge badge-neutral badge-click" onclick="event.stopPropagation(); quickSummary('${d.id}')" title="Create summary">No summary</span>`}
          </div>
        </div>
        <div class="plan-card-chevron">${ICON.chevronDown}</div>
      </div>
      ${detailsHtml}
    </div>
  `;
}

/* ============================================================
   SUMMARIES CRUD
   ============================================================ */
function populatePlanDropdown(selected){
  const sel = $('summaryPlanRef');
  const plans = [...State.plans.all()].sort((a,b)=>
    new Date(b.date || (b.createdAt?.seconds*1000) || 0) - new Date(a.date || (a.createdAt?.seconds*1000) || 0)
  );
  sel.innerHTML = '<option value="">— Select a Plan —</option>' +
    plans.map(p=>{
      const proj = projectKeyLabel(getPlanProjectKey(p));
      return `<option value="${p.id}" data-project="${escapeHtml(getPlanProjectKey(p)||'')}">${escapeHtml(p.title)} · ${escapeHtml(proj)} · ${escapeHtml(formatDate(p.date))}</option>`;
    }).join('');
  if(selected) sel.value = selected;
}

function onPlanRefChange(){
  const planId = $('summaryPlanRef').value;
  if(!planId) return;
  const p = State.plans.get(planId);
  if(p && p.date && !$('summaryDate').value) $('summaryDate').value = p.date;
}

async function autoGenerate(){
  const planId = $('summaryPlanRef').value;
  if(!planId){ toast('Please select an Update Plan first', 'error'); return; }
  const p = State.plans.get(planId);
  if(!p){ toast('Plan not found', 'error'); return; }

  // Pull tracker/category from Redmine so grouping is accurate
  try {
    toast('Resolving issue types from Redmine…');
    await enrichPlanIssueCategories(p);
  } catch(e){ console.warn('enrich for summary', e); }

  const fe = $('summaryFe').value.trim() || 'V?.??.??.??????';
  const v2 = $('summaryV2').value.trim() || 'V?.??.??.??????';
  const v3 = $('summaryV3').value.trim();
  const tgl = $('summaryDate').value ? formatDate($('summaryDate').value) : formatDate(p.date || todayISO());
  const parsed = parseIssueLines(p.issues);
  const tpl = $('summaryTemplate')?.value || 'wa';

  const issueLines = parsed.length
    ? parsed.map(it => ({
        num: it.number || '—',
        desc: it.description || '',
        url: it.url || '',
        tracker: it.tracker || '',
        category: it.category || '',
        description: it.description || ''
      }))
    : [];

  const lineWa = (it) => {
    const cat = it.category ? ` [${it.category}]` : '';
    return `• [#${it.num}]${cat} ${it.desc || ''}`.trimEnd();
  };
  const lineWaShort = (it) => `• #${it.num}${it.desc ? ' — '+it.desc : ''}`;
  const lineTg = (it) => {
    const link = it.url ? `[#${it.num}](${it.url})` : `#${it.num}`;
    const cat = it.category ? ` _${it.category}_` : '';
    return `• ${link}${cat}${it.desc ? ' — '+it.desc : ''}`;
  };

  let text = '';
  if(tpl === 'wa-short'){
    text = `🚀 *Zahir ERP Update* — ${tgl}\n`;
    text += `FE ${fe} · V2 ${v2}${v3 ? ' · V3 '+v3 : ''}\n\n`;
    text += issueLines.length
      ? formatGroupedIssueSections(issueLines, lineWaShort) + '\n'
      : '• (no issues)\n';
  } else if(tpl === 'telegram'){
    text = `🚀 *Zahir ERP Update*\n\n`;
    text += `FE: \`${fe}\`\nV2: \`${v2}\`\n`;
    if(v3) text += `V3: \`${v3}\`\n`;
    text += `📅 ${tgl}\n\n`;
    text += issueLines.length
      ? formatGroupedIssueSections(issueLines, lineTg) + '\n'
      : '• (no issues)\n';
  } else {
    text = `🚀 Zahir ERP Update\n\n`;
    text += `FE Version : ${fe}\n`;
    text += `V2 Version : ${v2}\n`;
    if(v3) text += `V3 Version : ${v3}\n`;
    text += `Date : ${tgl}\n\n`;
    const groups = groupIssuesByKind(issueLines);
    const order = ['feature','enhancement','optimization','bug','other'];
    order.forEach(k => {
      const list = groups[k];
      if(!list || !list.length) return;
      const meta = ISSUE_KIND_META[k];
      text += `${meta.emoji} ${meta.title}\n`;
      list.forEach(it => { text += lineWa(it) + '\n'; });
      text += '\n';
    });
    if(!issueLines.length) text += '• (no issues in plan)\n';
  }

  $('summaryText').value = text.trim() + '\n';
  const counts = groupIssuesByKind(issueLines);
  const summary = ['feature','enhancement','optimization','bug','other']
    .map(k => counts[k].length ? `${counts[k].length} ${ISSUE_KIND_META[k].title}` : '')
    .filter(Boolean).join(', ');
  toast('Summary grouped: ' + (summary || 'empty'));
}


function quickSummary(planId){
  resetSummaryForm();
  populatePlanDropdown(planId);
  const p = State.plans.get(planId);
  if(p && p.date) $('summaryDate').value = p.date;
  $('summaryModalTitle').textContent = 'Add Summary';
  openModal('summaryModal');
}

function viewPlanSummaries(planId){
  switchView('summaries');
  const plan = State.plans.get(planId);
  if(plan && $('summarySearch')){
    $('summarySearch').value = plan.title || '';
    renderSummaries();
  }
}

async function saveSummary(e){
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const id = $('summaryEditId').value;
  const data = {
    planId: $('summaryPlanRef').value,
    fe: $('summaryFe').value.trim(),
    v2: $('summaryV2').value.trim(),
    v3: $('summaryV3').value.trim(),
    date: $('summaryDate').value,
    text: $('summaryText').value.trim()
  };

  try {
    if(id){
      await CloudSync.updateSummary(id, data);
      toast('Summary updated successfully');
    } else {
      await CloudSync.addSummary(data);
      toast('New summary added');
    }
    closeModal('summaryModal');
    resetSummaryForm();
  } catch(err){
    toast('Failed to save summary', 'error');
  } finally {
    btn.disabled = false;
  }
}

function resetSummaryForm(){
  $('summaryForm').reset();
  $('summaryEditId').value = '';
  $('summaryDate').value = todayISO();
  $('summaryModalTitle').textContent = 'Add Summary';
  populatePlanDropdown();
}

function editSummary(id){
  const d = State.summaries.get(id);
  if(!d) return;
  resetSummaryForm();
  populatePlanDropdown(d.planId);
  $('summaryEditId').value = d.id;
  $('summaryFe').value = d.fe;
  $('summaryV2').value = d.v2;
  $('summaryV3').value = d.v3 || '';
  $('summaryDate').value = d.date;
  $('summaryText').value = d.text;
  $('summaryModalTitle').textContent = 'Edit Summary';
  openModal('summaryModal');
}

async function deleteSummary(id){
  const summary = State.summaries.get(id);
  const ok = await confirmDialog({
    title: 'Delete this summary?',
    message: `Delete summary <b>${escapeHtml(summary?.fe || '')} → ${escapeHtml(summary?.v2 || '')}</b>?<br><br>This action cannot be undone.`,
    okText: 'Delete Summary',
    cancelText: 'Cancel',
    type: 'danger'
  });
  if(!ok) return;

  try {
    await CloudSync.deleteSummary(id);
    toast('Summary deleted');
  } catch(err){
    toast('Failed to delete summary', 'error');
  }
}

function copySummary(id){
  const d = State.summaries.get(id);
  if(!d) return;
  navigator.clipboard.writeText(d.text).then(()=>{
    toast('Copied — ready to paste into WhatsApp');
  }).catch(()=>{
    const ta = document.createElement('textarea');
    ta.value = d.text;
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('Copied to clipboard');
  });
}

function renderSummaries(){
  const q = ($('summarySearch')?.value || '').toLowerCase().trim();
  const sort = ($('summarySort')?.value) || 'desc';
  const projFilter = ($('summaryProjectFilter')?.value || 'all');
  let list = [...State.summaries.all()];

  if(projFilter !== 'all'){
    list = list.filter(s => {
      const plan = State.plans.get(s.planId);
      const pk = getPlanProjectKey(plan);
      if(projFilter === 'none') return !pk;
      return pk === projFilter;
    });
  }

  if(q){
    list = list.filter(x => {
      const plan = State.plans.get(x.planId);
      const proj = projectKeyLabel(getPlanProjectKey(plan)).toLowerCase();
      return (
        (x.fe||'').toLowerCase().includes(q) ||
        (x.v2||'').toLowerCase().includes(q) ||
        (x.v3||'').toLowerCase().includes(q) ||
        (x.date||'').includes(q) ||
        (x.text||'').toLowerCase().includes(q) ||
        proj.includes(q) ||
        (plan?.title||'').toLowerCase().includes(q)
      );
    });
  }
  list.sort((a,b)=>{
    const ta = new Date(a.date || (a.createdAt?.seconds*1000) || 0).getTime();
    const tb = new Date(b.date || (b.createdAt?.seconds*1000) || 0).getTime();
    return sort==='asc' ? ta-tb : tb-ta;
  });

  const el = $('summaryList');
  if(!list.length){
    el.innerHTML = emptyState(ICON.inbox, 'No Summaries yet', 'Add a summary from an Update Plan to make it shareable to the WA group.');
    return;
  }

  el.innerHTML = `<div class="summary-list">` + list.map(d=>{
    const plan = d.planId ? State.plans.get(d.planId) : null;
    const v3Html = d.v3 ? `<span class="arrow">→</span><span>${escapeHtml(d.v3)}</span>` : '';
    return `
      <div class="summary-card">
        <div class="summary-card-head">
          <div class="summary-card-title">
            <span>${escapeHtml(d.fe)}</span>
            <span class="arrow">→</span>
            <span>${escapeHtml(d.v2)}</span>
            ${v3Html}
          </div>
          <div class="summary-card-meta">
            <span class="meta-chip">${ICON.calendar}${escapeHtml(formatDate(d.date))}</span>
            ${plan
              ? `<span class="meta-divider"></span><span class="badge badge-brand">${ICON.fileText}${escapeHtml(plan.title)}</span>`
              : `<span class="meta-divider"></span><span class="badge badge-neutral">No plan</span>`}
          </div>
        </div>
        <div class="summary-card-body">
          <div class="preview-block">${escapeHtml(d.text)}</div>
        </div>
        <div class="summary-card-foot">
          <button type="button" class="btn btn-success btn-sm" onclick="copySummary('${d.id}')">${ICON.clipboard}Copy for WhatsApp</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="editSummary('${d.id}')">${ICON.edit}Edit</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="deleteSummary('${d.id}')">${ICON.trash}Delete</button>
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

/* ============================================================
   DASHBOARD / COUNTS
   ============================================================ */
function refreshCounts(){
  // Fire-and-forget dashboard New counts
  try { refreshDashNewIssueCounts(); } catch(_){}
  const plans = State.plans.all();
  const sums = State.summaries.all();

  if($('countPlans')) $('countPlans').textContent = plans.length;
  if($('countSummaries')) $('countSummaries').textContent = sums.length;
  if($('statPlans')) $('statPlans').textContent = plans.length;
  if($('statSummaries')) $('statSummaries').textContent = sums.length;

  const totalIssues = plans.reduce((acc,p)=> acc + countIssues(p.issues), 0);
  if($('statIssues')) $('statIssues').textContent = totalIssues;

  const needsSummary = plans.filter(p => !planHasSummary(p.id)).length;
  if($('statNeedsSummary')) $('statNeedsSummary').textContent = needsSummary;

  const footerCount = $('footerDataCount');
  if(footerCount){
    footerCount.textContent = `${plans.length + sums.length} items`;
  }

  // Recent plans (dashboard)
  const recentEl = $('recentPlans');
  if(recentEl){
    const recent = [...plans].sort((a,b)=>
      new Date(b.date || (b.createdAt?.seconds*1000) || 0) - new Date(a.date || (a.createdAt?.seconds*1000) || 0)
    ).slice(0, 5);
    if(!recent.length){
      recentEl.innerHTML = emptyState(ICON.inbox, 'No plans yet', 'Start by syncing from Redmine or creating a plan manually.', [
        { label: 'Add Plan', action: "switchView('plans'); openAddModal()", primary: true },
        { label: 'Sync Redmine', action: "openPlansWithSync()" }
      ]);
    } else {
      recentEl.innerHTML = `<div class="recent-list">` + recent.map(p => {
        const n = countIssues(p.issues);
        const hasSum = planHasSummary(p.id);
        const redmine = planIsRedmine(p);
        return `<div class="recent-row" onclick="switchView('plans')">
          <div class="recent-row-main">
            <div class="recent-title">${escapeHtml(p.title || 'Untitled')}</div>
            <div class="recent-meta">
              <span>${escapeHtml(formatDate(p.date))}</span>
              <span>·</span>
              <span>${n} issues</span>
              ${redmine ? '<span class="badge badge-redmine" style="margin-left:4px">Redmine</span>' : ''}
              ${hasSum ? '<span class="badge badge-violet" style="margin-left:4px">Summary</span>' : '<span class="badge badge-neutral" style="margin-left:4px">No summary</span>'}
            </div>
          </div>
          ${!hasSum ? `<button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation(); quickSummary('${p.id}')">Summary</button>` : ''}
        </div>`;
      }).join('') + `</div>`;
    }
  }

  // Latest summary
  const latest = [...sums].sort((a,b)=>
    new Date(b.date || (b.createdAt?.seconds*1000) || 0) - new Date(a.date || (a.createdAt?.seconds*1000) || 0)
  )[0];
  const el = $('latestSummary');
  if(!el) return;
  if(!latest){
    el.innerHTML = emptyState(ICON.inbox, 'No summaries yet', 'Create a plan first, then generate a summary from it.', [
      { label: 'Go to Plans', action: "switchView('plans')" }
    ]);
  } else {
    const plan = latest.planId ? State.plans.get(latest.planId) : null;
    const v3Html = latest.v3 ? `<span class="arrow">→</span><span>${escapeHtml(latest.v3)}</span>` : '';
    el.innerHTML = `
      <div class="summary-card" style="margin:0;border:none;box-shadow:none;background:transparent">
        <div class="summary-card-head">
          <div class="summary-card-title">
            <span>${escapeHtml(latest.fe)}</span>
            <span class="arrow">→</span>
            <span>${escapeHtml(latest.v2)}</span>
            ${v3Html}
          </div>
          <div class="summary-card-meta">
            <span class="meta-chip">${ICON.calendar}${escapeHtml(formatDate(latest.date))}</span>
            ${plan ? `<span class="meta-divider"></span><span class="badge badge-violet">${escapeHtml(plan.title)}</span>` : ''}
          </div>
        </div>
        <div class="summary-card-body">
          <div class="preview-block">${escapeHtml(latest.text)}</div>
        </div>
        <div class="summary-card-foot">
          <button type="button" class="btn btn-success btn-sm" onclick="copySummary('${latest.id}')">${ICON.clipboard}Copy for WhatsApp</button>
        </div>
      </div>`;
  }
}

/* ============================================================
   EMPTY STATE
   ============================================================ */
function emptyState(iconSvg, title, desc, actions){
  const btns = (actions || []).map(a =>
    `<button type="button" class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="${a.action}">${escapeHtml(a.label)}</button>`
  ).join('');
  return `<div class="empty">
    <div class="empty-icon">${iconSvg}</div>
    <h4>${escapeHtml(title)}</h4>
    <p>${escapeHtml(desc)}</p>
    ${btns ? `<div class="empty-actions">${btns}</div>` : ''}
  </div>`;
}

/* ============================================================
   REDMINE HELPERS
   ============================================================ */
function applyStatusParam(params, statusVal){
  if(!statusVal || statusVal === '*') return;
  if(String(statusVal).startsWith('name:')){
    params.set('status_name', String(statusVal).slice(5));
  } else {
    params.set('status_id', statusVal);
  }
}

/* ============================================================
   REDMINE CACHE + ERROR HANDLING
   ============================================================ */
const RedmineCache = {
  TTL_MS: 8 * 60 * 1000, // 8 minutes — fewer Redmine round-trips
  _mem: new Map(),

  key(url){ return String(url); },

  get(url){
    const k = this.key(url);
    const hit = this._mem.get(k);
    if(hit && Date.now() - hit.ts < this.TTL_MS) return hit.data;
    try {
      const raw = sessionStorage.getItem('rm-cache:' + k);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(Date.now() - parsed.ts < this.TTL_MS){
        this._mem.set(k, parsed);
        return parsed.data;
      }
    } catch(_){}
    return null;
  },

  set(url, data){
    const entry = { ts: Date.now(), data };
    this._mem.set(this.key(url), entry);
    try {
      sessionStorage.setItem('rm-cache:' + this.key(url), JSON.stringify(entry));
    } catch(_){}
  },

  clear(){
    this._mem.clear();
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('rm-cache:'))
        .forEach(k => sessionStorage.removeItem(k));
    } catch(_){}
  }
};

function friendlyRedmineError(status, data){
  const detail = (data && (data.detail || data.error || data.hint)) || '';
  if(status === 401){
    return {
      title: 'Invalid API key (401)',
      message: 'Redmine rejected the API key. Regenerate it under My Account → API access key, update REDMINE_API_KEY on Vercel, then redeploy.'
    };
  }
  if(status === 403){
    return {
      title: 'Access denied (403)',
      message: 'This API key does not have permission for this project/issue. Check the user role in Redmine.'
    };
  }
  if(status === 404){
    return {
      title: 'Not found (404)',
      message: detail || 'Status or resource not found in Redmine. Make sure the status name "Ready for Testing" exists under Issue statuses.'
    };
  }
  if(status === 500 && /REDMINE_API_KEY not configured/i.test(detail + (data?.error||''))){
    return {
      title: 'API key not configured',
      message: 'Set the REDMINE_API_KEY environment variable in Vercel Project Settings, then redeploy.'
    };
  }
  if(status >= 500){
    return {
      title: 'Server error',
      message: detail || 'Redmine/proxy is having issues. Please try again shortly.'
    };
  }
  if(!navigator.onLine){
    return {
      title: 'Offline',
      message: 'No internet connection.'
    };
  }
  return {
    title: 'Failed to load from Redmine',
    message: detail || ('HTTP ' + status)
  };
}

async function fetchRedmine(pathAndQuery, { force = false } = {}){
  const url = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;

  if(!force){
    const cached = RedmineCache.get(url);
    if(cached) return { data: cached, fromCache: true, status: 200 };
  }

  let r;
  try {
    r = await fetch(url);
  } catch(err){
    const friendly = friendlyRedmineError(0, { detail: err.message });
    const e = new Error(friendly.message);
    e.friendly = friendly;
    e.status = 0;
    throw e;
  }

  let data = {};
  try { data = await r.json(); } catch(_){ data = {}; }

  if(!r.ok){
    const friendly = friendlyRedmineError(r.status, data);
    const e = new Error(friendly.message);
    e.friendly = friendly;
    e.status = r.status;
    e.data = data;
    throw e;
  }

  RedmineCache.set(url, data);
  return { data, fromCache: false, status: r.status };
}

/* ============================================================
   TESTER QUEUE — Ready for Testing
   ============================================================ */
window.__testerIssues = window.__testerIssues || [];
window.__testerAssigneeFilter = window.__testerAssigneeFilter || 'all';
window.__testerMeta = window.__testerMeta || { fromCache: false, statusName: 'Ready for Testing' };


/* ============================================================
   TESTER CATEGORY HELPERS
   Maps Redmine issue.category.name → frontend | backend | design | other
   ============================================================ */
const TESTER_CAT_LABELS = { all:'All', frontend:'Front End', backend:'Backend', design:'Design', other:'Other' };

window.__testerCategory = window.__testerCategory || 'frontend';

function getCachedRftStatusId(){
  try { return localStorage.getItem(RFT_STATUS_CACHE_KEY) || ''; } catch(_){ return ''; }
}
function setCachedRftStatusId(id, name){
  try {
    if(id) localStorage.setItem(RFT_STATUS_CACHE_KEY, String(id));
    if(name) localStorage.setItem(RFT_STATUS_CACHE_KEY + '_name', name);
  } catch(_){}
}

function normalizeTesterCategory(name){
  const s = String(name || '').toLowerCase().trim();
  if(!s) return 'other';
  if(/front\s*-?\s*end|^fe$|frontend|front_end/.test(s)) return 'frontend';
  if(/back\s*-?\s*end|^be$|backend|server|back_end/.test(s)) return 'backend';
  if(/design|desain|ui\/?ux|^ui$|^ux$|figma/.test(s)) return 'design';
  return 'other';
}


function getIssueProjectKey(issue){
  if(!issue) return '';
  if(issue._projectKey) return issue._projectKey;
  const id = String(issue._projectId || issue.project?.id || '');
  if(id === '75') return 'erp';
  if(id === '119') return 'erp-one';
  if(id === '113') return 'mfg';
  const n = String(issue._projectLabel || issue.project?.name || '').toLowerCase();
  if(/erp\s*one|\bone\b/.test(n) && /zahir|erp/.test(n)) return 'erp-one';
  if(/manufactur|\bmfg\b/.test(n)) return 'mfg';
  if(/\bmrp\b/.test(n)) return 'mrp';
  if(/zahir\s*erp/.test(n) && !/one|manufactur|mfg|mrp/.test(n)) return 'erp';
  return '';
}

function matchesProjectFilter(issue, filterVal){
  if(!filterVal || filterVal === 'all') return true;
  return getIssueProjectKey(issue) === filterVal;
}

function hasTesterCategory(issue){
  const name = issue?.category?.name;
  return !!(name && String(name).trim());
}

/** Map Redmine category → sidebar group. Returns null if no category (hidden). */
function getIssueTesterCategory(issue){
  if(!hasTesterCategory(issue)) return null; // no category → do not show
  return normalizeTesterCategory(issue.category.name);
}

function openTesterCategory(cat){
  const key = (TESTER_CAT_LABELS && TESTER_CAT_LABELS[cat]) ? cat : (cat === 'all' ? 'all' : 'other');
  window.__testerCategory = key;
  // Highlight active nav item among tester category buttons
  document.querySelectorAll('.nav-item[data-tester-cat]').forEach(b => {
    b.classList.toggle('active', b.dataset.testerCat === key);
  });
  // Clear active from non-tester nav when entering tester
  document.querySelectorAll('.nav-item:not([data-tester-cat])').forEach(b => b.classList.remove('active'));

  const metaTitle = TESTER_CAT_LABELS[key] || 'Tester Queue';
  if($('pageTitle')) $('pageTitle').textContent = metaTitle;
  if($('pageSubtitle')) $('pageSubtitle').textContent = 'Ready for Testing · ' + metaTitle;
  if($('testerCategoryTitle')) $('testerCategoryTitle').textContent = metaTitle + ' · Ready for Testing';

  // Sync sidebar counts immediately from current multi-project list
  try { updateTesterCategoryBadges(); } catch(_){}
  switchView('tester');
  try { syncUrlToRoute('tester', key); } catch(_){}
  // Re-apply active on the category button after switchView (it sets by data-view only)
  document.querySelectorAll('.nav-item[data-tester-cat]').forEach(b => {
    b.classList.toggle('active', b.dataset.testerCat === key);
  });
  renderTesterList();
  updateTesterCategoryBadges();
  // Opening a category marks its issues as seen (clears red dots)
  markCategoryIssuesSeen(key);
}

function updateTesterCategoryBadges(){
  const issues = window.__testerIssues || [];
  const counts = { frontend:0, backend:0, design:0, other:0 };
  let categorized = 0;
  issues.forEach(i => {
    const c = getIssueTesterCategory(i);
    if(c === null) return; // skip uncategorized
    if(counts[c] !== undefined) counts[c]++;
    else counts.other++;
    categorized++;
  });
  counts.all = categorized;

  const map = {
    all: 'countTesterAll',
    frontend: 'countTesterFrontend',
    backend: 'countTesterBackend',
    design: 'countTesterDesign',
    other: 'countTesterOther'
  };
  Object.keys(map).forEach(k => {
    const el = $(map[k]);
    const n = counts[k] || 0;
    if(el) el.textContent = String(n);
    const nav = document.querySelector(`.nav-item[data-tester-cat="${k}"]`);
    if(nav) nav.classList.toggle('has-queue', n > 0);
  });
  try { updateNewIssueIndicators(); } catch(_){}

  // Badge in card = current category count
  const cat = window.__testerCategory || 'all';
  const n = cat === 'all' ? (counts.all || 0) : (counts[cat] ?? 0);
  const badge = $('testerCountBadge');
  if(badge){
    badge.textContent = String(n);
    badge.classList.toggle('badge-pulse', n > 0);
  }
}

function setTesterBadgeCount(n){
  // Prefer per-category badges when we have issue list
  if(window.__testerIssues && window.__testerIssues.length){
    updateTesterCategoryBadges();
    return;
  }
  const badge = $('testerCountBadge');
  const label = (n === null || n === undefined) ? '—' : String(n);
  if(badge){
    badge.textContent = label;
    badge.classList.toggle('badge-pulse', typeof n === 'number' && n > 0);
  }
  ['countTesterFrontend','countTesterBackend','countTesterDesign','countTesterOther'].forEach(id => {
    const el = $(id);
    if(el && (n === null || n === undefined)) el.textContent = '—';
  });
}


/* ===== New-issue tracking (badge) ===== */
const SEEN_ISSUES_KEY = 'erp_tester_seen_ids';
function getSeenIssueIds(){
  try {
    const raw = localStorage.getItem(SEEN_ISSUES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch(_){ return new Set(); }
}
function saveSeenIssueIds(set){
  try {
    // keep last 500 ids
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(SEEN_ISSUES_KEY, JSON.stringify(arr));
  } catch(_){}
}
function markCategoryIssuesSeen(cat){
  const seen = getSeenIssueIds();
  (window.__testerIssues || []).forEach(i => {
    if(getIssueTesterCategory(i) === cat) seen.add(String(i.id));
  });
  saveSeenIssueIds(seen);
  updateTesterCategoryBadges();
  updateNewIssueIndicators();
}
function isNewIssue(issue){
  const seen = getSeenIssueIds();
  return !seen.has(String(issue.id));
}
function countNewByCategory(){
  const seen = getSeenIssueIds();
  const counts = { frontend:0, backend:0, design:0, other:0 };
  (window.__testerIssues || []).forEach(i => {
    if(!seen.has(String(i.id))){
      { const c = getIssueTesterCategory(i); if(c) counts[c] = (counts[c]||0)+1; }
    }
  });
  return counts;
}
function updateNewIssueIndicators(){
  const counts = countNewByCategory();
  Object.keys(counts).forEach(k => {
    const nav = document.querySelector(`.nav-item[data-tester-cat="${k}"]`);
    if(!nav) return;
    nav.classList.toggle('has-new', counts[k] > 0);
    let dot = nav.querySelector('.nav-new-dot');
    if(counts[k] > 0){
      if(!dot){
        dot = document.createElement('span');
        dot.className = 'nav-new-dot';
        dot.title = counts[k] + ' new';
        nav.appendChild(dot);
      }
    } else if(dot){
      dot.remove();
    }
  });
  // Topbar pulse on tester card badge if any new
  const totalNew = Object.values(counts).reduce((a,b)=>a+b,0);
  const badge = $('testerCountBadge');
  if(badge) badge.classList.toggle('badge-new', totalNew > 0);
  try { updateNotifToggleUI(); } catch(_){}
}


/* ===== Browser notifications: new Ready for Testing ===== */
const NOTIF_PREF_KEY = 'erp_tester_notif_enabled';
const NOTIF_LAST_KEY = 'erp_tester_notif_last_ids';
let __testerNotifTimer = null;

function isTesterNotifEnabled(){
  try { return localStorage.getItem(NOTIF_PREF_KEY) === '1'; } catch(_){ return false; }
}

function getLastNotifiedIds(){
  try {
    const raw = localStorage.getItem(NOTIF_LAST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch(_){ return new Set(); }
}
function saveLastNotifiedIds(set){
  try {
    localStorage.setItem(NOTIF_LAST_KEY, JSON.stringify(Array.from(set).slice(-500)));
  } catch(_){}
}

function updateNotifToggleUI(){
  const btn = $('btnToggleTesterNotif');
  const status = $('testerNotifStatus');
  const pill = $('testerNotifStatusPill');
  const bell = $('btnNotifBell');
  const dot = $('notifBellDot');
  const badge = $('notifBellBadge');
  const tgHint = $('notifTelegramHint');
  const on = isTesterNotifEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if(btn){
    btn.textContent = on ? 'Disable browser alerts' : 'Enable browser alerts';
    btn.classList.toggle('btn-primary', !on);
    btn.classList.toggle('btn-secondary', on);
  }
  if(status){
    if(typeof Notification === 'undefined'){
      status.textContent = 'Not supported in this browser';
    } else if(Notification.permission === 'denied'){
      status.textContent = 'Blocked — allow in browser site settings';
    } else if(on){
      status.textContent = 'On · checks while this tab is open';
    } else {
      status.textContent = 'Browser alerts off';
    }
  }
  if(pill){
    pill.classList.remove('on','blocked');
    if(typeof Notification !== 'undefined' && Notification.permission === 'denied'){
      pill.textContent = 'Blocked';
      pill.classList.add('blocked');
    } else if(on){
      pill.textContent = 'On';
      pill.classList.add('on');
    } else {
      pill.textContent = 'Off';
    }
  }
  if(bell) bell.classList.toggle('is-on', on);
  const recent = window.__notifRecent || [];
  const unread = recent.filter(x => !x.seen).length;
  if(dot){
    // keep small dot only when ON and no numeric badge needed
    const counts = (typeof countNewByCategory === 'function') ? countNewByCategory() : {};
    const totalNew = Object.values(counts).reduce((a,b)=>a+(b||0), 0);
    const showDot = on && unread === 0 && totalNew > 0;
    dot.classList.toggle('hidden', !showDot);
  }
  if(badge){
    if(unread > 0){
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  if(tgHint){
    const chat = (localStorage.getItem(typeof TG_CHAT_KEY !== 'undefined' ? TG_CHAT_KEY : 'erp_telegram_chat') || '').trim();
    const tgOn = typeof isTelegramRftEnabled === 'function' && isTelegramRftEnabled();
    tgHint.textContent = chat
      ? (tgOn ? 'Telegram: RFT alerts on' : 'Telegram: Chat ID set, alerts off')
      : 'Telegram: set Chat ID in Settings';
  }
  renderNotifRecent();
}

function renderNotifRecent(){
  const box = $('notifRecentList');
  if(!box) return;
  const list = window.__notifRecent || [];
  if(!list.length){
    box.innerHTML = '<p class="notif-empty">No new RFT alerts yet in this session.</p>';
    return;
  }
  box.innerHTML = list.slice(0, 12).map(item => {
    const pri = (item.priority || '').toLowerCase();
    const priClass = /immediate|urgent/.test(pri) ? 'immediate' : /high/.test(pri) ? 'high' : '';
    const priLabel = item.priority ? `<span class="notif-item-pri ${priClass}">${escapeHtml(item.priority)}</span>` : '';
    const meta = [item.project, item.category].filter(Boolean).join(' · ');
    return `<a class="notif-item" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener" onclick="markNotifSeen('${item.id}')">
      <div class="notif-item-top">
        <span class="notif-item-id">#${escapeHtml(String(item.id))}</span>
        ${priLabel}
      </div>
      <div class="notif-item-sub">${escapeHtml(item.subject || '')}</div>
      <div class="notif-item-meta">${escapeHtml(meta)}${item.at ? ' · ' + escapeHtml(item.at) : ''}</div>
    </a>`;
  }).join('');
}

function markNotifSeen(id){
  const list = window.__notifRecent || [];
  list.forEach(x => { if(String(x.id) === String(id)) x.seen = true; });
  updateNotifToggleUI();
}

function pushNotifRecent(issues){
  if(!issues || !issues.length) return;
  window.__notifRecent = window.__notifRecent || [];
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const existing = new Set(window.__notifRecent.map(x => String(x.id)));
  issues.forEach(i => {
    const id = String(i.id);
    if(existing.has(id)) return;
    window.__notifRecent.unshift({
      id,
      subject: i.subject || '',
      priority: i.priority?.name || '',
      category: i.category?.name || '',
      project: i._projectLabel || i.project?.name || '',
      url: `https://pjm.zahironline.com/issues/${id}`,
      at: now,
      seen: false
    });
  });
  window.__notifRecent = window.__notifRecent.slice(0, 30);
  updateNotifToggleUI();
}

function toggleNotifPanel(ev){
  if(ev){ ev.stopPropagation(); }
  const panel = $('notifPanel');
  if(!panel) return;
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if(opening){
    // Opening panel marks recent as seen (badge clears)
    (window.__notifRecent || []).forEach(x => { x.seen = true; });
  }
  updateNotifToggleUI();
}
function closeNotifPanel(){
  const panel = $('notifPanel');
  if(panel) panel.classList.add('hidden');
}
async function toggleTesterNotifications(){
  if(typeof Notification === 'undefined'){
    toast('This browser does not support notifications', 'error');
    return;
  }
  if(isTesterNotifEnabled()){
    try { localStorage.setItem(NOTIF_PREF_KEY, '0'); } catch(_){}
    stopTesterNotifPoll();
    updateNotifToggleUI();
    toast('Notifications disabled');
    return;
  }
  let perm = Notification.permission;
  if(perm === 'default'){
    perm = await Notification.requestPermission();
  }
  if(perm !== 'granted'){
    try { localStorage.setItem(NOTIF_PREF_KEY, '0'); } catch(_){}
    updateNotifToggleUI();
    toast('Permission denied — enable notifications for this site in the browser', 'error');
    return;
  }
  try { localStorage.setItem(NOTIF_PREF_KEY, '1'); } catch(_){}
  startTesterNotifPoll();
    // Lightweight sidebar counts (limit=1 per project)
    setTimeout(() => {
      prefetchNewIssueCounts().catch(()=>{});
      prefetchActiveWorkCounts().catch(()=>{});
    }, 2500);
  updateNotifToggleUI();
  toast('Browser notifications enabled');
  // Immediate check
  checkTesterNotifications().catch(()=>{});
}

function notifyNewTesterIssues(issues){
  if(!issues || !issues.length) return;

  const seen = getSeenIssueIds();
  const last = getLastNotifiedIds();

  // First run: seed baseline so we don't spam Telegram with the whole queue
  if(!last.size){
    const seed = new Set(issues.map(i => String(i.id)));
    saveLastNotifiedIds(seed);
    console.info('[tester] seeded notified baseline', seed.size);
    return;
  }

  // Telegram: any RFT id not yet notified (independent of browser "seen")
  const freshForTelegram = issues.filter(i => !last.has(String(i.id)));
  // Browser: also skip issues the user already opened in a category
  const freshForBrowser = freshForTelegram.filter(i => !seen.has(String(i.id)));

  if(!freshForTelegram.length) return;

  // Remember notified ids (avoid spam) — mark before send to avoid duplicates on retry
  const next = getLastNotifiedIds();
  freshForTelegram.forEach(i => next.add(String(i.id)));
  saveLastNotifiedIds(next);

  console.info('[tester] new RFT detected', freshForTelegram.map(i => i.id));
  pushNotifRecent(freshForTelegram);
  // In-app toast when tab is visible
  if(!document.hidden){
    const n = freshForTelegram.length;
    toast(`${n} new Ready for Testing issue${n>1?'s':''}`, 'success');
  }


  // Use telegram list for Telegram; browser list for Notification API
  var fresh = freshForBrowser;

  // Browser notification (optional)
  if(isTesterNotifEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted'){
    try {
      const nCount = fresh.length;
      const title = nCount === 1
        ? `RFT #${fresh[0].id}`
        : `${nCount} new Ready for Testing`;
      const lines = fresh.slice(0, 3).map(i => {
        const pri = i.priority?.name ? `[${i.priority.name}] ` : '';
        return `${pri}#${i.id} ${(i.subject || '').slice(0, 80)}`;
      });
      if(nCount > 3) lines.push(`…and ${nCount - 3} more`);
      const body = lines.join('\n');
      const n = new Notification(title, {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        tag: 'erp-rft-new',
        renotify: true,
        requireInteraction: nCount >= 3
      });
      n.onclick = () => {
        try { window.focus(); } catch(_){}
        const counts = { frontend:0, backend:0, design:0, other:0 };
        fresh.forEach(i => { const c = getIssueTesterCategory(i); if(c) counts[c] = (counts[c]||0)+1; });
        const best = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0] || 'frontend';
        openTesterCategory(best);
      };
    } catch(err){
      console.warn('browser notification failed', err);
    }
  }

  // Telegram notification for new RFT (uses all new ids, not browser-seen filter)
  if(isTelegramRftEnabled()){
    sendTelegramRftAlert(freshForTelegram).catch(err => console.warn('telegram RFT alert', err));
  } else {
    console.info('[telegram RFT] skipped — enable Chat ID + toggle in Settings');
  }
}

function isTelegramRftEnabled(){
  try {
    const chat = (localStorage.getItem(TG_CHAT_KEY) || '').trim();
    if(!chat) return false;
    const pref = localStorage.getItem('erp_telegram_rft_notif');
    // default ON when chat id is set
    if(pref === null || pref === undefined || pref === '') return true;
    return pref === '1';
  } catch(_){ return false; }
}

function setTelegramRftEnabled(on){
  try { localStorage.setItem('erp_telegram_rft_notif', on ? '1' : '0'); } catch(_){}
  const el = $('telegramRftToggle');
  if(el) el.checked = !!on;
}

async function testTelegramRftAlert(){
  const chatId = ($('telegramChatId')?.value || localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId){
    toast('Set Telegram Chat ID first', 'error');
    return;
  }
  await sendTelegramRftAlert([{
    id: 'TEST',
    subject: 'Test alert from Zahir ERP Update Manager — RFT notifications OK',
    priority: { name: 'Normal' },
    category: { name: 'Front End' },
    _projectLabel: 'Zahir ERP',
    project: { name: 'Zahir ERP' }
  }]);
}

async function sendTelegramRftAlert(fresh){
  const chatId = ($('telegramChatId')?.value || localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId || !fresh || !fresh.length) return;

  let text = `🆕 Ready for Testing — ${fresh.length} new\n\n`;
  fresh.slice(0, 15).forEach(i => {
    const proj = i._projectLabel || i.project?.name || '';
    const pri = i.priority?.name || '';
    const sub = (i.subject || '').slice(0, 120);
    const cat = i.category?.name || '';
    text += `#${i.id}`;
    if(pri) text += ` [${pri}]`;
    if(cat) text += ` · ${cat}`;
    if(proj) text += ` · ${proj}`;
    text += `\n${sub}\nhttps://pjm.zahironline.com/issues/${i.id}\n\n`;
  });
  if(fresh.length > 15) text += `…and ${fresh.length - 15} more\n`;

  try {
    const r = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, text: text.trim() })
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      console.warn('[telegram RFT]', r.status, data);
      toast('Telegram RFT alert failed: ' + (data.hint || data.error || r.status), 'error');
      return;
    }
    console.info('[telegram RFT] sent', fresh.length);
    toast('Telegram: ' + fresh.length + ' new RFT notified');
  } catch(err){
    console.warn('[telegram RFT] network', err);
    toast('Telegram RFT alert network error', 'error');
  }
}


async function checkTesterNotifications(){
  const lc = $('notifLastCheck');
  if(lc) lc.textContent = 'Last check: checking…';

  // Always refresh multi-project RFT list for accurate sidebar badges.
  // Browser / Telegram alerts only when enabled.
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = resolveTesterProjectIds();
    if(!targets.length) return;

    const merged = [];
    await Promise.all(targets.map(async (t) => {
      try {
        // force:true so new RFT is not hidden behind session cache
        const r = await fetchRftForProject(t.id, true);
        (r.issues || []).forEach(iss => {
          merged.push({ ...iss, _projectId: t.id, _projectLabel: t.label });
        });
        const _lcOk = $('notifLastCheck');
    if(_lcOk) _lcOk.textContent = 'Last check: ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  } catch(err){
        console.warn('[tester] notif fetch', t.label, err);
      }
    }));
    const byId = new Map();
    merged.forEach(iss => { if(!byId.has(iss.id)) byId.set(iss.id, iss); });
    const issues = Array.from(byId.values());

    window.__testerIssues = issues;
    window.__testerMeta = {
      ...(window.__testerMeta || {}),
      fromCache: true,
      projects: targets.map(t => t.label).join(', '),
      at: Date.now()
    };
    updateTesterCategoryBadges();

    // Detect brand-new RFT for browser + Telegram
    notifyNewTesterIssues(issues);
    const _lcOk = $('notifLastCheck');
    if(_lcOk) _lcOk.textContent = 'Last check: ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  } catch(err){
    const lcErr = $('notifLastCheck');
    if(lcErr) lcErr.textContent = 'Last check: failed';
    const _lc = $('notifLastCheck');
    if(_lc) _lc.textContent = 'Last check: failed';
    console.warn('checkTesterNotifications', err);
  }
}

function startTesterNotifPoll(){
  if(__testerNotifTimer) return;
  const tick = () => {
    if(document.hidden) return; // skip while tab hidden — cron/Telegram cover that
    checkTesterNotifications().catch(()=>{});
  };
  // Adaptive: every 90s while focused (was ~3 min)
  __testerNotifTimer = setInterval(tick, 90 * 1000);
  setTimeout(tick, 4000);
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) checkTesterNotifications().catch(()=>{});
  });
}
function stopTesterNotifPoll(){
  if(__testerNotifTimer){
    clearInterval(__testerNotifTimer);
    __testerNotifTimer = null;
  }
}

function getFilteredTesterIssues(){
  const q = ($('testerSearch')?.value || '').toLowerCase().trim();
  const cat = window.__testerCategory || 'all';
  const priFilter = ($('testerPriorityFilter')?.value || 'all');
  const projFilter = ($('testerProjectFilter')?.value || 'all');

  return (window.__testerIssues || []).filter(i => {
    const issueCat = getIssueTesterCategory(i);
    if(issueCat === null) return false; // no Redmine category → hide
    if(cat !== 'all' && issueCat !== cat) return false;
    if(!matchesProjectFilter(i, projFilter)) return false;
    if(priFilter !== 'all'){
      const pc = priorityClass(i.priority?.name);
      // map filter value to class suffix
      const want = 'pri-' + priFilter;
      // high filter also matches urgent class already in priorityClass
      if(priFilter === 'high'){
        if(pc !== 'pri-high') return false;
      } else if(pc !== want){
        return false;
      }
    }
    if(!q) return true;
    const hay = [
      i.id, i.subject, i.assigned_to?.name, i.priority?.name,
      i.tracker?.name, i.category?.name
    ].map(x => String(x||'').toLowerCase()).join(' ');
    return hay.includes(q);
  });
}


function setTesterAssigneeFilter(name){ window.__testerAssigneeFilter = 'all'; renderTesterList(); }

function renderTesterAssigneeChips(){ /* removed: assignee chips */ }



function formatAssignee(assigned){
  if(!assigned) return 'Unassigned';
  // Prefer display name; strip trailing "@login" if Redmine/name field embeds it
  let name = String(assigned.name || '').trim();
  let login = String(assigned.login || '').trim();
  if(name){
    // "Yarfik Ardiansyah @yarfikardiansyah" → "Yarfik Ardiansyah"
    const m = name.match(/^(.*?)\s+@[\w.-]+$/);
    if(m) name = m[1].trim();
    // pure @login as name
    if(name.startsWith('@')) name = name.slice(1);
    return name || login || 'Unassigned';
  }
  if(login) return login.startsWith('@') ? login.slice(1) : login;
  return 'Unassigned';
}

function priorityClass(name){
  const s = String(name || '').toLowerCase().trim();
  if(!s || s === '—') return 'pri-none';
  if(/immediate|critical|blocker/.test(s)) return 'pri-immediate';
  if(/urgent|high|major/.test(s)) return 'pri-high';
  if(/normal|medium/.test(s)) return 'pri-normal';
  if(/low|minor|trivial/.test(s)) return 'pri-low';
  return 'pri-none';
}
function priorityBadge(name){
  const label = name || '—';
  return `<span class="pri-badge ${priorityClass(label)}">${escapeHtml(label)}</span>`;
}

function renderTesterTableRows(list){
  return list.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const updated = issue.updated_on ? formatDate(issue.updated_on.slice(0, 10)) : '—';
    const priority = issue.priority?.name || '—';
    const tracker = issue.tracker?.name || '—';
    const isNew = isNewIssue(issue);
    return `<tr class="tester-tr${isNew ? ' is-new' : ''}${priorityClass(issue.priority?.name)==='pri-immediate' ? ' is-immediate' : ''}" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a>${isNew ? '<span class="new-chip">NEW</span>' : ''}</td>
      <td class="col-subject" title="${escapeHtml(issue.subject || '')}">${escapeHtml(issue.subject || '—')}</td>
      <td class="col-priority">${priorityBadge(priority)}</td>
      <td class="col-tracker">${escapeHtml(tracker)}</td>
      <td class="col-updated">${escapeHtml(updated)}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in Redmine">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');
}

function renderTesterTable(list){
  const cards = list.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const updated = issue.updated_on ? formatDate(issue.updated_on.slice(0, 10)) : '—';
    const priority = issue.priority?.name || '—';
    const tracker = issue.tracker?.name || '—';
    const assignee = formatAssignee(issue.assigned_to);
    const isNew = isNewIssue(issue);
    return `<a class="tester-mcard${isNew ? ' is-new' : ''}${priorityClass(issue.priority?.name)==='pri-immediate' ? ' is-immediate' : ''}" href="${escapeHtml(url)}" target="_blank" rel="noopener">
      <div class="tester-mcard-top">
        <span class="tester-mcard-id">#${issue.id}</span>
        <span class="tester-mcard-pri">${priorityBadge(priority)}</span>
      </div>
      <div class="tester-mcard-subject">${escapeHtml(issue.subject || '—')}</div>
      <div class="tester-mcard-meta">
        <span>${escapeHtml(assignee)}</span>
        <span>${escapeHtml(tracker)}</span>
        <span>${escapeHtml(updated)}</span>
      </div>
    </a>`;
  }).join('');

  return `<div class="tester-table-wrap tester-desktop">
    <table class="tester-table">
      <thead>
        <tr>
          <th class="col-id">Issue</th>
          <th class="col-subject">Description</th>
          <th class="col-priority">Priority</th>
          <th class="col-tracker">Tracker</th>
          <th class="col-updated">Updated</th>
          <th class="col-open"></th>
        </tr>
      </thead>
      <tbody>
        ${renderTesterTableRows(list)}
      </tbody>
    </table>
  </div>
  <div class="tester-cards tester-mobile">${cards}</div>`;
}


function testerLoadingSkeleton(){
  const row = () => `<div class="skel-row">
    <div class="skel skel-id"></div>
    <div class="skel skel-line long"></div>
    <div class="skel skel-pill"></div>
  </div>`;
  return `<div class="skel-wrap" aria-busy="true" aria-label="Loading">
    <div class="skel-label">Loading Ready for Testing…</div>
    ${row()}${row()}${row()}${row()}
  </div>`;
}
function renderTesterList(){
  const el = $('testerReminder');
  if(!el) return;

  // Error state must never look like "empty queue"
  const loadErr = window.__testerLoadError || window.__testerMeta?.error;
  if(loadErr){
    el.innerHTML = emptyState(ICON.alert, loadErr.title || 'Redmine unavailable', loadErr.message || 'Could not load tester queue. Check Redmine or try again.', [
      { label: 'Try again', action: 'loadTesterReminder(true)', primary: true },
      { label: 'Open Sync', action: "openPlansWithSync()" }
    ]);
    return;
  }

  const all = window.__testerIssues || [];
  if(!all.length){
    el.innerHTML = emptyState(ICON.check, 'No testing queue', 'No issues with status Ready for Testing in this project.', [
      { label: 'Refresh', action: 'loadTesterReminder(true)', primary: true }
    ]);
    return;
  }

  const list = getFilteredTesterIssues();
  if(!list.length){
    const catLabel = (window.TESTER_CAT_LABELS && window.TESTER_CAT_LABELS[window.__testerCategory]) || window.__testerCategory || 'this category';
    const uncat = all.filter(i => getIssueTesterCategory(i) === null).length;
    const hint = uncat
      ? `There are ${all.length} RFT issue(s) total. ${uncat} without a Redmine category are hidden until categorized.`
      : `There are ${all.length} Ready for Testing issue(s) total, but none in this category.`;
    el.innerHTML = emptyState(ICON.inbox, `No issues in ${catLabel}`, hint, [
      { label: 'Show All', action: "openTesterCategory('all')" },
      { label: 'Clear search', action: "$('testerSearch').value=''; renderTesterList();" }
    ]);
    return;
  }

  const groupBy = $('testerGroupBy')?.value || 'project';
  const cacheNote = window.__testerMeta?.fromCache
    ? `<div class="tester-cache-note">📦 From cache · click Refresh for latest data</div>`
    : '';

  if(groupBy === 'none'){
    el.innerHTML = cacheNote + renderTesterTable(list);
    return;
  }

  const groups = {};
  list.forEach(i => {
    let key;
    if(groupBy === 'priority') key = i.priority?.name || 'No priority';
    else if(groupBy === 'project') key = i._projectLabel || i.project?.name || 'Unknown project';
    else key = formatAssignee(i.assigned_to);
    if(!groups[key]) groups[key] = [];
    groups[key].push(i);
  });

  // Prefer stable project order when grouping by project
  const projectOrder = ['Zahir ERP', 'Zahir ERP One', 'Zahir MRP'];
  const keys = Object.keys(groups).sort((a,b) => {
    if(groupBy === 'project'){
      const ia = projectOrder.findIndex(p => a.toLowerCase().includes(p.toLowerCase().replace('zahir ','')) || a === p);
      const ib = projectOrder.findIndex(p => b.toLowerCase().includes(p.toLowerCase().replace('zahir ','')) || b === p);
      // Better: exact match index
      const rank = (name) => {
        const n = name.toLowerCase();
        if(/^zahir\s*erp$/i.test(name.trim()) || n === 'zahir erp') return 0;
        if(/erp\s*one/i.test(n)) return 1;
        if(/mrp/i.test(n)) return 2;
        return 50;
      };
      const ra = rank(a), rb = rank(b);
      if(ra !== rb) return ra - rb;
    }
    return groups[b].length - groups[a].length || a.localeCompare(b);
  });

  el.innerHTML = cacheNote + keys.map(key => `
    <div class="tester-group">
      <div class="tester-group-head">
        <span class="tester-group-title">${escapeHtml(key)}</span>
        <span class="badge badge-amber">${groups[key].length}</span>
      </div>
      ${renderTesterTable(groups[key])}
    </div>
  `).join('');
}

async function copyTesterList(){
  const list = getFilteredTesterIssues();
  if(!list.length){
    toast('No issues to copy', 'error');
    return;
  }

  const groupBy = $('testerGroupBy')?.value || 'assignee';
  let text = `🧪 Ready for Testing — ${list.length} issue(s)\n`;
  text += `📅 ${new Date().toLocaleString()}\n\n`;

  if(groupBy === 'none'){
    list.forEach((i, idx) => {
      text += `${idx+1}. #${i.id} — ${i.subject || ''}\n`;
      text += `   ${formatAssignee(i.assigned_to)}${i.priority?.name ? ' · '+i.priority.name : ''}\n`;
      text += `   https://pjm.zahironline.com/issues/${i.id}\n\n`;
    });
  } else {
    const groups = {};
    list.forEach(i => {
      let key;
      if(groupBy === 'priority') key = i.priority?.name || 'No priority';
      else if(groupBy === 'project') key = i._projectLabel || i.project?.name || 'Unknown project';
      else key = formatAssignee(i.assigned_to);
      if(!groups[key]) groups[key] = [];
      groups[key].push(i);
    });
    Object.keys(groups).sort().forEach(key => {
      text += `👤 ${key} (${groups[key].length})\n`;
      groups[key].forEach(i => {
        text += `• #${i.id} — ${i.subject || ''}\n`;
        text += `  https://pjm.zahironline.com/issues/${i.id}\n`;
      });
      text += `\n`;
    });
  }

  try {
    await navigator.clipboard.writeText(text.trim());
    toast(`Copied ${list.length} issue(s)`);
  } catch(_){
    const ta = document.createElement('textarea');
    ta.value = text.trim();
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast(`Copied ${list.length} issue(s)`);
  }
}


function resolveTesterProjectIds(){
  // Hard targets from Redmine (id + identifier + name fallbacks)
  // Live API: Zahir ERP #75, Manufacturing #113, ERP One #119
  const projects = RedmineState.projects || [];
  const ids = [];
  const seen = new Set();
  const add = (id, label) => {
    if(id == null || id === '') return;
    const sid = String(id);
    if(seen.has(sid)) return;
    seen.add(sid);
    ids.push({ id: sid, label: label || sid });
  };
  const findBy = (pred) => projects.find(pred);

  const TARGETS = [
    {
      label: 'Zahir ERP',
      match: (p) =>
        p.id === 75 ||
        p.identifier === 'custom-special-module' ||
        (/^zahir\s*erp$/i.test(String(p.name||'').trim()) &&
          !/one|manufactur|mfg|mrp/i.test(p.name||''))
    },
    {
      label: 'Zahir ERP One',
      match: (p) =>
        p.id === 119 ||
        p.identifier === 'zahir-erp-one' ||
        /erp\s*one/i.test(p.name||'') ||
        /zahir-erp-one/i.test(p.identifier||'')
    },
    {
      label: 'Zahir ERP Manufacturing',
      match: (p) =>
        p.id === 113 ||
        p.identifier === 'zahir-erp-manufacturing' ||
        /manufactur/i.test(p.name||'') ||
        /manufactur/i.test(p.identifier||'')
    }
  ];

  for(const t of TARGETS){
    const found = findBy(t.match);
    if(found) add(found.id, found.name || t.label);
    else {
      // Still try hardcoded id even if list incomplete
      if(t.label === 'Zahir ERP') add(75, t.label);
      if(t.label === 'Zahir ERP One') add(119, t.label);
      if(t.label === 'Zahir ERP Manufacturing') add(113, t.label);
    }
  }

  // Selected sync project as extra
  const selected = getSelectedProjectId();
  if(selected){
    const p = projects.find(x => String(x.id) === String(selected));
    add(selected, p?.name || 'Selected');
  }

  console.info('[tester] projects resolved', ids);
  return ids;
}



/**
 * Paginate Redmine issues (limit/offset) until all pages fetched or maxPages.
 * Prefetch/badge paths should still use limit=1 — do not use this helper there.
 */
async function fetchRedmineAllIssues(paramsInit, { force = false, pageSize = 100, maxPages = 5 } = {}){
  const all = [];
  let total = null;
  let offset = 0;
  let fromCacheAny = false;
  let resolved_status = null;
  let lastData = null;

  for(let page = 0; page < maxPages; page++){
    const params = new URLSearchParams(paramsInit);
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const { data, fromCache } = await fetchRedmine(`/api/redmine?${params.toString()}`, {
      force: !!force && page === 0
    });
    lastData = data;
    if(fromCache) fromCacheAny = true;
    if(data.resolved_status) resolved_status = data.resolved_status;
    if(total == null && typeof data.total_count === 'number') total = data.total_count;
    const batch = data.issues || [];
    all.push(...batch);
    if(batch.length < pageSize) break;
    if(total != null && all.length >= total) break;
    offset += pageSize;
  }

  const byId = new Map();
  all.forEach(iss => { if(iss && iss.id != null && !byId.has(iss.id)) byId.set(iss.id, iss); });
  const issues = Array.from(byId.values());

  return {
    issues,
    total_count: total != null ? total : issues.length,
    fromCache: fromCacheAny,
    resolved_status,
    data: lastData
  };
}

async function fetchRftForProject(projectId, force){
  const cachedSid = getCachedRftStatusId();
  const params = new URLSearchParams();
  if(cachedSid) params.set('status_id', cachedSid);
  else params.set('status_name', 'Ready for Testing');
  params.set('project_id', String(projectId));
  params.set('sort', 'updated_on:desc');
  const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 5 });
  if(result.resolved_status?.id){
    setCachedRftStatusId(result.resolved_status.id, result.resolved_status.name);
  }
  rememberIssueCategories(result.issues || []);
  return {
    issues: result.issues || [],
    fromCache: !!result.fromCache,
    statusName: result.resolved_status?.name
  };
}


async function loadTesterReminder(force){
  const el = $('testerReminder');
  const statusLabel = $('testerStatusLabel');
  const btn = $('btnRefreshTester');
  if(!el) return;

  try {
    if(!RedmineState.loaded){
      await loadRedmineProjects();
    }
  } catch(_){ /* ignore */ }

  const targets = resolveTesterProjectIds();
  if(!targets.length){
    el.innerHTML = emptyState(ICON.inbox, 'No projects available', 'Open Sync from Redmine to load projects (ERP, ERP One, MRP).', [
      { label: 'Open Sync', action: "openPlansWithSync()" }
    ]);
    setTesterBadgeCount(null);
    return;
  }

  if(btn){
    btn.disabled = true;
    btn.textContent = force ? 'Refreshing…' : 'Loading…';
  }
  if(!window.__testerIssues.length || force){
    el.innerHTML = testerLoadingSkeleton();
  }

  try {
    const merged = [];
    let anyCache = false;
    let statusName = 'Ready for Testing';
    await Promise.all(targets.map(async (t) => {
      try {
        const r = await fetchRftForProject(t.id, force);
        if(r.fromCache) anyCache = true;
        if(r.statusName) statusName = r.statusName;
        const n = (r.issues || []).length;
        console.info('[tester] RFT', t.label, '#'+t.id, '→', n, 'issues', r.fromCache ? '(cache)' : '(live)');
        (r.issues || []).forEach(i => {
          merged.push({ ...i, _projectId: t.id, _projectLabel: t.label });
        });
      } catch(err){
        console.warn('[tester] RFT fetch failed', t.label, '#'+t.id, err);
      }
    }));
    // Dedupe by issue id
    const byId = new Map();
    merged.forEach(i => { if(!byId.has(i.id)) byId.set(i.id, i); });
    const issues = Array.from(byId.values());
    window.__testerIssues = issues;
    window.__testerAssigneeFilter = 'all';
    window.__testerMeta = {
      fromCache: anyCache && !force,
      statusName: statusName || localStorage.getItem(RFT_STATUS_CACHE_KEY + '_name') || 'Ready for Testing',
      projects: targets.map(t => t.label).join(', '),
      error: null
    };
    try { notifyNewTesterIssues(issues); } catch(e){ console.warn('notify after tester load', e); }
    window.__testerLoadError = null;

    // Browser notification for brand-new issues (if enabled)
    try { notifyNewTesterIssues(issues); } catch(_){}

    if(statusLabel) statusLabel.textContent = window.__testerMeta.statusName;
    setTesterBadgeCount(issues.length);
    updateTesterCategoryBadges();

    if(force && $('testerSearch')) $('testerSearch').value = '';
    renderTesterAssigneeChips();
    renderTesterList();

    if(force && !anyCache) toast('Tester queue updated');
  } catch(err){
    console.error('Tester reminder failed:', err);
    const friendly = err.friendly || { title: 'Failed to load', message: err.message };
    window.__testerLoadError = friendly;
    window.__testerMeta = { ...(window.__testerMeta||{}), error: friendly };
    setTesterBadgeCount(null);
    const badge = $('testerCountBadge');
    if(badge) badge.textContent = '!';
    el.innerHTML = emptyState(ICON.alert, friendly.title, friendly.message, [
      { label: 'Try again', action: 'loadTesterReminder(true)', primary: true },
      { label: 'Open Sync', action: "openPlansWithSync()" }
    ]);
  } finally {
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Refresh';
    }
  }
}

/** Prefetch badge count in background (uses cache) */
async function prefetchTesterCount(){
  try {
    if(!RedmineState.loaded){
      await loadRedmineProjects();
    }
    const targets = resolveTesterProjectIds();
    if(!targets.length) return;
    const merged = [];
    let statusName = 'Ready for Testing';
    await Promise.all(targets.map(async (t) => {
      try {
        const r = await fetchRftForProject(t.id, false);
        if(r.statusName) statusName = r.statusName;
        (r.issues || []).forEach(i => merged.push({ ...i, _projectId: t.id, _projectLabel: t.label }));
      } catch(_){}
    }));
    const byId = new Map();
    merged.forEach(i => { if(!byId.has(i.id)) byId.set(i.id, i); });
    const issues = Array.from(byId.values());
    window.__testerIssues = issues;
    window.__testerMeta = {
      fromCache: true,
      statusName,
      projects: targets.map(t => t.label).join(', ')
    };
    setTesterBadgeCount(issues.length);
    updateTesterCategoryBadges();
  } catch(err){
    console.warn('Prefetch tester count failed:', err.message);
  }
}

/* ============================================================
   REDMINE — PROJECT LOADER
   ============================================================ */
async function loadRedmineProjects(){
  if(RedmineState.loaded && RedmineState.projects.length) return;

  const sel = $('syncProject');
  if(sel){
    sel.innerHTML = '<option value="">Loading projects…</option>';
    sel.disabled = true;
  }

  try {
    const r = await fetch('/api/redmine-projects');
    const data = await r.json();

    if(!r.ok) throw new Error(data.detail || data.error || 'Failed to load projects');

    const projects = (data.projects || []).filter(p => p.status === 1);
    if(!projects.length){
      if(sel) sel.innerHTML = '<option value="">No active projects found</option>';
      return;
    }

    RedmineState.projects = projects;
    RedmineState.loaded = true;

    let saved = null;
    try { saved = localStorage.getItem(REDMINE_STORAGE_KEY); } catch(e){}
    if(saved && projects.some(p => String(p.id) === saved || p.identifier === saved)){
      RedmineState.selectedProjectId = saved;
    } else if(projects.length === 1){
      RedmineState.selectedProjectId = String(projects[0].id);
    } else {
      const zahir = projects.find(p =>
        p.name.toLowerCase().includes('zahir erp') ||
        p.identifier === 'zahir-erp'
      );
      if(zahir) RedmineState.selectedProjectId = String(zahir.id);
    }

    sel.innerHTML = '<option value="">— Select project —</option>' +
      projects.map(p => {
        const isZahir = p.name.toLowerCase().includes('zahir erp') || p.identifier === 'zahir-erp';
        const label = (isZahir ? '⭐ ' : '') + p.name + (p.parent ? ` (${p.parent.name})` : '');
        return `<option value="${p.id}" data-identifier="${escapeHtml(p.identifier)}">${escapeHtml(label)}</option>`;
      }).join('');

    if(RedmineState.selectedProjectId){
      sel.value = RedmineState.selectedProjectId;
    }

    sel.disabled = false;
    updateRedmineProjectBadge();

  } catch(err){
    console.error('Failed to load projects:', err);
    sel.innerHTML = '<option value="">⚠ Failed to load projects</option>';
    sel.disabled = false;
    showSyncResult('error', `<b>Could not load projects:</b> ${escapeHtml(err.message)}`);
  }
}

function onRedmineProjectChange(){
  const sel = $('syncProject');
  if(!sel) return;
  const val = sel.value;
  if(!val){
    RedmineState.selectedProjectId = null;
    updateRedmineProjectBadge();
    return;
  }
  RedmineState.selectedProjectId = val;
  try { localStorage.setItem(REDMINE_STORAGE_KEY, val); } catch(e){}
  updateRedmineProjectBadge();
  // Refresh tester queue for the newly selected project
  if(currentView === 'tester') loadTesterReminder(true);
}

function updateRedmineProjectBadge(){
  const label = $('redmineProjectLabel');
  const idLabel = $('redmineProjectIdLabel');
  if(!label || !idLabel) return;

  const pid = RedmineState.selectedProjectId;
  if(!pid){
    label.textContent = 'No project selected';
    idLabel.textContent = '—';
    idLabel.style.display = 'none';
    return;
  }

  const proj = RedmineState.projects.find(p => String(p.id) === pid);
  if(proj){
    label.textContent = proj.name;
    idLabel.textContent = proj.identifier;
    idLabel.style.display = 'inline-flex';
  } else {
    label.textContent = pid;
    idLabel.style.display = 'none';
  }
}

function getSelectedProjectId(){
  return RedmineState.selectedProjectId;
}

/* ============================================================
   REDMINE DATE RANGE HELPER  (NEW in v4.10.0)
   ============================================================ */
function getRedmineDateRange(){
  const preset = ($('syncDatePreset')?.value) || 'today';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  const daysAgo = (n) => {
    const d = new Date(now);
    d.setDate(now.getDate() - n);
    return d;
  };

  switch (preset) {
    case 'today':
      return { from: ymd(now), to: ymd(now) };

    case 'week': {
      const day = now.getDay(); // 0=Min
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      return { from: ymd(monday), to: ymd(now) };
    }

    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: ymd(first), to: ymd(now) };
    }

    case '7d':
      return { from: ymd(daysAgo(7)), to: ymd(now) };

    case '30d':
      return { from: ymd(daysAgo(30)), to: ymd(now) };

    case 'custom':
      return {
        from: $('syncFrom')?.value || null,
        to:   $('syncTo')?.value   || null
      };

    case 'all':
    default:
      return { from: null, to: null };
  }
}

function onDatePresetChange(){
  const preset = $('syncDatePreset').value;
  const customRow = $('syncCustomRow');
  const warn = $('syncAllWarning');

  if (customRow) customRow.style.display = preset === 'custom' ? '' : 'none';
  if (warn)      warn.style.display      = preset === 'all'    ? '' : 'none';

  if (preset === 'custom') {
    if ($('syncFrom') && !$('syncFrom').value) $('syncFrom').value = todayISO();
    if ($('syncTo')   && !$('syncTo').value)   $('syncTo').value   = todayISO();
  }
}

/* ============================================================
   REDMINE SYNC
   ============================================================ */
async function testRedmineConnection(event){
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Testing...';
  setRedmineStatus('loading', 'Testing...');

  try {
    const params = new URLSearchParams();
    params.set('limit', '1');
    const pid = getSelectedProjectId();
    if(pid) params.set('project_id', pid);

    const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: true });
    if (data.issues && data.issues.length) {
      setRedmineStatus('success', 'Connected');
      toast('Redmine API connected');
      const issue = data.issues[0];
      showSyncResult('success', `
        <b>Connection OK.</b> Sample issue: <code style="font-family:'JetBrains Mono',monospace;font-size:11.5px">#${issue.id}</code> — ${escapeHtml(issue.subject || '')}
      `);
    } else {
      setRedmineStatus('success', 'Connected');
      toast('Connected, but no issues returned');
      showSyncResult('info', `<b>Connected.</b> API works but this project has no matching issues.`);
    }
  } catch(err){
    setRedmineStatus('error', 'Connection failed');
    toast('Connection failed', 'error');
    const msg = err.friendly ? `<b>${escapeHtml(err.friendly.title)}</b><br>${escapeHtml(err.friendly.message)}` : escapeHtml(err.message);
    showSyncResult('error', msg);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function previewRedmineSync(event){
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;

  const pid = getSelectedProjectId();
  if(!pid){
    toast('Please select a Redmine project first', 'error');
    return;
  }

  const preset = $('syncDatePreset').value;
  const { from, to } = getRedmineDateRange();

  if (preset === 'all') {
    const ok = await confirmDialog({
      title: 'Fetch ALL issues?',
      message: 'This mode will fetch <b>all issues</b> from this project with no date limit.<br><br>On a long-running PJM this can mean <b>thousands of issues</b>. It may take a while. Continue?',
      okText: 'Yes, continue',
      cancelText: 'Cancel',
      type: 'warning'
    });
    if(!ok) return;
  }

  if (preset === 'custom' && !from && !to) {
    toast('Enter at least one date (From / To)', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Loading...';
  setRedmineStatus('loading', 'Fetching...');

  try {
    const statusVal = $('syncStatus').value;
    const dateField = $('syncDateField').value;

    const params = new URLSearchParams();
    applyStatusParam(params, statusVal);
    params.set('project_id', pid);
    params.set('limit', '100');
    params.set('date_field', dateField);

    if (from) params.set('from', from);
    if (to)   params.set('to', to);

    const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: true });

    const issues = data.issues || [];
    if (!issues.length) {
      setRedmineStatus('success', 'No issues');
      showSyncResult('info', `No issues match this date + status filter.`);
      return;
    }

    const existingIds = new Set();
    State.plans.all().forEach(p => {
      parseIssueLines(p.issues).forEach(it => {
        if(it.number) existingIds.add(it.number);
      });
    });
    const newIssues = issues.filter(i => !existingIds.has(String(i.id)));

    setRedmineStatus('success', `${newIssues.length} new`);

    const rows = issues.slice(0, 50).map(issue=>{
      const catName = issue.category?.name || '';
      const catKey = catName ? (typeof normalizeTesterCategory === 'function' ? normalizeTesterCategory(catName) : '') : '';
      const catLabel = catName || '—';
      const catClass = catKey ? `sp-cat sp-cat-${catKey}` : 'sp-cat sp-cat-none';
      return `
      <div class="sync-preview-row">
        <span class="sp-num">#${issue.id}</span>
        <span class="sp-subject">${escapeHtml(issue.subject || '')}</span>
        <span class="${catClass}" title="${escapeHtml(catLabel)}">${escapeHtml(catLabel)}</span>
        <span class="sp-status" style="${!existingIds.has(String(issue.id)) ? '' : 'background:var(--bg-subtle);color:var(--text-tertiary);border-color:var(--line)'}">
          ${existingIds.has(String(issue.id)) ? 'Already added' : 'New'}
        </span>
      </div>`;
    }).join('');

    const rangeLabel = from || to
      ? `${from || '…'} → ${to || '…'}`
      : 'all dates';

    showSyncResult('info', `
      <b>Preview:</b> ${issues.length} issues (${rangeLabel}) — <b>${newIssues.length} new</b>, ${issues.length - newIssues.length} already in plans.
      <div class="sync-preview" style="margin-top:12px">
        <div class="sync-preview-head">
          <span>Issues Preview</span>
          <span class="count-badge">${issues.length}${issues.length > 50 ? ' (first 50)' : ''}</span>
        </div>
        <div class="sync-preview-rows">${rows}</div>
      </div>
    `);
  } catch(err){
    setRedmineStatus('error', 'Fetch failed');
    showSyncResult('error', `<b>Failed to fetch:</b> ${escapeHtml(err.message)}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function syncFromRedmine(event){
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;

  const pid = getSelectedProjectId();
  if(!pid){
    toast('Please select a Redmine project first', 'error');
    return;
  }

  const preset = $('syncDatePreset').value;
  const { from, to } = getRedmineDateRange();

  if (preset === 'all') {
    const ok = await confirmDialog({
      title: 'Fetch & sync ALL issues?',
      message: 'This mode will fetch <b>all issues</b> from this project. Already-synced ones are skipped, but it can still be <b>thousands</b>. Continue?',
      okText: 'Yes, sync all',
      cancelText: 'Cancel',
      type: 'warning'
    });
    if(!ok) return;
  }

  if (preset === 'custom' && !from && !to) {
    toast('Enter at least one date', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Syncing...';
  setRedmineStatus('loading', 'Syncing...');

  try {
    const statusVal = $('syncStatus').value;
    const dateField = $('syncDateField').value;

    const params = new URLSearchParams();
    applyStatusParam(params, statusVal);
    params.set('project_id', pid);
    params.set('limit', '100');
    params.set('date_field', dateField);

    if (from) params.set('from', from);
    if (to)   params.set('to', to);

    const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: true });

    const issues = data.issues || [];
    rememberIssueCategories(issues);
    if (!issues.length) {
      setRedmineStatus('success', 'No issues');
      showSyncResult('info', `No new issues for this date range.`);
      return;
    }

    const existingIds = new Set();
    State.plans.all().forEach(p => {
      parseIssueLines(p.issues).forEach(it => {
        if(it.number) existingIds.add(it.number);
      });
    });
    const newIssues = issues.filter(i => !existingIds.has(String(i.id)));

    if (!newIssues.length) {
      setRedmineStatus('success', 'Nothing new');
      showSyncResult('info', `All <b>${issues.length}</b> issues in this range are already in plans. Nothing new.`);
      return;
    }

    const proj = RedmineState.projects.find(p => String(p.id) === pid);
    const projName = proj ? proj.name : 'Redmine';
    const today = todayISO();

    const statusLabels = {'1':'New','2':'In Progress','3':'Resolved','4':'Feedback','5':'Closed','*':'All'};
    const statusLabel = statusVal.startsWith('name:')
      ? statusVal.slice(5)
      : (statusLabels[statusVal] || statusVal);

    let rangeLabel;
    if (preset === 'today')      rangeLabel = formatDate(today);
    else if (preset === 'week')  rangeLabel = `This Week`;
    else if (preset === 'month') rangeLabel = `This Month`;
    else if (preset === 'all')   rangeLabel = `All`;
    else                         rangeLabel = `${from||'…'} → ${to||'…'}`;

    const title = `${projName} — Update ${rangeLabel} (${statusLabel})`;

    const issueLines = newIssues.map(i => {
      const url = `https://pjm.zahironline.com/issues/${i.id}`;
      const desc = (i.subject || '').replace(/\s+/g, ' ').trim();
      const cat = (i.category && i.category.name ? i.category.name : '').trim();
      const trk = (i.tracker && i.tracker.name ? i.tracker.name : '').trim();
      if(desc && cat && trk) return `${url} | ${desc} | ${cat} | ${trk}`;
      if(desc && cat) return `${url} | ${desc} | ${cat}`;
      if(desc && trk) return `${url} | ${desc} |  | ${trk}`;
      if(desc) return `${url} | ${desc}`;
      return url;
    })

    let syncProjectKey = '';
    const pn = (projName || '').toLowerCase();
    if(/erp\s*one/.test(pn)) syncProjectKey = 'erp-one';
    else if(/manufactur|mfg/.test(pn)) syncProjectKey = 'mfg';
    else if(/\bmrp\b/.test(pn)) syncProjectKey = 'mrp';
    else if(/zahir\s*erp/.test(pn)) syncProjectKey = 'erp';

    await CloudSync.addPlan({
      title: title,
      date: today,
      projectKey: syncProjectKey,
      issues: issueLines.join('\n'),
      note: `Auto-synced from Redmine · Project: ${projName} (${proj?.identifier || pid}) · Range: ${from||'…'} → ${to||'…'} · ${new Date().toLocaleString()}`
    });

    setRedmineStatus('success', 'Synced');
    toast(`Synced ${newIssues.length} new issues from ${projName}`);

    const skipped = issues.length - newIssues.length;
    showSyncResult('success', `
      <b>Sync complete!</b><br>
      Added <b>${newIssues.length} new issue(s)</b> from <b>${escapeHtml(projName)}</b> as plan: "<b>${escapeHtml(title)}</b>"
      ${skipped ? `<br><span style="color:var(--text-secondary);font-size:12px">${skipped} issue(s) skipped (already in plans).</span>` : ''}
      <br><br>
      <button type="button" class="btn btn-primary btn-sm" onclick="finishSyncAndShowPlans()">Done — view plans</button>
    `);
    // Smooth UX: close panel shortly after success so the new plan is visible
    setTimeout(()=> {
      toggleSyncPanel(false);
      renderPlans();
    }, 1200);
  } catch(err){
    setRedmineStatus('error', 'Sync failed');
    const msg = err.friendly
      ? `<b>${escapeHtml(err.friendly.title)}</b><br>${escapeHtml(err.friendly.message)}`
      : `<b>Sync failed:</b> ${escapeHtml(err.message)}`;
    showSyncResult('error', msg);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function finishSyncAndShowPlans(){
  clearSyncResult();
  toggleSyncPanel(false);
  renderPlans();
  const list = $('planList');
  if(list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearSyncResult(){
  const el = $('syncResult');
  if(el) el.innerHTML = '';
}

function showSyncResult(type, html){
  const el = $('syncResult');
  if(!el) return;
  const icons = {
    success: ICON.check,
    error: ICON.alert,
    info: ICON.info,
    loading: '<div class="spinner-sm"></div>'
  };
  el.innerHTML = `
    <div class="sync-status-box ${type}">
      <div class="box-icon">${icons[type] || icons.info}</div>
      <div class="box-body">${html}</div>
    </div>
  `;
}

/* ============================================================
   BACKUP / RESTORE
   ============================================================ */
function exportAll(){
  const data = {
    plans: State.plans.all(),
    summaries: State.summaries.all(),
    exportedAt: new Date().toISOString(),
    uid: CloudSync.uid
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zahir-erp-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}

function importAll(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if(!data.plans || !data.summaries) throw new Error('Invalid format');

      const ok = await confirmDialog({
        title: 'Import backup data?',
        message: `This will import <b>${data.plans.length} plans</b> and <b>${data.summaries.length} summaries</b>.<br><br>Your current data will be <b>overwritten</b>. Continue?`,
        okText: 'Import Data',
        cancelText: 'Cancel',
        type: 'warning'
      });
      if(!ok){ ev.target.value = ''; return; }

      await CloudSync.bulkImport(data.plans, data.summaries);
      toast('Import successful');
    } catch(err){
      console.error(err);
      toast('Invalid file', 'error');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

async function wipeAll(){
  const plansCount = State.plans.all().length;
  const sumsCount = State.summaries.all().length;

  const ok = await confirmDialog({
    title: 'Delete ALL data?',
    message: `You are about to permanently delete <b>${plansCount} plan(s)</b> and <b>${sumsCount} summary(ies)</b> from the cloud.<br><br>This action <b>cannot be undone</b>.`,
    okText: 'Delete Everything',
    cancelText: 'Cancel',
    type: 'danger'
  });
  if(!ok) return;

  try {
    await CloudSync.wipeAll();
    toast('All data deleted');
  } catch(err){
    toast('Failed to clear data', 'error');
  }
}

/* ============================================================
   INIT
   ============================================================ */
function renderAll(){
  renderPlans();
  renderSummaries();
  populatePlanDropdown();
  refreshCounts();
}


/* ============================================================
   ACCOUNT — Google Sign-In (cross-device sync)
   - Guest (anonymous): random UID per device
   - Google: same UID on PC & phone after sign-in
   - Linking anonymous → Google keeps existing data on same UID
   ============================================================ */
function isAnonymousUser(user){
  return !!(user && user.isAnonymous);
}

function isGoogleUser(user){
  if(!user || user.isAnonymous) return false;
  const providers = (user.providerData || []).map(p => p.providerId);
  return providers.includes('google.com') || !!(user.email);
}

function showAuthGate(msg){
  const gate = $('authGate');
  const loading = $('loadingOverlay');
  if(loading) loading.classList.add('hidden');
  if(gate) gate.classList.remove('hidden');
  const err = $('authError');
  if(err) err.textContent = msg || '';
  // Hide main app chrome while gated
  document.body.classList.add('auth-locked');
}

function hideAuthGate(){
  const gate = $('authGate');
  if(gate) gate.classList.add('hidden');
  document.body.classList.remove('auth-locked');
}

async function continueAsGuest(){
  try {
    const err = $('authError');
    if(err) err.textContent = '';
    let user = auth.currentUser;
    if(!user){
      const cred = await auth.signInAnonymously();
      user = cred.user;
    }
    // Mark this session as intentionally guest so we don't re-show gate
    sessionStorage.setItem('erp_guest_ok', '1');
    hideAuthGate();
    await startAppForUser(user);
    toast('Continuing as guest — data stays on this device');
  } catch(e){
    console.error(e);
    const err = $('authError');
    if(err) err.textContent = e.message || 'Could not continue as guest';
  }
}

function updateAccountUI(user){
  const identity = $('accountIdentity');
  const statusText = $('accountStatusText');
  const pill = $('accountStatusPill');
  const btnIn = $('btnGoogleSignIn');
  const btnOut = $('btnSignOut');
  const uidEl = $('userUID');

  if(uidEl) uidEl.textContent = user ? user.uid : '—';

  if(!user){
    if(identity) identity.textContent = 'Not signed in';
    if(statusText) statusText.textContent = 'Signed out';
    if(btnIn) btnIn.classList.remove('hidden');
    if(btnOut) btnOut.classList.add('hidden');
    return;
  }

  if(isAnonymousUser(user)){
    if(identity) identity.textContent = 'Guest (anonymous) — data stays on this device only';
    if(statusText) statusText.textContent = 'Guest';
    if(pill) pill.classList.remove('ok');
    if(btnIn) btnIn.classList.remove('hidden');
    if(btnOut) btnOut.classList.add('hidden');
  } else {
    const email = user.email || user.providerData?.[0]?.email || user.displayName || 'Signed in';
    if(identity) identity.textContent = email;
    if(statusText) statusText.textContent = 'Google';
    if(pill) pill.classList.add('ok');
    if(btnIn) btnIn.classList.add('hidden');
    if(btnOut) btnOut.classList.remove('hidden');
  }
}


/* ============================================================
   GUEST → GOOGLE DATA MIGRATION
   Snapshot local in-memory data before auth change; import if
   the destination account is empty.
   ============================================================ */
function snapshotLocalWorkspace(){
  try {
    const plans = (State.plans && State.plans.all) ? State.plans.all() : [];
    const summaries = (State.summaries && State.summaries.all) ? State.summaries.all() : [];
    if(!plans.length && !summaries.length) return null;
    const payload = {
      at: Date.now(),
      fromUid: CloudSync.uid || (auth.currentUser && auth.currentUser.uid) || null,
      plans: plans.map(p => {
        const { id, ...rest } = p;
        // Strip server timestamps that can't be re-written as-is
        const clean = { ...rest };
        delete clean.createdAt;
        delete clean.updatedAt;
        return { id, ...clean };
      }),
      summaries: summaries.map(s => {
        const { id, ...rest } = s;
        const clean = { ...rest };
        delete clean.createdAt;
        delete clean.updatedAt;
        return { id, ...clean };
      })
    };
    sessionStorage.setItem(MIGRATE_SNAP_KEY, JSON.stringify(payload));
    return payload;
  } catch(e){
    console.warn('snapshotLocalWorkspace failed', e);
    return null;
  }
}

function readMigrateSnapshot(){
  try {
    const raw = sessionStorage.getItem(MIGRATE_SNAP_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch(_){ return null; }
}

function clearMigrateSnapshot(){
  try { sessionStorage.removeItem(MIGRATE_SNAP_KEY); } catch(_){}
}

async function maybeMigrateGuestDataToCurrentUser(){
  const snap = readMigrateSnapshot();
  if(!snap || (!snap.plans?.length && !snap.summaries?.length)) return false;
  if(!CloudSync.uid) return false;

  // Only migrate if destination is empty (avoid overwriting existing Google data)
  try {
    const [plansSnap, sumsSnap] = await Promise.all([
      CloudSync.plansRef.limit(1).get(),
      CloudSync.summariesRef.limit(1).get()
    ]);
    const destHasData = !plansSnap.empty || !sumsSnap.empty;
    if(destHasData){
      console.log('Skip migration — destination account already has data');
      clearMigrateSnapshot();
      return false;
    }

    await CloudSync.bulkImport(snap.plans || [], snap.summaries || []);
    clearMigrateSnapshot();
    toast(`Migrated ${snap.plans.length} plan(s) & ${snap.summaries.length} summary(ies) to this account`);
    return true;
  } catch(err){
    console.error('Migration failed:', err);
    toast('Could not migrate guest data — use Export/Import in Settings', 'error');
    return false;
  }
}

async function signInWithGoogle(){
  const btn = $('btnGoogleSignIn');
  const btnAuth = $('btnAuthGoogle');
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const errEl = $('authError');
  if(errEl) errEl.textContent = '';

  const setBusy = (busy, label) => {
    [btn, btnAuth].forEach(b => {
      if(!b) return;
      b.disabled = !!busy;
      if(busy) b.textContent = label || 'Opening Google…';
    });
  };

  const preferRedirect = (() => {
    try {
      const ua = navigator.userAgent || '';
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      return mobile || standalone;
    } catch(_){ return false; }
  })();

  try {
    setBusy(true, preferRedirect ? 'Redirecting to Google…' : 'Opening Google…');
    // Keep a copy of guest data in case UID changes
    snapshotLocalWorkspace();
    const current = auth.currentUser;

    // Mobile / PWA: redirect is reliable (popups are often blocked)
    if(preferRedirect){
      sessionStorage.setItem('erp_auth_redirect', '1');
      if(current && current.isAnonymous){
        await current.linkWithRedirect(provider);
      } else {
        await auth.signInWithRedirect(provider);
      }
      return; // page will navigate away
    }

    // Desktop: try popup first
    let cred;
    if(current && current.isAnonymous){
      try {
        cred = await current.linkWithPopup(provider);
        toast('Google linked — data kept on this account');
      } catch(linkErr){
        if(linkErr.code === 'auth/credential-already-in-use' ||
           linkErr.code === 'auth/email-already-in-use'){
          cred = await auth.signInWithPopup(provider);
          toast('Signed in with Google');
        } else if(linkErr.code === 'auth/popup-blocked' || linkErr.code === 'auth/popup-closed-by-user'){
          // Fallback to redirect
          sessionStorage.setItem('erp_auth_redirect', '1');
          setBusy(true, 'Redirecting to Google…');
          if(linkErr.code === 'auth/popup-blocked'){
            await current.linkWithRedirect(provider);
          } else {
            await auth.signInWithRedirect(provider);
          }
          return;
        } else {
          throw linkErr;
        }
      }
    } else {
      try {
        cred = await auth.signInWithPopup(provider);
        toast('Signed in with Google');
      } catch(popErr){
        if(popErr.code === 'auth/popup-blocked'){
          sessionStorage.setItem('erp_auth_redirect', '1');
          setBusy(true, 'Redirecting to Google…');
          await auth.signInWithRedirect(provider);
          return;
        }
        throw popErr;
      }
    }

    sessionStorage.removeItem('erp_guest_ok');
    const user = (cred && cred.user) || auth.currentUser;
    hideAuthGate();
    updateAccountUI(user);
    if(user){
      await startAppForUser(user);
      await maybeMigrateGuestDataToCurrentUser();
    }
  } catch(err){
    console.error('Google sign-in failed:', err);
    const map = {
      'auth/popup-closed-by-user': 'Sign-in cancelled',
      'auth/popup-blocked': 'Popup blocked — use redirect or allow popups for this site',
      'auth/operation-not-allowed': 'Google sign-in is not enabled in Firebase Console',
      'auth/unauthorized-domain': `Domain ${location.hostname} is not authorized in Firebase Console`,
      'auth/account-exists-with-different-credential': 'Account exists with a different sign-in method'
    };
    const msg = map[err.code] || (err.message || 'Sign-in failed');
    if(errEl) errEl.textContent = msg;
    toast(msg, 'error');
  } finally {
    setBusy(false);
    if(btn) btn.textContent = 'Sign in with Google';
    if(btnAuth){
      btnAuth.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Sign in with Google`;
    }
  }
}

async function signOutAccount(){
  try {
    sessionStorage.removeItem('erp_guest_ok');
    await auth.signOut();
    toast('Signed out');
    showAuthGate();
  } catch(err){
    console.error(err);
    toast(err.message || 'Sign out failed', 'error');
  }
}

async function startAppForUser(user){
  if(!user || !user.uid){
    console.error('startAppForUser: missing user');
    return;
  }
  try {
    updateAccountUI(user);
    const loadingText = $('loadingText');
    if(loadingText) loadingText.textContent = 'Loading your data...';
    await CloudSync.init(user.uid);
    const overlay = $('loadingOverlay');
    if(overlay) overlay.classList.add('hidden');
    // Non-blocking prefetch
    try { prefetchTesterCount(); } catch(e){ console.warn('prefetchTesterCount', e); }
  } catch(err){
    console.error('startAppForUser failed:', err);
    setSyncStatus('error', 'Load failed');
    const overlay = $('loadingOverlay');
    if(overlay) overlay.classList.add('hidden');
    toast(err.message || 'Failed to load data', 'error');
  }
}

/* ============================================================
   VERSION DISPLAY
   ============================================================ */
function applyAppVersion(){
  const ver = `v${APP_VERSION}`;
  const label = $('appVersionLabel');
  const labelSettings = $('appVersionLabelSettings');
  const dateEl = $('appVersionDate');

  if(label) label.textContent = ver;
  if(labelSettings) labelSettings.textContent = ver;
  if(dateEl){
    dateEl.textContent = APP_VERSION_DATE;
    dateEl.title = APP_VERSION_NOTE || '';
  }

  // Also log to console so easy to check
  console.log(`%c Zahir ERP Update Manager ${ver} `, 'background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-weight:600', `· ${APP_VERSION_DATE} · ${APP_VERSION_NOTE}`);
}


/** Expose functions used by HTML onclick/onchange (ES modules are not global) */

function joinWorkspace(){
  const input = $('workspaceCodeInput');
  const code = input ? input.value.trim() : '';
  return CloudSync.joinWorkspace(code);
}
function usePersonalWorkspace(){
  return CloudSync.usePersonalWorkspace();
}
function copyWorkspaceId(){
  const id = CloudSync.workspaceId || '';
  if(!id){ toast('No workspace yet', 'error'); return; }
  navigator.clipboard.writeText(id).then(()=>toast('Workspace code copied')).catch(()=>toast(id));
}


/* ============================================================
   NEW ISSUES — status "New" from 3 Zahir projects
   ============================================================ */
const NEW_ISSUE_PROJECTS = [
  { key: 'erp-one', label: 'Zahir ERP One', id: 119, identifier: 'zahir-erp-one',
    match: (p) => {
      if(typeof p === 'string') return /erp\s*one/i.test(p);
      return p.id === 119 || p.identifier === 'zahir-erp-one' || /erp\s*one/i.test(p.name||'');
    }
  },
  { key: 'erp', label: 'Zahir ERP', id: 75, identifier: 'custom-special-module',
    match: (p) => {
      if(typeof p === 'string') {
        const s = String(p||'').trim();
        if (/one|manufactur|mfg|point|pos|payroll|mobile/i.test(s)) return false;
        return /^zahir\s*erp$/i.test(s);
      }
      return p.id === 75 || p.identifier === 'custom-special-module' ||
        (/^zahir\s*erp$/i.test(String(p.name||'').trim()) && !/one|manufactur|mfg/i.test(p.name||''));
    }
  },
  { key: 'mfg', label: 'Zahir ERP Manufacturing', id: 113, identifier: 'zahir-erp-manufacturing',
    match: (p) => {
      if(typeof p === 'string') return /manufactur/i.test(p);
      return p.id === 113 || p.identifier === 'zahir-erp-manufacturing' || /manufactur/i.test(p.name||'');
    }
  }
];

window.__newIssuesByProject = window.__newIssuesByProject || {};
window.__newIssuesError = null;
window.__newIssuesMeta = null;

function resolveNewIssueProjectIds(){
  const projects = RedmineState.projects || [];
  const result = [];
  const used = new Set();
  for(const def of NEW_ISSUE_PROJECTS){
    let found = projects.find(p => def.match(p) && !used.has(p.id));
    if(!found && def.id && !used.has(def.id)){
      found = { id: def.id, name: def.label, identifier: def.identifier };
    }
    if(found) used.add(found.id);
    result.push({
      key: def.key,
      label: def.label,
      projectId: found ? found.id : null,
      projectName: found ? (found.name || def.label) : null
    });
  }
  return result;
}

function getNewIssuesStatusName(){
  const v = ($('newIssuesStatusFilter')?.value || 'New').trim();
  return v || 'New';
}

async function fetchNewIssuesForProject(projectId, force = false){
  const params = new URLSearchParams();
  params.set('status_name', getNewIssuesStatusName());
  params.set('project_id', String(projectId));
  params.set('sort', 'updated_on:desc');
  const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 5 });
  rememberIssueCategories(result.issues || []);
  return {
    issues: result.issues || [],
    fromCache: !!result.fromCache,
    resolved: result.resolved_status
  };
}


async function loadNewIssues(force){
  const el = $('newIssuesBody');
  const btn = $('btnRefreshNewIssues');
  const hasMem = !!(window.__newIssuesByProject && Object.keys(window.__newIssuesByProject).length);

  // Stale-while-revalidate: show last data instantly when not forcing
  if(!force && hasMem){
    renderNewIssues();
    const meta = window.__newIssuesMeta;
    const age = meta ? (Date.now() - (meta.at || 0)) : Infinity;
    // If fresher than 8 min, skip network
    if(age < 8 * 60 * 1000){
      return;
    }
  } else if(!hasMem){
    if(el) el.innerHTML = (typeof testerLoadingSkeleton === 'function') ? testerLoadingSkeleton() : '<p style="padding:20px">Loading…</p>';
  }
  if(btn) btn.disabled = true;

  try {
    if(!RedmineState.loaded){
      await loadRedmineProjects();
    }
    const targets = resolveNewIssueProjectIds();
    const byProject = {};
    let total = 0;
    let anyFromCache = false;

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId){
        byProject[t.key] = { ...t, issues: [], error: 'Project not found in Redmine' };
        return;
      }
      try {
        const { issues, fromCache, resolved } = await fetchNewIssuesForProject(t.projectId, !!force);
        if(fromCache) anyFromCache = true;
        byProject[t.key] = { ...t, issues, fromCache, statusName: resolved?.name || getNewIssuesStatusName(), error: null };
        total += issues.length;
      } catch(err){
        console.error('New issues fetch failed', t.label, err);
        byProject[t.key] = {
          ...t, issues: [],
          error: (err.friendly && err.friendly.message) || err.message || 'Failed to load'
        };
      }
    }));

    window.__newIssuesByProject = byProject;
    window.__newIssuesError = null;
    window.__newIssuesMeta = { total, at: Date.now(), fromCache: anyFromCache && !force };

    const badge = $('countNewIssues');
    if(badge) badge.textContent = String(total);
    const totalBadge = $('newIssuesTotalBadge');
    if(totalBadge) totalBadge.textContent = String(total);
    const statusLabel = $('newIssuesStatusLabel');
    if(statusLabel){
      statusLabel.textContent = 'Status: ' + getNewIssuesStatusName() + (anyFromCache && !force ? ' · cached' : '');
    }

    renderNewIssues();
  } catch(err){
    console.error(err);
    // Keep showing stale data if we have it
    if(hasMem){
      renderNewIssues();
      toast('Refresh failed — showing cached data', 'error');
    } else {
      window.__newIssuesError = err.friendly || { title: 'Failed to load', message: err.message };
      if(el){
        el.innerHTML = emptyState(ICON.alert, window.__newIssuesError.title || 'Failed', window.__newIssuesError.message || '', [
          { label: 'Try again', action: 'loadNewIssues(true)', primary: true }
        ]);
      }
    }
  } finally {
    if(btn) btn.disabled = false;
  }
}

function prioritySortRank(name){
  const c = (typeof priorityClass === 'function') ? priorityClass(name) : '';
  if(c === 'pri-immediate') return 0;
  if(c === 'pri-high') return 1;
  if(c === 'pri-normal') return 2;
  if(c === 'pri-low') return 3;
  return 4;
}

function parseIssueDay(issue){
  // Prefer created_on, fallback updated_on
  const raw = issue.created_on || issue.updated_on || '';
  if(!raw) return null;
  const d = raw.slice(0, 10); // YYYY-MM-DD
  return d || null;
}

function getNewIssuesDateRange(){
  const mode = ($('newIssuesDateFilter')?.value) || 'all';
  const fromEl = $('newIssuesDateFrom');
  const toEl = $('newIssuesDateTo');
  if(fromEl && toEl){
    const show = mode === 'custom';
    fromEl.style.display = show ? '' : 'none';
    toEl.style.display = show ? '' : 'none';
  }
  if(mode === 'all') return null;
  const today = new Date();
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  if(mode === 'today'){
    const t = iso(today);
    return { from: t, to: t };
  }
  if(mode === '7d'){
    const a = new Date(today); a.setDate(a.getDate()-6);
    return { from: iso(a), to: iso(today) };
  }
  if(mode === '30d'){
    const a = new Date(today); a.setDate(a.getDate()-29);
    return { from: iso(a), to: iso(today) };
  }
  if(mode === 'custom'){
    return {
      from: (fromEl && fromEl.value) || null,
      to: (toEl && toEl.value) || null
    };
  }
  return null;
}

function getFilteredNewIssues(issues){
  const q = ($('newIssuesSearch')?.value || '').toLowerCase().trim();
  const range = getNewIssuesDateRange();
  const priFilter = ($('newIssuesPriorityFilter')?.value || 'all');
  let list = issues || [];

  if(priFilter !== 'all'){
    list = list.filter(i => {
      const pc = (typeof priorityClass === 'function') ? priorityClass(i.priority?.name) : '';
      if(priFilter === 'high') return pc === 'pri-high';
      return pc === ('pri-' + priFilter);
    });
  }

  if(range && (range.from || range.to)){
    list = list.filter(i => {
      const day = parseIssueDay(i);
      if(!day) return false;
      if(range.from && day < range.from) return false;
      if(range.to && day > range.to) return false;
      return true;
    });
  }

  if(q){
    list = list.filter(i => {
      const hay = [i.id, i.subject, i.assigned_to?.name, i.priority?.name, i.tracker?.name]
        .map(x => String(x||'').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }

  // Immediate first, then High, Normal, Low; within same priority by updated_on desc
  list = [...list].sort((a, b) => {
    const ra = prioritySortRank(a.priority?.name);
    const rb = prioritySortRank(b.priority?.name);
    if(ra !== rb) return ra - rb;
    const ua = a.updated_on || a.created_on || '';
    const ub = b.updated_on || b.created_on || '';
    return ub.localeCompare(ua);
  });

  return list;
}

function renderNewIssues(){
  const el = $('newIssuesBody');
  if(!el) return;

  if(window.__newIssuesError){
    el.innerHTML = emptyState(ICON.alert, window.__newIssuesError.title || 'Error', window.__newIssuesError.message || '', [
      { label: 'Try again', action: 'loadNewIssues(true)', primary: true }
    ]);
    return;
  }

  const by = window.__newIssuesByProject || {};
  const order = NEW_ISSUE_PROJECTS.map(p => p.key);
  if(!order.some(k => by[k])){
    el.innerHTML = emptyState(ICON.inbox, 'No data yet', 'Click Refresh to load New issues from Redmine.', [
      { label: 'Refresh', action: 'loadNewIssues(true)', primary: true }
    ]);
    return;
  }

  const projFilter = ($('newIssuesProjectFilter')?.value || 'all');
  el.innerHTML = order.map(key => {
    const block = by[key];
    if(!block) return '';
    if(projFilter !== 'all' && key !== projFilter) return '';
    const issues = getFilteredNewIssues(block.issues || []);
    const title = block.projectName || block.label;
    const head = `
      <div class="new-proj-head">
        <div class="new-proj-title">
          <span>${escapeHtml(title)}</span>
          <span class="badge badge-cyan">${issues.length}</span>
          ${block.projectId ? `<span class="meta-chip" style="font-size:11px">#${block.projectId}</span>` : ''}
        </div>
        <div class="new-proj-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="copyNewIssueLinks('${key}')" ${!issues.length ? 'disabled' : ''}>
            Copy links
          </button>
        </div>
      </div>`;

    if(block.error){
      return `<div class="new-proj-block">${head}
        <div class="empty" style="padding:16px"><p style="margin:0;color:#ef4444;font-size:13px">${escapeHtml(block.error)}</p></div>
      </div>`;
    }
    if(!issues.length){
      return `<div class="new-proj-block">${head}
        <div class="empty" style="padding:16px"><p style="margin:0;color:var(--text-tertiary);font-size:13px">No New issues</p></div>
      </div>`;
    }

    const rows = issues.map(issue => {
      const url = `https://pjm.zahironline.com/issues/${issue.id}`;
      const pri = issue.priority?.name || '—';
      const updated = issue.updated_on ? formatDate(issue.updated_on.slice(0,10)) : '—';
      const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
      return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
        <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
        <td class="col-subject">${escapeHtml(issue.subject || '—')}</td>
        <td class="col-priority">${priHtml}</td>
        <td class="col-updated">${escapeHtml(updated)}</td>
        <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ICON.externalLink}</a></td>
      </tr>`;
    }).join('');

    return `<div class="new-proj-block">${head}
      <div class="tester-table-wrap">
        <table class="tester-table">
          <thead><tr>
            <th class="col-id">Issue</th>
            <th class="col-subject">Description</th>
            <th class="col-priority">Priority</th>
            <th class="col-updated">Updated</th>
            <th class="col-open"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

function buildNewIssueLinksText(key){
  const block = (window.__newIssuesByProject || {})[key];
  if(!block) return '';
  const issues = getFilteredNewIssues(block.issues || []);
  const title = block.projectName || block.label || key;
  const st = getNewIssuesStatusName();
  let text = `${title} — ${st} (${issues.length})\n`;
  issues.forEach(i => {
    text += `https://pjm.zahironline.com/issues/${i.id}\n`;
  });
  return text.trim();
}

async function copyNewIssueLinks(key){
  const text = buildNewIssueLinksText(key);
  if(!text || !text.includes('http')){
    toast('No links to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Links copied');
  } catch(_){
    toast('Copy failed', 'error');
  }
}

async function copyAllNewIssueLinks(){
  const order = NEW_ISSUE_PROJECTS.map(p => p.key);
  const parts = order.map(k => buildNewIssueLinksText(k)).filter(t => t.includes('http'));
  if(!parts.length){
    toast('No links to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(parts.join('\n\n'));
    toast('All project links copied');
  } catch(_){
    toast('Copy failed', 'error');
  }
}


async function refreshDashNewIssueCounts(){
  const ids = {
    'erp-one': 'statNewErpOne',
    'erp': 'statNewErp',
    'mfg': 'statNewMfg'
  };
  // Show loading
  Object.values(ids).forEach(id => {
    const el = $(id);
    if(el && (el.textContent === '—' || el.textContent === '')) el.textContent = '…';
  });

  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = resolveNewIssueProjectIds();
    await Promise.all(targets.map(async (t) => {
      const el = $(ids[t.key]);
      if(!el) return;
      if(!t.projectId){
        el.textContent = '—';
        return;
      }
      try {
        // Force status New for dashboard cards (not the UI filter)
        const params = new URLSearchParams();
        params.set('status_name', 'New');
        params.set('project_id', String(t.projectId));
        params.set('limit', '100');
        params.set('sort', 'updated_on:desc');
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`);
        const n = (data.issues || []).length;
        el.textContent = String(n);
      } catch(err){
        console.warn('dash new count', t.key, err);
        el.textContent = '!';
      }
    }));
  } catch(err){
    console.warn('refreshDashNewIssueCounts', err);
  }
}


/** Lightweight New Issues badge — limit=1 per project, use total_count */

/** Lightweight Active Work badge — limit=1 per status × project */
async function prefetchActiveWorkCounts(){
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = typeof resolveNewIssueProjectIds === 'function' ? resolveNewIssueProjectIds() : [];
    if(!targets.length) return;

    let progress = 0;
    let deploy = 0;

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId) return;
      const statuses = (typeof ACTIVE_WORK_STATUSES !== 'undefined') ? ACTIVE_WORK_STATUSES : [];
      for(const st of statuses){
        const name = (st.names && st.names[0]) || st.label;
        if(!name) continue;
        try {
          const params = new URLSearchParams();
          params.set('status_name', name);
          params.set('project_id', String(t.projectId));
          params.set('limit', '1');
          const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: false });
          const n = (typeof data.total_count === 'number') ? data.total_count : (data.issues || []).length;
          if(st.key === 'progress') progress += n;
          else if(st.key === 'deploy') deploy += n;
        } catch(_){}
      }
    }));

    const total = progress + deploy;
    const c = $('countActiveWork');
    if(c) c.textContent = String(total);
  } catch(err){
    console.warn('prefetchActiveWorkCounts', err);
  }
}

async function prefetchNewIssueCounts(){
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = typeof resolveNewIssueProjectIds === 'function' ? resolveNewIssueProjectIds() : [];
    if(!targets.length) return;
    let total = 0;
    await Promise.all(targets.map(async (t) => {
      if(!t.projectId) return;
      try {
        const params = new URLSearchParams();
        params.set('status_name', 'New');
        params.set('project_id', String(t.projectId));
        params.set('limit', '1');
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: false });
        const n = (typeof data.total_count === 'number') ? data.total_count : (data.issues || []).length;
        total += n;
        // Keep dash cards in sync if present
        const dashIds = { 'erp-one': 'statNewErpOne', 'erp': 'statNewErp', 'mfg': 'statNewMfg' };
        const el = $(dashIds[t.key]);
        if(el) el.textContent = String(n);
      } catch(err){
        console.warn('prefetchNewIssueCounts', t.key, err);
      }
    }));
    const badge = $('countNewIssues');
    if(badge) badge.textContent = String(total);
    const wn = $('countWhatNext');
    if(wn && (wn.textContent === '0' || wn.textContent === '—' || !wn.textContent)){
      wn.textContent = String(total); // What Next ≈ New backlog
    }
  } catch(err){
    console.warn('prefetchNewIssueCounts', err);
  }
}

function openNewIssuesView(){
  switchView('newissues');
  loadNewIssues(false);
}



/* ============================================================
   ACTIVE WORK — In Progress + On Deploy across 3 projects
   ============================================================ */
const ACTIVE_WORK_STATUSES = [
  { key: 'progress', label: 'In Progress', names: ['In Progress', 'On Progress', 'Progress'] },
  { key: 'deploy', label: 'On Deploy', names: ['On Deploy', 'Ondeploy', 'On deploy', 'Deploy'] }
];

window.__activeWorkData = window.__activeWorkData || { progress: [], deploy: [] };
window.__activeWorkError = null;

async function fetchIssuesByStatusName(projectId, statusNames, force = false){
  let lastErr = null;
  for(const name of statusNames){
    try {
      const params = new URLSearchParams();
      params.set('status_name', name);
      params.set('project_id', String(projectId));
      params.set('sort', 'updated_on:desc');
      const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 5 });
      if((result.issues && result.issues.length) || result.resolved_status){
        rememberIssueCategories(result.issues || []);
        return {
          issues: result.issues || [],
          statusName: result.resolved_status?.name || name,
          fromCache: !!result.fromCache
        };
      }
    } catch(err){
      lastErr = err;
    }
  }
  if(lastErr) throw lastErr;
  return { issues: [], statusName: statusNames[0] || '', fromCache: false };
}


async function loadActiveWork(force){
  const el = $('activeWorkBody');
  const btn = $('btnRefreshActiveWork');
  const hasMem = !!(window.__activeWorkData && ((window.__activeWorkData.progress||[]).length || (window.__activeWorkData.deploy||[]).length || window.__activeWorkMeta));

  if(!force && hasMem){
    renderActiveWork();
    const age = window.__activeWorkMeta ? (Date.now() - (window.__activeWorkMeta.at || 0)) : Infinity;
    if(age < 8 * 60 * 1000){
      return;
    }
  } else if(!hasMem){
    if(el) el.innerHTML = (typeof testerLoadingSkeleton === 'function') ? testerLoadingSkeleton() : '<p style="padding:20px">Loading…</p>';
  }
  if(btn) btn.disabled = true;

  try {
    if(!RedmineState.loaded){
      await loadRedmineProjects();
    }
    const targets = resolveNewIssueProjectIds();
    const progressAll = [];
    const deployAll = [];

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId) return;
      // In Progress
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ACTIVE_WORK_STATUSES[0].names, !!force);
        r.issues.forEach(i => progressAll.push({
          ...i,
          _projectKey: t.key,
          _projectLabel: t.projectName || t.label,
          _statusLabel: r.statusName || 'In Progress'
        }));
      } catch(err){
        console.warn('In Progress fetch', t.label, err);
      }
      // On Deploy
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ACTIVE_WORK_STATUSES[1].names, !!force);
        r.issues.forEach(i => deployAll.push({
          ...i,
          _projectKey: t.key,
          _projectLabel: t.projectName || t.label,
          _statusLabel: r.statusName || 'On Deploy'
        }));
      } catch(err){
        console.warn('On Deploy fetch', t.label, err);
      }
    }));

    // Sort Immediate first within each list
    const sortPri = (arr) => arr.sort((a,b) => {
      const ra = (typeof prioritySortRank === 'function') ? prioritySortRank(a.priority?.name) : 0;
      const rb = (typeof prioritySortRank === 'function') ? prioritySortRank(b.priority?.name) : 0;
      if(ra !== rb) return ra - rb;
      const aa = formatAssignee(a.assigned_to).toLowerCase();
      const bb = formatAssignee(b.assigned_to).toLowerCase();
      return aa.localeCompare(bb);
    });
    sortPri(progressAll);
    sortPri(deployAll);

    window.__activeWorkData = { progress: progressAll, deploy: deployAll };
    window.__activeWorkError = null;
    window.__activeWorkMeta = { at: Date.now(), total: progressAll.length + deployAll.length };

    const total = progressAll.length + deployAll.length;
    const c = $('countActiveWork');
    if(c) c.textContent = String(total);
    const b = $('activeWorkTotalBadge');
    if(b) b.textContent = String(total);

    renderActiveWork();
  } catch(err){
    console.error(err);
    if(hasMem){
      renderActiveWork();
      toast('Refresh failed — showing cached data', 'error');
    } else {
      window.__activeWorkError = err.friendly || { title: 'Failed to load', message: err.message };
      if(el){
        el.innerHTML = emptyState(ICON.alert, window.__activeWorkError.title || 'Failed', window.__activeWorkError.message || '', [
          { label: 'Try again', action: 'loadActiveWork(true)', primary: true }
        ]);
      }
    }
  } finally {
    if(btn) btn.disabled = false;
  }
}

function getActiveWorkDateRange(){
  const mode = ($('activeWorkDateFilter')?.value) || 'all';
  const fromEl = $('activeWorkDateFrom');
  const toEl = $('activeWorkDateTo');
  if(fromEl && toEl){
    const show = mode === 'custom';
    fromEl.style.display = show ? '' : 'none';
    toEl.style.display = show ? '' : 'none';
  }
  if(mode === 'all') return null;
  const today = new Date();
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  if(mode === 'today'){
    const t = iso(today);
    return { from: t, to: t };
  }
  if(mode === '7d'){
    const a = new Date(today); a.setDate(a.getDate()-6);
    return { from: iso(a), to: iso(today) };
  }
  if(mode === '30d'){
    const a = new Date(today); a.setDate(a.getDate()-29);
    return { from: iso(a), to: iso(today) };
  }
  if(mode === 'custom'){
    return {
      from: (fromEl && fromEl.value) || null,
      to: (toEl && toEl.value) || null
    };
  }
  return null;
}

function filterActiveWorkList(list){
  const q = ($('activeWorkSearch')?.value || '').toLowerCase().trim();
  const priFilter = ($('activeWorkPriorityFilter')?.value || 'all');
  const projFilter = ($('activeWorkProjectFilter')?.value || 'all');
  const range = getActiveWorkDateRange();
  let out = list || [];

  if(projFilter !== 'all'){
    out = out.filter(i => matchesProjectFilter(i, projFilter));
  }

  if(priFilter !== 'all'){
    out = out.filter(i => {
      const pc = (typeof priorityClass === 'function') ? priorityClass(i.priority?.name) : '';
      if(priFilter === 'high') return pc === 'pri-high';
      return pc === ('pri-' + priFilter);
    });
  }

  if(range && (range.from || range.to)){
    out = out.filter(i => {
      const day = (typeof parseIssueDay === 'function') ? parseIssueDay(i) : ((i.created_on || i.updated_on || '').slice(0,10) || null);
      if(!day) return false;
      if(range.from && day < range.from) return false;
      if(range.to && day > range.to) return false;
      return true;
    });
  }

  if(q){
    out = out.filter(i => {
      const hay = [i.id, i.subject, i.assigned_to?.name, i.priority?.name, i._projectLabel, i._statusLabel]
        .map(x => String(x||'').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  return out;
}

function renderActiveWorkTable(list){
  if(!list.length){
    return `<div class="empty" style="padding:16px"><p style="margin:0;color:var(--text-tertiary);font-size:13px">No issues</p></div>`;
  }
  const rows = list.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const assignee = formatAssignee(issue.assigned_to);
    const pri = issue.priority?.name || '—';
    const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
    const proj = issue._projectLabel || '—';
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">${escapeHtml(issue.subject || '—')}</td>
      <td class="col-assignee-show">${escapeHtml(assignee)}</td>
      <td class="col-priority">${priHtml}</td>
      <td class="col-tracker">${escapeHtml(proj)}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');
  return `<div class="tester-table-wrap">
    <table class="tester-table">
      <thead><tr>
        <th class="col-id">Issue</th>
        <th class="col-subject">Description</th>
        <th class="col-assignee-show">Assignee</th>
        <th class="col-priority">Priority</th>
        <th class="col-tracker">Project</th>
        <th class="col-open"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderActiveWorkGrouped(list){
  const groupBy = ($('activeWorkGroupBy')?.value) || 'assignee';
  if(groupBy === 'none') return renderActiveWorkTable(list);

  const groups = {};
  list.forEach(i => {
    const key = groupBy === 'project'
      ? (i._projectLabel || 'Unknown project')
      : formatAssignee(i.assigned_to);
    if(!groups[key]) groups[key] = [];
    groups[key].push(i);
  });
  const keys = Object.keys(groups).sort((a,b) => groups[b].length - groups[a].length || a.localeCompare(b));
  return keys.map(key => `
    <div class="tester-group">
      <div class="tester-group-head">
        <span class="tester-group-title">${escapeHtml(key)}</span>
        <span class="badge badge-amber">${groups[key].length}</span>
      </div>
      ${renderActiveWorkTable(groups[key])}
    </div>
  `).join('');
}

function renderActiveWork(){
  const el = $('activeWorkBody');
  if(!el) return;
  if(window.__activeWorkError){
    el.innerHTML = emptyState(ICON.alert, window.__activeWorkError.title || 'Error', window.__activeWorkError.message || '', [
      { label: 'Try again', action: 'loadActiveWork(true)', primary: true }
    ]);
    return;
  }
  const data = window.__activeWorkData || { progress: [], deploy: [] };
  const statusFilter = ($('activeWorkStatusFilter')?.value) || 'all';
  const progress = filterActiveWorkList(data.progress || []);
  const deploy = filterActiveWorkList(data.deploy || []);
  const showProgress = statusFilter === 'all' || statusFilter === 'progress';
  const showDeploy = statusFilter === 'all' || statusFilter === 'deploy';

  let html = '';
  if(showProgress){
    html += `
    <div class="new-proj-block">
      <div class="new-proj-head">
        <div class="new-proj-title">
          <span>In Progress</span>
          <span class="badge badge-amber">${progress.length}</span>
        </div>
        <div class="new-proj-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="copyActiveWorkLinks('progress')" ${!progress.length?'disabled':''}>Copy links</button>
        </div>
      </div>
      ${renderActiveWorkGrouped(progress)}
    </div>`;
  }
  if(showDeploy){
    html += `
    <div class="new-proj-block">
      <div class="new-proj-head">
        <div class="new-proj-title">
          <span>On Deploy</span>
          <span class="badge badge-cyan">${deploy.length}</span>
        </div>
        <div class="new-proj-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="copyActiveWorkLinks('deploy')" ${!deploy.length?'disabled':''}>Copy links</button>
        </div>
      </div>
      ${renderActiveWorkGrouped(deploy)}
    </div>`;
  }
  if(!html){
    html = emptyState(ICON.inbox, 'No section selected', 'Pick a status filter to show issues.');
  }
  el.innerHTML = html;
}

async function copyActiveWorkLinks(which){
  const data = window.__activeWorkData || { progress: [], deploy: [] };
  const list = filterActiveWorkList(which === 'deploy' ? data.deploy : data.progress);
  const label = which === 'deploy' ? 'On Deploy' : 'In Progress';
  if(!list.length){ toast('No links to copy', 'error'); return; }
  let text = `${label} (${list.length})\n`;
  list.forEach(i => {
    const who = formatAssignee(i.assigned_to);
    text += `#${i.id} [${who}] ${i.subject || ''}\nhttps://pjm.zahironline.com/issues/${i.id}\n`;
  });
  try {
    await navigator.clipboard.writeText(text.trim());
    toast('Links copied');
  } catch(_){
    toast('Copy failed', 'error');
  }
}

function openActiveWorkView(){
  switchView('activework');
  loadActiveWork(false);
}



/* ============================================================
   WHAT NEXT — rank New issues by urgency (priority + age)
   ============================================================ */
window.__whatNextList = window.__whatNextList || [];
window.__whatNextMeta = null;
window.__whatNextError = null;

function daysSince(iso){
  if(!iso) return 0;
  const t = Date.parse(iso);
  if(!t) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function scoreWhatNextIssue(issue){
  // Higher score = do sooner
  const pri = (typeof priorityClass === 'function') ? priorityClass(issue.priority?.name) : '';
  let score = 30;
  let reasons = [];

  if(pri === 'pri-immediate'){ score += 100; reasons.push('Immediate'); }
  else if(pri === 'pri-high'){ score += 70; reasons.push('High priority'); }
  else if(pri === 'pri-normal'){ score += 35; reasons.push('Normal'); }
  else if(pri === 'pri-low'){ score += 10; reasons.push('Low'); }
  else { score += 25; reasons.push('Unranked priority'); }

  const createdDays = daysSince(issue.created_on);
  const updatedDays = daysSince(issue.updated_on);
  const ageDays = Math.max(createdDays, updatedDays);
  // Waiting longer → higher urgency (cap 40 pts)
  const agePts = Math.min(40, ageDays * 2);
  score += agePts;
  if(ageDays >= 14) reasons.push(ageDays + 'd waiting');
  else if(ageDays >= 7) reasons.push(ageDays + 'd old');
  else if(ageDays >= 3) reasons.push(ageDays + 'd');

  const assignee = (typeof formatAssignee === 'function') ? formatAssignee(issue.assigned_to) : (issue.assigned_to?.name || '');
  if(!issue.assigned_to || assignee === 'Unassigned'){
    score += 5;
    reasons.push('Unassigned');
  }

  return { score, reasons, ageDays };
}

async function loadWhatNext(force){
  const el = $('whatNextBody');
  const btn = $('btnRefreshWhatNext');
  const hasMem = (window.__whatNextList || []).length > 0;

  if(!force && hasMem){
    renderWhatNext();
    const age = window.__whatNextMeta ? (Date.now() - (window.__whatNextMeta.at || 0)) : Infinity;
    if(age < 8 * 60 * 1000) return;
  } else if(!hasMem){
    if(el) el.innerHTML = (typeof testerLoadingSkeleton === 'function') ? testerLoadingSkeleton() : '<p style="padding:20px">Loading…</p>';
  }
  if(btn) btn.disabled = true;

  try {
    if(!RedmineState.loaded){
      await loadRedmineProjects();
    }
    const targets = resolveNewIssueProjectIds();
    const all = [];

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId) return;
      try {
        // Always status New for prioritization backlog
        const params = new URLSearchParams();
        params.set('status_name', 'New');
        params.set('project_id', String(t.projectId));
        params.set('limit', '100');
        params.set('sort', 'updated_on:desc');
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: !!force });
        (data.issues || []).forEach(i => {
          const scored = scoreWhatNextIssue(i);
          all.push({
            ...i,
            _projectKey: t.key,
            _projectLabel: t.projectName || t.label,
            _score: scored.score,
            _reasons: scored.reasons,
            _ageDays: scored.ageDays
          });
        });
      } catch(err){
        console.warn('WhatNext fetch', t.label, err);
      }
    }));

    all.sort((a, b) => b._score - a._score || (a.id - b.id));
    window.__whatNextList = all;
    window.__whatNextError = null;
    window.__whatNextMeta = { at: Date.now(), total: all.length };

    const c = $('countWhatNext');
    if(c) c.textContent = String(all.length);
    const b = $('whatNextTotalBadge');
    if(b) b.textContent = String(all.length);

    renderWhatNext();
  } catch(err){
    console.error(err);
    if(hasMem){
      renderWhatNext();
      toast('Refresh failed — showing cached ranking', 'error');
    } else {
      window.__whatNextError = err.friendly || { title: 'Failed to load', message: err.message };
      if(el){
        el.innerHTML = emptyState(ICON.alert, window.__whatNextError.title || 'Failed', window.__whatNextError.message || '', [
          { label: 'Try again', action: 'loadWhatNext(true)', primary: true }
        ]);
      }
    }
  } finally {
    if(btn) btn.disabled = false;
  }
}

function getFilteredWhatNext(){
  let list = window.__whatNextList || [];
  const q = ($('whatNextSearch')?.value || '').toLowerCase().trim();
  const proj = ($('whatNextProjectFilter')?.value) || 'all';
  const pri = ($('whatNextPriorityFilter')?.value) || 'all';
  const limit = parseInt(($('whatNextLimit')?.value) || '20', 10);

  if(proj !== 'all'){
    list = list.filter(i => matchesProjectFilter(i, proj));
  }
  if(pri !== 'all'){
    list = list.filter(i => {
      const pc = (typeof priorityClass === 'function') ? priorityClass(i.priority?.name) : '';
      if(pri === 'high') return pc === 'pri-high';
      return pc === ('pri-' + pri);
    });
  }
  if(q){
    list = list.filter(i => {
      const hay = [i.id, i.subject, i._projectLabel, i.priority?.name, formatAssignee(i.assigned_to)]
        .map(x => String(x||'').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  // already sorted by score
  if(limit > 0) list = list.slice(0, limit);
  return list;
}

function renderWhatNext(){
  const el = $('whatNextBody');
  if(!el) return;

  if(window.__whatNextError && !(window.__whatNextList||[]).length){
    el.innerHTML = emptyState(ICON.alert, window.__whatNextError.title || 'Error', window.__whatNextError.message || '', [
      { label: 'Try again', action: 'loadWhatNext(true)', primary: true }
    ]);
    return;
  }

  const list = getFilteredWhatNext();
  if(!list.length){
    el.innerHTML = emptyState(ICON.inbox, 'No issues to rank', 'No New issues match the current filters.', [
      { label: 'Refresh', action: 'loadWhatNext(true)', primary: true }
    ]);
    return;
  }

  const rows = list.map((issue, idx) => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const pri = issue.priority?.name || '—';
    const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
    const rank = idx + 1;
    const rankClass = rank <= 3 ? 'wn-rank wn-rank-top' : 'wn-rank';
    const reasons = (issue._reasons || []).map(r => `<span class="wn-chip">${escapeHtml(r)}</span>`).join('');
    const assignee = formatAssignee(issue.assigned_to);
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      <td class="col-rank"><span class="${rankClass}">${rank}</span></td>
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">
        <div class="wn-subject">${escapeHtml(issue.subject || '—')}</div>
        <div class="wn-reasons">${reasons}</div>
      </td>
      <td class="col-priority">${priHtml}</td>
      <td class="col-assignee-show">${escapeHtml(assignee)}</td>
      <td class="col-tracker">${escapeHtml(issue._projectLabel || '—')}</td>
      <td class="col-score" title="Urgency score">${issue._score}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="wn-legend">
      Ranked by <b>priority</b> (Immediate first) + <b>waiting time</b> + unassigned boost.
      Higher score = work on sooner.
    </div>
    <div class="tester-table-wrap">
      <table class="tester-table">
        <thead><tr>
          <th class="col-rank">#</th>
          <th class="col-id">Issue</th>
          <th class="col-subject">Description</th>
          <th class="col-priority">Priority</th>
          <th class="col-assignee-show">Assignee</th>
          <th class="col-tracker">Project</th>
          <th class="col-score">Score</th>
          <th class="col-open"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function copyWhatNextList(){
  const list = getFilteredWhatNext();
  if(!list.length){ toast('Nothing to copy', 'error'); return; }
  let text = `What Next — prioritized New issues (${list.length})\n\n`;
  list.forEach((i, idx) => {
    text += `${idx+1}. #${i.id} [${i.priority?.name || '—'}] ${i.subject || ''}\n`;
    text += `   ${i._projectLabel || ''} · score ${i._score} · ${(i._reasons||[]).join(', ')}\n`;
    text += `   https://pjm.zahironline.com/issues/${i.id}\n\n`;
  });
  try {
    await navigator.clipboard.writeText(text.trim());
    toast('Top list copied');
  } catch(_){
    toast('Copy failed', 'error');
  }
}


async function createPlanFromWhatNext(){
  const list = getFilteredWhatNext();
  if(!list.length){
    toast('No ranked issues to add', 'error');
    return;
  }
  const top = list.slice(0, 15);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const lines = top.map(i => {
    const url = `https://pjm.zahironline.com/issues/${i.id}`;
    const desc = (i.subject || '').trim();
    return desc ? `${url} ${desc}` : url;
  });
  // Infer project from What Next filter or majority of ranked issues
  let projectKey = ($('whatNextProjectFilter')?.value || 'all');
  if(projectKey === 'all'){
    const tally = {};
    top.forEach(i => {
      const k = getIssueProjectKey(i);
      if(k) tally[k] = (tally[k]||0)+1;
    });
    projectKey = Object.keys(tally).sort((a,b)=>tally[b]-tally[a])[0] || 'erp';
  }
  const data = {
    title: `What Next · ${projectKeyLabel(projectKey)} · ${iso}`,
    date: iso,
    projectKey,
    issues: lines.join('\n'),
    note: `Auto-created from What Next (${top.length} issues). Score-ranked New backlog.`
  };
  try {
    await CloudSync.addPlan(data);
    toast('Plan created from top What Next');
    switchView('plans');
  } catch(err){
    console.error(err);
    toast(err.message || 'Failed to create plan', 'error');
  }
}


async function refreshDashAttention(){
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = (typeof resolveNewIssueProjectIds === 'function') ? resolveNewIssueProjectIds() : [];
    let immediate = 0;
    let stuck = 0;
    let deploy = 0;

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId) return;
      try {
        const params = new URLSearchParams();
        params.set('status_name', 'New');
        params.set('project_id', String(t.projectId));
        params.set('limit', '100');
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`);
        (data.issues || []).forEach(i => {
          const pc = (typeof priorityClass === 'function') ? priorityClass(i.priority?.name) : '';
          if(pc === 'pri-immediate') immediate++;
        });
      } catch(_){}
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ['In Progress', 'On Progress', 'Progress'], false);
        (r.issues || []).forEach(i => {
          const days = (typeof daysSince === 'function') ? daysSince(i.updated_on || i.created_on) : 0;
          if(days >= 7) stuck++;
        });
      } catch(_){}
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ['On Deploy', 'Ondeploy', 'Deploy'], false);
        deploy += (r.issues || []).length;
      } catch(_){}
    }));

    set('attImmediateNew', String(immediate));
    set('attStuckProgress', String(stuck));
    set('attOnDeploy', String(deploy));
    window.__dashAttention = { immediate, stuck, deploy, at: Date.now() };
  } catch(err){
    console.warn('refreshDashAttention', err);
  }
}

function openWhatNextView(){
  switchView('whatnext');
  loadWhatNext(false);
}



/* ===== Background auto-refresh ===== */
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
let __autoRefreshTimer = null;

function startBackgroundAutoRefresh(){
  if(__autoRefreshTimer) return;
  __autoRefreshTimer = setInterval(() => {
    if(document.hidden) return;
    try {
      if(currentView === 'newissues') loadNewIssues(false);
      else if(currentView === 'activework') loadActiveWork(false);
      else if(currentView === 'whatnext') loadWhatNext(false);
      else if(currentView === 'tester') loadTesterReminder(false);
      else if(currentView === 'dashboard'){
        refreshDashNewIssueCounts();
        refreshDashAttention();
      }
      // Keep tester sidebar counts accurate even outside Tester Queue
      if(currentView !== 'tester'){
        prefetchTesterCount().catch(()=>{});
      }
    } catch(e){ console.warn('auto-refresh', e); }
  }, AUTO_REFRESH_MS);
}


const TG_CHAT_KEY = 'erp_telegram_chat_id';

function loadTelegramChatId(){
  try {
    const v = localStorage.getItem(TG_CHAT_KEY) || '';
    const input = $('telegramChatId');
    if(input) input.value = v;
    const st = $('telegramStatus');
    if(st) st.textContent = v ? ('Chat ID: ' + v) : 'Chat ID not set';
  } catch(_){}
}

function saveTelegramChatId(){
  const v = ($('telegramChatId')?.value || '').trim();
  try { localStorage.setItem(TG_CHAT_KEY, v); } catch(_){}
  loadTelegramChatId();
  toast(v ? 'Telegram Chat ID saved' : 'Chat ID cleared');
}

function buildTelegramBriefing(){
  const att = window.__dashAttention || {};
  const wn = (window.__whatNextList || []).slice(0, 8);
  let text = '📋 *Zahir ERP — Daily briefing*\n\n';
  text += `🔴 Immediate New: ${att.immediate ?? '—'}\n`;
  text += `⏳ Stuck In Progress (>7d): ${att.stuck ?? '—'}\n`;
  text += `🚀 On Deploy: ${att.deploy ?? '—'}\n\n`;
  if(wn.length){
    text += '*What Next (top)*\n';
    wn.forEach((i, idx) => {
      text += `${idx+1}. #${i.id} [${i.priority?.name||'—'}] ${i.subject||''}\n`;
      text += `https://pjm.zahironline.com/issues/${i.id}\n`;
    });
  }
  return text;
}

async function sendTelegramBriefing(){
  const chatId = ($('telegramChatId')?.value || localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId){
    toast('Set Telegram Chat ID in Settings first', 'error');
    switchView('settings');
    return;
  }
  // Ensure we have some data
  try {
    if(!(window.__whatNextList||[]).length) await loadWhatNext(false);
    if(!window.__dashAttention) await refreshDashAttention();
  } catch(_){}

  const text = buildTelegramBriefing();
  try {
    const r = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, text })
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      try { await navigator.clipboard.writeText(text); } catch(_){}
      const detail = data.hint || data.error || data.description || ('HTTP ' + r.status);
      toast('Telegram: ' + detail + ' — text copied', 'error');
      console.warn('[telegram]', r.status, data);
      return;
    }
    toast('Briefing sent to Telegram');
  } catch(err){
    try { await navigator.clipboard.writeText(text); } catch(_){}
    toast('Send failed — briefing copied to clipboard', 'error');
  }
}


/* ============================================================
   CREATE ISSUE → Redmine
   ============================================================ */
window.__ciMeta = window.__ciMeta || { trackers: [], priorities: [], categories: [] };

function openCreateIssueView(){
  switchView('createissue');
  ensureCreateIssueMeta();
}

async function ensureCreateIssueMeta(){
  const pid = $('ciProject')?.value;
  if(!pid){
    // still load trackers/priorities without categories
  }
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    // merge live projects into select if available
    const sel = $('ciProject');
    if(sel && (RedmineState.projects || []).length){
      const preferred = [
        { id: 75, label: 'Zahir ERP' },
        { id: 119, label: 'Zahir ERP One' },
        { id: 113, label: 'Zahir ERP Manufacturing' }
      ];
      const cur = sel.value;
      const opts = preferred.map(p => {
        const found = (RedmineState.projects || []).find(x => String(x.id) === String(p.id));
        return `<option value="${p.id}">${escapeHtml(found?.name || p.label)}</option>`;
      }).join('');
      sel.innerHTML = '<option value="">— Select project —</option>' + opts;
      if(cur) sel.value = cur;
    }
    // Default to Zahir ERP if nothing selected
    if(sel && !sel.value){
      sel.value = '75';
    }
    await loadCreateIssueMeta((sel && sel.value) || pid || '75');
  } catch(err){
    console.warn('ensureCreateIssueMeta', err);
  }
}


async function loadCreateIssueMeta(projectId){
  const q = projectId ? `?meta=1&project_id=${encodeURIComponent(projectId)}` : '?meta=1';
  try {
    const r = await fetch('/api/redmine-issue' + q);
    const data = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(data.error || r.status);
    window.__ciMeta = {
      trackers: data.trackers || [],
      priorities: data.priorities || [],
      categories: data.categories || []
    };
    fillCreateIssueSelects();
  } catch(err){
    toast('Failed to load Redmine metadata: ' + (err.message || err), 'error');
  }
}

function fillCreateIssueSelects(){
  const meta = window.__ciMeta || {};
  const tr = $('ciTracker');
  const pr = $('ciPriority');
  const cat = $('ciCategory');
  if(tr){
    const cur = tr.value;
    tr.innerHTML = '<option value="">— Select tracker —</option>' +
      (meta.trackers || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    if(cur) tr.value = cur;
  }
  if(pr){
    const cur = pr.value;
    pr.innerHTML = '<option value="">— Default —</option>' +
      (meta.priorities || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    // prefer Normal if exists
    if(!cur){
      const normal = (meta.priorities || []).find(p => /normal/i.test(p.name || ''));
      if(normal) pr.value = String(normal.id);
    } else pr.value = cur;
  }
  if(cat){
    const cur = cat.value;
    cat.innerHTML = '<option value="">— Optional —</option>' +
      (meta.categories || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    if(cur) cat.value = cur;
  }
}

async function onCreateIssueProjectChange(){
  const pid = $('ciProject')?.value;
  if(pid) await loadCreateIssueMeta(pid);
}

function generateIssueDescription(){
  const trackerSel = $('ciTracker');
  const trackerName = trackerSel?.selectedOptions?.[0]?.text || '';
  const subject = ($('ciSubject')?.value || '').trim();
  const notes = ($('ciNotes')?.value || '').trim();
  const catName = $('ciCategory')?.selectedOptions?.[0]?.text || '';
  const kind = classifyIssueKind(trackerName, subject + ' ' + notes);

  const bullets = notes
    ? notes.split(/\n+/).map(s => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean)
    : [];

  let desc = '';
  const header = subject ? `**${subject}**\n\n` : '';

  if(kind === 'bug'){
    desc = header;
    desc += `## Summary\n${bullets[0] || subject || '(brief summary of the bug)'}\n\n`;
    desc += `## Steps to Reproduce\n`;
    if(bullets.length > 1){
      bullets.slice(1).forEach((b, i) => { desc += `${i + 1}. ${b}\n`; });
    } else {
      desc += `1. Open the related menu/module\n2. Perform the action that triggers the issue\n3. Observe the result\n`;
    }
    desc += `\n## Expected Result\n- (what should happen)\n\n`;
    desc += `## Actual Result\n- ${bullets[0] || '(what actually happens)'}\n\n`;
    desc += `## Environment\n`;
    desc += `- Module / area: ${catName && catName !== '— Optional —' ? catName : '(FE / BE / …)'}\n`;
    desc += `- Project: ${$('ciProject')?.selectedOptions?.[0]?.text || '—'}\n`;
    desc += `\n## Notes\n${notes || '- '}\n`;
  } else if(kind === 'optimization'){
    desc = header;
    desc += `## Goal\n${bullets[0] || subject || '(what to optimize)'}\n\n`;
    desc += `## Current Behavior\n- (describe current performance / flow)\n\n`;
    desc += `## Proposed Improvement\n`;
    (bullets.length ? bullets : ['(describe the change)']).forEach(b => { desc += `- ${b}\n`; });
    desc += `\n## Acceptance Criteria\n- Measurable improvement or clearer UX\n- No regression on related flows\n`;
  } else if(kind === 'enhancement'){
    desc = header;
    desc += `## Enhancement\n${bullets[0] || subject || '(what to improve)'}\n\n`;
    desc += `## Why\n- (business / user reason)\n\n`;
    desc += `## Proposed Behavior\n`;
    (bullets.length ? bullets : ['(describe expected behavior)']).forEach(b => { desc += `- ${b}\n`; });
    desc += `\n## Acceptance Criteria\n- Behavior matches description\n- Existing flows still work\n`;
  } else {
    // feature / other
    desc = header;
    desc += `## Feature Overview\n${bullets[0] || subject || '(what to build)'}\n\n`;
    desc += `## Requirements\n`;
    (bullets.length ? bullets : ['(list functional requirements)']).forEach(b => { desc += `- ${b}\n`; });
    desc += `\n## Acceptance Criteria\n- All requirements above are met\n- Covered by basic manual test\n`;
    desc += `\n## Out of Scope\n- (optional)\n`;
  }

  if($('ciDescription')) $('ciDescription').value = desc.trim() + '\n';
  toast('Description generated — edit as needed');
}

function resetCreateIssueForm(){
  $('createIssueForm')?.reset();
  const box = $('ciResult');
  if(box){ box.style.display = 'none'; box.innerHTML = ''; }
  fillCreateIssueSelects();
}

async function submitCreateIssue(e){
  e.preventDefault();
  const btn = $('ciSubmitBtn');
  if(btn) btn.disabled = true;

  const projectEl = $('ciProject');
  const trackerEl = $('ciTracker');
  const project_id = (projectEl?.value || '').trim();
  const tracker_id = (trackerEl?.value || '').trim();
  const subject = ($('ciSubject')?.value || '').trim();
  const description = ($('ciDescription')?.value || '').trim();

  if(!project_id){
    toast('Please select a Project first', 'error');
    projectEl?.focus();
    if(btn) btn.disabled = false;
    return;
  }
  if(!tracker_id){
    toast('Please select a Tracker (Bug / Feature / …)', 'error');
    trackerEl?.focus();
    if(btn) btn.disabled = false;
    return;
  }
  if(!subject || !description){
    toast('Subject and description are required', 'error');
    if(btn) btn.disabled = false;
    return;
  }

  const payload = {
    project_id: Number(project_id),
    tracker_id: Number(tracker_id),
    subject,
    description
  };
  const pr = ($('ciPriority')?.value || '').trim();
  const cat = ($('ciCategory')?.value || '').trim();
  if(pr) payload.priority_id = Number(pr);
  if(cat) payload.category_id = Number(cat);

  try {
    const r = await fetch('/api/redmine-issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      const detail = Array.isArray(data.detail) ? data.detail.join(', ') : (data.detail || data.error || r.status);
      const hint = data.hint ? ' — ' + data.hint : '';
      const extra = data.sent ? ` (project_id=${data.sent.project_id})` : '';
      throw new Error((typeof detail === 'string' ? detail : JSON.stringify(detail)) + extra + hint);
    }
    const url = data.url || (data.id ? `https://pjm.zahironline.com/issues/${data.id}` : '');
    const box = $('ciResult');
    if(box){
      box.style.display = 'block';
      box.className = 'sync-status-box';
      box.innerHTML = `<div class="box-body"><b>Created #${data.id}</b><br>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : ''}</div>`;
    }
    toast(`Issue #${data.id} created on Redmine`);
    if($('ciSubject')) $('ciSubject').value = '';
    if($('ciNotes')) $('ciNotes').value = '';
    if($('ciDescription')) $('ciDescription').value = '';
  } catch(err){
    toast('Create failed: ' + (err.message || err), 'error');
  } finally {
    if(btn) btn.disabled = false;
  }
}




/* ============================================================
   PUBLIC SHARE LINK (no workspace / no login)
   Data is embedded in the URL hash — anyone with the link can view.
   ============================================================ */
function encodeSharePayload(obj){
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSharePayload(str){
  try {
    const b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch(err){
    console.warn('decodeSharePayload', err);
    return null;
  }
}

function buildPlanShareData(plan){
  if(!plan) return null;
  const issues = parseIssueLines(plan.issues || '').map(it => ({
    url: it.url || '',
    number: it.number || '',
    description: it.description || '',
    category: it.category || '',
    tracker: it.tracker || ''
  }));
  return {
    v: 1,
    title: plan.title || 'Update Plan',
    date: plan.date || '',
    note: plan.note || '',
    projectKey: plan.projectKey || '',
    issues
  };
}

async function copyPlanShareLink(planId){
  const plan = State.plans.get(planId);
  if(!plan){ toast('Plan not found', 'error'); return; }
  const data = buildPlanShareData(plan);
  if(!data){ toast('Nothing to share', 'error'); return; }

  // Short link via Firestore: /share?id=xxxxxxxx
  try {
    if(!auth?.currentUser){
      throw new Error('Sign in required to create a short share link');
    }
    const id = makeShareId();
    await db.collection('shares').doc(id).set({
      v: 1,
      title: data.title || 'Update Plan',
      date: data.date || '',
      note: data.note || '',
      projectKey: data.projectKey || '',
      issues: data.issues || [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.currentUser.uid
    });
    const url = `${location.origin}/share?id=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Short share link copied');
    } catch(_){
      prompt('Copy this share link:', url);
    }
    closeAllCopyMenus();
    return;
  } catch(err){
    console.warn('short share failed', err);
    // Fallback: long hash link (still works offline)
    try {
      const token = encodeSharePayload(data);
      if(token.length > 12000){
        toast('Could not create share link. Check Firestore rules for /shares, or use Copy for Telegram.', 'error');
        return;
      }
      const url = `${location.origin}/share.html#${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('Share link copied (long form — publish Firestore /shares rules for short links)');
      } catch(_){
        prompt('Copy this share link:', url);
      }
    } catch(e2){
      toast('Share failed: ' + (err.message || err), 'error');
    }
  }
  closeAllCopyMenus();
}

function makeShareId(){
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for(let i = 0; i < arr.length; i++) id += alphabet[arr[i] % alphabet.length];
  return id;
}


function isShareRoute(){
  try {
    const q = new URLSearchParams(location.search);
    return q.get('view') === 'share' || (location.hash && location.hash.length > 20 && q.get('view') === 'share');
  } catch(_){ return false; }
}

function loadSharedPlanFromUrl(){
  const body = $('shareBody');
  if(!body) return;
  const hash = (location.hash || '').replace(/^#/, '');
  if(!hash){
    body.innerHTML = `<div class="empty" style="padding:40px 16px"><p style="margin:0;color:var(--text-tertiary)">Invalid share link (missing data).</p></div>`;
    return;
  }
  const data = decodeSharePayload(hash);
  if(!data || !Array.isArray(data.issues)){
    body.innerHTML = `<div class="empty" style="padding:40px 16px"><p style="margin:0;color:var(--text-tertiary)">Could not read this share link.</p></div>`;
    return;
  }
  renderSharedPlan(data);
}

function renderSharedPlan(data){
  const body = $('shareBody');
  if(!body) return;
  const issues = data.issues || [];
  const rows = issues.map((it, idx) => {
    const num = it.number || (it.url || '').match(/\/issues\/(\d+)/)?.[1] || '';
    const url = it.url || (num ? `https://pjm.zahironline.com/issues/${num}` : '#');
    const cat = it.category ? `<span class="sp-cat">${escapeHtml(it.category)}</span>` : '';
    const trk = it.tracker ? `<span class="meta-chip" style="font-size:11px">${escapeHtml(it.tracker)}</span>` : '';
    return `<tr>
      <td class="share-num">${idx + 1}</td>
      <td class="share-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">#${escapeHtml(String(num || '—'))}</a></td>
      <td class="share-desc">${escapeHtml(it.description || '')}</td>
      <td>${cat} ${trk}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="share-card">
      <h2 class="share-title">${escapeHtml(data.title || 'Update Plan')}</h2>
      <div class="share-meta">
        ${data.date ? `<span>📅 ${escapeHtml(formatDate(data.date) || data.date)}</span>` : ''}
        <span>${issues.length} issue(s)</span>
        ${data.projectKey ? `<span class="meta-chip">${escapeHtml(data.projectKey)}</span>` : ''}
      </div>
      ${data.note ? `<p class="share-note">${escapeHtml(data.note)}</p>` : ''}
      <div class="share-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="copySharedIssueLinks()">Copy all links</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="copySharedTelegram()">Copy for Telegram</button>
      </div>
      <div class="table-wrap share-table-wrap">
        <table class="data-table share-table">
          <thead>
            <tr><th>#</th><th>Issue</th><th>Description</th><th>Category</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">No issues</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  window.__sharedPlanData = data;
}

function copySharedIssueLinks(){
  const data = window.__sharedPlanData;
  if(!data) return;
  const lines = (data.issues || []).map(it => it.url || (it.number ? `https://pjm.zahironline.com/issues/${it.number}` : '')).filter(Boolean);
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Links copied')).catch(() => toast('Copy failed', 'error'));
}

function copySharedTelegram(){
  const data = window.__sharedPlanData;
  if(!data) return;
  const lines = (data.issues || []).map(it => {
    const url = it.url || (it.number ? `https://pjm.zahironline.com/issues/${it.number}` : '');
    return url;
  }).filter(Boolean);
  const text = `${data.title || 'Update Plan'}\n\n` + lines.join('\n');
  navigator.clipboard.writeText(text).then(() => toast('Copied for Telegram')).catch(() => toast('Copy failed', 'error'));
}

function bootShareMode(){
  // Hide auth gate & show app shell for public share
  const gate = $('authGate');
  if(gate) gate.classList.add('hidden');
  const loading = $('loadingScreen') || $('appLoading');
  if(loading) loading.classList.add('hidden');
  document.body.classList.add('share-mode');
  // Hide sidebar nav complexity for pure share? keep simple - just switch view
  try {
    switchView('share', { replaceUrl: true });
  } catch(_){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const v = $('view-share');
    if(v) v.classList.add('active');
  }
  loadSharedPlanFromUrl();
  // Minimal chrome: still show topbar version
  updateNotifToggleUI?.();
}


function exposeAppGlobals(){
  const map = {
    openTesterCategory, switchView, toggleSidebar, openAddModal, closeModal,
    setPlanFilter, renderPlans, renderSummaries, renderTesterList,
    loadTesterReminder, copyTesterList, openPlansWithSync, toggleSyncPanel,
    previewRedmineSync, syncFromRedmine, testRedmineConnection, onRedmineProjectChange,
    onDatePresetChange, onPlanRefChange, addIssueRow, autoGenerate, removeIssueRow,
    exportAll, importAll, wipeAll, copyUID,
    signInWithGoogle, signOutAccount, continueAsGuest,
    joinWorkspace, usePersonalWorkspace, copyWorkspaceId,
    toggleTesterNotifications, pushNotifRecent, markNotifSeen, renderNotifRecent, toggleNotifPanel, closeNotifPanel,
    // Plan cards
    togglePlanCard, toggleCopyMenu, closeAllCopyMenus, copyPlan, copyPlanShareLink, makeShareId, bootShareMode, loadSharedPlanFromUrl, copySharedIssueLinks, copySharedTelegram, editPlan, deletePlan, savePlan,
    // Summaries
    editSummary, deleteSummary, copySummary, quickSummary, saveSummary, resetSummaryForm, resetPlanForm,
    finishSyncAndShowPlans,
    openNewIssuesView, loadNewIssues, renderNewIssues, copyNewIssueLinks, copyAllNewIssueLinks, refreshDashNewIssueCounts,
    openActiveWorkView, openCreateIssueView, onCreateIssueProjectChange, generateIssueDescription, submitCreateIssue, resetCreateIssueForm, loadActiveWork, renderActiveWork, copyActiveWorkLinks,
    openWhatNextView, loadWhatNext, renderWhatNext, copyWhatNextList, createPlanFromWhatNext,
    applyRouteFromUrl, syncUrlToRoute,
    refreshDashAttention, saveTelegramChatId, sendTelegramBriefing, loadTelegramChatId, setTelegramRftEnabled, isTelegramRftEnabled, testTelegramRftAlert, checkTesterNotifications,
    CloudSync
  };
  Object.keys(map).forEach(k => {
    try {
      if(typeof map[k] === 'function' || (map[k] && typeof map[k] === 'object')) {
        window[k] = map[k];
      }
    } catch(e){ console.warn('expose failed', k, e); }
  });
}

export async function startApp(){
  exposeAppGlobals();
  try { startBackgroundAutoRefresh(); } catch(_){}
  try { loadTelegramChatId(); } catch(_){}

  // Restore notification preference
  try {
    updateNotifToggleUI();
    try {
      const tgOn = document.getElementById('telegramRftToggle');
      if(tgOn) tgOn.checked = isTelegramRftEnabled();
    } catch(_){}
    // Always poll RFT for accurate sidebar counts + Telegram alerts
    startTesterNotifPoll();
    // Lightweight sidebar counts (limit=1 per project)
    setTimeout(() => {
      prefetchNewIssueCounts().catch(()=>{});
      prefetchActiveWorkCounts().catch(()=>{});
    }, 2500);
    document.addEventListener('click', (e) => {
      const wrap = $('notifBellWrap');
      if(wrap && !wrap.contains(e.target)) closeNotifPanel();
    });
  } catch(_){}

  // Formerly DOMContentLoaded handler
  // Show version immediately
  applyAppVersion();

  const okBtn = $('confirmOkBtn');
  const cancelBtn = $('confirmCancelBtn');
  const confirmOverlay = $('confirmModal');
  if(okBtn) okBtn.addEventListener('click', ()=> _closeConfirm(true));
  if(cancelBtn) cancelBtn.addEventListener('click', ()=> _closeConfirm(false));
  if(confirmOverlay) confirmOverlay.addEventListener('click', (e)=> {
    if(e.target === confirmOverlay) _closeConfirm(false);
  });

  document.addEventListener('keydown', (e)=>{
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;

    if(e.key === 'Escape'){
      if(confirmOverlay && confirmOverlay.classList.contains('show')){
        _closeConfirm(false);
      }
      closeAllCopyMenus();
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
      return;
    }

    // Don't trigger shortcuts while typing
    if(typing || e.metaKey || e.ctrlKey || e.altKey) return;

    // / → focus search on current list view
    if(e.key === '/'){
      e.preventDefault();
      const input = currentView === 'summaries' ? $('summarySearch') : $('planSearch');
      if(currentView !== 'plans' && currentView !== 'summaries'){
        switchView('plans');
      }
      setTimeout(()=> (currentView === 'summaries' ? $('summarySearch') : $('planSearch'))?.focus(), 50);
      return;
    }

    // N → new item
    if(e.key === 'n' || e.key === 'N'){
      e.preventDefault();
      if(currentView === 'summaries'){
        openAddModal();
      } else if(currentView === 'plans' || currentView === 'dashboard'){
        if(currentView !== 'plans') switchView('plans');
        openAddModal();
      }
    }
  });

  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if(e.target === ov) closeModal(ov.id); });
  });

  ThemeManager.init();
  $('planDate').value = todayISO();
  $('summaryDate').value = todayISO();

  // Init Redmine date filter — default: Today
  if ($('syncDatePreset')) $('syncDatePreset').value = 'today';
  if ($('syncFrom')) $('syncFrom').value = todayISO();
  if ($('syncTo'))   $('syncTo').value   = todayISO();
  onDatePresetChange();

  setIssueLines([]);
  renderAll();
  try { initRouter(); } catch(_){}
  try { applyRouteFromUrl({ replaceUrl: true }); } catch(_){ switchView('dashboard'); }

    // Public share link — skip login gate
  try {
    const q = new URLSearchParams(location.search);
    if(q.get('view') === 'share'){
      bootShareMode();
      return;
    }
  } catch(_){}

  $('loadingText').textContent = 'Connecting to Firebase...';

  // Restore session (Google) or fall back to anonymous guest
  // Complete Google redirect sign-in (mobile)
  try {
    const redirectResult = await auth.getRedirectResult();
    if(redirectResult && redirectResult.user){
      sessionStorage.removeItem('erp_auth_redirect');
      sessionStorage.removeItem('erp_guest_ok');
      console.log('✅ Google redirect sign-in:', redirectResult.user.email || redirectResult.user.uid);
    }
  } catch(redirErr){
    console.warn('Redirect sign-in error:', redirErr);
    const errEl = $('authError');
    if(errEl) errEl.textContent = redirErr.message || 'Google sign-in failed';
  }

  let __authBootstrapped = false;
  let __authSigningIn = false;
  auth.onAuthStateChanged(async (user) => {
    try {
      if(!user){
        // No Firebase session → show login (don't auto-anonymous unless guest chosen)
        showAuthGate();
        return;
      }

      // Already loaded same user
      if(__authBootstrapped && CloudSync.uid === user.uid){
        updateAccountUI(user);
        if(isGoogleUser(user) || sessionStorage.getItem('erp_guest_ok') === '1'){
          hideAuthGate();
        }
        return;
      }

      console.log('✅ Auth session:', user.isAnonymous ? 'anonymous' : (user.email || user.uid));

      // Require Google unless user chose guest this session
      if(isAnonymousUser(user) && sessionStorage.getItem('erp_guest_ok') !== '1'){
        showAuthGate();
        updateAccountUI(user);
        return;
      }

      __authBootstrapped = true;
      hideAuthGate();
      await startAppForUser(user);
      // If we just returned from Google redirect with a snapshot, import it
      if(!isAnonymousUser(user)){
        await maybeMigrateGuestDataToCurrentUser();
      }
    } catch(err) {
      console.error('❌ Auth failed:', err);
      setSyncStatus('error', 'Auth failed');
      const msgMap = {
        'auth/unauthorized-domain': `Domain <b>${location.hostname}</b> is not authorized in Firebase Console.<br>Go to: Authentication → Settings → Authorized domains → Add domain.`,
        'auth/operation-not-allowed': 'Sign-in method not enabled.<br>Enable Anonymous and/or Google in Firebase Console → Authentication → Sign-in method.',
        'auth/network-request-failed': 'Could not reach Firebase. Check your internet or disable adblock.',
        'auth/invalid-api-key': 'Firebase API key is invalid.'
      };
      const friendly = msgMap[err.code] || `Error: ${err.code || err.message}`;
      $('loadingText').innerHTML = `
        <div style="max-width:420px;text-align:center;color:#ef4444;font-weight:600;margin-bottom:8px">
          Failed to connect to Firebase
        </div>
        <div style="max-width:420px;text-align:center;color:var(--text-secondary);font-size:12.5px;line-height:1.6">
          ${friendly}
        </div>`;
    }
  });

  applyAppVersion();

  // PWA service worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').then((reg)=>{
      console.log('SW registered', reg.scope);
    }).catch((err)=>{
      console.warn('SW registration failed', err);
    });
  }
}

