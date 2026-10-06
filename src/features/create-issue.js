/**
 * Create Redmine issue
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { apiFetch } from '../api.js';
import { RedmineState } from '../core/state.js';
import { $, classifyIssueKind, escapeHtml, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { renderMarkdown } from '../core/markdown.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { confirmDialog } from '../ui/confirm.js';

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
      assignees: data.assignees || [],
      textFormat: data.textFormat || 'unknown',
      templates: data.templates || {}
    };
    applyTextFormat();
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

function uniqueName(name){
  const taken = new Set(ciFiles.map(f => f.name.toLowerCase()));
  if(!taken.has(name.toLowerCase())) return name;
  const m = name.match(/^(.*?)(\.[^.]+)?$/);
  for(let i = 2; i < 100; i++){
    const n = `${m[1]}-${i}${m[2] || ''}`;
    if(!taken.has(n.toLowerCase())) return n;
  }
  return `${Date.now()}-${name}`;
}

async function addCiFiles(list, { inline = false } = {}){
  const added = [];
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
    // Redmine links inline images by file name, so names must be unique and URL-safe
    const safe = uniqueName(file.name.replace(/[^\w.\-]+/g, '_'));
    if(safe !== file.name) file = new File([file], safe, { type: file.type });
    const entry = { id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, inline,
      url: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' };
    ciFiles.push(entry);
    added.push(entry);
  }
  renderCiFiles();
  return added;
}

function removeCiFile(id){
  const f = ciFiles.find(x => x.id === id);
  if(f && f.url) URL.revokeObjectURL(f.url);
  // drop its image line(s) from the description too
  if(f){
    const ta = $('ciDescription');
    if(ta){
      const esc = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      ta.value = ta.value.replace(new RegExp(`^[ \\t]*!\\[[^\\]]*\\]\\(${esc}\\)[ \\t]*\\n?`, 'gm'), '');
      refreshCiPreview();
    }
  }
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
  const desc = $('ciDescription')?.value || '';
  box.innerHTML = ciFiles.map(f => {
    const inDesc = desc.includes(`](${f.name})`);
    return `<div class="ci-file${inDesc ? ' is-inline' : ''}">
      ${f.url ? `<img src="${f.url}" alt="">` : '<span class="ci-file-icon" aria-hidden="true">📄</span>'}
      <span class="ci-file-text">
        <span class="ci-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="ci-file-size">${inDesc ? 'In description · ' : ''}${fmtSize(f.size)}</span>
      </span>
      ${f.url && !inDesc ? `<button type="button" class="ci-file-ins" data-ins="${f.id}" title="Insert into the description at the cursor">Insert</button>` : ''}
      <button type="button" class="ci-file-del" data-del="${f.id}" aria-label="Remove ${escapeHtml(f.name)}">×</button>
    </div>`;
  }).join('');
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
  // Screenshots pasted into the description go INTO the description (at the cursor);
  // pasted anywhere else in the form they become plain attachments.
  form.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if(!files.length) return;
    e.preventDefault();
    if(e.target && e.target.id === 'ciDescription'){
      const added = await addCiFiles(files, { inline: true });
      added.forEach(f => insertImageRef(f.name));
      if(added.length) toast(`${added.length} screenshot${added.length > 1 ? 's' : ''} added to the description`);
    } else {
      const added = await addCiFiles(files);
      if(added.length) toast(`${added.length} screenshot${added.length > 1 ? 's' : ''} attached`);
    }
  });
  list?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]'); if(del) return removeCiFile(del.dataset.del);
    const ins = e.target.closest('[data-ins]');
    if(ins){ const f = ciFiles.find(x => x.id === ins.dataset.ins); if(f){ f.inline = true; insertImageRef(f.name); } }
  });

  // description editor (same model as the Knowledge Base editor)
  const ta = $('ciDescription');
  const inlineInput = $('ciInlineImg');
  $('ciMdTools')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ci-md]');
    if(!b) return;
    e.preventDefault();
    const k = b.dataset.ciMd;
    if(k === 'image') return inlineInput?.click();
    if(k === 'bold') return mdSurround('**', '**', 'bold text');
    if(k === 'path') return mdSurround('**', '**', 'Purchase > Purchase Order');
    if(k === 'h') return mdPrefixLines(() => '## ');
    if(k === 'ul') return mdPrefixLines(() => '- ');
    if(k === 'ol') return mdPrefixLines(i => `${i + 1}. `);
  });
  inlineInput?.addEventListener('change', async () => {
    const added = await addCiFiles([...inlineInput.files], { inline: true });
    added.forEach(f => insertImageRef(f.name));
    inlineInput.value = '';
  });
  ta?.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b'){ e.preventDefault(); mdSurround('**', '**', 'bold text'); }
  });
  ta?.addEventListener('input', () => { renderCiFiles(); });
  ta?.addEventListener('dragover', (e) => { if(e.dataTransfer?.types?.includes('Files')){ e.preventDefault(); ta.classList.add('is-drop'); } });
  ta?.addEventListener('dragleave', () => ta.classList.remove('is-drop'));
  ta?.addEventListener('drop', async (e) => {
    ta.classList.remove('is-drop');
    const files = [...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type));
    if(!files.length) return;
    e.preventDefault();
    const added = await addCiFiles(files, { inline: true });
    added.forEach(f => insertImageRef(f.name));
  });
  document.querySelectorAll('[data-ci-tab]').forEach(b => b.addEventListener('click', () => setCiTab(b.dataset.ciTab)));
  $('ciTextFormat')?.addEventListener('change', (e) => {
    try { localStorage.setItem(CI_FORMAT_KEY, e.target.value); } catch(_){}
  });
  const lay = $('ciLayout');
  if(lay){
    try { lay.value = localStorage.getItem('erp_ci_layout') || 'qa'; } catch(_){}
    lay.addEventListener('change', () => { try { localStorage.setItem('erp_ci_layout', lay.value); } catch(_){} });
  }
}

/* ---- description editor helpers ---- */
const CI_FORMAT_KEY = 'erp_ci_text_format';

