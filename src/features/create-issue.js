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
window.__ciMeta = window.__ciMeta || { trackers: [], priorities: [], categories: [], customFields: [], statuses: [], assignees: [] };
const CI_REQUIRED_KEY = 'erp_ci_required_cf'; // custom field ids Redmine said are required

function openCreateIssueView(){
  switchView('createissue');   // switchView → onCreateIssueShown() loads the form data
}

/* Called by switchView('createissue') — also on reload / back / direct link,
 * which previously left Tracker stuck at "Load after project". */
let ciMetaLoading = null;
function onCreateIssueShown(){
  wireCreateIssueForm();
  const hasTrackers = ((window.__ciMeta && window.__ciMeta.trackers) || []).length > 0;
  if(hasTrackers){ fillCreateIssueSelects(); renderCustomFields(); return; }
  if(!ciMetaLoading){
    ciMetaLoading = ensureCreateIssueMeta().finally(() => { ciMetaLoading = null; });
  }
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
      categories: data.categories || [],
      customFields: data.customFields || [],
      statuses: data.statuses || [],
      assignees: data.assignees || []
    };
    fillCreateIssueSelects();
    renderCustomFields();
  } catch(err){
    toast('Failed to load Redmine metadata: ' + (err.message || err), 'error');
  }
}

function fillSelect(el, items, { placeholder, pick, label = (x) => x.name } = {}){
  if(!el) return;
  const cur = el.value;
  el.innerHTML = (placeholder != null ? `<option value="">${escapeHtml(placeholder)}</option>` : '') +
    items.map(t => `<option value="${t.id}">${escapeHtml(label(t))}</option>`).join('');
  if(cur && [...el.options].some(o => o.value === cur)) el.value = cur;
  else if(pick){ const p = items.find(pick); if(p) el.value = String(p.id); }
}

function fillCreateIssueSelects(){
  const meta = window.__ciMeta || {};
  fillSelect($('ciTracker'), meta.trackers || [], { placeholder: '— Select tracker —' });
  // Status / Priority are required: default to New / Normal
  fillSelect($('ciStatus'), meta.statuses || [], { placeholder: (meta.statuses || []).length ? null : 'Default', pick: x => /^new$/i.test(x.name) });
  fillSelect($('ciPriority'), meta.priorities || [], { placeholder: (meta.priorities || []).length ? null : 'Default', pick: p => p.is_default || /normal/i.test(p.name) });
  fillSelect($('ciCategory'), meta.categories || [], { placeholder: 'None' });
  // Assignee: developers first, then other project members
  const as = $('ciAssignee');
  if(as){
    const devs = (meta.assignees || []).filter(a => a.developer);
    const others = (meta.assignees || []).filter(a => !a.developer);
    const opt = (a) => `<option value="${a.id}">${escapeHtml(a.name)}${a.group ? ' (group)' : ''}</option>`;
    const cur = as.value;
    as.innerHTML = '<option value="">Unassigned</option>' +
      (devs.length ? `<optgroup label="Developers">${devs.map(opt).join('')}</optgroup>` : '') +
      (others.length ? `<optgroup label="${devs.length ? 'Other members' : 'Project members'}">${others.map(opt).join('')}</optgroup>` : '');
    if(cur && [...as.options].some(o => o.value === cur)) as.value = cur;
  }
}

/* ---- Redmine custom fields (e.g. Client Name) ----
 * Missing required custom fields were the usual reason Redmine refused new
 * issues ("… cannot be blank"). Ones Redmine reported as required are
 * remembered and marked with *. */
function requiredCfIds(){
  try { return new Set(JSON.parse(localStorage.getItem(CI_REQUIRED_KEY) || '[]').map(String)); } catch(_){ return new Set(); }
}
function rememberRequiredCf(ids){
  const set = requiredCfIds();
  ids.forEach(id => set.add(String(id)));
  try { localStorage.setItem(CI_REQUIRED_KEY, JSON.stringify([...set])); } catch(_){}
}

/* The two custom fields filled on almost every issue get their own inputs in
 * "Issue details"; any other project custom fields go under "More Redmine fields". */
const COMMON_CF = {
  projectName: { re: /^project\s*name$/i, input: 'ciProjectName', list: 'ciProjectNameList', field: 'ciProjectNameField', required: true },
  clientName:  { re: /^client(\s*name)?$/i, input: 'ciClientName', list: 'ciClientNameList', field: 'ciClientNameField', required: false }
};

function findCf(re){
  return ((window.__ciMeta && window.__ciMeta.customFields) || []).find(cf => re.test(String(cf.name || '').trim()));
}

