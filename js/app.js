/* ============================================================
   ZAHIR ERP UPDATE MANAGER — APP LOGIC
   ============================================================ */

/* ============================================================
   APP VERSION — single source of truth
   Bump this every time you deploy a meaningful change.
   Format: MAJOR.MINOR.PATCH
   ============================================================ */
const APP_VERSION = '4.16.2';
const APP_VERSION_DATE = '2026-09-23';   // YYYY-MM-DD
const APP_VERSION_NOTE = 'Mobile Google login via redirect (no popup)';

/* Plan list filter state */
window.__planFilter = window.__planFilter || 'all';
window.__expandedPlans = window.__expandedPlans || new Set();

/* ============================================================
   FIREBASE INIT
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyA9EXEDl79MzQkO4k181BH4SQPE6lOArGg",
  authDomain: "erpupdate-f0b18.firebaseapp.com",
  projectId: "erpupdate-f0b18",
  storageBucket: "erpupdate-f0b18.firebasestorage.app",
  messagingSenderId: "500016291571",
  appId: "1:500016291571:web:455e3a23ce8f8597142186",
  measurementId: "G-WNPME76HRK"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ============================================================
   REDMINE STATE
   ============================================================ */
const RedmineState = {
  projects: [],
  selectedProjectId: null,
  loaded: false
};

const REDMINE_STORAGE_KEY = 'zahir-redmine-project';

/* Track which copy dropdown is currently open (survives re-render) */
window.__openCopyMenuId = window.__openCopyMenuId || null;

/* ============================================================
   HELPERS
   ============================================================ */
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const todayISO = () => new Date().toISOString().split('T')[0];

function toast(msg, type){
  const t = $('toast');
  if(!t) return;
  const icon = type === 'error' ? ICON.alert : ICON.check;
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  t.classList.add('show');
  clearTimeout(t._t);
  // Errors stay longer so user can read them
  const ms = type === 'error' ? 5200 : 2600;
  t._t = setTimeout(()=>t.classList.remove('show'), ms);
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
  if(!line) return { url:'', description:'' };
  const trimmed = String(line).trim();
  const sepIdx = trimmed.indexOf('|');
  if(sepIdx > -1){
    const url = trimmed.slice(0, sepIdx).trim();
    const description = trimmed.slice(sepIdx + 1).trim();
    return { url, description };
  }
  return { url: trimmed, description: '' };
}

function parseIssueLines(text){
  return (text||'').split('\n').map(s=>s.trim()).filter(Boolean).map(line => {
    const { url, description } = parseIssueLine(line);
    return { url, description, number: extractIssueNumber(url) };
  });
}

/* ============================================================
   ICON LIBRARY
   ============================================================ */
