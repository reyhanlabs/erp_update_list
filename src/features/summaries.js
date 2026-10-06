/**
 * Summaries CRUD + rendering
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { State } from '../core/state.js';
import {
  $,
  escapeHtml,
  formatDate,
  formatGroupedIssueSections,
  groupIssuesByKind,
  ISSUE_KIND_META,
  parseIssueLines,
  toast,
  todayISO
} from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { confirmDialog } from '../ui/confirm.js';
import { switchView } from '../ui/navigation.js';
import { closeModal, openModal } from '../ui/modal.js';
import { enrichPlanIssueCategories, getPlanProjectKey, projectKeyLabel } from './plans/plans.js';
import { emptyState } from '../ui/list-controls.js';
import { writeClipboard } from '../core/clipboard.js';

/* ============================================================
   SUMMARIES CRUD
   ============================================================ */
function populatePlanDropdown(selected){
  const sel = $('summaryPlanRef');
  const plans = [...State.plans.all()].sort((a,b)=>
    new Date(b.date || (b.createdAt?.seconds*1000) || 0) - new Date(a.date || (a.createdAt?.seconds*1000) || 0)
  );
  sel.innerHTML = '<option value="">— Select a Plan —</option>' +
    plans.map(p=>{
      const proj = projectKeyLabel(getPlanProjectKey(p));
      return `<option value="${p.id}" data-project="${escapeHtml(getPlanProjectKey(p)||'')}">${escapeHtml(p.title)} · ${escapeHtml(proj)} · ${escapeHtml(formatDate(p.date))}</option>`;
    }).join('');
  if(selected) sel.value = selected;
}

function onPlanRefChange(){
  const planId = $('summaryPlanRef').value;
  if(!planId) return;
  const p = State.plans.get(planId);
  if(p && p.date && !$('summaryDate').value) $('summaryDate').value = p.date;
}

async function autoGenerate(){
  const planId = $('summaryPlanRef').value;
  if(!planId){ toast('Please select an Update Plan first', 'error'); return; }
  const p = State.plans.get(planId);
  if(!p){ toast('Plan not found', 'error'); return; }

  // Pull tracker/category from Redmine so grouping is accurate
  try {
    toast('Resolving issue types from Redmine…');
    await enrichPlanIssueCategories(p);
  } catch(e){ console.warn('enrich for summary', e); }

  const fe = $('summaryFe').value.trim() || 'V?.??.??.??????';
  const v2 = $('summaryV2').value.trim() || 'V?.??.??.??????';
  const v3 = $('summaryV3').value.trim();
  const tgl = $('summaryDate').value ? formatDate($('summaryDate').value) : formatDate(p.date || todayISO());
  const parsed = parseIssueLines(p.issues);
  const tpl = $('summaryTemplate')?.value || 'wa';

  const issueLines = parsed.length
    ? parsed.map(it => ({
        num: it.number || '—',
        desc: it.description || '',
        url: it.url || '',
        tracker: it.tracker || '',
        category: it.category || '',
        description: it.description || ''
      }))
    : [];

  const lineWa = (it) => {
    const cat = it.category ? ` [${it.category}]` : '';
    return `• [#${it.num}]${cat} ${it.desc || ''}`.trimEnd();
  };
  const lineWaShort = (it) => `• #${it.num}${it.desc ? ' — '+it.desc : ''}`;
  const lineTg = (it) => {
    const link = it.url ? `[#${it.num}](${it.url})` : `#${it.num}`;
    const cat = it.category ? ` _${it.category}_` : '';
    return `• ${link}${cat}${it.desc ? ' — '+it.desc : ''}`;
  };

  let text = '';
  if(tpl === 'wa-short'){
    text = `🚀 *Zahir ERP Update* — ${tgl}\n`;
    text += `FE ${fe} · V2 ${v2}${v3 ? ' · V3 '+v3 : ''}\n\n`;
    text += issueLines.length
      ? formatGroupedIssueSections(issueLines, lineWaShort) + '\n'
      : '• (no issues)\n';
  } else if(tpl === 'telegram'){
    text = `🚀 *Zahir ERP Update*\n\n`;
    text += `FE: \`${fe}\`\nV2: \`${v2}\`\n`;
    if(v3) text += `V3: \`${v3}\`\n`;
    text += `📅 ${tgl}\n\n`;
    text += issueLines.length
      ? formatGroupedIssueSections(issueLines, lineTg) + '\n'
      : '• (no issues)\n';
  } else {
    text = `🚀 Zahir ERP Update\n\n`;
    text += `FE Version : ${fe}\n`;
    text += `V2 Version : ${v2}\n`;
    if(v3) text += `V3 Version : ${v3}\n`;
    text += `Date : ${tgl}\n\n`;
    const groups = groupIssuesByKind(issueLines);
    const order = ['feature','enhancement','optimization','bug','other'];
    order.forEach(k => {
      const list = groups[k];
      if(!list || !list.length) return;
      const meta = ISSUE_KIND_META[k];
      text += `${meta.emoji} ${meta.title}\n`;
      list.forEach(it => { text += lineWa(it) + '\n'; });
      text += '\n';
    });
    if(!issueLines.length) text += '• (no issues in plan)\n';
  }

  $('summaryText').value = text.trim() + '\n';
  const counts = groupIssuesByKind(issueLines);
  const summary = ['feature','enhancement','optimization','bug','other']
    .map(k => counts[k].length ? `${counts[k].length} ${ISSUE_KIND_META[k].title}` : '')
    .filter(Boolean).join(', ');
  toast('Summary grouped: ' + (summary || 'empty'));
}