function renderCustomFields(){
  const fields = (window.__ciMeta && window.__ciMeta.customFields) || [];
  const used = new Set();
  Object.values(COMMON_CF).forEach(def => {
    const cf = findCf(def.re);
    const wrap = $(def.field), input = $(def.input), list = $(def.list);
    if(!wrap || !input) return;
    // hidden when the project doesn't have this custom field
    wrap.classList.toggle('hidden', !cf);
    input.dataset.cfId = cf ? String(cf.id) : '';
    input.dataset.cfName = cf ? cf.name : '';
    input.required = !!(cf && def.required);
    if(list) list.innerHTML = cf ? (cf.values || []).map(v => `<option value="${escapeHtml(v)}"></option>`).join('') : '';
    if(cf) used.add(cf.id);
  });

  const more = $('ciMoreFields'), box = $('ciCustomFields');
  if(!box) return;
  const prev = {};
  box.querySelectorAll('[data-cf-id]').forEach(el => { prev[el.dataset.cfId] = el.value; });
  const req = requiredCfIds();
  const rest = fields.filter(cf => !used.has(cf.id))
    .sort((a, b) => (req.has(String(b.id)) - req.has(String(a.id))) || a.name.localeCompare(b.name));
  box.innerHTML = rest.map(cf => {
    const id = String(cf.id);
    return `<div class="field">
      <label for="ciCf${id}">${escapeHtml(cf.name)}${req.has(id) ? ' <span class="req">*</span>' : ''}</label>
      <input class="input" id="ciCf${id}" data-cf-id="${id}" data-cf-name="${escapeHtml(cf.name)}" list="ciCfList${id}"
        value="${escapeHtml(prev[id] || '')}" autocomplete="off">
      <datalist id="ciCfList${id}">${(cf.values || []).map(v => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>
    </div>`;
  }).join('');
  if(more){
    more.classList.toggle('hidden', !rest.length);
    const n = $('ciMoreCount'); if(n) n.textContent = rest.length ? `(${rest.length})` : '';
    if(rest.some(cf => req.has(String(cf.id)))) more.open = true;   // Redmine said one of these is required
  }
}

function collectCustomFields(){
  const out = [];
  document.querySelectorAll('#createIssueForm [data-cf-id]').forEach(el => {
    const v = (el.value || '').trim();
    if(el.dataset.cfId && v) out.push({ id: Number(el.dataset.cfId), value: v });
  });
  return out;
}

/* ---- attachments ---- */
const MAX_FILE = 3 * 1024 * 1024;      // server limit per file (base64 must fit Vercel's 4.5 MB body)
const MAX_FILES = 10;
let ciFiles = [];                       // { id, file, name, size, url }

function fmtSize(n){ return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }

async function shrinkImage(file){
  // big screenshots/photos → JPEG, max 2000px, so they fit the 3 MB limit
  if(!/^image\/(png|jpe?g|webp|bmp)$/i.test(file.type) || file.size <= MAX_FILE) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    for(let q = 0.85; q >= 0.5; q -= 0.1){
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      if(blob && blob.size <= MAX_FILE) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      scale *= 0.85;
    }
  } catch(_){ /* keep original */ } finally { URL.revokeObjectURL(url); }
  return file;
}

async function addCiFiles(list){
  for(const raw of list){
    if(ciFiles.length >= MAX_FILES){ toast(`Up to ${MAX_FILES} attachments`, 'error'); break; }
    let file = raw;
    if(!file.name || /^image\.(png|jpe?g)$/i.test(file.name)){
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      file = new File([raw], `screenshot-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ciFiles.length + 1}.${ext}`, { type: raw.type || 'image/png' });
    }
    file = await shrinkImage(file);
    if(file.size > MAX_FILE){ toast(`${file.name} is larger than 3 MB`, 'error'); continue; }
    ciFiles.push({ id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size,
      url: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' });
  }
  renderCiFiles();
}

function removeCiFile(id){
  const f = ciFiles.find(x => x.id === id);
  if(f && f.url) URL.revokeObjectURL(f.url);
  ciFiles = ciFiles.filter(x => x.id !== id);
  renderCiFiles();
}

function clearCiFiles(){
  ciFiles.forEach(f => f.url && URL.revokeObjectURL(f.url));
  ciFiles = [];
  renderCiFiles();
}

function renderCiFiles(){
  const box = $('ciFileList');
  if(!box) return;
  box.innerHTML = ciFiles.map(f => `<div class="ci-file">
      ${f.url ? `<img src="${f.url}" alt="">` : '<span class="ci-file-icon" aria-hidden="true">📄</span>'}
      <span class="ci-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="ci-file-size">${fmtSize(f.size)}</span>
      <button type="button" class="ci-file-del" data-del="${f.id}" aria-label="Remove ${escapeHtml(f.name)}">×</button>
    </div>`).join('');
}

function fileToBase64(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}

async function uploadCiFiles(onProgress){
  const uploads = [];
  for(let i = 0; i < ciFiles.length; i++){
    const f = ciFiles[i];
    onProgress && onProgress(i + 1, ciFiles.length, f.name);
    const data = await fileToBase64(f.file);
    const r = await apiFetch('/api/redmine-issue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload', filename: f.name, content_type: f.file.type || 'application/octet-stream', data })
    });
    const d = await r.json().catch(() => ({}));
    if(!r.ok || !d.token) throw new Error(`${f.name}: ${d.error || 'upload failed'}${d.hint ? ' — ' + d.hint : ''}`);
    uploads.push({ token: d.token, filename: d.filename || f.name, content_type: d.content_type || f.file.type });
  }
  return uploads;
}

