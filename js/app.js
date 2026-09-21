/* ============================================================
   ZAHIR ERP UPDATE MANAGER — APP LOGIC
   v4.5.0 — Redmine project picker
   ============================================================ */

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
  t._t = setTimeout(()=>t.classList.remove('show'), 2400);
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
  plans:     { title:'Update Plans', sub:'Manage issue lists from SDET', addBtn:true, addLabel:'Add New Plan' },
  summaries: { title:'Update Summaries', sub:'Summaries ready to share to the WA group', addBtn:true, addLabel:'Add New Summary' },
  sync:      { title:'Sync from Redmine', sub:'Import resolved issues automatically', addBtn:false },
  settings:  { title:'Settings', sub:'Backup, restore, and data management', addBtn:false }
};

document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click', ()=> switchView(btn.dataset.view));
});

function switchView(view){
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view===view));
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
  if(view === 'sync') loadRedmineProjects();
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
  const issues = (plan.issues || '').split('\n').map(s=>s.trim()).filter(Boolean);
  const title = plan.title || 'Update Plan';
  const dateStr = formatDate(plan.date);

  if(format === 'plain') return issues.join('\n');

  if(format === 'numbered'){
    let out = `${title}\n`;
    out += `Date: ${dateStr}\n`;
    out += `Total: ${issues.length} issues\n\n`;
    issues.forEach((url, i)=>{
      const num = extractIssueNumber(url) || '—';
      out += `${i+1}. [#${num}] ${url}\n`;
    });
    return out.trim();
  }

  if(format === 'markdown'){
    let out = `*${title}*\n`;
    out += `_${dateStr} · ${issues.length} issues_\n\n`;
    issues.forEach((url)=>{
      const num = extractIssueNumber(url) || '—';
      out += `• [#${num}](${url})\n`;
    });
    return out.trim();
  }

  if(format === 'telegram'){
    let out = `📋 *${title}*\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${issues.length} issues\n\n`;
    issues.forEach((url)=>{
      const num = extractIssueNumber(url) || '—';
      out += `• [#${num}](${url})\n`;
    });
    return out.trim();
  }

  return issues.join('\n');
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

  const menu = wrapper.querySelector('.copy-menu');
  const card = btn.closest('.plan-card');
  const isOpen = menu.classList.contains('open');

  closeAllCopyMenus();

  if(!isOpen){
    menu.classList.add('open');
    btn.classList.add('active');
    if(card) card.classList.add('menu-open');

    window.__copyMenuJustOpened = Date.now();
  }
}

function closeAllCopyMenus(){
  document.querySelectorAll('.copy-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.copy-menu-wrap .btn.active').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.plan-card.menu-open').forEach(c => c.classList.remove('menu-open'));
}

