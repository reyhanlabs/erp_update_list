/**
 * Issue line editor
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { $, escapeHtml, extractIssueNumber, parseIssueLine } from '../../core/helpers.js';

/* ============================================================
   ISSUE EDITOR
   ============================================================ */
function addIssueRow(fullLine){
  const body = $('issueEditorBody');
  if(!body) return;
  const parsed = parseIssueLine(fullLine || '');
  const urlVal = parsed.url || '';
  const descVal = parsed.description || '';
  const catVal = parsed.category || '';
  const trkVal = parsed.tracker || '';

  const row = document.createElement('div');
  row.className = 'issue-row-input';
  if(catVal) row.dataset.category = catVal;
  if(trkVal) row.dataset.tracker = trkVal;
  row.innerHTML = `
    <div class="row-num empty">#—</div>
    <input type="text" placeholder="https://pjm.zahironline.com/issues/32685" value="${escapeHtml(urlVal)}" oninput="onIssueInput(this)" data-url="true"/>
    <button type="button" class="row-delete" onclick="removeIssueRow(this)" title="Remove">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <input type="text" class="row-desc" placeholder="Description (optional, from Redmine)" value="${escapeHtml(descVal)}" data-desc="true" style="grid-column:1 / -1; margin-top:2px"/>
    <input type="hidden" data-cat="true" value="${escapeHtml(catVal)}"/>
    <input type="hidden" data-tracker="true" value="${escapeHtml(trkVal)}"/>
  `;
  body.appendChild(row);
  if(urlVal) onIssueInput(row.querySelector('input[data-url]'));
  updateIssueCountBadge();
  setTimeout(()=>{
    row.scrollIntoView({block:'nearest', behavior:'smooth'});
    const inp = row.querySelector('input[data-url]');
    if(inp) inp.focus();
  }, 30);
}

function removeIssueRow(btn){
  const row = btn.closest('.issue-row-input');
  if(row){
    row.style.opacity = '0';
    row.style.transform = 'translateX(-10px)';
    row.style.transition = 'all .15s ease';
    setTimeout(()=>{
      row.remove();
      updateIssueCountBadge();
    }, 150);
  }
}

function onIssueInput(input){
  const row = input.closest('.issue-row-input');
  if(!row) return;
  const numEl = row.querySelector('.row-num');
  const num = extractIssueNumber(input.value.trim());
  if(num){
    numEl.textContent = '#' + num;
    numEl.classList.remove('empty');
  } else {
    numEl.textContent = '#—';
    numEl.classList.add('empty');
  }
  updateIssueCountBadge();
}

function updateIssueCountBadge(){
  const body = $('issueEditorBody');
  const badge = $('issueCountBadge');
  if(!body || !badge) return;
  const total = body.querySelectorAll('.issue-row-input').length;
  const filled = [...body.querySelectorAll('.issue-row-input input[data-url]')].filter(i=>i.value.trim()).length;
  badge.textContent = filled === total ? total : `${filled}/${total}`;
}

function getIssueLines(){
  const body = $('issueEditorBody');
  if(!body) return [];
  const rows = [...body.querySelectorAll('.issue-row-input')];
  const out = [];
  rows.forEach(row => {
    const url = (row.querySelector('input[data-url]')?.value || '').trim();
    const desc = (row.querySelector('input[data-desc]')?.value || '').trim();
    const cat = (row.querySelector('input[data-cat]')?.value || row.dataset.category || '').trim();
    const trk = (row.querySelector('input[data-tracker]')?.value || row.dataset.tracker || '').trim();
    if(!url) return;
    if(desc && cat && trk) out.push(`${url} | ${desc} | ${cat} | ${trk}`);
    else if(desc && cat) out.push(`${url} | ${desc} | ${cat}`);
    else if(desc && trk) out.push(`${url} | ${desc} |  | ${trk}`);
    else if(desc) out.push(`${url} | ${desc}`);
    else out.push(url);
  });
  return out;
}

function setIssueLines(lines){
  const body = $('issueEditorBody');
  if(!body) return;
  body.innerHTML = '';
  if(!lines || !lines.length){
    addIssueRow('');
  } else {
    lines.forEach(l => addIssueRow(l));
  }
  updateIssueCountBadge();
  setTimeout(()=>{ body.scrollTop = body.scrollHeight; }, 50);
}

export {
  addIssueRow,
  getIssueLines,
  removeIssueRow,
  setIssueLines
};