function applyTextFormat(){
  const sel = $('ciTextFormat');
  if(!sel) return;
  let saved = '';
  try { saved = localStorage.getItem(CI_FORMAT_KEY) || ''; } catch(_){}
  const detected = window.__ciMeta?.textFormat;
  sel.value = saved || (detected === 'textile' ? 'textile' : 'markdown');
}

function mdSurround(before, after, placeholder){
  const ta = $('ciDescription'); if(!ta) return;
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b) || placeholder;
  ta.setRangeText(before + sel + after, a, b, 'end');
  ta.selectionStart = a + before.length; ta.selectionEnd = a + before.length + sel.length;
  ta.focus(); refreshCiPreview();
}

function mdPrefixLines(prefixFn){
  const ta = $('ciDescription'); if(!ta) return;
  const { value } = ta;
  const a = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let b = value.indexOf('\n', ta.selectionEnd); if(b === -1) b = value.length;
  const out = value.slice(a, b).split('\n').map((l, i) => prefixFn(i) + l.replace(/^(#{1,4}|\d+[.)]|[-*])\s+/, '')).join('\n');
  ta.setRangeText(out, a, b, 'end'); ta.focus(); refreshCiPreview();
}

/* Insert "![name](name)" at the cursor; on a numbered step it goes indented
 * under that step so Redmine shows it inside the step. */
function insertImageRef(name){
  const ta = $('ciDescription'); if(!ta) return;
  const md = `![${name.replace(/\.[^.]+$/, '')}](${name})`;
  const { value, selectionStart: pos } = ta;
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = value.indexOf('\n', pos); if(lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  if(/^\s*\d+[.)]\s+/.test(line) || /^\s{2,}\S/.test(line)){
    ta.setRangeText(`\n   ${md}`, lineEnd, lineEnd, 'end');
  } else if(!line.trim()){
    ta.setRangeText(md, pos, pos, 'end');
  } else {
    ta.setRangeText(`\n${md}\n`, lineEnd, lineEnd, 'end');
  }
  ta.focus();
  renderCiFiles();
  refreshCiPreview();
}

function setCiTab(tab){
  document.querySelectorAll('[data-ci-tab]').forEach(b => {
    const on = b.dataset.ciTab === tab;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('ciDescription')?.classList.toggle('hidden', tab === 'preview');
  $('ciPreview')?.classList.toggle('hidden', tab !== 'preview');
  $('ciMdTools')?.classList.toggle('is-disabled', tab === 'preview');
  refreshCiPreview();
}

function refreshCiPreview(){
  const prev = $('ciPreview');
  if(!prev || prev.classList.contains('hidden')) return;
  const byName = new Map(ciFiles.map(f => [f.name, f.url]));
  prev.innerHTML = renderMarkdown($('ciDescription')?.value || '', { resolveImage: (n) => byName.get(n) || '' })
    || '<p class="kb-muted">Nothing written yet.</p>';
}

/* Redmine with Textile formatting: convert the Markdown written here. */
function markdownToTextile(md){
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const inlineConv = (t) => t
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `!${src}${alt ? `(${alt})` : ''}!`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '"$1":$2')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/`([^`]+)`/g, '@$1@');
  let inCode = false;
  for(const raw of lines){
    if(/^\s*```/.test(raw)){ out.push(inCode ? '</pre>' : '<pre>'); inCode = !inCode; continue; }
    if(inCode){ out.push(raw); continue; }
    let l = raw;
    // image line under a list item → join it to that item (Textile has no nested blocks)
    const img = l.match(/^\s{2,}(!\[[^\]]*\]\([^)]+\))\s*$/);
    if(img && out.length && /^(#|\*) /.test(out[out.length - 1])){ out[out.length - 1] += ' ' + inlineConv(img[1]); continue; }
    if(/^\s*\|?\s*:?-{2,}/.test(l) && l.includes('-') && /\|/.test(l)) continue;           // table separator
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if(h){ out.push(`h${Math.max(2, h[1].length)}. ${inlineConv(h[2])}`); continue; }
    if(/^>\s?/.test(l)){ out.push('bq. ' + inlineConv(l.replace(/^>\s?/, ''))); continue; }
    if(/^\s*\d+[.)]\s+/.test(l)){ out.push('# ' + inlineConv(l.replace(/^\s*\d+[.)]\s+/, ''))); continue; }
    if(/^\s*[-*]\s+/.test(l)){ out.push('* ' + inlineConv(l.replace(/^\s*[-*]\s+/, ''))); continue; }
    out.push(inlineConv(l));
  }
  return out.join('\n');
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

