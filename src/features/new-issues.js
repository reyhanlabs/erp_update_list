/**
 * New issues view + shared issue table cells
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { RedmineState } from '../core/state.js';
import { $, escapeHtml, formatDate, resolveIssueCategory, toast } from '../core/helpers.js';
import { issueSelectCell, issueSelectHeader, updateBatchBar } from '../ui/batch-selection.js';
import {
  activeFilterLabels,
  clockTime,
  emptyState,
  matchesQuickFilter,
  renderListCoverage,
  setNavCount,
  setQuickFilter
} from '../ui/list-controls.js';
import { fetchRedmine } from '../redmine/client.js';
import {
  formatAssignee,
  genericLoadingSkeleton,
  priorityBadge,
  priorityClass,
  testerLoadingSkeleton
} from './tester/queue.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { getIssueStatusDef, openIssueStatusView, persistIssueStatusCache } from './issue-status.js';
import { ACTIVE_WORK_STATUSES, fetchIssuesByStatusName } from './active-work.js';

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
  const def = getIssueStatusDef(window.__issueStatusKey || 'new');
  // Prefer UI filter if user changed it inside the page
  const v = ($('newIssuesStatusFilter')?.value || '').trim();
  if(v && v !== 'all') return v;
  return def.names[0] || 'New';
}

async function fetchNewIssuesForProject(projectId, force = false, statusKey){
  const def = getIssueStatusDef(statusKey || window.__issueStatusKey || 'new');
  const names = def.names && def.names.length ? def.names : [getNewIssuesStatusName()];
  const r = await fetchIssuesByStatusName(projectId, names, !!force);
  return {
    issues: r.issues || [],
    total: typeof r.total === 'number' ? r.total : (r.issues || []).length,
    fromCache: !!r.fromCache,
    resolved: r.statusName ? { name: r.statusName } : null
  };
}


async function loadNewIssues(force){
  const _niEl = $('newIssuesList') || $('view-newissues');
  if(force || !(window.__newIssuesByProject && Object.keys(window.__newIssuesByProject).length)){
    const box = $('newIssuesList');
    if(box && !box.innerHTML.trim()) box.innerHTML = genericLoadingSkeleton('Loading New issues…');
  }

  const el = $('newIssuesBody');
  const btn = $('btnRefreshNewIssues');
  const memKey = window.__newIssuesMeta && window.__newIssuesMeta.statusKey;
  const curKey = window.__issueStatusKey || 'new';
  // The status this load is for. If the user switches menu (e.g. Rework → Feedback)
  // while it is still running, its results must not be shown under the new menu.
  const loadKey = curKey;
  window.__newIssuesLoadSeq = (window.__newIssuesLoadSeq || 0) + 1;
  const loadSeq = window.__newIssuesLoadSeq;
  window.__newIssuesLatestLoad = window.__newIssuesLatestLoad || {};
  window.__newIssuesLatestLoad[loadKey] = loadSeq;
  const hasMem = !!(window.__newIssuesByProject && Object.keys(window.__newIssuesByProject).length
    && memKey === curKey);

  // Stale-while-revalidate: show last data instantly when not forcing AND same status
  if(!force && hasMem){
    renderNewIssues();
    const meta = window.__newIssuesMeta;
    const age = meta ? (Date.now() - (meta.at || 0)) : Infinity;
    const total = meta && meta.total != null ? meta.total : 0;
    // Skip network only if we have non-empty data for this status from the last 2 minutes
    if(age < 2 * 60 * 1000 && total > 0){
      return;
    }
    // empty or aging → fall through to network
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
    let remoteTotal = 0;
    let anyFromCache = false;

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId){
        byProject[t.key] = { ...t, issues: [], error: 'Project not found in Redmine' };
        return;
      }
      try {
        const { issues, total: rTotal, fromCache, resolved } = await fetchNewIssuesForProject(t.projectId, !!force, loadKey);
        if(fromCache) anyFromCache = true;
        byProject[t.key] = { ...t, issues, remoteTotal: rTotal, fromCache, statusName: resolved?.name || getIssueStatusDef(loadKey).names[0], error: null };
        total += issues.length;
        remoteTotal += Math.max(rTotal || 0, issues.length);
      } catch(err){
        console.error('New issues fetch failed', t.label, err);
        byProject[t.key] = {
          ...t, issues: [],
          error: (err.friendly && err.friendly.message) || err.message || 'Failed to load'
        };
      }
    }));

    // A newer load for the same status already started: drop this one
    if(window.__newIssuesLatestLoad[loadKey] !== loadSeq) return;

    const sk = loadKey;
    const meta = { total, remoteTotal, at: Date.now(), fromCache: anyFromCache && !force, statusKey: sk };
    // Cache + sidebar count always go to the status that was actually loaded
    window.__issueStatusCache[sk] = { byProject, meta, at: Date.now(), badgesOnly: false };
    try { persistIssueStatusCache(); } catch(_){}
    const defB = getIssueStatusDef(sk);
    const sb = defB.badgeId ? $(defB.badgeId) : null;
    if(sb) setNavCount(sb, total);

    // The user moved to another status meanwhile: don't touch the list on screen
    if((window.__issueStatusKey || 'new') !== sk) return;

    window.__newIssuesByProject = byProject;
    window.__newIssuesError = null;
    window.__newIssuesMeta = meta;
    // legacy badge
    const leg = $('countNewIssues');
    if(leg && sk === 'new') leg.textContent = String(total);

    const badge = $('countNewIssues');
    if(badge) badge.textContent = String(total);
    const totalBadge = $('newIssuesTotalBadge');
    if(totalBadge) totalBadge.textContent = String(total);
    const statusLabel = $('newIssuesStatusLabel');
    if(statusLabel){
      statusLabel.textContent = 'Status: ' + getNewIssuesStatusName() + ' · updated ' + clockTime(Date.now());
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

  if(!list) list = issues || [];
  list = (list || issues || []).filter(i => matchesQuickFilter(i));
  // re-bind if list was const
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


/** Shared Monday-style description cell: subject + chips */
function issueDescriptionCell(issue, opts = {}){
  const showProject = opts.showProject !== false;
  const showAssignee = opts.showAssignee !== false;
  const showCategory = opts.showCategory !== false;
  const extraHtml = opts.extraHtml || '';
  const cat = showCategory
    ? (issue.category?.name || (typeof resolveIssueCategory === 'function' ? resolveIssueCategory(issue.id, '', issue.subject) : '') || '')
    : '';
  const proj = issue._projectLabel || issue.project?.name || '';
  const chips = [
    showCategory ? categoryChip(cat) : '',
    showAssignee ? assigneeChip(issue.assigned_to) : '',
    showProject ? projectChip(proj) : ''
  ].filter(Boolean).join('');
  return `<div class="issue-subject-line">${escapeHtml(issue.subject || '—')}</div>
    <div class="issue-chip-row">${chips}${extraHtml}</div>`;
}

