/**
 * What Next ranking + dashboard attention
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { RedmineState } from '../core/state.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { switchView } from '../ui/navigation.js';
import { projectKeyLabel } from './plans/plans.js';
import { issueSelectCell, issueSelectHeader, updateBatchBar } from '../ui/batch-selection.js';
import { emptyState, matchesQuickFilter } from '../ui/list-controls.js';
import { fetchRedmine } from '../redmine/client.js';
import { getIssueProjectKey, matchesProjectFilter } from './tester/categories.js';
import { formatAssignee, priorityBadge, priorityClass, testerLoadingSkeleton } from './tester/queue.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { assigneeChip, categoryChip, projectChip, resolveNewIssueProjectIds } from './new-issues.js';
import { fetchIssuesByStatusName } from './active-work.js';

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
  return list.filter(i => matchesQuickFilter(i));
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
      ${issueSelectCell(issue.id)}
      <td class="col-rank"><span class="${rankClass}">${rank}</span></td>
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">
        <div class="wn-subject">${escapeHtml(issue.subject || '—')}</div>
        <div class="issue-chip-row" style="margin:4px 0">
          ${categoryChip(issue.category?.name || '')}
          ${assigneeChip(issue.assigned_to)}
          ${projectChip(issue._projectLabel || '')}
        </div>
        <div class="wn-reasons">${reasons}</div>
      </td>
      <td class="col-priority">${priHtml}</td>
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
          ${issueSelectHeader()}
          <th class="col-rank">#</th>
          <th class="col-id">Issue</th>
          <th class="col-subject">Description</th>
          <th class="col-priority">Priority</th>
          <th class="col-score">Score</th>
          <th class="col-open"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  try { updateBatchBar(); } catch(_){}
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


async function refreshDashAttention(force){
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  const mark = (cardId, n, tone) => {
    const c = $(cardId);
    if(!c) return;
    c.classList.toggle('has-items', n > 0);
    c.classList.remove('tone-amber', 'tone-blue');
    if(n > 0 && tone) c.classList.add(tone);
  };
  // loading state
  ['attImmediateNew','attStuckProgress','attOnDeploy','attRework','attFeedback'].forEach(id => {
    const el = $(id);
    if(el && (force || el.textContent === '—' || el.textContent === '')) el.textContent = '…';
  });

  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = (typeof resolveNewIssueProjectIds === 'function') ? resolveNewIssueProjectIds() : [];
    let immediate = 0, stuck = 0, deploy = 0, rework = 0, feedback = 0;
    const topItems = []; // {id, subject, tag, project, url, rank}

    await Promise.all(targets.map(async (t) => {
      if(!t.projectId) return;
      const label = t.projectName || t.label || t.key;

      // New → Immediate
      try {
        const params = new URLSearchParams();
        params.set('status_name', 'New');
        params.set('project_id', String(t.projectId));
        params.set('limit', '100');
        params.set('sort', 'updated_on:desc');
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: !!force });
        (data.issues || []).forEach(i => {
          const pc = (typeof priorityClass === 'function') ? priorityClass(i.priority?.name) : '';
          if(pc === 'pri-immediate'){
            immediate++;
            topItems.push({
              id: i.id, subject: i.subject || '', tag: 'Immediate', project: label,
              url: `https://pjm.zahironline.com/issues/${i.id}`, rank: 0
            });
          }
        });
      } catch(_){}

      // On Progress stuck >7d
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ['In Progress', 'On Progress', 'Progress'], !!force);
        (r.issues || []).forEach(i => {
          const days = (typeof daysSince === 'function') ? daysSince(i.updated_on || i.created_on) : 0;
          if(days >= 7){
            stuck++;
            topItems.push({
              id: i.id, subject: i.subject || '', tag: `Stuck ${days}d`, project: label,
              url: `https://pjm.zahironline.com/issues/${i.id}`, rank: 1
            });
          }
        });
      } catch(_){}

      // On Deploy
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ['On Deploy', 'Ondeploy', 'Deploy'], !!force);
        deploy += (r.issues || []).length;
        (r.issues || []).slice(0, 3).forEach(i => {
          topItems.push({
            id: i.id, subject: i.subject || '', tag: 'On Deploy', project: label,
            url: `https://pjm.zahironline.com/issues/${i.id}`, rank: 2
          });
        });
      } catch(_){}

      // Rework
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ['Rework', 'Re-work', 'Re Work'], !!force);
        rework += (r.issues || []).length;
        (r.issues || []).slice(0, 3).forEach(i => {
          topItems.push({
            id: i.id, subject: i.subject || '', tag: 'Rework', project: label,
            url: `https://pjm.zahironline.com/issues/${i.id}`, rank: 0
          });
        });
      } catch(_){}

      // Feedback
      try {
        const r = await fetchIssuesByStatusName(t.projectId, ['Feedback'], !!force);
        feedback += (r.issues || []).length;
        (r.issues || []).slice(0, 2).forEach(i => {
          topItems.push({
            id: i.id, subject: i.subject || '', tag: 'Feedback', project: label,
            url: `https://pjm.zahironline.com/issues/${i.id}`, rank: 3
          });
        });
      } catch(_){}
    }));

    set('attImmediateNew', String(immediate));
    set('attStuckProgress', String(stuck));
    set('attOnDeploy', String(deploy));
    set('attRework', String(rework));
    set('attFeedback', String(feedback));

    mark('attCardImmediate', immediate, null);
    mark('attCardStuck', stuck, 'tone-amber');
    mark('attCardDeploy', deploy, 'tone-blue');
    mark('attCardRework', rework, null);
    mark('attCardFeedback', feedback, 'tone-amber');

    // Preview list (top 8 by urgency rank)
    topItems.sort((a,b) => a.rank - b.rank || String(b.id).localeCompare(String(a.id)));
    const uniq = [];
    const seen = new Set();
    topItems.forEach(it => {
      const k = String(it.id);
      if(seen.has(k)) return;
      seen.add(k);
      uniq.push(it);
    });
    const preview = $('dashAttPreview');
    const listEl = $('dashAttPreviewList');
    if(preview && listEl){
      const show = uniq.slice(0, 8);
      if(!show.length){
        preview.hidden = true;
        listEl.innerHTML = '';
      } else {
        preview.hidden = false;
        listEl.innerHTML = show.map(it => `
          <a class="dash-att-item" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">
            <span class="dash-att-item-id">#${escapeHtml(String(it.id))}</span>
            <span class="dash-att-item-sub" title="${escapeHtml(it.subject)}">${escapeHtml(it.subject || '—')} · ${escapeHtml(it.project)}</span>
            <span class="dash-att-item-tag">${escapeHtml(it.tag)}</span>
          </a>
        `).join('');
      }
    }

    window.__dashAttention = { immediate, stuck, deploy, rework, feedback, at: Date.now(), top: uniq.slice(0, 12) };
  } catch(err){
    console.warn('refreshDashAttention', err);
  }
}


function openWhatNextView(){
  switchView('whatnext');
  loadWhatNext(false);
}

export {
  copyWhatNextList,
  createPlanFromWhatNext,
  daysSince,
  loadWhatNext,
  openWhatNextView,
  refreshDashAttention,
  renderWhatNext
};