/* ============================================================
   GENERATE DESCRIPTION (v4.49.0)
   Builds the description from everything already filled in the form
   (tracker, category, Project Name, Client Name, project, notes) and
   follows the layout the team already uses in Redmine for that tracker
   (headings learned from recent issues). Falls back to a built-in layout.
   ============================================================ */
const SECTION_RULES = [
  ['steps',        /langkah|step|reproduc|reproduksi|cara|alur|proses|flow/i],
  ['expected',     /harap|expect|seharus|ekspektasi|desired|should/i],
  ['actual',       /aktual|actual|saat ini|terjadi|kondisi|current|error|kendala|hasil/i],
  ['requirements', /kebutuhan|requirement|usulan|proposed|perubahan|improvement|spesifikasi|solusi|solution/i],
  ['acceptance',   /kriteria|acceptance|selesai|definition|done/i],
  ['summary',      /deskripsi|ringkas|summary|masalah|problem|overview|latar|background|tujuan|goal|enhancement|fitur|feature|why|alasan/i],
  ['environment',  /data|pendukung|info|environment|lingkungan|detail|klien|client|versi|version|modul|module/i],
  ['notes',        /catatan|note|keterangan|tambahan|lainnya|other|out of scope/i],
  ['screens',      /lampiran|screenshot|gambar|attachment|bukti|evidence/i]
];
function sectionKey(label){
  for(const [k, re] of SECTION_RULES) if(re.test(label)) return k;
  return 'other';
}

const BUILTIN_LAYOUTS = {
  bug:          ['Summary', 'Steps to Reproduce', 'Actual Result', 'Expected Result', 'Environment', 'Notes'],
  enhancement:  ['Summary', 'Why', 'Proposed Behavior', 'Acceptance Criteria', 'Environment'],
  optimization: ['Goal', 'Current Behavior', 'Proposed Improvement', 'Acceptance Criteria', 'Environment'],
  feature:      ['Feature Overview', 'Requirements', 'Acceptance Criteria', 'Environment', 'Out of Scope']
};

/* Notes → buckets. Understands short labels ("Langkah:", "Expected:", "Hasil:", …),
 * numbered lines as steps, and the first plain line as the summary. */
function parseNotes(text){
  const b = { summary: '', steps: [], expected: [], actual: [], requirements: [], notes: [], details: [] };
  const LABELS = [
    ['steps',    /^(langkah(-langkah)?|steps?( to reproduce)?|cara|reproduce)\s*:/i],
    ['expected', /^(expected( result)?|harapan|seharusnya|hasil yang diharapkan)\s*:/i],
    ['actual',   /^(actual( result)?|hasil( saat ini)?|terjadi|error|kondisi( saat ini)?)\s*:/i],
    ['requirements', /^(kebutuhan|requirements?|usulan|proposed)\s*:/i],
    ['notes',    /^(catatan|notes?|keterangan)\s*:/i]
  ];
  let cur = null;
  String(text || '').split(/\r?\n/).forEach(raw => {
    let line = raw.trim();
    if(!line) return;
    const lab = LABELS.find(([, re]) => re.test(line));
    if(lab){ cur = lab[0]; line = line.replace(lab[1], '').trim(); if(!line) return; }
    const numbered = /^\d+[.)]\s+/.test(line);
    line = line.replace(/^(\d+[.)]|[-•*])\s+/, '').trim();
    if(!line) return;
    if(numbered && (!cur || cur === 'steps')){ b.steps.push(line); cur = cur || 'steps'; return; }
    if(cur){ b[cur].push(line); return; }
    if(!b.summary) b.summary = line; else b.details.push(line);
  });
  return b;
}

/* ---- QA bug-report layout (v4.49.1) ----
 * The format the team uses (Environment → Precondition → Steps to Reproduce →
 * Actual → Expected → Severity / Priority → Notes → Attachment). Extra note
 * labels: App, Module, Menu, Env/Environment, Browser, OS, Version/Versi,
 * Precondition/Prasyarat, Severity, Priority/Prioritas, Lampiran/Attachment.
 * Browser / OS / Environment / App given in notes are remembered as defaults. */
