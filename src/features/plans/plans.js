/**
 * Plans CRUD + rendering
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../../icons.js';
import { State } from '../../core/state.js';
import {
  $,
  escapeHtml,
  formatDate,
  parseIssueLines,
  rememberIssueCategories,
  toast,
  todayISO
} from '../../core/helpers.js';
import { CloudSync } from '../../core/cloud-sync.js';
import { confirmDialog } from '../../ui/confirm.js';
import { closeModal, openModal } from '../../ui/modal.js';
import { restoreOpenCopyMenu } from './copy-menu.js';
import { getIssueLines, setIssueLines } from './issue-editor.js';
import { emptyState, savePersistedFilters } from '../../ui/list-controls.js';
import { fetchRedmine } from '../../redmine/client.js';
import { normalizeTesterCategory } from '../tester/categories.js';

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
    projectKey: ($('planProject')?.value || '').trim(),
    issues: issues.join('\n'),
    note: $('planNote').value.trim()
  };
  if(!data.projectKey){
    toast('Please select a project', 'error');
    btn.disabled = false;
    return;
  }

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
  if($('planProject')) $('planProject').value = '';
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
function setPlanFilter(filter){
  window.__planFilter = filter || 'all';
  try { savePersistedFilters({ planFilter: window.__planFilter }); } catch(_){}
  document.querySelectorAll('#planFilters .filter-chip').forEach(chip=>{
    chip.classList.toggle('active', chip.dataset.filter === window.__planFilter);
  });
  renderPlans();
}

function planHasSummary(planId){
  return State.summaries.all().some(s => s.planId === planId);
}

function planIsRedmine(plan){
  return (plan.note || '').toLowerCase().includes('synced from redmine');
}


function projectKeyLabel(key){
  const map = {
    'erp': 'Zahir ERP',
    'erp-one': 'Zahir ERP One',
    'mfg': 'Manufacturing',
    'mrp': 'Zahir MRP'
  };
  return map[key] || (key ? String(key) : 'No project');
}

function getPlanProjectKey(plan){
  if(!plan) return '';
  if(plan.projectKey) return plan.projectKey;
  const t = String(plan.title || '').toLowerCase();
  if(/erp\s*one|\bone\b/.test(t) && /zahir|erp|one/.test(t)) return 'erp-one';
  if(/manufactur|\bmfg\b/.test(t)) return 'mfg';
  if(/\bmrp\b/.test(t)) return 'mrp';
  return '';
}

function renderPlans(){
  const q = ($('planSearch')?.value || '').toLowerCase().trim();
  const sort = $('planSort')?.value || 'desc';
  const filter = window.__planFilter || 'all';
  const projFilter = ($('planProjectFilter')?.value || 'all');
  let list = [...State.plans.all()];

  if(q){
    list = list.filter(x =>
      (x.title||'').toLowerCase().includes(q) ||
      (x.date||'').includes(q) ||
      (x.issues||'').toLowerCase().includes(q) ||
      (x.note||'').toLowerCase().includes(q) ||
      projectKeyLabel(getPlanProjectKey(x)).toLowerCase().includes(q)
    );
  }

  if(projFilter === 'none') list = list.filter(p => !getPlanProjectKey(p));
  else if(projFilter !== 'all') list = list.filter(p => getPlanProjectKey(p) === projFilter);

  if(filter === 'no-summary') list = list.filter(p => !planHasSummary(p.id));
  else if(filter === 'has-summary') list = list.filter(p => planHasSummary(p.id));
  else if(filter === 'redmine') list = list.filter(p => planIsRedmine(p));

  list.sort((a,b)=>{
    const ta = new Date(a.date || (a.createdAt?.seconds*1000) || 0).getTime();
    const tb = new Date(b.date || (b.createdAt?.seconds*1000) || 0).getTime();
    return sort==='asc' ? ta-tb : tb-ta;
  });

  const el = $('planList');
  if(!el) return;

  if(!list.length){
    const total = State.plans.all().length;
    if(!total){
      el.innerHTML = emptyState(ICON.inbox, 'No Update Plans yet', 'Create your first plan or sync from Redmine.', [
        { label: 'Add Plan', action: "openAddModal()", primary: true },
        { label: 'Sync Redmine', action: "openPlansWithSync()" }
      ]);
    } else {
      el.innerHTML = emptyState(ICON.inbox, 'No matching plans', 'Try changing the filter or search keywords.', [
        { label: 'Reset filter', action: "setPlanFilter('all')" }
      ]);
    }
    return;
  }

  // Group by project when showing all projects
  if(projFilter === 'all' && list.length){
    const groups = {};
    list.forEach(p => {
      const k = getPlanProjectKey(p) || 'none';
      if(!groups[k]) groups[k] = [];
      groups[k].push(p);
    });
    const order = ['erp','erp-one','mfg','mrp','none'];
    const keys = Object.keys(groups).sort((a,b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    el.innerHTML = keys.map(k => `
      <div class="new-proj-block" style="margin-bottom:16px">
        <div class="new-proj-head" style="padding:8px 0">
          <div class="new-proj-title">
            <span>${escapeHtml(projectKeyLabel(k === 'none' ? '' : k))}</span>
            <span class="badge badge-cyan">${groups[k].length}</span>
          </div>
        </div>
        <div class="plan-list">${groups[k].map(d => renderPlanCard(d)).join('')}</div>
      </div>
    `).join('');
  } else {
    el.innerHTML = `<div class="plan-list">` + list.map(d => renderPlanCard(d)).join('') + `</div>`;
  }
  restoreOpenCopyMenu();
}

/** Stable pastel tone index 0–5 from plan date (same date → same color) */
function planDateTone(dateStr){
  const s = String(dateStr || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return 0;
  const n = parseInt(m[1], 10) * 372 + parseInt(m[2], 10) * 31 + parseInt(m[3], 10);
  return Math.abs(n) % 6;
}


async function enrichPlanIssueCategories(plan){
  if(!plan) return false;
  const parsed = parseIssueLines(plan.issues);
  const ids = [...new Set(parsed.map(p => p.number).filter(Boolean).map(String))];
  if(!ids.length) return false;

  // Skip fetch if every id already has tracker in cache
  const missing = ids.filter(id => !(window.__issueTrackerById && window.__issueTrackerById[id]));
  if(!missing.length && ids.every(id => window.__issueCategoryById && window.__issueCategoryById[id])){
    return true;
  }

  try {
    // Redmine supports issue_id=1,2,3 — fetch in chunks of 50
    const chunkSize = 50;
    for(let i = 0; i < ids.length; i += chunkSize){
      const chunk = ids.slice(i, i + chunkSize);
      const params = new URLSearchParams();
      params.set('issue_id', chunk.join(','));
      params.set('status_id', '*');
      params.set('limit', String(chunk.length));
      try {
        const { data } = await fetchRedmine(`/api/redmine?${params.toString()}`, { force: true });
        rememberIssueCategories(data.issues || []);
      } catch(err){
        console.warn('enrich chunk failed', err);
      }
    }
    return true;
  } catch(err){
    console.warn('enrichPlanIssueCategories', err);
    return false;
  }
}


function renderPlanCard(d){
  const parsed = parseIssueLines(d.issues);
  const totalIssue = parsed.length;
  const linkedSummaries = State.summaries.all().filter(s=>s.planId===d.id).length;
  const isRedmineSynced = (d.note || '').toLowerCase().includes('synced from redmine');
  const isExpanded = window.__expandedPlans.has(d.id);

  const issueRows = parsed.map(p=>{
    const num = p.number || '—';
    const desc = p.description || '';
    const url = p.url || '#';
    const cat = p.category || '';
    const catKey = cat && typeof normalizeTesterCategory === 'function' ? normalizeTesterCategory(cat) : '';
    const catHtml = cat
      ? `<span class="pi-cat pi-cat-${catKey || 'other'}" title="${escapeHtml(cat)}">${escapeHtml(cat)}</span>`
      : `<span class="pi-cat pi-cat-none">—</span>`;
    return `<div class="plan-issue-row">
      <a class="pi-num" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open in Redmine">#${escapeHtml(num)}</a>
      <span class="pi-desc">${escapeHtml(desc || url)}</span>
      ${catHtml}
      <a class="pi-open" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open in Redmine">${ICON.externalLink}</a>
    </div>`;
  }).join('');

  const noteHtml = d.note
    ? `<div class="plan-details-note">${ICON.messageSquare}<span>${escapeHtml(d.note)}</span></div>`
    : '';

  const issuesSection = totalIssue > 0
    ? `<div class="plan-details-issues">
        <div class="issues-block">
          <div class="issues-block-head">
            <span>Issue List</span>
            <span class="count-pill">${totalIssue}</span>
          </div>
          <div class="plan-issue-list">${issueRows}</div>
        </div>
      </div>`
    : '';

  const detailsHtml = `
    <div class="plan-details">
      ${noteHtml}
      ${issuesSection}
      <div class="plan-details-foot">
        <div class="copy-menu-wrap">
          <button type="button" class="btn btn-secondary btn-sm" data-plan-id="${d.id}" onclick="toggleCopyMenu(this, event)">
            ${ICON.clipboard}Copy for Telegram
            ${ICON.chevronDown}
          </button>
          <div class="copy-menu" onclick="event.stopPropagation()">
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlanShareLink('${d.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Copy share link (no login)
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'telegram-links')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 3.5L2.5 10.5l6.5 2.5L11 20l3.5-4.5 6.5 3z"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Telegram — links only</span>
                <span class="mi-desc">For SDET · URLs only, no description</span>
              </span>
            </button>
            <button type="button" class="copy-menu-item" onclick="event.stopPropagation(); copyPlan('${d.id}', 'telegram-full')">
              <span class="mi-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 3.5L2.5 10.5l6.5 2.5L11 20l3.5-4.5 6.5 3z"/>
                </svg>
              </span>
              <span class="mi-body">
                <span class="mi-title">Telegram — link + description</span>
                <span class="mi-desc">URL and subject under each link</span>
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
                <span class="mi-desc">Clickable [#issue](url) + desc</span>
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
                <span class="mi-desc">Numbered [#issue] + description</span>
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
        <button type="button" class="btn btn-secondary btn-sm" data-perm="edit" onclick="editPlan('${d.id}')">${ICON.edit}Edit</button>
        <button type="button" class="btn btn-danger btn-sm" data-perm="edit" onclick="deletePlan('${d.id}')">${ICON.trash}Delete</button>
      </div>
    </div>
  `;

  const pk = getPlanProjectKey(d) || 'none';
  const cardClasses = [
    'plan-card',
    'proj-' + (pk || 'none'),
    'tone-' + planDateTone(d.date),
    isExpanded ? 'expanded' : '',
    isRedmineSynced ? 'from-redmine' : '',
    linkedSummaries > 0 ? 'has-summary' : ''
  ].filter(Boolean).join(' ');

  return `
    <div class="${cardClasses}">
      <div class="plan-card-main" onclick="togglePlanCard('${d.id}', event)">
        <div class="plan-card-left">
          <div class="plan-card-title">${escapeHtml(d.title)}</div>
          <div class="plan-card-meta">
            <span class="meta-chip">${ICON.calendar}${escapeHtml(formatDate(d.date))}</span>
            <span class="meta-divider"></span>
            <span class="badge badge-cyan">${escapeHtml(projectKeyLabel(getPlanProjectKey(d)))}</span>
            <span class="badge badge-cyan">${ICON.hash}${totalIssue} issues</span>
            ${isRedmineSynced ? `<span class="badge badge-redmine">🔴 Redmine</span>` : ''}
            ${linkedSummaries
              ? `<span class="badge badge-violet badge-click" onclick="event.stopPropagation(); viewPlanSummaries('${d.id}')" title="View summaries">${ICON.fileText}${linkedSummaries} summaries</span>`
              : `<span class="badge badge-neutral badge-click" onclick="event.stopPropagation(); quickSummary('${d.id}')" title="Create summary">No summary</span>`}
          </div>
        </div>
        <div class="plan-card-chevron">${ICON.chevronDown}</div>
      </div>
      ${detailsHtml}
    </div>
  `;
}

export {
  deletePlan,
  editPlan,
  enrichPlanIssueCategories,
  getPlanProjectKey,
  planHasSummary,
  planIsRedmine,
  projectKeyLabel,
  renderPlans,
  resetPlanForm,
  savePlan,
  setPlanFilter
};
