/**
 * Create Redmine issue
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { apiFetch } from '../api.js';
import { RedmineState } from '../core/state.js';
import { $, classifyIssueKind, escapeHtml, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { loadRedmineProjects } from '../redmine/projects.js';

/* ============================================================
   CREATE ISSUE → Redmine
   ============================================================ */
window.__ciMeta = window.__ciMeta || { trackers: [], priorities: [], categories: [] };

function openCreateIssueView(){
  switchView('createissue');
  ensureCreateIssueMeta();
}

async function ensureCreateIssueMeta(){
  const pid = $('ciProject')?.value;
  if(!pid){
    // still load trackers/priorities without categories
  }
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    // merge live projects into select if available
    const sel = $('ciProject');
    if(sel && (RedmineState.projects || []).length){
      const preferred = [
        { id: 75, label: 'Zahir ERP' },
        { id: 119, label: 'Zahir ERP One' },
        { id: 113, label: 'Zahir ERP Manufacturing' }
      ];
      const cur = sel.value;
      const opts = preferred.map(p => {
        const found = (RedmineState.projects || []).find(x => String(x.id) === String(p.id));
        return `<option value="${p.id}">${escapeHtml(found?.name || p.label)}</option>`;
      }).join('');
      sel.innerHTML = '<option value="">— Select project —</option>' + opts;
      if(cur) sel.value = cur;
    }
    // Default to Zahir ERP if nothing selected
    if(sel && !sel.value){
      sel.value = '75';
    }
    await loadCreateIssueMeta((sel && sel.value) || pid || '75');
  } catch(err){
    console.warn('ensureCreateIssueMeta', err);
  }
}


async function loadCreateIssueMeta(projectId){
  const q = projectId ? `?meta=1&project_id=${encodeURIComponent(projectId)}` : '?meta=1';
  try {
    const r = await apiFetch('/api/redmine-issue' + q);
    const data = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(data.error || r.status);
    window.__ciMeta = {
      trackers: data.trackers || [],
      priorities: data.priorities || [],
      categories: data.categories || []
    };
    fillCreateIssueSelects();
  } catch(err){
    toast('Failed to load Redmine metadata: ' + (err.message || err), 'error');
  }
}