const QA_ENV_KEY = 'erp_ci_env_defaults';
const QA_LABELS = [
  ['app',          /^(app|aplikasi)\s*:/i],
  ['module',       /^(module|modul)\s*:/i],
  ['menu',         /^menu\s*:/i],
  ['env',          /^(env|environment|lingkungan)\s*:/i],
  ['browser',      /^browser\s*:/i],
  ['os',           /^os\s*:/i],
  ['version',      /^(version|versi)\s*:/i],
  ['precondition', /^(precondition|prasyarat|kondisi awal|pre-?condition)\s*:/i],
  ['severity',     /^severity\s*:/i],
  ['priority',     /^(priority|prioritas)\s*:/i],
  ['attachment',   /^(attachment|lampiran)\s*:/i]
];

/* Pull the QA-only labels out of the notes; returns { fields, lists, rest } */
function extractQaNotes(text){
  const fields = {}; const lists = { precondition: [], attachment: [] };
  const rest = [];
  let cur = null;
  String(text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    const hit = QA_LABELS.find(([, re]) => re.test(line));
    if(hit){
      const v = line.replace(hit[1], '').trim();
      if(hit[0] in lists){ cur = hit[0]; if(v) lists[cur].push(v.replace(/^[-•*]\s+/, '')); }
      else { cur = null; if(v) fields[hit[0]] = v; }
      return;
    }
    if(cur && line && /^[-•*]\s+/.test(line)){ lists[cur].push(line.replace(/^[-•*]\s+/, '')); return; }
    if(line) cur = null;
    rest.push(raw);
  });
  return { fields, lists, rest: rest.join('\n') };
}

function qaDefaults(){
  try { return JSON.parse(localStorage.getItem(QA_ENV_KEY) || '{}') || {}; } catch(_){ return {}; }
}
function rememberQaDefaults(f){
  const d = qaDefaults();
  ['app', 'env', 'browser', 'os'].forEach(k => { if(f[k]) d[k] = f[k]; });
  try { localStorage.setItem(QA_ENV_KEY, JSON.stringify(d)); } catch(_){}
}

function severityFor(priorityName){
  const p = String(priorityName || '').toLowerCase();
  if(/immediate|urgent|critical/.test(p)) return { severity: 'Critical', p: 'P1' };
  if(/high/.test(p)) return { severity: 'High', p: 'P1' };
  if(/normal|medium/.test(p)) return { severity: 'Medium', p: 'P2' };
  if(/low/.test(p)) return { severity: 'Low', p: 'P3' };
  return { severity: 'Medium', p: 'P2' };
}

function buildQaDescription(ctx){
  const { n, qa, stepImgs, looseImgs, project, projectName, clientName, category, priorityName, kind } = ctx;
  const d = qaDefaults();
  const f = qa.fields;
  rememberQaDefaults(f);

  // Module / Menu: from notes, else from the first "Buka X > Y" step
  let module = f.module || '', menu = f.menu || '';
  if(!module || !menu){
    const path = n.steps.map(s => s.replace(/\*\*/g, '')).map(s => s.match(/(?:buka|open|masuk(?: ke)?)\s+(?:menu\s+)?([^>]+?)\s*>\s*([^,.;]+)/i)).find(Boolean);
    if(path){ module = module || path[1].trim(); menu = menu || path[2].trim(); }
  }
  const env = [
    `App : ${f.app || d.app || project || 'ERP Web'}`,
    `Module : ${module || category || '(modul)'}`,
    `Menu : ${menu || '(menu)'}`,
    `Environment : ${f.env || d.env || 'Production'}`,
    `Browser : ${f.browser || d.browser || 'Chrome'}`,
    `OS : ${f.os || d.os || 'Windows 10'}`,
    `Version : ${f.version || 'Latest'}`,
    clientName && `Client : ${clientName}`,
    projectName && `Project : ${projectName}`
  ].filter(Boolean);

  const list = (arr, empty) => (arr.length ? arr : [empty]).map(x => `- ${x}`).join('\n');
  const sev = severityFor(priorityName);

  // steps: start with logging in, like the team's reports; screenshots stay with their step
  let steps = n.steps.slice();
  const hadLogin = steps.length && /^(login|masuk)\b/i.test(steps[0]);
  const offset = steps.length && !hadLogin ? 1 : 0;
  if(offset) steps.unshift('Login ke ERP.');
  if(!steps.length) steps = ['Login ke ERP.', '(buka menu terkait)', '(lakukan aksinya)', '(periksa hasilnya)'];
  const stepText = steps.map((s, i) => {
    const imgs = (stepImgs.get(i + 1 - offset) || []).map(x => `   ${x}`);
    stepImgs.delete(i + 1 - offset);
    return [`${i + 1}. ${s}`, ...imgs].join('\n');
  }).join('\n');

  const actual = n.actual.length ? n.actual : (n.summary ? [n.summary] : ['(apa yang terjadi saat ini)']);
  const attachLines = [
    ...[...looseImgs, ...[...stepImgs.values()].flat()],
    ...qa.lists.attachment.map(x => `- ${x}`)
  ];
  const isBug = kind === 'bug';
  const sections = [
    ['Environment', env.map(x => `- ${x}`).join('\n')],
    ['Precondition', list(qa.lists.precondition, '(kondisi/data yang harus ada sebelum langkah dijalankan)')],
    [isBug ? 'Steps to Reproduce' : 'Steps', stepText],
    [isBug ? 'Actual Result' : 'Current Condition', list(actual, '-')],
    ['Expected Result', list(n.expected.length ? n.expected : n.requirements, '(apa yang seharusnya terjadi)')],
    ['Severity / Priority', `- Severity: ${f.severity || sev.severity}\n- Priority: ${f.priority || sev.p}`],
    ['Notes', list([...n.notes, ...n.details], '-')],
    ['Attachment', attachLines.length ? attachLines.join('\n') : '- (screenshot / video / network log)']
  ];
  return sections.map(([h, body]) => `**${h}:**\n\n${body}`).join('\n\n') + '\n';
}