function quickSummary(planId){
  resetSummaryForm();
  populatePlanDropdown(planId);
  const p = State.plans.get(planId);
  if(p && p.date) $('summaryDate').value = p.date;
  $('summaryModalTitle').textContent = 'Add Summary';
  openModal('summaryModal');
}

function viewPlanSummaries(planId){
  switchView('summaries');
  const plan = State.plans.get(planId);
  if(plan && $('summarySearch')){
    $('summarySearch').value = plan.title || '';
    renderSummaries();
  }
}

async function saveSummary(e){
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const id = $('summaryEditId').value;
  const data = {
    planId: $('summaryPlanRef').value,
    fe: $('summaryFe').value.trim(),
    v2: $('summaryV2').value.trim(),
    v3: $('summaryV3').value.trim(),
    date: $('summaryDate').value,
    text: $('summaryText').value.trim()
  };

  try {
    if(id){
      await CloudSync.updateSummary(id, data);
      toast('Summary updated successfully');
    } else {
      await CloudSync.addSummary(data);
      toast('New summary added');
    }
    closeModal('summaryModal');
    resetSummaryForm();
  } catch(err){
    toast('Failed to save summary', 'error');
  } finally {
    btn.disabled = false;
  }
}

function resetSummaryForm(){
  $('summaryForm').reset();
  $('summaryEditId').value = '';
  $('summaryDate').value = todayISO();
  $('summaryModalTitle').textContent = 'Add Summary';
  populatePlanDropdown();
}

function editSummary(id){
  const d = State.summaries.get(id);
  if(!d) return;
  resetSummaryForm();
  populatePlanDropdown(d.planId);
  $('summaryEditId').value = d.id;
  $('summaryFe').value = d.fe;
  $('summaryV2').value = d.v2;
  $('summaryV3').value = d.v3 || '';
  $('summaryDate').value = d.date;
  $('summaryText').value = d.text;
  $('summaryModalTitle').textContent = 'Edit Summary';
  openModal('summaryModal');
}