function categoryChip(name){
  const n = String(name || '').trim();
  if(!n) return '<span class="meta-chip chip-muted">—</span>';
  const k = n.toLowerCase();
  let cls = 'chip-cat';
  if(/front/.test(k) || k === 'fe') cls += ' chip-fe';
  else if(/back/.test(k) || k === 'be') cls += ' chip-be';
  else if(/design/.test(k)) cls += ' chip-design';
  else cls += ' chip-other';
  return `<span class="meta-chip ${cls}">${escapeHtml(n)}</span>`;
}

function projectChip(label){
  const n = String(label || '').trim() || '—';
  return `<span class="meta-chip chip-project">${escapeHtml(n)}</span>`;
}

function assigneeChip(assigned){
  const name = (typeof formatAssignee === 'function') ? formatAssignee(assigned) : (assigned?.name || 'Unassigned');
  const cls = (!assigned || name === 'Unassigned') ? 'chip-muted' : 'chip-assignee';
  return `<span class="meta-chip ${cls}">${escapeHtml(name)}</span>`;
}

function renderIssueStatusTable(issues, { showProject = true } = {}){
  const rows = issues.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const pri = issue.priority?.name || '—';
    const updated = issue.updated_on ? formatDate(issue.updated_on.slice(0,10)) : '—';
    const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      ${issueSelectCell(issue.id)}
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">${issueDescriptionCell(issue, { showProject })}</td>
      <td class="col-priority">${priHtml}</td>
      <td class="col-updated">${escapeHtml(updated)}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');

  return `<div class="tester-table-wrap">
    <table class="tester-table">
      <thead><tr>
        ${issueSelectHeader()}
        <th class="col-id">Issue</th>
        <th class="col-subject">Description</th>
        <th class="col-priority">Priority</th>
        <th class="col-updated">Updated</th>
        <th class="col-open"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function collectNewIssuesFlat(){
  const by = window.__newIssuesByProject || {};
  const order = NEW_ISSUE_PROJECTS.map(p => p.key);
  const projFilter = ($('newIssuesProjectFilter')?.value || 'all');
  const out = [];
  order.forEach(key => {
    const block = by[key];
    if(!block) return;
    if(projFilter !== 'all' && key !== projFilter) return;
    if(block.error) return;
    const issues = getFilteredNewIssues(block.issues || []);
    issues.forEach(i => {
      out.push({
        ...i,
        _projectKey: key,
        _projectLabel: block.projectName || block.label || key
      });
    });
  });
  // Priority first (Immediate → Low), then updated desc
  out.sort((a, b) => {
    const rank = (p) => {
      const s = String(p?.name || '').toLowerCase();
      if(/immediate|critical|blocker/.test(s)) return 0;
      if(/urgent|high|major/.test(s)) return 1;
      if(/normal|medium/.test(s)) return 2;
      if(/low|minor|trivial/.test(s)) return 3;
      return 4;
    };
    const ra = rank(a.priority), rb = rank(b.priority);
    if(ra !== rb) return ra - rb;
    return String(b.updated_on || '').localeCompare(String(a.updated_on || ''));
  });
  return out;
}


/* "Showing X of Y" when filters hide issues, so the list can be squared
 * with the sidebar count (which always counts everything). */
function updateNewIssuesCoverage(matching){
  const by = window.__newIssuesByProject || {};
  const loaded = Object.values(by).reduce((n, b) => n + ((b && !b.error && b.issues) ? b.issues.length : 0), 0);
  const remote = window.__newIssuesMeta?.remoteTotal || loaded;
  const filters = [];
  if(($('newIssuesSearch')?.value || '').trim()) filters.push('search');
  const proj = $('newIssuesProjectFilter');
  if(proj && proj.value !== 'all') filters.push(proj.options[proj.selectedIndex]?.text || 'project');
  const pri = $('newIssuesPriorityFilter');
  if(pri && pri.value !== 'all') filters.push(pri.options[pri.selectedIndex]?.text || 'priority');
  const dt = $('newIssuesDateFilter');
  if(dt && dt.value !== 'all') filters.push(dt.options[dt.selectedIndex]?.text || 'date');
  renderListCoverage('newIssuesCoverage', {
    matching, loaded, remote,
    filters: activeFilterLabels(filters),
    clearAction: 'clearNewIssuesFilters()'
  });
}

function clearNewIssuesFilters(){
  const set = (id, v) => { const el = $(id); if(el) el.value = v; };
  set('newIssuesSearch', '');
  set('newIssuesProjectFilter', 'all');
  set('newIssuesPriorityFilter', 'all');
  set('newIssuesDateFilter', 'all');
  setQuickFilter('all', renderNewIssues);
}

function renderNewIssues(){
  const el = $('newIssuesBody');
  if(!el) return;

  // Date filter toggle
  try {
    const df = $('newIssuesDateFilter')?.value;
    const showCustom = df === 'custom';
    ['newIssuesDateFrom','newIssuesDateTo'].forEach(id => {
      const n = $(id);
      if(n) n.style.display = showCustom ? '' : 'none';
    });
  } catch(_){}

  if(window.__newIssuesError){
    el.innerHTML = emptyState(ICON.alert, window.__newIssuesError.title || 'Error', window.__newIssuesError.message || '', [
      { label: 'Try again', action: 'loadNewIssues(true)', primary: true }
    ]);
    return;
  }

  const by = window.__newIssuesByProject || {};
  const order = NEW_ISSUE_PROJECTS.map(p => p.key);
  if(!order.some(k => by[k])){
    el.innerHTML = emptyState(ICON.inbox, 'Nothing loaded yet', 'Pull the latest issues from Redmine for this status.', [
      { label: 'Refresh from Redmine', action: 'loadNewIssues(true)', primary: true },
      { label: 'Dashboard', action: "switchView('dashboard')" }
    ]);
    return;
  }

  const groupBy = ($('newIssuesGroupBy')?.value || 'project');
  const list = collectNewIssuesFlat();
  updateNewIssuesCoverage(list.length);
  const statusLabel = (typeof getIssueStatusDef === 'function')
    ? getIssueStatusDef(window.__issueStatusKey || 'new').label
    : 'issues';

  if(!list.length){
    // Still show project errors if any
    const errBlocks = order.map(key => {
      const block = by[key];
      if(!block || !block.error) return '';
      return `<div class="new-proj-block"><div class="new-proj-head"><div class="new-proj-title"><span>${escapeHtml(block.projectName || block.label || key)}</span></div></div>
        <div class="empty" style="padding:16px"><p style="margin:0;color:#ef4444;font-size:13px">${escapeHtml(block.error)}</p></div></div>`;
    }).join('');
    el.innerHTML = errBlocks || emptyState(ICON.inbox, `No ${statusLabel} issues`, 'Try another filter, or refresh to pull the latest from Redmine.', [
      { label: 'Refresh', action: 'loadNewIssues(true)', primary: true },
      { label: 'Clear filters', action: "if($('newIssuesSearch'))$('newIssuesSearch').value='';if($('newIssuesProjectFilter'))$('newIssuesProjectFilter').value='all';renderNewIssues();" }
    ]);
    return;
  }

  // groupBy: project | assignee | none
  if(groupBy === 'none'){
    el.innerHTML = renderIssueStatusTable(list, { showProject: true });
    return;
  }

  const groups = {};
  list.forEach(i => {
    let key;
    if(groupBy === 'assignee') key = formatAssignee(i.assigned_to);
    else key = i._projectLabel || i.project?.name || 'Unknown project';
    if(!groups[key]) groups[key] = [];
    groups[key].push(i);
  });

  const projectOrder = ['Zahir ERP', 'Zahir ERP One', 'Zahir ERP Manufacturing', 'Zahir MRP'];
  const keys = Object.keys(groups).sort((a,b) => {
    if(groupBy === 'project'){
      const rank = (name) => {
        const n = name.toLowerCase();
        if(/^zahir\s*erp$/i.test(name.trim()) || n === 'zahir erp') return 0;
        if(/erp\s*one/i.test(n)) return 1;
        if(/manufactur|mfg/i.test(n)) return 2;
        if(/mrp/i.test(n)) return 3;
        return 50;
      };
      const ra = rank(a), rb = rank(b);
      if(ra !== rb) return ra - rb;
    }
    if(groupBy === 'assignee'){
      if(a === 'Unassigned') return 1;
      if(b === 'Unassigned') return -1;
    }
    return groups[b].length - groups[a].length || a.localeCompare(b);
  });

  el.innerHTML = keys.map(key => {
    const issues = groups[key];
    const head = `
      <div class="new-proj-head">
        <div class="new-proj-title">
          <span>${escapeHtml(key)}</span>
          <span class="badge badge-cyan">${issues.length}</span>
        </div>
        <div class="new-proj-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-group-key="${escapeHtml(key)}" onclick="copyGroupIssueLinks(this.getAttribute('data-group-key'))" ${!issues.length ? 'disabled' : ''}>
            Copy links
          </button>
        </div>
      </div>`;
    return `<div class="new-proj-block tester-group">${head}
      ${renderIssueStatusTable(issues, { showProject: groupBy !== 'project' })}
    </div>`;
  }).join('');
  try { updateBatchBar(); } catch(_){}
}

function copyGroupIssueLinks(groupKey){
  const groupBy = ($('newIssuesGroupBy')?.value || 'project');
  const list = collectNewIssuesFlat().filter(i => {
    if(groupBy === 'assignee') return formatAssignee(i.assigned_to) === groupKey;
    return (i._projectLabel || i.project?.name || 'Unknown project') === groupKey;
  });
  if(!list.length){ toast('No links to copy', 'error'); return; }
  const text = list.map(i => `https://pjm.zahironline.com/issues/${i.id}`).join('\n');
  navigator.clipboard.writeText(text).then(() => toast('Links copied')).catch(() => toast('Copy failed', 'error'));
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
        params.set('limit', '1');
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`);
        // total_count = same number the sidebar shows (was capped at 100)
        const n = typeof data.total_count === 'number' ? data.total_count : (data.issues || []).length;
        el.textContent = String(n);
      } catch(err){
        console.warn('dash new count', t.key, err);
        el.textContent = '!';
      }
    }));
    updateDashNewBars();
  } catch(err){
    console.warn('refreshDashNewIssueCounts', err);
  }
}

/* Dashboard: bar lengths relative to the busiest project */
function updateDashNewBars(){
  const pairs = [['statNewErp', 'barNewErp'], ['statNewErpOne', 'barNewErpOne'], ['statNewMfg', 'barNewMfg']];
  const nums = pairs.map(([n]) => parseInt($(n)?.textContent || '', 10)).map(v => (isNaN(v) ? 0 : v));
  const max = Math.max(1, ...nums);
  pairs.forEach(([, bar], i) => {
    const el = $(bar);
    if(el) el.style.width = `${Math.round((nums[i] / max) * 100)}%`;
  });
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
  openIssueStatusView(window.__issueStatusKey || 'new');
}

export {
  clearNewIssuesFilters,
  assigneeChip,
  categoryChip,
  collectNewIssuesFlat,
  copyAllNewIssueLinks,
  copyGroupIssueLinks,
  copyNewIssueLinks,
  issueDescriptionCell,
  loadNewIssues,
  openNewIssuesView,
  parseIssueDay,
  prefetchActiveWorkCounts,
  prefetchNewIssueCounts,
  prioritySortRank,
  projectChip,
  refreshDashNewIssueCounts,
  renderNewIssues,
  resolveNewIssueProjectIds
};
