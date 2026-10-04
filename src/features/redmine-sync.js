/**
 * Sync from Redmine
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { RedmineState, State } from '../core/state.js';
import {
  $,
  escapeHtml,
  formatDate,
  parseIssueLines,
  rememberIssueCategories,
  toast,
  todayISO
} from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { setRedmineStatus } from '../ui/sync-status.js';
import { confirmDialog } from '../ui/confirm.js';
import { toggleSyncPanel } from '../ui/navigation.js';
import { renderPlans } from './plans/plans.js';
import { applyStatusParam, fetchRedmine } from '../redmine/client.js';
import { normalizeTesterCategory } from './tester/categories.js';
import { getRedmineDateRange, getSelectedProjectId } from '../redmine/projects.js';

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

export {
  finishSyncAndShowPlans,
  previewRedmineSync,
  showSyncResult,
  syncFromRedmine,
  testRedmineConnection
};
