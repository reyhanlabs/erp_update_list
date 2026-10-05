/**
 * Issue Status board
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { RedmineState } from '../core/state.js';
import { $ } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { setNavCount } from '../ui/list-controls.js';
import { fetchRedmine } from '../redmine/client.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { loadNewIssues, renderNewIssues, resolveNewIssueProjectIds } from './new-issues.js';

/* ============================================================
   ISSUE STATUS BOARD — New / On Progress / On Deploy / Resolved / Rework / Feedback
   ============================================================ */
const ISSUE_STATUS_DEFS = {
  new:      { key:'new',      label:'New',         names:['New'], badgeId:'countStatusNew' },
  progress: { key:'progress', label:'On Progress', names:['In Progress','On Progress','Progress'], badgeId:'countStatusProgress' },
  deploy:   { key:'deploy',   label:'On Deploy',   names:['On Deploy','Ondeploy','On deploy','Deploy'], badgeId:'countStatusDeploy' },
  resolved: { key:'resolved', label:'Resolved',    names:['Resolved'], badgeId:'countStatusResolved' },
  rework:   { key:'rework',   label:'Rework',      names:['Rework','Re-work','Re Work'], badgeId:'countStatusRework' },
  feedback: { key:'feedback', label:'Feedback',    names:['Feedback'], badgeId:'countStatusFeedback' }
};
window.__issueStatusKey = window.__issueStatusKey || 'new';
window.__issueStatusCache = window.__issueStatusCache || {};

const ISSUE_STATUS_LS_KEY = 'erp_issue_status_badges_v1';
const ISSUE_STATUS_SS_KEY = 'erp_issue_status_cache_v1';

function persistIssueStatusBadges(){
  try {
    const badges = {};
    Object.keys(ISSUE_STATUS_DEFS).forEach(k => {
      const c = window.__issueStatusCache[k];
      if(c && c.meta && c.meta.total != null) badges[k] = c.meta.total;
      else {
        const def = ISSUE_STATUS_DEFS[k];
        const el = def && def.badgeId ? $(def.badgeId) : null;
        if(el){
          const n = parseInt(el.textContent, 10);
          if(!isNaN(n)) badges[k] = n;
        }
      }
    });
    localStorage.setItem(ISSUE_STATUS_LS_KEY, JSON.stringify({ badges, at: Date.now() }));
  } catch(_){}
}

function persistIssueStatusCache(){
  try {
    // Full list cache for instant reopen (session only)
    const payload = { cache: window.__issueStatusCache || {}, at: Date.now() };
    sessionStorage.setItem(ISSUE_STATUS_SS_KEY, JSON.stringify(payload));
  } catch(err){
    // Quota exceeded — keep badges only
    console.warn('issue status session cache skip', err && err.name);
  }
  persistIssueStatusBadges();
}

function restoreIssueStatusCache(){
  // 1) Full session cache
  try {
    const raw = sessionStorage.getItem(ISSUE_STATUS_SS_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && parsed.cache && typeof parsed.cache === 'object'){
        window.__issueStatusCache = { ...(window.__issueStatusCache || {}), ...parsed.cache };
      }
    }
  } catch(_){}
  // 2) Badge totals (survive full browser restart)
  try {
    const raw = localStorage.getItem(ISSUE_STATUS_LS_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    const badges = parsed && parsed.badges ? parsed.badges : {};
    Object.keys(badges).forEach(k => {
      const def = ISSUE_STATUS_DEFS[k];
      if(!def) return;
      const n = badges[k];
      if(n == null || isNaN(n)) return;
      const el = $(def.badgeId);
      if(el) el.textContent = String(n);
      // seed cache meta so sidebar is not stuck at 0
      if(!window.__issueStatusCache[k]){
        window.__issueStatusCache[k] = {
          byProject: null,
          meta: { total: n, fromCache: true },
          at: parsed.at || 0,
          badgesOnly: true
        };
      } else if(window.__issueStatusCache[k].meta && window.__issueStatusCache[k].meta.total == null){
        window.__issueStatusCache[k].meta.total = n;
      }
    });
  } catch(_){}
  // Drop empty full-caches so they cannot block a real fetch
  try {
    Object.keys(window.__issueStatusCache || {}).forEach(k => {
      const c = window.__issueStatusCache[k];
      if(!c || !c.byProject) return;
      const any = Object.values(c.byProject).some(b => b && Array.isArray(b.issues) && b.issues.length);
      if(!any){
        window.__issueStatusCache[k] = {
          byProject: null,
          meta: c.meta || { total: 0 },
          at: 0,
          badgesOnly: true
        };
      }
    });
  } catch(_){}
}

function applyIssueStatusBadgesFromCache(){
  Object.keys(ISSUE_STATUS_DEFS).forEach(k => {
    const def = ISSUE_STATUS_DEFS[k];
    const c = window.__issueStatusCache[k];
    const total = c && c.meta && c.meta.total != null ? c.meta.total : null;
    if(total == null) return;
    const el = $(def.badgeId);
    if(el) setNavCount(el, total);
  });
}