document.addEventListener('click', (e) => {
  if(window.__copyMenuJustOpened && Date.now() - window.__copyMenuJustOpened < 100){
    return;
  }
  if(e.target.closest('.copy-menu-wrap')) return;
  if(e.target.closest('.copy-menu')) return;
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
function addIssueRow(url){
  const body = $('issueEditorBody');
  if(!body) return;
  const row = document.createElement('div');
  row.className = 'issue-row-input';
  row.innerHTML = `
    <div class="row-num empty">#—</div>
    <input type="text" placeholder="https://pjm.zahironline.com/issues/32685" value="${escapeHtml(url || '')}" oninput="onIssueInput(this)"/>
    <button type="button" class="row-delete" onclick="removeIssueRow(this)" title="Remove">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  body.appendChild(row);
  if(url) onIssueInput(row.querySelector('input'));
  updateIssueCountBadge();
  setTimeout(()=>{
    row.scrollIntoView({block:'nearest', behavior:'smooth'});
    const inp = row.querySelector('input');
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
  const filled = [...body.querySelectorAll('.issue-row-input input')].filter(i=>i.value.trim()).length;
  badge.textContent = filled === total ? total : `${filled}/${total}`;
}

function getIssueLines(){
  const body = $('issueEditorBody');
  if(!body) return [];
  return [...body.querySelectorAll('.issue-row-input input')]
    .map(i => i.value.trim())
    .filter(Boolean);
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
function renderPlans(){
  const q = ($('planSearch').value || '').toLowerCase().trim();
  const sort = $('planSort').value;
  let list = [...State.plans.all()];

  if(q){
    list = list.filter(x =>
      (x.title||'').toLowerCase().includes(q) ||
      (x.date||'').includes(q) ||
      (x.issues||'').toLowerCase().includes(q) ||
      (x.note||'').toLowerCase().includes(q)
    );
  }
  list.sort((a,b)=>{
    const ta = new Date(a.date || (a.createdAt?.seconds*1000) || 0).getTime();
    const tb = new Date(b.date || (b.createdAt?.seconds*1000) || 0).getTime();
    return sort==='asc' ? ta-tb : tb-ta;
  });

  const el = $('planList');
  if(!list.length){
    el.innerHTML = emptyState(ICON.inbox, 'No Update Plans yet', 'Create your first plan to start tracking SDET issues and generating summaries.');
    return;
  }

  el.innerHTML = `<div class="plan-list">` + list.map(d => renderPlanCard(d)).join('') + `</div>`;
}

function renderPlanCard(d){
  const issueLines = (d.issues||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const totalIssue = issueLines.length;
  const linkedSummaries = State.summaries.all().filter(s=>s.planId===d.id).length;
  const isRedmineSynced = (d.note || '').toLowerCase().includes('synced from redmine');
  const isExpanded = window.__expandedPlans.has(d.id);

  const issueRows = issueLines.map(u=>{
    const num = extractIssueNumber(u) || '—';
    return `<a class="plan-issue-row" href="${escapeHtml(u)}" target="_blank" rel="noopener">
      <span class="pi-num">#${escapeHtml(num)}</span>
      <span class="pi-url">${escapeHtml(u)}</span>
      <span class="pi-open">${ICON.externalLink}</span>
    </a>`;
  }).join('');

  const noteHtml = d.note
    ? `<div class="plan-details-note">${ICON.messageSquare}<span>${escapeHtml(d.note)}</span></div>`
    : '';

  const issuesSection = totalIssue > 0
    ? `<div class="plan-details-issues">
        <div class="plan-issues-label">
          <span>Issue List</span>
          <span class="issue-count">${totalIssue}</span>
        </div>
        <div class="plan-issue-list">${issueRows}</div>
      </div>`
    : '';

  const detailsHtml = `
    <div class="plan-details">
      ${noteHtml}
      ${issuesSection}
      <div class="plan-details-foot">
        <div class="copy-menu-wrap">
          <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCopyMenu(this, event)">
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
                <span class="mi-desc">Markdown link + emoji headers</span>
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
                <span class="mi-desc">Clickable [#issue](url) format</span>
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
                <span class="mi-desc">Title + date + numbered [#issue] url</span>
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

  return `
    <div class="plan-card ${isExpanded ? 'expanded' : ''}">
      <div class="plan-card-main" onclick="togglePlanCard('${d.id}', event)">
        <div class="plan-card-left">
          <div class="plan-card-title">${escapeHtml(d.title)}</div>
          <div class="plan-card-meta">
            <span class="meta-chip">${ICON.calendar}${escapeHtml(formatDate(d.date))}</span>
            <span class="meta-divider"></span>
            <span class="badge badge-cyan">${ICON.hash}${totalIssue} issues</span>
            ${isRedmineSynced ? `<span class="badge badge-redmine">🔴 Redmine</span>` : ''}
            ${linkedSummaries
              ? `<span class="badge badge-violet">${ICON.fileText}${linkedSummaries} summaries</span>`
              : `<span class="badge badge-neutral">No summary</span>`}
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
  if(!planId){ toast('Please select an Update Plan first'); return; }
  const p = State.plans.get(planId);
  const fe = $('summaryFe').value.trim() || 'V?.??.??.??????';
  const v2 = $('summaryV2').value.trim() || 'V?.??.??.??????';
  const tgl = $('summaryDate').value ? formatDate($('summaryDate').value) : formatDate(p.date || todayISO());
  const issues = (p.issues||'').split('\n').map(s=>s.trim()).filter(Boolean);

  let text = `🚀 Zahir ERP Update\n\n`;
  text += `FE Version : ${fe}\n`;
  text += `V2 Version : ${v2}\n`;
  text += `Date : ${tgl}\n\n`;
  text += `⚡ Improvements\n`;
  if(issues.length){
    issues.forEach(url=>{
      const num = extractIssueNumber(url) || url;
      text += `• [#${num}] \n`;
    });
  } else {
    text += `• \n`;
  }
  text += `\n🛠️ Bug Fixes\n• [#xxxxx] \n`;
  $('summaryText').value = text;
  toast('Template generated');
}

function quickSummary(planId){
  resetSummaryForm();
  populatePlanDropdown(planId);
  const p = State.plans.get(planId);
  if(p && p.date) $('summaryDate').value = p.date;
  $('summaryModalTitle').textContent = 'Add Summary';
  openModal('summaryModal');
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
    return `
      <div class="summary-card">
        <div class="summary-card-head">
          <div class="summary-card-title">
            <span>${escapeHtml(d.fe)}</span>
            <span class="arrow">→</span>
            <span>${escapeHtml(d.v2)}</span>
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

  $('countPlans').textContent = plans.length;
  $('countSummaries').textContent = sums.length;
  $('statPlans').textContent = plans.length;
  $('statSummaries').textContent = sums.length;

  const totalIssues = plans.reduce((acc,p)=> acc + countIssues(p.issues), 0);
  $('statIssues').textContent = totalIssues;

  const footerCount = $('footerDataCount');
  if(footerCount){
    footerCount.textContent = `${plans.length + sums.length} items`;
  }

  const latest = [...sums].sort((a,b)=>
    new Date(b.date || (b.createdAt?.seconds*1000) || 0) - new Date(a.date || (a.createdAt?.seconds*1000) || 0)
  )[0];
  const el = $('latestSummary');
  if(!el) return;
  if(!latest){
    el.innerHTML = emptyState(ICON.inbox, 'No summaries yet', 'Create a plan first, then generate a summary from it.');
  } else {
    const plan = latest.planId ? State.plans.get(latest.planId) : null;
    el.innerHTML = `
      <div class="summary-card" style="margin:0">
        <div class="summary-card-head">
          <div class="summary-card-title">
            <span>${escapeHtml(latest.fe)}</span>
            <span class="arrow">→</span>
            <span>${escapeHtml(latest.v2)}</span>
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
function emptyState(iconSvg, title, desc){
  return `<div class="empty">
    <div class="empty-icon">${iconSvg}</div>
    <h4>${escapeHtml(title)}</h4>
    <p>${escapeHtml(desc)}</p>
  </div>`;
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
    showSyncResult('error', `<b>Could not load projects:</b> ${escapeHtml(err.message)}<br><span style="color:var(--text-secondary);font-size:12px">Make sure <code>api/redmine-projects.js</code> exists and REDMINE_API_KEY is set.</span>`);
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

    const r = await fetch(`/api/redmine?${params.toString()}`);
    const data = await r.json();
    if (r.ok && data.issues && data.issues.length) {
      setRedmineStatus('success', 'Connected');
      toast('Redmine API connected');
      const issue = data.issues[0];
      showSyncResult('success', `
        <b>Connection OK.</b> Sample issue: <code style="font-family:'JetBrains Mono',monospace;font-size:11.5px">#${issue.id}</code> — ${escapeHtml(issue.subject || '')}
      `);
    } else if (r.ok) {
      setRedmineStatus('success', 'Connected');
      toast('Connected, but no issues returned');
      showSyncResult('info', `<b>Connected.</b> API works but this project has no matching issues.`);
    } else {
      throw new Error(data.detail || data.error || 'Unknown error');
    }
  } catch(err){
    setRedmineStatus('error', 'Connection failed');
    toast('Connection failed', 'error');
    showSyncResult('error', `<b>Connection failed:</b> ${escapeHtml(err.message)}`);
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

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Loading...';
  setRedmineStatus('loading', 'Fetching...');

  try {
    const statusId = $('syncStatus').value;
    const sinceDate = $('syncSince').value;

    const params = new URLSearchParams();
    if (statusId !== '*') params.set('status_id', statusId);
    params.set('project_id', pid);
    params.set('limit', '100');
    if (sinceDate) params.set('updated_on', `>=${sinceDate}T00:00:00Z`);

    const r = await fetch(`/api/redmine?${params.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || data.error || 'Fetch failed');

    const issues = data.issues || [];
    if (!issues.length) {
      setRedmineStatus('success', 'No issues');
      showSyncResult('info', `No issues match the current filter for this project.`);
      return;
    }

    const existingIds = new Set();
    State.plans.all().forEach(p => {
      (p.issues || '').split('\n').forEach(line => {
        const m = line.match(/issues\/(\d+)/);
        if (m) existingIds.add(m[1]);
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

    showSyncResult('info', `
      <b>Preview:</b> ${issues.length} issues from Redmine — <b>${newIssues.length} new</b>, ${issues.length - newIssues.length} already in your plans.
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

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Syncing...';
  setRedmineStatus('loading', 'Syncing...');

  try {
    const statusId = $('syncStatus').value;
    const sinceDate = $('syncSince').value;

    const params = new URLSearchParams();
    if (statusId !== '*') params.set('status_id', statusId);
    params.set('project_id', pid);
    params.set('limit', '100');
    if (sinceDate) params.set('updated_on', `>=${sinceDate}T00:00:00Z`);

    const r = await fetch(`/api/redmine?${params.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || data.error || 'Fetch failed');

    const issues = data.issues || [];
    if (!issues.length) {
      setRedmineStatus('success', 'No issues');
      showSyncResult('info', `No issues match the current filter. Try clearing the date or changing status.`);
      return;
    }

    const existingIds = new Set();
    State.plans.all().forEach(p => {
      (p.issues || '').split('\n').forEach(line => {
        const m = line.match(/issues\/(\d+)/);
        if (m) existingIds.add(m[1]);
      });
    });
    const newIssues = issues.filter(i => !existingIds.has(String(i.id)));

    if (!newIssues.length) {
      setRedmineStatus('success', 'Nothing new');
      showSyncResult('info', `✅ All <b>${issues.length}</b> issues already in your plans. Nothing new to sync.`);
      return;
    }

    const proj = RedmineState.projects.find(p => String(p.id) === pid);
    const projName = proj ? proj.name : 'Redmine';

    const today = new Date().toISOString().split('T')[0];
    const statusLabels = {'1':'New','2':'In Progress','3':'Resolved','4':'Feedback','5':'Closed','*':'All'};
    const statusLabel = statusLabels[statusId] || statusId;
    const title = `${projName} — Update ${formatDate(today)} (${statusLabel})`;
    const issueUrls = newIssues.map(i => `https://pjm.zahironline.com/issues/${i.id}`);

    await CloudSync.addPlan({
      title: title,
      date: today,
      issues: issueUrls.join('\n'),
      note: `Auto-synced from Redmine · Project: ${projName} (${proj?.identifier || pid}) · ${new Date().toLocaleString()}`
    });

    setRedmineStatus('success', 'Synced');
    toast(`Synced ${newIssues.length} new issues from ${projName}`);

    const skipped = issues.length - newIssues.length;
    showSyncResult('success', `
      <b>✅ Sync complete!</b><br>
      Added <b>${newIssues.length} new issues</b> from <b>${escapeHtml(projName)}</b> as plan: "<b>${escapeHtml(title)}</b>"
      ${skipped ? `<br><span style="color:var(--text-secondary);font-size:12px">${skipped} issues skipped (already in your plans).</span>` : ''}
      <br><br>
      <button type="button" class="btn btn-primary btn-sm" onclick="switchView('plans')">View in Update Plans →</button>
    `);
  } catch(err){
    setRedmineStatus('error', 'Sync failed');
    showSyncResult('error', `<b>Sync failed:</b> ${escapeHtml(err.message)}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
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

document.addEventListener('DOMContentLoaded', ()=>{
  const okBtn = $('confirmOkBtn');
  const cancelBtn = $('confirmCancelBtn');
  const confirmOverlay = $('confirmModal');
  if(okBtn) okBtn.addEventListener('click', ()=> _closeConfirm(true));
  if(cancelBtn) cancelBtn.addEventListener('click', ()=> _closeConfirm(false));
  if(confirmOverlay) confirmOverlay.addEventListener('click', (e)=> {
    if(e.target === confirmOverlay) _closeConfirm(false);
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      if(confirmOverlay && confirmOverlay.classList.contains('show')){
        _closeConfirm(false);
      }
      closeAllCopyMenus();
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
    }
  });

  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if(e.target === ov) closeModal(ov.id); });
  });

  ThemeManager.init();
  $('planDate').value = todayISO();
  $('summaryDate').value = todayISO();

  const sinceInput = $('syncSince');
  if(sinceInput && !sinceInput.value){
    const d = new Date();
    d.setDate(d.getDate() - 7);
    sinceInput.value = d.toISOString().split('T')[0];
  }

  setIssueLines([]);
  renderAll();
  switchView('dashboard');

  $('loadingText').textContent = 'Connecting to Firebase...';
  auth.signInAnonymously()
    .then(async (cred) => {
      const userUID = cred.user.uid;
      console.log('✅ Signed in anonymously:', userUID);
      $('loadingText').textContent = 'Loading your data...';
      await CloudSync.init(userUID);
      $('loadingOverlay').classList.add('hidden');
    })
    .catch(err => {
      console.error('❌ Auth failed:', err);
      setSyncStatus('error', 'Auth failed');

      const msgMap = {
        'auth/unauthorized-domain': `Domain <b>${location.hostname}</b> belum di-authorize di Firebase Console.<br>Buka: Authentication → Settings → Authorized domains → Add domain.`,
        'auth/operation-not-allowed': 'Anonymous sign-in belum diaktifkan.<br>Buka: Firebase Console → Authentication → Sign-in method → Anonymous → Enable.',
        'auth/network-request-failed': 'Gagal konek ke Firebase. Cek internet atau matikan adblock.',
        'auth/invalid-api-key': 'API key Firebase tidak valid.'
      };
      const friendly = msgMap[err.code] || `Error: ${err.code || err.message}`;

      $('loadingText').innerHTML = `
        <div style="max-width:420px;text-align:center;color:#ef4444;font-weight:600;margin-bottom:8px">
          Gagal terhubung ke Firebase
        </div>
        <div style="max-width:420px;text-align:center;color:var(--text-secondary);font-size:12.5px;line-height:1.6">
          ${friendly}
        </div>
        <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:var(--brand);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit">
          Coba Lagi
        </button>
      `;
    });

  window.addEventListener('online', ()=>{
    if(CloudSync.uid) setSyncStatus('syncing', 'Reconnecting');
  });
  window.addEventListener('offline', ()=> setSyncStatus('offline', 'Offline'));
});