async function deleteSummary(id){
  const summary = State.summaries.get(id);
  const ok = await confirmDialog({
    title: 'Delete this summary?',
    message: `Delete summary <b>${escapeHtml(summary?.fe || '')} → ${escapeHtml(summary?.v2 || '')}</b>?<br><br>This action cannot be undone.`,
    okText: 'Delete Summary',
    cancelText: 'Cancel',
    type: 'danger'
  });
  if(!ok) return;

  try {
    await CloudSync.deleteSummary(id);
    toast('Summary deleted');
  } catch(err){
    toast('Failed to delete summary', 'error');
  }
}

function copySummary(id){
  const d = State.summaries.get(id);
  if(!d) return;
  // when the browser blocks copying, writeClipboard shows a box to copy by hand
  writeClipboard(d.text).then(()=>{
    toast('Copied — ready to paste into WhatsApp');
  }).catch(()=>{});
}

function renderSummaries(){
  const q = ($('summarySearch')?.value || '').toLowerCase().trim();
  const sort = ($('summarySort')?.value) || 'desc';
  const projFilter = ($('summaryProjectFilter')?.value || 'all');
  let list = [...State.summaries.all()];

  if(projFilter !== 'all'){
    list = list.filter(s => {
      const plan = State.plans.get(s.planId);
      const pk = getPlanProjectKey(plan);
      if(projFilter === 'none') return !pk;
      return pk === projFilter;
    });
  }

  if(q){
    list = list.filter(x => {
      const plan = State.plans.get(x.planId);
      const proj = projectKeyLabel(getPlanProjectKey(plan)).toLowerCase();
      return (
        (x.fe||'').toLowerCase().includes(q) ||
        (x.v2||'').toLowerCase().includes(q) ||
        (x.v3||'').toLowerCase().includes(q) ||
        (x.date||'').includes(q) ||
        (x.text||'').toLowerCase().includes(q) ||
        proj.includes(q) ||
        (plan?.title||'').toLowerCase().includes(q)
      );
    });
  }
  list.sort((a,b)=>{
    const ta = new Date(a.date || (a.createdAt?.seconds*1000) || 0).getTime();
    const tb = new Date(b.date || (b.createdAt?.seconds*1000) || 0).getTime();
    return sort==='asc' ? ta-tb : tb-ta;
  });

  const el = $('summaryList');
  if(!list.length){
    el.innerHTML = emptyState(ICON.inbox, 'No Summaries yet', 'Add a summary from an Update Plan to make it shareable to the WA group.');
    return;
  }

  el.innerHTML = `<div class="summary-list">` + list.map(d=>{
    const plan = d.planId ? State.plans.get(d.planId) : null;
    const v3Html = d.v3 ? `<span class="arrow">→</span><span>${escapeHtml(d.v3)}</span>` : '';
    return `
      <div class="summary-card">
        <div class="summary-card-head">
          <div class="summary-card-title">
            <span>${escapeHtml(d.fe)}</span>
            <span class="arrow">→</span>
            <span>${escapeHtml(d.v2)}</span>
            ${v3Html}
          </div>
          <div class="summary-card-meta">
            <span class="meta-chip">${ICON.calendar}${escapeHtml(formatDate(d.date))}</span>
            ${plan
              ? `<span class="meta-divider"></span><span class="badge badge-brand">${ICON.fileText}${escapeHtml(plan.title)}</span>`
              : `<span class="meta-divider"></span><span class="badge badge-neutral">No plan</span>`}
          </div>
        </div>
        <div class="summary-card-body">
          <div class="preview-block">${escapeHtml(d.text)}</div>
        </div>
        <div class="summary-card-foot">
          <button type="button" class="btn btn-success btn-sm" onclick="copySummary('${d.id}')">${ICON.clipboard}Copy for WhatsApp</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="editSummary('${d.id}')">${ICON.edit}Edit</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="deleteSummary('${d.id}')">${ICON.trash}Delete</button>
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

export {
  autoGenerate,
  copySummary,
  deleteSummary,
  editSummary,
  onPlanRefChange,
  populatePlanDropdown,
  quickSummary,
  renderSummaries,
  resetSummaryForm,
  saveSummary
};
