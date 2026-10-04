/**
 * Tester queue state, categories, seen-issue tracking
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { RFT_STATUS_CACHE_KEY } from '../../config.js';
import { $ } from '../../core/helpers.js';
import { switchView, syncUrlToRoute } from '../../ui/navigation.js';
import { savePersistedFilters } from '../../ui/list-controls.js';
import { updateNotifToggleUI } from './notifications.js';
import { renderTesterList } from './queue.js';

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
  const key = cat || 'all';
  window.__testerCategory = key;
  try { savePersistedFilters({ testerCategory: key }); } catch(_){}
  window.__testerShown = 40;
  try { savePersistedFilters({ testerCategory: key }); } catch(_){}
  window.__testerShown = 40;
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

export {
  countNewByCategory,
  getCachedRftStatusId,
  getIssueProjectKey,
  getIssueTesterCategory,
  getSeenIssueIds,
  isNewIssue,
  matchesProjectFilter,
  normalizeTesterCategory,
  openTesterCategory,
  setCachedRftStatusId,
  setTesterBadgeCount,
  TESTER_CAT_LABELS,
  updateTesterCategoryBadges
};
