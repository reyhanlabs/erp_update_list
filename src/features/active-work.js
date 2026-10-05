/**
 * Active work view
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { RedmineState } from '../core/state.js';
import { $, escapeHtml, rememberIssueCategories, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { issueSelectCell, issueSelectHeader, updateBatchBar } from '../ui/batch-selection.js';
import { emptyState, matchesQuickFilter } from '../ui/list-controls.js';
import { matchesProjectFilter } from './tester/categories.js';
import {
  fetchRedmineAllIssues,
  formatAssignee,
  genericLoadingSkeleton,
  priorityBadge,
  priorityClass,
  testerLoadingSkeleton
} from './tester/queue.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import {
  issueDescriptionCell,
  parseIssueDay,
  prioritySortRank,
  resolveNewIssueProjectIds
} from './new-issues.js';

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
      const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 10 });
      if((result.issues && result.issues.length) || result.resolved_status){
        rememberIssueCategories(result.issues || []);
        return {
          issues: result.issues || [],
          total: typeof result.total_count === 'number' ? result.total_count : (result.issues || []).length,
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
  const box = $('activeWorkList');
  if(box && (force || !(window.__activeWorkData && ((window.__activeWorkData.progress||[]).length || (window.__activeWorkData.deploy||[]).length)))){
    if(!box.innerHTML.trim() || force) box.innerHTML = genericLoadingSkeleton('Loading active work…');
  }

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
  list = (list || []).filter(i => matchesQuickFilter(i));
  if(!list.length){
    return `<div class="empty" style="padding:16px"><p style="margin:0;color:var(--text-tertiary);font-size:13px">No issues</p></div>`;
  }
  const rows = list.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const pri = issue.priority?.name || '—';
    const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      ${issueSelectCell(issue.id)}
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">${issueDescriptionCell(issue, { showProject: true, showAssignee: true })}</td>
      <td class="col-priority">${priHtml}</td>
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
  // quick filters
  const _qf = (arr) => (arr || []).filter(i => matchesQuickFilter(i));
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
  try { updateBatchBar(); } catch(_){}
}

function openActiveWorkView(){
  switchView('activework');
  loadActiveWork(false);
}

export {
  ACTIVE_WORK_STATUSES,
  copyActiveWorkLinks,
  fetchIssuesByStatusName,
  loadActiveWork,
  openActiveWorkView,
  renderActiveWork
};