/* ============================================================
   PASTE FROM CHATGPT (v4.50.0)
   Takes a bug report written by ChatGPT in the team's QA format
   ("Title:", "Environment:", "Steps to Reproduce:", … "Attachment:")
   and fills the form: Title → Subject, [Bug] → Tracker,
   Severity / Priority → Priority, Client / Project → custom fields,
   the rest → Description (Markdown, Redmine-ready).
   ============================================================ */
const GPT_SECTIONS = [
  ['title',        /^title$|^judul$|^subject$/i],
  ['environment',  /^environment$|^env$|^lingkungan$/i],
  ['precondition', /^pre-?conditions?$|^prasyarat$|^kondisi awal$/i],
  ['steps',        /^steps?( to reproduce)?$|^langkah(-langkah)?$|^reproduction steps$/i],
  ['actual',       /^actual( result)?s?$|^hasil( saat ini)?$/i],
  ['expected',     /^expected( result)?s?$|^harapan$|^hasil yang diharapkan$/i],
  ['severity',     /^severity\s*\/\s*priority$|^priority\s*\/\s*severity$|^severity$|^priority$/i],
  ['notes',        /^notes?$|^catatan$|^additional notes$/i],
  ['attachment',   /^attachments?$|^lampiran$|^evidence$/i],
  ['summary',      /^summary$|^description$|^deskripsi$|^ringkasan$/i]
];
const GPT_TITLES = {
  environment: 'Environment', precondition: 'Precondition', steps: 'Steps to Reproduce', actual: 'Actual Result',
  expected: 'Expected Result', severity: 'Severity / Priority', notes: 'Notes', attachment: 'Attachment', summary: 'Summary'
};

function parseGptReport(text){
  const out = { title: '', sections: new Map(), order: [] };
  let cur = null;
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(raw => {
    // "**Title:** …", "### Steps to Reproduce", "Environment :" …
    const clean = raw.trim().replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '').trim();
    const m = clean.match(/^([A-Za-z][A-Za-z /-]{1,40}?)\s*:\s*(.*)$/) || clean.match(/^([A-Za-z][A-Za-z /-]{1,40})$/);
    const key = m ? (GPT_SECTIONS.find(([, re]) => re.test(m[1].trim())) || [])[0] : null;
    if(key){
      // a known heading (with or without text after the colon)
      const after = (m[2] || '').trim();
      // "Severity: High" / "Priority: P1" written without bullets inside that section
      if(cur === 'severity' && key === 'severity' && after){ out.sections.get('severity').push(clean); return; }
      if(key === 'title'){ out.title = after; cur = after ? null : 'title'; return; }
      cur = key;
      if(!out.sections.has(key)){ out.sections.set(key, []); out.order.push(key); }
      if(after) out.sections.get(key).push(after);
      return;
    }
    if(cur === 'title'){ if(clean){ out.title = clean; cur = null; } return; }
    // chatty lead-in like "Berikut bug report-nya:" / "Here is the bug report:"
    if(!cur && /^(berikut|here('s| is)|tentu|baik|sure|oke|ok\b|this is)/i.test(clean)) return;
    if(!cur){ if(clean){ if(!out.sections.has('summary')){ out.sections.set('summary', []); out.order.push('summary'); } out.sections.get('summary').push(raw.trim()); } return; }
    out.sections.get(cur).push(raw.replace(/\s+$/, ''));
  });
  return out;
}

/* bullets "* x" / "• x" → "- x"; numbered stay numbered; blank lines collapsed */
function tidyLines(lines){
  const res = [];
  lines.forEach(l => {
    const t = l.trim();
    if(!t){ if(res.length && res[res.length - 1] !== '') res.push(''); return; }
    if(/^\d+[.)]\s+/.test(t)) res.push(t.replace(/^(\d+)[)]\s+/, '$1. '));
    else if(/^[*•\-–]\s+/.test(t)) res.push('- ' + t.replace(/^[*•\-–]\s+/, ''));
    // "Severity: High" on its own line → list item, so Redmine keeps one per line
    else if(/^\**[A-Za-z][A-Za-z /]{1,30}\**\s*:\s*\S/.test(t)) res.push('- ' + t);
    else res.push(t);
  });
  while(res.length && res[res.length - 1] === '') res.pop();
  // inside a section, drop blank lines between list items (ChatGPT adds them)
  return res.filter((l, i, a) => !(l === '' && /^(- |\d+\. )/.test(a[i - 1] || '') && /^(- |\d+\. )/.test(a[i + 1] || '')));
}

