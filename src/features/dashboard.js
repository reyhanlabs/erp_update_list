/**
 * Dashboard counts
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { State } from '../core/state.js';
import { $, countIssues, escapeHtml, formatDate } from '../core/helpers.js';
import { planHasSummary, planIsRedmine } from './plans/plans.js';
import { emptyState } from '../ui/list-controls.js';
import { refreshDashNewIssueCounts } from './new-issues.js';

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

export {
  refreshCounts
};
