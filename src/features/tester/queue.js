/**
 * Tester queue (Ready for Testing) list
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { RFT_STATUS_CACHE_KEY } from '../../config.js';
import { ICON } from '../../icons.js';
import { RedmineState } from '../../core/state.js';
import { $, escapeHtml, formatDate, rememberIssueCategories, toast } from '../../core/helpers.js';
import { issueSelectCell, issueSelectHeader, updateBatchBar } from '../../ui/batch-selection.js';
import { emptyState, matchesQuickFilter } from '../../ui/list-controls.js';
import { fetchRedmine } from '../../redmine/client.js';
import {
  getCachedRftStatusId,
  getIssueTesterCategory,
  isNewIssue,
  matchesProjectFilter,
  setCachedRftStatusId,
  setTesterBadgeCount,
  updateTesterCategoryBadges
} from './categories.js';
import { notifyNewTesterIssues } from './notifications.js';
import { getSelectedProjectId, loadRedmineProjects } from '../../redmine/projects.js';
import { assigneeChip, categoryChip, issueDescriptionCell, projectChip } from '../new-issues.js';

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
      const want = 'pri-' + priFilter;
      if(priFilter === 'high'){
        if(pc !== 'pri-high') return false;
      } else if(pc !== want){
        return false;
      }
    }
    if(!matchesQuickFilter(i)) return false;
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
    // Prefer Redmine category; fall back to tester bucket label
    if(!issue.category?.name && issue._testerCat){
      issue = { ...issue, category: { name: (window.TESTER_CAT_LABELS && window.TESTER_CAT_LABELS[issue._testerCat]) || issue._testerCat } };
    }
    return `<tr class="tester-tr${isNew ? ' is-new' : ''}${priorityClass(issue.priority?.name)==='pri-immediate' ? ' is-immediate' : ''}" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      ${issueSelectCell(issue.id)}
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a>${isNew ? '<span class="new-chip">NEW</span>' : ''}</td>
      <td class="col-subject" title="${escapeHtml(issue.subject || '')}">${issueDescriptionCell(issue, { showProject: true })}</td>
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
      <div class="issue-chip-row" style="margin:6px 0 4px">
        ${categoryChip(issue.category?.name || '')}
        ${assigneeChip(issue.assigned_to)}
        ${projectChip(issue._projectLabel || issue.project?.name || '')}
      </div>
      <div class="tester-mcard-meta">
        <span>${escapeHtml(tracker)}</span>
        <span>${escapeHtml(updated)}</span>
      </div>
    </a>`;
  }).join('');

  return `<div class="tester-table-wrap tester-desktop">
    <table class="tester-table">
      <thead>
        <tr>
          ${issueSelectHeader()}
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



function genericLoadingSkeleton(label){
  const row = () => `<div class="skel-row">
    <div class="skel skel-id"></div>
    <div class="skel skel-line long"></div>
    <div class="skel skel-pill"></div>
  </div>`;
  return `<div class="skel-wrap" aria-busy="true" aria-label="Loading">
    <div class="skel-label">${escapeHtml(label || 'Loading…')}</div>
    ${row()}${row()}${row()}${row()}
  </div>`;
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
function showMoreTester(){
  window.__testerShown = (window.__testerShown || 40) + 40;
  renderTesterList();
}
function renderTesterList(){
  // reset page size when category/project changes handled elsewhere

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
    el.innerHTML = emptyState(ICON.check, 'Queue is clear', 'No Ready for Testing issues right now — nice! Refresh if you expect new ones.', [
      { label: 'Refresh', action: 'loadTesterReminder(true)', primary: true },
      { label: 'Open New issues', action: "openIssueStatusView('new')" }
    ]);
    return;
  }

  const listAll = getFilteredTesterIssues();
  if(!listAll.length){
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

  const pageSize = window.__testerShown || 40;
  const list = listAll.slice(0, pageSize);
  const moreBtn = listAll.length > list.length
    ? `<div style="text-align:center;padding:12px 8px 20px">
        <button type="button" class="btn btn-secondary btn-sm" onclick="showMoreTester()">Show more (${listAll.length - list.length} remaining)</button>
      </div>`
    : '';
  if(groupBy === 'none'){
    el.innerHTML = cacheNote + renderTesterTable(list) + moreBtn;
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
  `).join('') + moreBtn;
  try { updateBatchBar(); } catch(_){}
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

export {
  copyTesterList,
  fetchRedmineAllIssues,
  fetchRftForProject,
  formatAssignee,
  genericLoadingSkeleton,
  loadTesterReminder,
  prefetchTesterCount,
  priorityBadge,
  priorityClass,
  renderTesterList,
  resolveTesterProjectIds,
  showMoreTester,
  testerLoadingSkeleton
};