function kv(lines, re){
  for(const l of lines){
    const m = l.replace(/^[-*•\s]+/, '').replace(/\*\*/g, '').match(re);
    if(m) return m[1].trim();
  }
  return '';
}

function selectByText(sel, test){
  if(!sel) return false;
  const opt = [...sel.options].find(o => o.value && test(o.text.trim()));
  if(opt){ sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  return false;
}

function applyGptReport(text){
  const r = parseGptReport(text);
  const filled = [];
  if(!r.title && !r.order.some(k => k !== 'summary')){
    toast('This doesn\'t look like a bug report: no Title / Steps / Expected sections found', 'error');
    return false;
  }

  // Title → Subject, "[Bug]" → Tracker
  if(r.title){
    const subj = $('ciSubject');
    if(subj){ subj.value = r.title.slice(0, 255); filled.push('Subject'); }
    const tag = r.title.match(/^\s*\[([^\]]+)\]/);
    if(tag && selectByText($('ciTracker'), t => t.toLowerCase() === tag[1].trim().toLowerCase())) filled.push('Tracker');
  }

  // Severity / Priority → Priority select
  const sevLines = r.sections.get('severity') || [];
  const pr = kv(sevLines, /^priority\s*:\s*(.+)$/i), sv = kv(sevLines, /^severity\s*:\s*(.+)$/i);
  const prSel = $('ciPriority');
  let prDone = false;
  if(pr) prDone = selectByText(prSel, t => t.toLowerCase() === pr.toLowerCase());
  if(!prDone){
    const fromLevel = { p0: /immediate|urgent/i, p1: /high/i, p2: /normal|medium/i, p3: /low/i, p4: /low/i }[pr.toLowerCase().replace(/\s/g, '')];
    const fromSev = /critical|blocker/i.test(sv) ? /immediate|urgent/i : /high|major/i.test(sv) ? /high/i : /medium|minor|normal/i.test(sv) ? /normal/i : /low|trivial/i.test(sv) ? /low/i : null;
    const re = fromLevel || fromSev;
    if(re) prDone = selectByText(prSel, t => re.test(t));
  }
  if(prDone) filled.push('Priority');

  // Environment "Client : …" / "Project : …" → custom fields
  const env = r.sections.get('environment') || [];
  const client = kv(env, /^(?:client|klien)(?:\s*name)?\s*:\s*(.+)$/i);
  const proj = kv(env, /^project(?:\s*name)?\s*:\s*(.+)$/i);
  const cn = $('ciClientName'), pn = $('ciProjectName');
  if(client && cn && !cn.closest('.hidden')){ cn.value = client; filled.push('Client Name'); }
  if(proj && pn && !pn.closest('.hidden')){ pn.value = proj; filled.push('Project Name'); }

  // Description: every section except Title, in ChatGPT's order; screenshots already
  // pasted stay under the same step number, others go to Attachment
  const ta = $('ciDescription');
  const old = ta ? ta.value : '';
  const stepImgs = new Map(); const looseImgs = [];
  let stepNo = 0;
  old.split('\n').forEach(line => {
    if(/^\s*\d+[.)]\s+/.test(line)){ stepNo++; return; }
    const img = line.match(/^\s*(!\[[^\]]*\]\([^)]+\))\s*$/);
    if(!img) return;
    if(/^\s{2,}/.test(line) && stepNo){ if(!stepImgs.has(stepNo)) stepImgs.set(stepNo, []); stepImgs.get(stepNo).push(img[1]); }
    else looseImgs.push(img[1]);
  });
  const parts = [];
  r.order.forEach(key => {
    let lines = tidyLines(r.sections.get(key) || []);
    if(!lines.length) return;
    if(key === 'steps'){
      let n = 0;
      lines = lines.flatMap(l => {
        if(!/^\d+\.\s/.test(l)) return [l];
        n++;
        const imgs = (stepImgs.get(n) || []).map(x => `   ${x}`);
        stepImgs.delete(n);
        return [l, ...imgs];
      });
    }
    if(key === 'attachment'){
      const extra = [...looseImgs.splice(0), ...[...stepImgs.values()].flat()];
      stepImgs.clear();
      lines = [...lines, ...extra];
    }
    parts.push(`**${GPT_TITLES[key] || key}:**\n\n${lines.join('\n')}`);
  });
  const leftover = [...looseImgs, ...[...stepImgs.values()].flat()];
  if(leftover.length) parts.push(`**Attachment:**\n\n${leftover.join('\n')}`);
  const desc = parts.join('\n\n').trim() + '\n';

  const apply = () => {
    if(ta) ta.value = desc;
    window.__ciLastGenerated = desc;
    refreshCiPreview();
    renderCiFiles();
    closeGptPanel();
    toast(`Filled from ChatGPT: ${['Description', ...filled].join(', ')}`);
  };
  const textOnly = (v) => String(v || '').replace(/^[ \t]*!\[[^\]]*\]\([^)]+\)[ \t]*\n?/gm, '').trim();
  if(textOnly(old) && textOnly(old) !== textOnly(window.__ciLastGenerated)){
    confirmDialog({
      title: 'Replace the description?',
      message: 'The description has text you typed. Importing replaces it (screenshots are kept).',
      okText: 'Replace', cancelText: 'Keep mine'
    }).then(ok => { if(ok) apply(); });
    return true;
  }
  apply();
  return true;
}