let ciWired = false;
function wireCreateIssueForm(){
  if(ciWired) return;
  const drop = $('ciDrop'), input = $('ciFiles'), list = $('ciFileList'), form = $('createIssueForm');
  if(!drop || !input || !form) return;
  ciWired = true;
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { addCiFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); addCiFiles([...(e.dataTransfer?.files || [])]); });
  // paste a screenshot anywhere in the form
  form.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if(files.length){ e.preventDefault(); addCiFiles(files); toast(`${files.length} screenshot${files.length > 1 ? 's' : ''} attached`); }
  });
  list?.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if(b) removeCiFile(b.dataset.del); });
}

function showCreateResult(kind, html){
  const box = $('ciResult');
  if(!box) return;
  box.style.display = 'block';
  box.className = `sync-status-box ci-result ci-result-${kind}`;
  box.innerHTML = `<div class="box-body">${html}</div>`;
  if(kind === 'error'){
    // scroll only the content pane (scrollIntoView would also shift the layout)
    const sc = document.querySelector('.content');
    if(sc){
      const r = box.getBoundingClientRect(), cr = sc.getBoundingClientRect();
      if(r.bottom > cr.bottom || r.top < cr.top) sc.scrollTo({ top: sc.scrollTop + (r.top - cr.top) - 80, behavior: 'smooth' });
    }
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
  document.querySelectorAll('#createIssueForm [data-cf-id]').forEach(el => { el.value = ''; el.classList.remove('is-invalid'); });
  clearCiFiles();
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
  const st = ($('ciStatus')?.value || '').trim();
  const asg = ($('ciAssignee')?.value || '').trim();
  if(pr) payload.priority_id = Number(pr);
  if(cat) payload.category_id = Number(cat);
  if(st) payload.status_id = Number(st);
  if(asg) payload.assigned_to_id = Number(asg);
  const pn = $('ciProjectName');
  if(pn && pn.required && !pn.value.trim()){
    toast('Project Name is required', 'error');
    pn.classList.add('is-invalid'); pn.focus();
    if(btn) btn.disabled = false;
    return;
  }
  const cfs = collectCustomFields();
  if(cfs.length) payload.custom_fields = cfs;
  document.querySelectorAll('#createIssueForm .is-invalid').forEach(el => el.classList.remove('is-invalid'));
  const resBox = $('ciResult');
  if(resBox){ resBox.style.display = 'none'; resBox.innerHTML = ''; }

  try {
    if(ciFiles.length){
      payload.uploads = await uploadCiFiles((i, n) => { if(btn) btn.textContent = `Uploading ${i}/${n}…`; });
    }
    if(btn) btn.textContent = 'Creating…';
    const r = await apiFetch('/api/redmine-issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      const errors = Array.isArray(data.errors) && data.errors.length ? data.errors
        : (Array.isArray(data.detail) ? data.detail : [String(data.detail || data.error || `HTTP ${r.status}`)]);
      // "Client Name cannot be blank" → mark that field and remember it as required
      const inputs = [...document.querySelectorAll('#createIssueForm [data-cf-id]')].filter(el => el.dataset.cfId);
      const hitIds = [];
      errors.forEach(msg => {
        const m = String(msg).toLowerCase();
        inputs.forEach(el => {
          const name = (el.dataset.cfName || '').toLowerCase();
          if(name && m.startsWith(name)){ el.classList.add('is-invalid'); hitIds.push(el.dataset.cfId); }
        });
      });
      if(hitIds.length){ rememberRequiredCf(hitIds); renderCustomFields(); hitIds.forEach(id => $('ciCf' + id)?.classList.add('is-invalid')); $('ciCf' + hitIds[0])?.focus(); }
      const missingField = !hitIds.length && errors.some(e => /cannot be blank|tidak boleh kosong|harus diisi/i.test(e));
      showCreateResult('error', `<b>${escapeHtml(data.error || 'Redmine refused the issue')}</b>
        <ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        ${data.hint ? `<p>${escapeHtml(data.hint)}</p>` : ''}
        ${missingField ? '<p>This field is not in the list above. Ask a Redmine admin which custom fields are required for this tracker.</p>' : ''}`);
      const err = new Error(errors.join('; '));
      err.shown = true;
      throw err;
    }
    const url = data.url || (data.id ? `https://pjm.zahironline.com/issues/${data.id}` : '');
    showCreateResult('ok', `<b>Created #${data.id}</b><br>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : ''}`);
    toast(`Issue #${data.id} created on Redmine`);
    if($('ciSubject')) $('ciSubject').value = '';
    if($('ciNotes')) $('ciNotes').value = '';
    if($('ciDescription')) $('ciDescription').value = '';
    clearCiFiles();
  } catch(err){
    if(!err.shown) showCreateResult('error', `<b>Could not create the issue</b><p>${escapeHtml(err.message || String(err))}</p>`);
    toast('Create failed: ' + (err.message || err), 'error');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Push to Redmine'; }
  }
}

export {
  onCreateIssueShown,
  generateIssueDescription,
  onCreateIssueProjectChange,
  openCreateIssueView,
  resetCreateIssueForm,
  submitCreateIssue
};