function fillCreateIssueSelects(){
  const meta = window.__ciMeta || {};
  const tr = $('ciTracker');
  const pr = $('ciPriority');
  const cat = $('ciCategory');
  if(tr){
    const cur = tr.value;
    tr.innerHTML = '<option value="">— Select tracker —</option>' +
      (meta.trackers || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    if(cur) tr.value = cur;
  }
  if(pr){
    const cur = pr.value;
    pr.innerHTML = '<option value="">— Default —</option>' +
      (meta.priorities || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    // prefer Normal if exists
    if(!cur){
      const normal = (meta.priorities || []).find(p => /normal/i.test(p.name || ''));
      if(normal) pr.value = String(normal.id);
    } else pr.value = cur;
  }
  if(cat){
    const cur = cat.value;
    cat.innerHTML = '<option value="">— Optional —</option>' +
      (meta.categories || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    if(cur) cat.value = cur;
  }
}

async function onCreateIssueProjectChange(){
  const pid = $('ciProject')?.value;
  if(pid) await loadCreateIssueMeta(pid);
}

function generateIssueDescription(){
  const trackerSel = $('ciTracker');
  const trackerName = trackerSel?.selectedOptions?.[0]?.text || '';
  const subject = ($('ciSubject')?.value || '').trim();
  const notes = ($('ciNotes')?.value || '').trim();
  const catName = $('ciCategory')?.selectedOptions?.[0]?.text || '';
  const kind = classifyIssueKind(trackerName, subject + ' ' + notes);

  const bullets = notes
    ? notes.split(/\n+/).map(s => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean)
    : [];

  let desc = '';
  const header = subject ? `**${subject}**\n\n` : '';

  if(kind === 'bug'){
    desc = header;
    desc += `## Summary\n${bullets[0] || subject || '(brief summary of the bug)'}\n\n`;
    desc += `## Steps to Reproduce\n`;
    if(bullets.length > 1){
      bullets.slice(1).forEach((b, i) => { desc += `${i + 1}. ${b}\n`; });
    } else {
      desc += `1. Open the related menu/module\n2. Perform the action that triggers the issue\n3. Observe the result\n`;
    }
    desc += `\n## Expected Result\n- (what should happen)\n\n`;
    desc += `## Actual Result\n- ${bullets[0] || '(what actually happens)'}\n\n`;
    desc += `## Environment\n`;
    desc += `- Module / area: ${catName && catName !== '— Optional —' ? catName : '(FE / BE / …)'}\n`;
    desc += `- Project: ${$('ciProject')?.selectedOptions?.[0]?.text || '—'}\n`;
    desc += `\n## Notes\n${notes || '- '}\n`;
  } else if(kind === 'optimization'){
    desc = header;
    desc += `## Goal\n${bullets[0] || subject || '(what to optimize)'}\n\n`;
    desc += `## Current Behavior\n- (describe current performance / flow)\n\n`;
    desc += `## Proposed Improvement\n`;
    (bullets.length ? bullets : ['(describe the change)']).forEach(b => { desc += `- ${b}\n`; });
    desc += `\n## Acceptance Criteria\n- Measurable improvement or clearer UX\n- No regression on related flows\n`;
  } else if(kind === 'enhancement'){
    desc = header;
    desc += `## Enhancement\n${bullets[0] || subject || '(what to improve)'}\n\n`;
    desc += `## Why\n- (business / user reason)\n\n`;
    desc += `## Proposed Behavior\n`;
    (bullets.length ? bullets : ['(describe expected behavior)']).forEach(b => { desc += `- ${b}\n`; });
    desc += `\n## Acceptance Criteria\n- Behavior matches description\n- Existing flows still work\n`;
  } else {
    // feature / other
    desc = header;
    desc += `## Feature Overview\n${bullets[0] || subject || '(what to build)'}\n\n`;
    desc += `## Requirements\n`;
    (bullets.length ? bullets : ['(list functional requirements)']).forEach(b => { desc += `- ${b}\n`; });
    desc += `\n## Acceptance Criteria\n- All requirements above are met\n- Covered by basic manual test\n`;
    desc += `\n## Out of Scope\n- (optional)\n`;
  }

  if($('ciDescription')) $('ciDescription').value = desc.trim() + '\n';
  toast('Description generated — edit as needed');
}

function resetCreateIssueForm(){
  $('createIssueForm')?.reset();
  const box = $('ciResult');
  if(box){ box.style.display = 'none'; box.innerHTML = ''; }
  fillCreateIssueSelects();
}

async function submitCreateIssue(e){
  e.preventDefault();
  const btn = $('ciSubmitBtn');
  if(btn) btn.disabled = true;

  const projectEl = $('ciProject');
  const trackerEl = $('ciTracker');
  const project_id = (projectEl?.value || '').trim();
  const tracker_id = (trackerEl?.value || '').trim();
  const subject = ($('ciSubject')?.value || '').trim();
  const description = ($('ciDescription')?.value || '').trim();

  if(!project_id){
    toast('Please select a Project first', 'error');
    projectEl?.focus();
    if(btn) btn.disabled = false;
    return;
  }
  if(!tracker_id){
    toast('Please select a Tracker (Bug / Feature / …)', 'error');
    trackerEl?.focus();
    if(btn) btn.disabled = false;
    return;
  }
  if(!subject || !description){
    toast('Subject and description are required', 'error');
    if(btn) btn.disabled = false;
    return;
  }

  const payload = {
    project_id: Number(project_id),
    tracker_id: Number(tracker_id),
    subject,
    description
  };
  const pr = ($('ciPriority')?.value || '').trim();
  const cat = ($('ciCategory')?.value || '').trim();
  if(pr) payload.priority_id = Number(pr);
  if(cat) payload.category_id = Number(cat);

  try {
    const r = await apiFetch('/api/redmine-issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      const detail = Array.isArray(data.detail) ? data.detail.join(', ') : (data.detail || data.error || r.status);
      const hint = data.hint ? ' — ' + data.hint : '';
      const extra = data.sent ? ` (project_id=${data.sent.project_id})` : '';
      throw new Error((typeof detail === 'string' ? detail : JSON.stringify(detail)) + extra + hint);
    }
    const url = data.url || (data.id ? `https://pjm.zahironline.com/issues/${data.id}` : '');
    const box = $('ciResult');
    if(box){
      box.style.display = 'block';
      box.className = 'sync-status-box';
      box.innerHTML = `<div class="box-body"><b>Created #${data.id}</b><br>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : ''}</div>`;
    }
    toast(`Issue #${data.id} created on Redmine`);
    if($('ciSubject')) $('ciSubject').value = '';
    if($('ciNotes')) $('ciNotes').value = '';
    if($('ciDescription')) $('ciDescription').value = '';
  } catch(err){
    toast('Create failed: ' + (err.message || err), 'error');
  } finally {
    if(btn) btn.disabled = false;
  }
}

export {
  generateIssueDescription,
  onCreateIssueProjectChange,
  openCreateIssueView,
  resetCreateIssueForm,
  submitCreateIssue
};