function openGptPanel(){
  const p = $('ciGptPanel');
  if(!p) return;
  p.classList.remove('hidden');
  const ta = $('ciGptText');
  if(ta){ ta.value = ''; ta.focus(); }
  // fill straight from the clipboard when the browser allows it
  if(navigator.clipboard && navigator.clipboard.readText){
    navigator.clipboard.readText().then(t => {
      if(t && /steps to reproduce|expected result|actual result|^\s*\**title\**\s*:/im.test(t) && ta && !ta.value) ta.value = t;
    }).catch(() => {});
  }
}
function closeGptPanel(){ $('ciGptPanel')?.classList.add('hidden'); }
function importGptText(){ applyGptReport($('ciGptText')?.value || ''); }

function generateIssueDescription(){
  const meta = window.__ciMeta || {};
  const trackerSel = $('ciTracker');
  const trackerId = trackerSel?.value || '';
  const trackerName = trackerSel?.selectedOptions?.[0]?.text || '';
  const subject = ($('ciSubject')?.value || '').trim();
  const notesText = ($('ciNotes')?.value || '').trim();
  const pick = (id) => { const el = $(id); const t = el?.selectedOptions?.[0]?.text || ''; return el && el.value ? t : ''; };
  const category = pick('ciCategory');
  const project = $('ciProject')?.selectedOptions?.[0]?.text || '';
  const projectName = ($('ciProjectName')?.value || '').trim();
  const clientName = ($('ciClientName')?.value || '').trim();
  const kind = classifyIssueKind(trackerName, subject + ' ' + notesText);
  const layoutSel = $('ciLayout');
  const useQa = !layoutSel || layoutSel.value !== 'team';
  const qa = extractQaNotes(notesText);
  const n = parseNotes(qa.rest);

  // layout: the team's own for this tracker, else built-in
  const team = meta.templates && meta.templates[trackerId];
  const headings = team ? team.headings : (BUILTIN_LAYOUTS[kind] || BUILTIN_LAYOUTS.feature);

  // keep screenshots already in the description: under step N, or loose
  const ta = $('ciDescription');
  const old = ta ? ta.value : '';
  const stepImgs = new Map(); const looseImgs = [];
  let stepNo = 0;
  // a previous QA-format run added "Login ke ERP." as step 1: count steps from the notes instead
  const oldLogin = /^\s*1[.)]\s+(login|masuk)\b/im.test(old) ? 1 : 0;
  old.split('\n').forEach(line => {
    if(/^\s*\d+[.)]\s+/.test(line)){ stepNo++; return; }
    const img = line.match(/^\s*(!\[[^\]]*\]\([^)]+\))\s*$/);
    if(!img) return;
    if(/^\s{2,}/.test(line) && stepNo){
      const key = stepNo - oldLogin;            // 0 = the login step
      if(!stepImgs.has(key)) stepImgs.set(key, []);
      stepImgs.get(key).push(img[1]);
    } else looseImgs.push(img[1]);
  });

  const envLinesFor = (L) => [
    clientName && `- ${L.client}: ${clientName}`,
    projectName && `- Project Name: ${projectName}`,
    category && `- ${L.module}: ${category}`,
    project && `- ${L.project}: ${project}`
  ].filter(Boolean);
  const bullets = (arr, empty) => (arr.length ? arr : [empty]).map(x => `- ${x}`).join('\n');
  const steps = (L) => {
    const list = n.steps.length ? n.steps : L.steps;
    return list.map((s, i) => {
      const imgs = (stepImgs.get(i + 1) || []).map(x => `   ${x}`);
      stepImgs.delete(i + 1);
      return [`${i + 1}. ${s}`, ...imgs].join('\n');
    }).join('\n');
  };
  const summary = (L) => [n.summary || subject || L.sum, ...n.details.map(d => `- ${d}`)].join('\n');

  const keys = new Set(headings.map(sectionKey));
  // extra sections in the team's language
  const indo = /langkah|hasil|deskripsi|catatan|harap|kebutuhan|masalah|pendukung|latar/i.test(headings.join(' '));
  const L = indo
    ? { env: 'Data Pendukung', notes: 'Catatan', shots: 'Lampiran', now: '(jelaskan yang terjadi sekarang)', should: '(seharusnya bagaimana)',
        steps: ['(buka menu / modul)', '(lakukan aksinya)', '(lihat hasilnya)'], change: '(jelaskan perubahan yang dibutuhkan)',
        done: 'Berjalan sesuai penjelasan di atas, alur lain tetap normal', envEmpty: '- (klien, versi, modul)', sum: '(ringkasan singkat)',
        client: 'Klien', module: 'Modul / kategori', project: 'Project Redmine' }
    : { env: 'Environment', notes: 'Notes', shots: 'Screenshots', now: '(what happens now)', should: '(what should happen)',
        steps: ['(open the menu / module)', '(do the action)', '(see the result)'], change: '(describe the change)',
        done: 'Works as described above, existing flows still work', envEmpty: '- (client, version, module)', sum: '(short summary)',
        client: 'Client', module: 'Module / category', project: 'Redmine project' };
  const envLines = envLinesFor(L);

  const used = new Set();
  const body = (label) => {
    const k = sectionKey(label);
    used.add(k);
    switch(k){
      case 'summary':      return summary(L);
      case 'steps':        return steps(L);
      // the problem line already sits in the summary section when there is one
      case 'actual':       return bullets(n.actual, keys.has('summary') ? L.now : (n.summary || L.now));
      case 'expected':     return bullets(n.expected, L.should);
      case 'requirements': return bullets(n.requirements.length ? n.requirements : n.details, L.change);
      case 'acceptance':   return bullets([], L.done);
      case 'environment':  return envLines.join('\n') || L.envEmpty;
      case 'notes':        return bullets(n.notes, '-').replace(/^- -$/, '-');
      case 'screens':      return looseImgs.splice(0).join('\n') || '-';
      default:             return '-';
    }
  };

  let desc;
  if(useQa){
    desc = buildQaDescription({ n, qa, stepImgs, looseImgs, project, projectName, clientName, category, kind,
      priorityName: $('ciPriority')?.selectedOptions?.[0]?.text || '' });
  } else {
  const parts = headings.map(h => `## ${h}\n${body(h)}`);
  // anything the layout had no room for still ends up in the description
  if(!used.has('environment') && envLines.length) parts.push(`## ${L.env}\n${envLines.join('\n')}`);
  if(!used.has('notes') && n.notes.length) parts.push(`## ${L.notes}\n${bullets(n.notes, '-')}`);
  const leftover = [...looseImgs, ...[...stepImgs.values()].flat()];
  if(leftover.length) parts.push(`## ${L.shots}\n${leftover.join('\n')}`);
  desc = parts.join('\n\n').trim() + '\n';
  }

  // Title like "[Bug] …": prefix the subject with the tracker when it has none
  const subj = $('ciSubject');
  if(subj && trackerName && subj.value.trim() && !/^\s*\[/.test(subj.value)){
    subj.value = `[${trackerName}] ${subj.value.trim()}`;
  } else if(subj && !subj.value.trim() && n.summary){
    subj.value = `${trackerName ? `[${trackerName}] ` : ''}${n.summary}`.slice(0, 255);
  }

  const apply = () => {
    if(ta) ta.value = desc;
    window.__ciLastGenerated = desc;
    refreshCiPreview();
    renderCiFiles();
    toast(useQa ? 'Generated in the QA format, edit as needed'
      : team ? `Generated with your team's ${team.tracker} layout (from ${team.basedOn} recent issues)` : 'Description generated, edit as needed');
  };
  // don't silently overwrite text typed by hand (pasting screenshots doesn't count)
  const textOnly = (v) => String(v || '').replace(/^[ \t]*!\[[^\]]*\]\([^)]+\)[ \t]*\n?/gm, '').trim();
  const typed = textOnly(old);
  if(typed && typed !== textOnly(window.__ciLastGenerated)){
    confirmDialog({
      title: 'Replace the description?',
      message: 'The description has text you typed. Generating replaces it (screenshots are kept).',
      okText: 'Replace', cancelText: 'Keep mine'
    }).then(ok => { if(ok) apply(); });
    return;
  }
  apply();
}

function resetCreateIssueForm(){
  $('createIssueForm')?.reset();
  const box = $('ciResult');
  if(box){ box.style.display = 'none'; box.innerHTML = ''; }
  document.querySelectorAll('#createIssueForm [data-cf-id]').forEach(el => { el.value = ''; el.classList.remove('is-invalid'); });
  clearCiFiles();
  setCiTab('write');
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
  const descriptionMd = ($('ciDescription')?.value || '').trim();
  const description = ($('ciTextFormat')?.value === 'textile') ? markdownToTextile(descriptionMd) : descriptionMd;

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
  openGptPanel,
  closeGptPanel,
  importGptText,
  onCreateIssueShown,
  generateIssueDescription,
  onCreateIssueProjectChange,
  openCreateIssueView,
  resetCreateIssueForm,
  submitCreateIssue
};