const ICON = {
  calendar:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  hash:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
  fileText:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  clipboard:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  check:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  edit:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  plus:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  messageSquare:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  inbox:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  alert:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  warning:'<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger:'<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  externalLink:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  chevronDown:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  info:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

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

  async init(uid){
    this.uid = uid;
    this.plansRef = db.collection('users').doc(uid).collection('plans');
    this.summariesRef = db.collection('users').doc(uid).collection('summaries');
    const uidEl = $('userUID');
    if(uidEl) uidEl.textContent = uid;

    setSyncStatus('syncing', 'Syncing');
    await this.pullAll();
    this.subscribe();
    setSyncStatus('online', 'Synced');
    updateLastSync();
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

function switchView(view){
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => {
    if(view === 'tester' && b.dataset.testerCat){
      b.classList.toggle('active', b.dataset.testerCat === (window.__testerCategory || 'frontend'));
    } else {
      b.classList.toggle('active', b.dataset.view===view && !b.dataset.testerCat);
    }
  });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-'+view));
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
    const cat = window.__testerCategory || 'frontend';
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

function togglePlanCard(planId, event){
  if(event){
    event.stopPropagation();
  }
  if(window.__expandedPlans.has(planId)){
    window.__expandedPlans.delete(planId);
  } else {
    window.__expandedPlans.add(planId);
  }
  renderPlans();
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

  if(format === 'telegram'){
    let out = `📋 *${title}*\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${parsed.length} issues\n\n`;
    parsed.forEach((p)=>{
      const num = p.number || '—';
      out += `• [#${num}](${p.url})\n`;
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
    telegram: 'Telegram format'
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

  const row = document.createElement('div');
  row.className = 'issue-row-input';
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
    if(!url) return;
    if(desc) out.push(`${url} | ${desc}`);
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
    issues: issues.join('\n'),
    note: $('planNote').value.trim()
  };

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

function renderPlans(){
  const q = ($('planSearch')?.value || '').toLowerCase().trim();
  const sort = $('planSort')?.value || 'desc';
  const filter = window.__planFilter || 'all';
  let list = [...State.plans.all()];

  if(q){
    list = list.filter(x =>
      (x.title||'').toLowerCase().includes(q) ||
      (x.date||'').includes(q) ||
      (x.issues||'').toLowerCase().includes(q) ||
      (x.note||'').toLowerCase().includes(q)
    );
  }

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

  el.innerHTML = `<div class="plan-list">` + list.map(d => renderPlanCard(d)).join('') + `</div>`;
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
    return `<div class="plan-issue-row">
      <a class="pi-num" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open in Redmine">#${escapeHtml(num)}</a>
      <span class="pi-desc">${escapeHtml(desc || url)}</span>
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
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'telegram')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 3.5L2.5 10.5l6.5 2.5L11 20l3.5-4.5 6.5 3z"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Telegram format</span>
                <span class="mi-desc">Markdown link + description</span>
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
    plans.map(p=>`<option value="${p.id}">${escapeHtml(p.title)} · ${escapeHtml(formatDate(p.date))}</option>`).join('');
  if(selected) sel.value = selected;
}

function onPlanRefChange(){
  const planId = $('summaryPlanRef').value;
  if(!planId) return;
  const p = State.plans.get(planId);
  if(p && p.date && !$('summaryDate').value) $('summaryDate').value = p.date;
}

function autoGenerate(){
  const planId = $('summaryPlanRef').value;
  if(!planId){ toast('Please select an Update Plan first', 'error'); return; }
  const p = State.plans.get(planId);
  if(!p){ toast('Plan not found', 'error'); return; }
  const fe = $('summaryFe').value.trim() || 'V?.??.??.??????';
  const v2 = $('summaryV2').value.trim() || 'V?.??.??.??????';
  const v3 = $('summaryV3').value.trim();
  const tgl = $('summaryDate').value ? formatDate($('summaryDate').value) : formatDate(p.date || todayISO());
  const parsed = parseIssueLines(p.issues);
  const tpl = $('summaryTemplate')?.value || 'wa';

  const issueLines = parsed.length
    ? parsed.map(it => {
        const num = it.number || '—';
        const desc = it.description || '';
        return { num, desc, url: it.url };
      })
    : [{ num: 'xxxxx', desc: '', url: '' }];

  let text = '';

  if(tpl === 'wa-short'){
    text = `🚀 *Zahir ERP Update* — ${tgl}\n`;
    text += `FE ${fe} · V2 ${v2}${v3 ? ' · V3 '+v3 : ''}\n\n`;
    issueLines.forEach(it => {
      text += `• #${it.num}${it.desc ? ' — '+it.desc : ''}\n`;
    });
  } else if(tpl === 'telegram'){
    text = `🚀 *Zahir ERP Update*\n\n`;
    text += `FE: \`${fe}\`\nV2: \`${v2}\`\n`;
    if(v3) text += `V3: \`${v3}\`\n`;
    text += `📅 ${tgl}\n\n`;
    text += `*Improvements*\n`;
    issueLines.forEach(it => {
      const link = it.url ? `[#${it.num}](${it.url})` : `#${it.num}`;
      text += `• ${link}${it.desc ? ' — '+it.desc : ''}\n`;
    });
    text += `\n*Bug Fixes*\n• `;
  } else {
    // WA formal (default)
    text = `🚀 Zahir ERP Update\n\n`;
    text += `FE Version : ${fe}\n`;
    text += `V2 Version : ${v2}\n`;
    if(v3) text += `V3 Version : ${v3}\n`;
    text += `Date : ${tgl}\n\n`;
    text += `⚡ Improvements\n`;
    issueLines.forEach(it => {
      text += `• [#${it.num}] ${it.desc}\n`;
    });
    text += `\n🛠️ Bug Fixes\n• [#xxxxx] \n`;
  }

  $('summaryText').value = text;
  toast('Template generated (' + (tpl === 'wa-short' ? 'WA singkat' : tpl === 'telegram' ? 'Telegram' : 'WA formal') + ')');
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
  const q = ($('summarySearch').value || '').toLowerCase().trim();
  const sort = $('summarySort').value;
  let list = [...State.summaries.all()];

  if(q){
    list = list.filter(x =>
      (x.fe||'').toLowerCase().includes(q) ||
      (x.v2||'').toLowerCase().includes(q) ||
      (x.v3||'').toLowerCase().includes(q) ||
      (x.date||'').includes(q) ||
      (x.text||'').toLowerCase().includes(q)
    );
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
  TTL_MS: 2 * 60 * 1000, // 2 minutes
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
const TESTER_CAT_LABELS = {
  frontend: 'Front End',
  backend: 'Backend',
  design: 'Design',
  other: 'Other'
};

window.__testerCategory = window.__testerCategory || 'frontend';

const RFT_STATUS_CACHE_KEY = 'erp_rft_status_id';

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
  if(/front\s*-?\s*end|^fe$|frontend/.test(s)) return 'frontend';
  if(/back\s*-?\s*end|^be$|backend|server/.test(s)) return 'backend';
  if(/design|ui\/?ux|^ui$|^ux$|figma/.test(s)) return 'design';
  return 'other';
}

function getIssueTesterCategory(issue){
  return normalizeTesterCategory(issue?.category?.name);
}

function openTesterCategory(cat){
  const key = TESTER_CAT_LABELS[cat] ? cat : 'other';
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

  switchView('tester');
  // Re-apply active on the category button after switchView (it sets by data-view only)
  document.querySelectorAll('.nav-item[data-tester-cat]').forEach(b => {
    b.classList.toggle('active', b.dataset.testerCat === key);
  });
  renderTesterList();
  updateTesterCategoryBadges();
}

function updateTesterCategoryBadges(){
  const issues = window.__testerIssues || [];
  const counts = { frontend:0, backend:0, design:0, other:0 };
  issues.forEach(i => { counts[getIssueTesterCategory(i)]++; });

  const map = {
    frontend: 'countTesterFrontend',
    backend: 'countTesterBackend',
    design: 'countTesterDesign',
    other: 'countTesterOther'
  };
  Object.keys(map).forEach(k => {
    const el = $(map[k]);
    if(el) el.textContent = String(counts[k]);
    const nav = document.querySelector(`.nav-item[data-tester-cat="${k}"]`);
    if(nav) nav.classList.toggle('has-queue', counts[k] > 0);
  });

  // Badge in card = current category count
  const cat = window.__testerCategory || 'frontend';
  const n = counts[cat] ?? issues.length;
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

function getFilteredTesterIssues(){
  const q = ($('testerSearch')?.value || '').toLowerCase().trim();
  const cat = window.__testerCategory || 'frontend';

  return (window.__testerIssues || []).filter(i => {
    if(getIssueTesterCategory(i) !== cat) return false;
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

function renderTesterTableRows(list){
  return list.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const updated = issue.updated_on ? formatDate(issue.updated_on.slice(0, 10)) : '—';
    const priority = issue.priority?.name || '—';
    const tracker = issue.tracker?.name || '—';
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject" title="${escapeHtml(issue.subject || '')}">${escapeHtml(issue.subject || '—')}</td>
      <td class="col-priority">${escapeHtml(priority)}</td>
      <td class="col-tracker">${escapeHtml(tracker)}</td>
      <td class="col-updated">${escapeHtml(updated)}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in Redmine">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');
}

function renderTesterTable(list){
  return `<div class="tester-table-wrap">
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
  </div>`;
}

function renderTesterList(){
  const el = $('testerReminder');
  if(!el) return;

  const all = window.__testerIssues || [];
  if(!all.length){
    el.innerHTML = emptyState(ICON.check, 'No testing queue', 'No issues with status Ready for Testing in this project. If this looks wrong, click Refresh — Redmine may have been temporarily unavailable.');
    return;
  }

  const list = getFilteredTesterIssues();
  if(!list.length){
    const catLabel = (window.TESTER_CAT_LABELS && window.TESTER_CAT_LABELS[window.__testerCategory]) || window.__testerCategory || 'this category';
    el.innerHTML = emptyState(ICON.inbox, `No issues in ${catLabel}`, `There are ${all.length} Ready for Testing issue(s) total, but none in this category.`, [
      { label: 'Clear search', action: "$('testerSearch').value=''; renderTesterList();" }
    ]);
    return;
  }

  const groupBy = $('testerGroupBy')?.value || 'assignee';
  const cacheNote = window.__testerMeta?.fromCache
    ? `<div class="tester-cache-note">📦 From cache · click Refresh for latest data</div>`
    : '';

  if(groupBy === 'none'){
    el.innerHTML = cacheNote + renderTesterTable(list);
    return;
  }

  const groups = {};
  list.forEach(i => {
    const key = groupBy === 'priority'
      ? (i.priority?.name || 'No priority')
      : (i.assigned_to?.name || 'Unassigned');
    if(!groups[key]) groups[key] = [];
    groups[key].push(i);
  });

  const keys = Object.keys(groups).sort((a,b) => groups[b].length - groups[a].length || a.localeCompare(b));

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
      text += `   ${i.assigned_to?.name || 'Unassigned'}${i.priority?.name ? ' · '+i.priority.name : ''}\n`;
      text += `   https://pjm.zahironline.com/issues/${i.id}\n\n`;
    });
  } else {
    const groups = {};
    list.forEach(i => {
      const key = groupBy === 'priority'
        ? (i.priority?.name || 'No priority')
        : (i.assigned_to?.name || 'Unassigned');
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

  const pid = getSelectedProjectId();
  if(!pid){
    el.innerHTML = emptyState(ICON.inbox, 'Select a project first', 'Open Sync from Redmine, pick a project, then refresh here.', [
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
    el.innerHTML = `<div class="empty" style="padding:28px 16px"><p style="margin:0;color:var(--text-tertiary);font-size:13px">Loading Ready for Testing issues…</p></div>`;
  }

  try {
    const params = new URLSearchParams();
    const cachedSid = getCachedRftStatusId();
    if(cachedSid){
      params.set('status_id', cachedSid);
    } else {
      params.set('status_name', 'Ready for Testing');
    }
    params.set('project_id', pid);
    params.set('limit', '100');
    params.set('sort', 'updated_on:desc');
    const path = `/api/redmine?${params.toString()}`;

    let data, fromCache;
    try {
      ({ data, fromCache } = await fetchRedmine(path, { force: !!force }));
    } catch(firstErr){
      // If cached status_id failed / stale, retry once via status_name
      if(cachedSid){
        const p2 = new URLSearchParams();
        p2.set('status_name', 'Ready for Testing');
        p2.set('project_id', pid);
        p2.set('limit', '100');
        p2.set('sort', 'updated_on:desc');
        ({ data, fromCache } = await fetchRedmine(`/api/redmine?${p2.toString()}`, { force: true }));
      } else {
        throw firstErr;
      }
    }

    if(data.resolved_status?.id){
      setCachedRftStatusId(data.resolved_status.id, data.resolved_status.name);
    }

    const issues = data.issues || [];
    window.__testerIssues = issues;
    window.__testerAssigneeFilter = 'all';
    window.__testerMeta = {
      fromCache: !!fromCache,
      statusName: data.resolved_status?.name || localStorage.getItem(RFT_STATUS_CACHE_KEY + '_name') || 'Ready for Testing'
    };

    if(statusLabel) statusLabel.textContent = window.__testerMeta.statusName;
    setTesterBadgeCount(issues.length);
    updateTesterCategoryBadges();

    if(force && $('testerSearch')) $('testerSearch').value = '';
    renderTesterAssigneeChips();
    renderTesterList();

    if(force && !fromCache) toast('Tester queue updated');
  } catch(err){
    console.error('Tester reminder failed:', err);
    const friendly = err.friendly || { title: 'Failed to load', message: err.message };
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
    const pid = getSelectedProjectId();
    if(!pid) return;
    const params = new URLSearchParams();
    const cachedSid = getCachedRftStatusId();
    if(cachedSid) params.set('status_id', cachedSid);
    else params.set('status_name', 'Ready for Testing');
    params.set('project_id', pid);
    params.set('limit', '100');
    params.set('sort', 'updated_on:desc');
    const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`);
    if(data.resolved_status?.id) setCachedRftStatusId(data.resolved_status.id, data.resolved_status.name);
    const issues = data.issues || [];
    window.__testerIssues = issues;
    window.__testerMeta = {
      fromCache: true,
      statusName: data.resolved_status?.name || 'Ready for Testing'
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
  if(!sel) return;

  sel.innerHTML = '<option value="">Loading projects…</option>';
  sel.disabled = true;

  try {
    const r = await fetch('/api/redmine-projects');
    const data = await r.json();

    if(!r.ok) throw new Error(data.detail || data.error || 'Failed to load projects');

    const projects = (data.projects || []).filter(p => p.status === 1);
    if(!projects.length){
      sel.innerHTML = '<option value="">No active projects found</option>';
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

    const rows = issues.slice(0, 50).map(issue=>`
      <div class="sync-preview-row">
        <span class="sp-num">#${issue.id}</span>
        <span class="sp-subject">${escapeHtml(issue.subject || '')}</span>
        <span class="sp-status" style="${!existingIds.has(String(issue.id)) ? '' : 'background:var(--bg-subtle);color:var(--text-tertiary);border-color:var(--line)'}">
          ${existingIds.has(String(issue.id)) ? 'Already added' : 'New'}
        </span>
      </div>
    `).join('');

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
      return desc ? `${url} | ${desc}` : url;
    });

    await CloudSync.addPlan({
      title: title,
      date: today,
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
    if(user) await startAppForUser(user);
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

document.addEventListener('DOMContentLoaded', async ()=>{
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
  switchView('dashboard');

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
});
