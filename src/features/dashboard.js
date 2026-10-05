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

  const today = $('dashToday');
  if(today){
    const d = new Date();
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    today.textContent = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
  }

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
      recentEl.innerHTML = `<div class="dash-plans">` + recent.map(p => {
        const n = countIssues(p.issues);
        const hasSum = planHasSummary(p.id);
        const redmine = planIsRedmine(p);
        return `<div class="dash-plan" role="button" tabindex="0" onclick="switchView('plans')" onkeydown="if(event.key==='Enter'){switchView('plans')}">
          <div class="dash-plan-main">
            <div class="dash-plan-title">${escapeHtml(p.title || 'Untitled')}</div>
            <div class="dash-plan-meta">
              <span>${escapeHtml(formatDate(p.date))}</span>
              <span>${n} issue${n === 1 ? '' : 's'}</span>
              ${redmine ? '<span class="dash-tag">Redmine</span>' : ''}
            </div>
          </div>
          ${hasSum
            ? '<span class="dash-plan-state is-done">Summary ready</span>'
            : `<button type="button" class="dash-plan-state is-todo" onclick="event.stopPropagation(); quickSummary('${p.id}')">Write summary</button>`}
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
    const versions = [latest.fe, latest.v2, latest.v3].filter(Boolean).map(v => `<span class="dash-ver">${escapeHtml(v)}</span>`).join('');
    const text = String(latest.text || '').trim();
    el.innerHTML = `
      <div class="dash-summary">
        <div class="dash-summary-head">
          ${versions ? `<div class="dash-summary-versions">${versions}</div>` : ''}
          <div class="dash-summary-meta">
            ${latest.date ? `<span>${escapeHtml(formatDate(latest.date))}</span>` : ''}
            ${plan ? `<span class="dash-tag">${escapeHtml(plan.title)}</span>` : ''}
          </div>
        </div>
        ${text ? `<div class="dash-summary-text">${escapeHtml(text)}</div>` : '<p class="dash-summary-empty">This summary has no text yet.</p>'}
        <div class="dash-summary-foot">
          <button type="button" class="btn btn-success btn-sm" onclick="copySummary('${latest.id}')"${text ? '' : ' disabled'}>${ICON.clipboard}Copy for WhatsApp</button>
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
