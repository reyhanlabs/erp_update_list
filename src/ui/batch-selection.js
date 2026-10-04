/**
 * Multi-select issues + batch bar
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { escapeHtml, toast } from '../core/helpers.js';

/* ============================================================
   BATCH SELECTION (Monday-style multi-select)
   ============================================================ */
window.__selectedIssueIds = window.__selectedIssueIds || new Set();

function selectedIssueIdSet(){
  if(!(window.__selectedIssueIds instanceof Set)){
    window.__selectedIssueIds = new Set();
  }
  return window.__selectedIssueIds;
}

function toggleIssueSelect(id, checked){
  const set = selectedIssueIdSet();
  const k = String(id);
  if(checked) set.add(k); else set.delete(k);
  updateBatchBar();
}

function toggleSelectAllIssues(checkbox, scopeSel){
  const set = selectedIssueIdSet();
  const boxes = document.querySelectorAll((scopeSel || '.issue-select-cb') + '');
  const on = !!checkbox.checked;
  boxes.forEach(cb => {
    cb.checked = on;
    const id = cb.dataset.issueId;
    if(!id) return;
    if(on) set.add(String(id)); else set.delete(String(id));
  });
  updateBatchBar();
}

function clearIssueSelection(){
  selectedIssueIdSet().clear();
  document.querySelectorAll('.issue-select-cb').forEach(cb => { cb.checked = false; });
  const master = document.querySelectorAll('.issue-select-all');
  master.forEach(m => { m.checked = false; m.indeterminate = false; });
  updateBatchBar();
}

function updateBatchBar(){
  const n = selectedIssueIdSet().size;
  document.querySelectorAll('.batch-bar').forEach(bar => {
    bar.classList.toggle('is-visible', n > 0);
    const countEl = bar.querySelector('.batch-count');
    if(countEl) countEl.textContent = String(n);
  });
  // Sync row checkboxes with set
  document.querySelectorAll('.issue-select-cb').forEach(cb => {
    const id = String(cb.dataset.issueId || '');
    cb.checked = selectedIssueIdSet().has(id);
  });
}

function issueSelectCell(id){
  const k = String(id);
  const on = selectedIssueIdSet().has(k) ? 'checked' : '';
  return `<td class="col-check" onclick="event.stopPropagation()">
    <input type="checkbox" class="issue-select-cb" data-issue-id="${escapeHtml(k)}" ${on}
      onchange="toggleIssueSelect('${escapeHtml(k)}', this.checked)" aria-label="Select issue ${escapeHtml(k)}"/>
  </td>`;
}

function issueSelectHeader(){
  return `<th class="col-check"><input type="checkbox" class="issue-select-all" title="Select all visible"
    onchange="toggleSelectAllIssues(this, '.issue-select-cb')" aria-label="Select all"/></th>`;
}

function getSelectedIssueUrls(){
  const ids = Array.from(selectedIssueIdSet());
  return ids.map(id => `https://pjm.zahironline.com/issues/${id}`);
}

async function copySelectedIssueLinks(){
  const urls = getSelectedIssueUrls();
  if(!urls.length){ toast('No issues selected', 'error'); return; }
  try {
    await navigator.clipboard.writeText(urls.join('\n'));
    toast(`${urls.length} link(s) copied`);
  } catch(_){
    toast('Copy failed', 'error');
  }
}

async function copySelectedTelegram(){
  const urls = getSelectedIssueUrls();
  if(!urls.length){ toast('No issues selected', 'error'); return; }
  // Links only — SDET-friendly
  const text = urls.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(`${urls.length} link(s) for Telegram`);
  } catch(_){
    toast('Copy failed', 'error');
  }
}

export {
  clearIssueSelection,
  copySelectedIssueLinks,
  copySelectedTelegram,
  issueSelectCell,
  issueSelectHeader,
  toggleIssueSelect,
  toggleSelectAllIssues,
  updateBatchBar
};