/** Lightweight badge prefetch for all Issue Status sidebar counts */
async function prefetchAllIssueStatusBadges(){
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = (typeof resolveNewIssueProjectIds === 'function') ? resolveNewIssueProjectIds() : [];
    if(!targets.length){
      console.warn('[issue-status badges] no projects resolved');
      return;
    }

    // Run statuses sequentially to avoid stampeding Redmine; projects in parallel per status
    for(const statusKey of Object.keys(ISSUE_STATUS_DEFS)){
      const def = ISSUE_STATUS_DEFS[statusKey];
      const perProject = await Promise.all(targets.map(async (t) => {
        if(!t.projectId) return 0;
        for(const name of def.names){
          try {
            const params = new URLSearchParams();
            params.set('status_name', name);
            params.set('project_id', String(t.projectId));
            params.set('limit', '1');
            const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: false });
            return (typeof data.total_count === 'number') ? data.total_count : (data.issues || []).length;
          } catch(err){
            // try next name
          }
        }
        return 0;
      }));
      const total = perProject.reduce((a, b) => a + (b || 0), 0);
      const el = $(def.badgeId);
      if(el) setNavCount(el, total);
      const prev = window.__issueStatusCache[statusKey] || {};
      if(prev.byProject && !prev.badgesOnly){
        window.__issueStatusCache[statusKey] = {
          ...prev,
          meta: { ...(prev.meta || {}), total, statusKey }
        };
      } else {
        window.__issueStatusCache[statusKey] = {
          byProject: null,
          meta: { total, fromCache: true, statusKey },
          at: 0,
          badgesOnly: true
        };
      }
      console.info('[issue-status badges]', statusKey, total);
    }
    try { persistIssueStatusBadges(); } catch(_){}
  } catch(err){
    console.warn('prefetchAllIssueStatusBadges', err);
  }
}


function getIssueStatusDef(key){
  return ISSUE_STATUS_DEFS[key] || ISSUE_STATUS_DEFS.new;
}

function openIssueStatusView(statusKey){
  const key = (statusKey && ISSUE_STATUS_DEFS[statusKey]) ? statusKey : 'new';
  window.__issueStatusKey = key;
  document.querySelectorAll('.nav-item[data-issue-status]').forEach(b => {
    b.classList.toggle('active', b.dataset.issueStatus === key);
  });
  const def = getIssueStatusDef(key);
  const titleEl = $('pageTitle');
  if(titleEl) titleEl.textContent = def.label;
  const subEl = $('pageSubtitle');
  if(subEl) subEl.textContent = `Status "${def.label}" · Zahir ERP / One / Manufacturing`;
  const cardTitle = $('newIssuesCardTitle');
  if(cardTitle) cardTitle.textContent = key === 'new' ? 'New Issues' : `${def.label} issues`;
  // Keep status filter select in sync if present
  const sel = $('newIssuesStatusFilter');
  if(sel){
    // Prefer exact first name
    const opt = Array.from(sel.options).find(o => o.value === def.names[0]);
    if(opt) sel.value = def.names[0];
  }
  switchView('newissues');
  const cached = window.__issueStatusCache[key];
  const hasFullCache = !!(cached && cached.byProject && !cached.badgesOnly
    && Object.keys(cached.byProject).length
    && Object.values(cached.byProject).some(b => b && Array.isArray(b.issues)));

  if(hasFullCache){
    window.__newIssuesByProject = cached.byProject;
    window.__newIssuesMeta = { ...(cached.meta || {}), statusKey: key, at: cached.at || Date.now() };
    window.__newIssuesError = null;
    try { renderNewIssues(); } catch(_){}
    const total = (cached.meta && cached.meta.total) != null
      ? cached.meta.total
      : Object.values(cached.byProject).reduce((s, b) => s + ((b && b.issues) ? b.issues.length : 0), 0);
    const badge = $('newIssuesTotalBadge');
    if(badge) badge.textContent = String(total);
    const sb = $(def.badgeId);
    if(sb) setNavCount(sb, total);
    const age = cached.at ? (Date.now() - cached.at) : Infinity;
    // Always soft-refresh so counts don't stay stuck; use force when empty
    const empty = total === 0;
    setTimeout(() => {
      try { loadNewIssues(empty || age > 10 * 60 * 1000); } catch(_){}
    }, empty ? 0 : 300);
    return;
  }

  // No list cache — clear previous status data so loadNewIssues does not reuse it
  window.__newIssuesByProject = {};
  window.__newIssuesMeta = null;
  window.__newIssuesError = null;
  if(cached && cached.meta && cached.meta.total != null){
    const badge = $('newIssuesTotalBadge');
    if(badge) badge.textContent = String(cached.meta.total);
    const sb = $(def.badgeId);
    if(sb) sb.textContent = String(cached.meta.total);
  }
  // Force network load for this status
  loadNewIssues(true);
}

export {
  applyIssueStatusBadgesFromCache,
  getIssueStatusDef,
  ISSUE_STATUS_DEFS,
  openIssueStatusView,
  persistIssueStatusCache,
  prefetchAllIssueStatusBadges,
  restoreIssueStatusCache
};
