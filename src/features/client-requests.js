/**
 * Client requests (v4.69.0)
 *
 * The client's own list of requests (from Notepad, WhatsApp, e-mail, Excel …)
 * kept whole, one point per line, each point linked to the Redmine issues that
 * deliver it. The point's status follows its issues:
 *   done        every linked issue is done (or marked done by hand)
 *   doing       something linked is in progress, or done and not-started are mixed
 *   todo        linked issues are all still New
 *   missing     no issue in Redmine yet
 *   dropped     marked by hand (cancelled by the client / not needed)
 *
 * Stored per workspace: workspaces/{ws}/requests/{id}
 *   { client, title, receivedAt, source, items:[{id,no,text,detail,issueIds,mode,note}],
 *     files:[{name,url,publicId,bytes,type}], createdAt, createdBy, updatedAt, updatedBy }
 * Original files go to Cloudinary (raw upload, signed by /api/cloudinary).
 */
import { auth, db } from '../firebase.js';
import { CloudSync } from '../core/cloud-sync.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { apiFetch } from '../api.js';
import { confirmDialog } from '../ui/confirm.js';
import { canEdit } from '../core/team.js';
import { groupOf } from './client-report.js';

const REDMINE = 'https://pjm.zahironline.com/issues/';
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const MAX_FILE = 20 * 1024 * 1024;
const STATUS = {
  done:    { label: 'Done',            cls: 'is-done' },
  doing:   { label: 'In progress',     cls: 'is-doing' },
  todo:    { label: 'Not started',     cls: 'is-todo' },
  missing: { label: 'No issue yet',    cls: 'is-missing' },
  dropped: { label: 'Dropped',         cls: 'is-dropped' }
};

const R = {
  client: '', lists: [], loaded: false, unsub: null, ws: null,
  open: new Set(),          // list ids expanded
  form: null,               // { mode:'paste'|'excel', … } while adding a list
  addTo: null,              // list id receiving pasted points
  editList: null,           // list id whose title / date is being edited (v4.70.0)
  editItem: null,           // 'listId:itemId' of the point being edited (v4.70.0)
  busy: false
};
const ref = () => db.collection('workspaces').doc(CloudSync.workspaceId).collection('requests');
const uid = () => Math.random().toString(36).slice(2, 10);
const who = () => (auth.currentUser && (auth.currentUser.email || auth.currentUser.displayName)) || '';
const host = () => $('clientRequestsBody');
// the client's issues plus parent issues that don't carry the Client Name field (fetched by id)
const issuesOfClient = () => {
  const own = window.__clientIssues || [], extra = window.__clientParents || [];
  if(!extra.length) return own;
  const ids = new Set(own.map(i => String(i.id)));
  return own.concat(extra.filter(i => !ids.has(String(i.id))));
};
const issueById = (id) => issuesOfClient().find(i => String(i.id) === String(id));
/* v4.69.1: a request usually has ONE parent issue in Redmine (same or similar title) with
   FE / BE / design sub-issues. Points link to the parent; the sub-issues only feed its status. */
const parentIdOf = (i) => i && i.parent && i.parent.id ? String(i.parent.id) : '';
// parent id → sub-issues, rebuilt when the client's issue list changes
let kidsMap = null, kidsKey = null;
function kids(){
  const own = window.__clientIssues || [], extra = window.__clientParents || [];
  if(kidsMap && kidsKey && kidsKey[0] === own && kidsKey[1] === extra && kidsKey[2] === own.length + extra.length) return kidsMap;
  kidsMap = new Map();
  issuesOfClient().forEach(i => { const p = parentIdOf(i); if(p){ if(!kidsMap.has(p)) kidsMap.set(p, []); kidsMap.get(p).push(i); } });
  kidsKey = [own, extra, own.length + extra.length];
  return kidsMap;
}
const childrenOf = (id) => kids().get(String(id)) || [];
/* v4.69.3: Redmine trees can have three levels, e.g.
     RUMAH YATIM (client container) → one issue per request → FE / BE sub-issues.
   A "container" is an issue whose sub-issues have sub-issues of their own. The
   request level is the highest issue below a container. Suggestions use that
   level; an issue picked by hand is linked exactly as picked. */
const hasChildren = (id) => childrenOf(id).length > 0;
const isContainer = (id) => childrenOf(id).some(c => hasChildren(c.id));
function requestLevelOf(id){
  let cur = String(id);
  const seen = new Set();
  while(!seen.has(cur)){
    seen.add(cur);
    const p = parentIdOf(issueById(cur));
    if(!p || !issueById(p) || isContainer(p)) break;
    cur = p;
  }
  return cur;
}
/** progress group of a linked issue: its OWN current status (v4.69.5). Sub-issues are
    only shown as information ("2/3 sub-issues done"), they don't change the status. */
function linkedGroup(id){
  const i = issueById(id);
  return i ? groupOf(i) : 'todo';
}

/* ---------------- data ---------------- */
function listen(clientName){
  const ws = CloudSync.workspaceId;
  if(!ws) return;
  if(R.unsub && R.client === clientName && R.ws === ws) return;
  if(R.unsub){ try { R.unsub(); } catch(_){} }
  R.client = clientName; R.ws = ws; R.loaded = false; R.lists = [];
  R.unsub = ref().where('client', '==', clientName).onSnapshot(snap => {
    R.lists = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => l.client === clientName)
      .sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')) || (b.createdAt || 0) - (a.createdAt || 0));
    R.loaded = true;
    if(R.lists.length === 1) R.open.add(R.lists[0].id);
    rerender();
    try { window.dispatchEvent(new CustomEvent('requests:updated', { detail: { client: clientName } })); } catch(_){}
  }, err => {
    console.warn('requests', err);
    R.loaded = true; R.error = err.code === 'permission-denied' ? 'Firestore refused: publish the latest firestore.rules (v4.69.0 adds client requests).' : (err.message || String(err));
    R.unsub = null;
    rerender();
  });
}
/** Lists for a client (used by the Report tab). Starts listening if needed. */
export function getRequestLists(clientName){
  listen(clientName);
  return R.client === clientName ? R.lists : [];
}

async function saveList(id, patch){
  await ref().doc(id).set({ ...patch, updatedAt: Date.now(), updatedBy: who() }, { merge: true });
}
async function saveItems(list, items){
  try { await saveList(list.id, { items }); }
  catch(err){ toast(err.code === 'permission-denied' ? 'Not allowed: publish the latest firestore.rules, or ask for editor access' : (err.message || 'Could not save'), 'error'); }
}
const listById = (id) => R.lists.find(l => l.id === id);

/* ---------------- status ---------------- */
export function itemStatus(item){
  if(item.mode === 'done') return 'done';
  if(item.mode === 'dropped') return 'dropped';
  const ids = item.issueIds || [];
  if(!ids.length) return 'missing';
  const g = ids.map(id => linkedGroup(id));
  if(g.every(x => x === 'done')) return 'done';
  if(g.every(x => x === 'todo')) return 'todo';
  return 'doing';
}
export function listCounts(list){
  const c = { total: 0, done: 0, doing: 0, todo: 0, missing: 0, dropped: 0 };
  (list.items || []).forEach(it => { c.total++; c[itemStatus(it)]++; });
  c.active = c.total - c.dropped;
  return c;
}

/* ---------------- parsing ---------------- */
// "1. …", "1) …", "- …", "• …", "a. …" start a point; other lines continue the previous one.
const MARK = /^\s*(?:(\d{1,3})[.)]\s+|[-*•●▪◦]\s+|[a-z][.)]\s+)/i;
export function parseRequestText(text){
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const marked = lines.filter(l => MARK.test(l)).length;
  const items = [];
  lines.forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    if(!line.trim()) return;
    if(marked >= 2 ? MARK.test(line) : true){
      const m = line.match(MARK);
      items.push({ no: m && m[1] ? m[1] : '', text: line.replace(MARK, '').trim(), detail: '' });
    } else if(items.length){
      const last = items[items.length - 1];
      last.detail = (last.detail ? last.detail + '\n' : '') + line.trim();
    } else {
      items.push({ no: '', text: line.trim(), detail: '' });   // a heading line before the first number
    }
  });
  return items.map((it, n) => ({ id: uid(), no: it.no || String(n + 1), text: it.text.slice(0, 1000), detail: it.detail.slice(0, 3000), issueIds: [], mode: 'auto', note: '' }));
}

let xlsxP = null;
function loadXlsx(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(!xlsxP) xlsxP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = XLSX_URL; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => window.XLSX ? res(window.XLSX) : rej(new Error('Excel reader missing'));
    s.onerror = () => { xlsxP = null; rej(new Error('Could not load the Excel reader (check the connection)')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}
/** File → { sheets: { name: rows[][] } } (CSV read natively, xls/xlsx via SheetJS) */
async function readTable(file){
  const name = file.name.toLowerCase();
  if(name.endsWith('.csv') || name.endsWith('.txt')){
    const text = await file.text();
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return { sheets: { [file.name]: parseCsv(text, sep) } };
  }
  const X = await loadXlsx();
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  const sheets = {};
  wb.SheetNames.forEach(n => { sheets[n] = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }); });
  return { sheets };
}
function parseCsv(text, sep){
  const rows = []; let row = [], cell = '', q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){ if(ch === '"' && text[i + 1] === '"'){ cell += '"'; i++; } else if(ch === '"') q = false; else cell += ch; continue; }
    if(ch === '"') q = true;
    else if(ch === sep){ row.push(cell); cell = ''; }
    else if(ch === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
    else if(ch !== '\r') cell += ch;
  }
  if(cell || row.length){ row.push(cell); rows.push(row); }
  return rows;
}
/* the column that looks most like "the request": header words first, else the longest text */
function guessColumn(rows){
  const head = (rows[0] || []).map(h => String(h).toLowerCase());
  const byName = head.findIndex(h => /permintaan|request|kebutuhan|deskripsi|description|keterangan|uraian|requirement|fitur|feature|item/.test(h));
  if(byName >= 0) return byName;
  const len = (rows[0] || []).map((_, c) => rows.slice(1, 30).reduce((n, r) => n + String(r[c] || '').length, 0));
  return len.indexOf(Math.max(...len, 0));
}

/* ---------------- suggestions ---------------- */
const STOP = new Set('yang dan di ke dari untuk pada dengan tidak bisa agar ada akan atau juga saat jika sudah belum mohon tolong minta dibuat buat tambah tambahkan penambahan perbaikan ubah diubah menjadi supaya dalam oleh the and for with to of in on a an is fe be lap laporan'.split(' '));
const toks = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w)));
function similarity(a, b){
  if(!a.size || !b.size) return 0;
  let n = 0; a.forEach(w => { if(b.has(w)) n++; });
  return n / Math.sqrt(a.size * b.size);
}
let tokCache = new Map();
function issueToks(i){
  const k = `${i.id}@${i.updated_on || ''}`;
  if(!tokCache.has(k)) tokCache.set(k, { s: toks(i.subject), d: toks(String(i.description || '').slice(0, 600)) });
  return tokCache.get(k);
}
/* suggestions are request-level issues: a matching FE / BE sub-issue suggests its request
   issue, never the client container above it */
export function suggestIssues(item, n = 3){
  const t = toks(`${item.text} ${item.detail || ''}`);
  const linked = new Set((item.issueIds || []).map(String));
  const best = new Map();   // request-level id → best score
  issuesOfClient().forEach(i => {
    if(isContainer(i.id)) return;
    const it = issueToks(i);
    let score = Math.max(similarity(t, it.s), similarity(t, it.d) * 0.8);
    const top = requestLevelOf(i.id);
    if(top !== String(i.id)) score *= 0.9;          // matched through a sub-issue
    if(score > (best.get(top) || 0)) best.set(top, score);
  });
  return [...best.entries()].filter(([id, s]) => s >= 0.25 && !linked.has(id))
    .map(([id, score]) => ({ issue: issueById(id), score })).filter(x => x.issue)
    .sort((a, b) => b.score - a.score).slice(0, n);
}

/* ---------------- render ---------------- */
function rerender(){
  const el = host();
  if(el && el.isConnected) renderInto(el);
}
export function renderClientRequests(el, clientName){
  listen(clientName);
  renderInto(el);
}

const statusPill = (st) => `<span class="rq-status ${STATUS[st].cls}">${STATUS[st].label}</span>`;
function issueChip(id, listId, itemId){
  const i = issueById(id);
  const g = i ? linkedGroup(id) : '';
  const kids = i ? childrenOf(id) : [];
  const kidsDone = kids.filter(k => groupOf(k) === 'done').length;
  const cls = g === 'done' ? 'is-done' : g === 'todo' ? 'is-todo' : g ? 'is-doing' : 'is-unknown';
  const tip = i ? `${i.subject || ''} — ${i.status?.name || ''}${kids.length ? `\nSub-issues: ${kids.map(k => `#${k.id} ${k.status?.name || ''}`).join(', ')}` : ''}` : 'Issue not in this client\'s list';
  return `<span class="rq-chip ${cls}" title="${escapeHtml(tip)}">
    <a href="${REDMINE}${id}" target="_blank" rel="noopener">#${id}</a>${i ? `<small>${escapeHtml(i.status?.name || '')}${kids.length ? ` · ${kidsDone}/${kids.length} sub-issues done` : ''}</small>` : ''}
    ${canEdit() ? `<button type="button" aria-label="Unlink #${id}" onclick="unlinkRequestIssue('${listId}','${itemId}','${id}')">×</button>` : ''}</span>`;
}

function itemEditRow(list, it){
  return `<div class="rq-item rq-editing" onkeydown="if(event.key==='Escape'){event.preventDefault();cancelEditRequestItem();}">
    <input class="input rq-edit-no" id="rqEditNo" value="${escapeHtml(it.no || '')}" maxlength="12" aria-label="Number">
    <div class="rq-body">
      <input class="input" id="rqEditText" value="${escapeHtml(it.text || '')}" maxlength="1000" placeholder="The request, as the client wrote it" aria-label="Request" onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditRequestItem('${list.id}','${it.id}');}">
      <textarea class="input rq-edit-detail" id="rqEditDetail" rows="3" maxlength="3000" placeholder="Detail (optional)" aria-label="Detail">${escapeHtml(it.detail || '')}</textarea>
      <div class="rq-form-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="cancelEditRequestItem()">Cancel</button><button type="button" class="btn btn-primary btn-sm" onclick="saveEditRequestItem('${list.id}','${it.id}')">Save</button></div>
    </div>
  </div>`;
}
function itemRow(list, it, n, count){
  if(R.editItem === `${list.id}:${it.id}` && canEdit()) return itemEditRow(list, it);
  const st = itemStatus(it);
  const sug = canEdit() && st !== 'dropped' ? suggestIssues(it) : [];
  const edit = canEdit();
  return `<div class="rq-item rq-${st}">
    <div class="rq-no">${escapeHtml(it.no || '')}</div>
    <div class="rq-body">
      <div class="rq-text"${edit ? ` ondblclick="editRequestItem('${list.id}','${it.id}')" title="Double-click to edit"` : ''}>${escapeHtml(it.text || '')}</div>
      ${it.detail ? `<div class="rq-detail">${escapeHtml(it.detail)}</div>` : ''}
      <div class="rq-links">
        ${(it.issueIds || []).map(id => issueChip(id, list.id, it.id)).join('')}
        ${edit ? `<input class="rq-link-input" list="rqIssueList" placeholder="+ link issue #" aria-label="Link an issue" onkeydown="if(event.key==='Enter'){event.preventDefault();linkRequestIssue('${list.id}','${it.id}',this.value);this.value='';}" onchange="if(this.value){linkRequestIssue('${list.id}','${it.id}',this.value);this.value='';}">` : ''}
      </div>
      ${sug.length ? `<div class="rq-sug"><span>Suggested:</span>${sug.map(x => `<button type="button" class="rq-sug-btn" onclick="linkRequestIssue('${list.id}','${it.id}','${x.issue.id}')" title="${escapeHtml(x.issue.subject || '')}">+ #${x.issue.id} ${escapeHtml(String(x.issue.subject || '').slice(0, 60))}</button>`).join('')}</div>` : ''}
      ${it.note || edit ? `<div class="rq-note">${edit
        ? `<input class="rq-note-input" placeholder="Note for this point (answer to the client, decision …)" value="${escapeHtml(it.note || '')}" onchange="setRequestNote('${list.id}','${it.id}',this.value)">`
        : `<span>${escapeHtml(it.note)}</span>`}</div>` : ''}
    </div>
    <div class="rq-side">
      ${statusPill(st)}
      ${edit ? `<select class="rq-mode" aria-label="Status of this point" onchange="setRequestMode('${list.id}','${it.id}',this.value)">
        <option value="auto"${(it.mode || 'auto') === 'auto' ? ' selected' : ''}>From issues</option>
        <option value="done"${it.mode === 'done' ? ' selected' : ''}>Done (no issue needed)</option>
        <option value="dropped"${it.mode === 'dropped' ? ' selected' : ''}>Dropped</option>
      </select>
      <div class="rq-item-tools">
        <button type="button" class="rq-tool" title="Move up" aria-label="Move up" ${n === 0 ? 'disabled' : ''} onclick="moveRequestItem('${list.id}','${it.id}',-1)">↑</button>
        <button type="button" class="rq-tool" title="Move down" aria-label="Move down" ${n === count - 1 ? 'disabled' : ''} onclick="moveRequestItem('${list.id}','${it.id}',1)">↓</button>
        <button type="button" class="rq-tool" title="Edit this point" aria-label="Edit this point" onclick="editRequestItem('${list.id}','${it.id}')">✎</button>
        <button type="button" class="rq-tool rq-del" title="Delete this point" aria-label="Delete this point" onclick="removeRequestItem('${list.id}','${it.id}')">×</button>
      </div>` : ''}
    </div>
  </div>`;
}

function listCard(list){
  const c = listCounts(list);
  const open = R.open.has(list.id);
  const pct = c.active ? Math.round(c.done * 100 / c.active) : 0;
  const edit = canEdit();
  const files = (list.files || []).map((f, i) => `<span class="rq-file"><a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" title="${escapeHtml(f.name)}">📎 ${escapeHtml(f.name)}</a>${edit ? `<button type="button" aria-label="Remove ${escapeHtml(f.name)}" title="Remove this file" onclick="removeRequestFile('${list.id}',${i})">×</button>` : ''}</span>`).join('');
  return `<section class="rq-list${open ? ' is-open' : ''}">
    <header class="rq-list-head" onclick="if(!event.target.closest('button,a,input'))toggleRequestList('${list.id}')">
      <div class="rq-list-title">
        <b>${escapeHtml(list.title || 'Requests')}</b>
        <small>${list.receivedAt ? `received ${escapeHtml(fmtDate(list.receivedAt))} · ` : ''}${c.total} point${c.total === 1 ? '' : 's'}${list.source === 'excel' ? ' · from Excel' : ''}</small>
      </div>
      <div class="rq-list-bar" title="${c.done} of ${c.active} done">
        <span class="is-done" style="flex:${c.done}"></span><span class="is-doing" style="flex:${c.doing}"></span><span class="is-todo" style="flex:${c.todo}"></span><span class="is-missing" style="flex:${c.missing}"></span>
      </div>
      <div class="rq-list-counts">
        <b>${pct}%</b>
        <span class="is-done">${c.done} done</span><span class="is-doing">${c.doing} in progress</span><span class="is-todo">${c.todo} not started</span>${c.missing ? `<span class="is-missing">${c.missing} no issue yet</span>` : ''}
      </div>
      <button type="button" class="rq-toggle" aria-expanded="${open}" onclick="toggleRequestList('${list.id}')">${open ? 'Hide' : 'Show'}</button>
    </header>
    ${open ? `<div class="rq-list-body">
      ${files ? `<div class="rq-files">${files}</div>` : ''}
      ${edit ? `<div class="rq-list-tools">
        <button type="button" class="btn btn-secondary btn-xs" onclick="autoLinkRequests('${list.id}')">Link best suggestions</button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="openAddRequestPoints('${list.id}')">Add points</button>
        <label class="btn btn-secondary btn-xs rq-attach">Attach file<input type="file" multiple hidden onchange="attachRequestFiles('${list.id}', this.files); this.value=''"></label>
        <button type="button" class="btn btn-secondary btn-xs" onclick="renameRequestList('${list.id}')">Edit details</button>
        <button type="button" class="btn btn-ghost btn-xs rq-danger" onclick="deleteRequestList('${list.id}')">Delete list</button>
      </div>` : ''}
      ${R.editList === list.id && edit ? `<div class="rq-addpoints rq-editlist" onkeydown="if(event.key==='Escape'){event.preventDefault();cancelEditRequestList();}">
        <div class="rq-form-grid">
          <label class="field"><span>Title</span><input class="input" id="rqListTitle" maxlength="160" value="${escapeHtml(list.title || '')}" onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditRequestList('${list.id}');}"></label>
          <label class="field"><span>Received</span><input class="input" type="date" id="rqListDate" value="${escapeHtml(list.receivedAt || '')}"></label>
        </div>
        <div class="rq-form-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="cancelEditRequestList()">Cancel</button><button type="button" class="btn btn-primary btn-sm" onclick="saveEditRequestList('${list.id}')">Save</button></div></div>` : ''}
      ${R.addTo === list.id ? `<div class="rq-addpoints"><textarea id="rqAddText" class="input" rows="4" placeholder="Paste more points, one per line or numbered"></textarea>
        <div class="rq-form-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="cancelAddRequestPoints()">Cancel</button><button type="button" class="btn btn-primary btn-sm" onclick="saveAddRequestPoints('${list.id}')">Add</button></div></div>` : ''}
      <div class="rq-items">${(list.items || []).map((it, n, a) => itemRow(list, it, n, a.length)).join('') || '<p class="rq-empty">No points yet.</p>'}</div>
    </div>` : ''}
  </section>`;
}

function fmtDate(iso){
  const d = new Date(iso); if(isNaN(d)) return String(iso || '');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formHtml(){
  const f = R.form;
  const t = f.table;
  const sheet = t ? t.sheets[f.sheet] || [] : [];
  const cols = (sheet[0] || []).map((h, i) => `<option value="${i}"${Number(f.col) === i ? ' selected' : ''}>${escapeHtml(String(h || `Column ${i + 1}`)).slice(0, 60)}</option>`).join('');
  const preview = f.mode === 'excel' && t ? excelItems().slice(0, 6) : f.mode === 'paste' ? parseRequestText(f.text || '').slice(0, 6) : [];
  const count = f.mode === 'excel' && t ? excelItems().length : parseRequestText(f.text || '').length;
  return `<div class="rq-form">
    <h4>New request list</h4>
    <div class="rq-form-grid">
      <label class="field"><span>Title</span><input class="input" id="rqTitle" value="${escapeHtml(f.title || '')}" placeholder="e.g. Permintaan Oktober 2026 / meeting 14 Oct" oninput="R_setForm('title', this.value)"></label>
      <label class="field"><span>Received</span><input class="input" type="date" id="rqDate" value="${escapeHtml(f.date || '')}" onchange="R_setForm('date', this.value)"></label>
    </div>
    <div class="cr-tabs rq-mode-tabs" role="tablist">
      <button type="button" class="cr-tab${f.mode === 'paste' ? ' is-active' : ''}" onclick="R_setForm('mode','paste')">Paste text</button>
      <button type="button" class="cr-tab${f.mode === 'excel' ? ' is-active' : ''}" onclick="R_setForm('mode','excel')">Excel / CSV</button>
    </div>
    ${f.mode === 'paste' ? `<textarea class="input rq-paste" id="rqPaste" rows="9" placeholder="Paste the client's list here — from Notepad, WhatsApp, e-mail.\n1. Laporan stok per gudang\n2. Filter tanggal di laporan penjualan\n   (detail lines under a number stay with that point)" oninput="R_setForm('text', this.value, true)">${escapeHtml(f.text || '')}</textarea>`
    : `<div class="rq-excel">
        <label class="btn btn-secondary btn-sm">Choose Excel / CSV file<input type="file" hidden accept=".xlsx,.xls,.csv,.txt" onchange="R_readExcel(this.files[0])"></label>
        ${f.fileName ? `<span class="rq-muted">${escapeHtml(f.fileName)}</span>` : ''}
        ${t ? `<div class="rq-form-grid">
          ${Object.keys(t.sheets).length > 1 ? `<label class="field"><span>Sheet</span><select class="select" onchange="R_setForm('sheet', this.value)">${Object.keys(t.sheets).map(n => `<option${n === f.sheet ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>` : ''}
          <label class="field"><span>Request column</span><select class="select" onchange="R_setForm('col', this.value)">${cols}</select></label>
          <label class="field"><span>Detail column (optional)</span><select class="select" onchange="R_setForm('detailCol', this.value)"><option value="">—</option>${cols.replace(/ selected/g, '').replace(`value="${f.detailCol}"`, `value="${f.detailCol}" selected`)}</select></label>
        </div>
        <label class="sv-check"><input type="checkbox" ${f.keepFile !== false ? 'checked' : ''} onchange="R_setForm('keepFile', this.checked)"> Keep this file attached to the list</label>` : ''}
      </div>`}
    <label class="field rq-files-field"><span>Attach original files (optional — Excel, Word, PDF, images)</span><input type="file" multiple onchange="R_setFiles(this.files)"></label>
    <div class="rq-preview">${count ? `<b>${count} point${count === 1 ? '' : 's'}</b>${preview.map(p => `<div class="rq-prev-row"><span>${escapeHtml(p.no || '')}</span>${escapeHtml(p.text)}${p.detail ? `<small>${escapeHtml(p.detail.slice(0, 120))}</small>` : ''}</div>`).join('')}${count > preview.length ? `<div class="rq-muted">…and ${count - preview.length} more</div>` : ''}` : '<span class="rq-muted">The points will show here.</span>'}</div>
    <div class="rq-form-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick="closeRequestForm()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="saveRequestForm()"${R.busy ? ' disabled' : ''}>${R.busy ? 'Saving…' : 'Save list'}</button>
    </div>
  </div>`;
}
function excelItems(){
  const f = R.form, rows = (f.table && f.table.sheets[f.sheet]) || [];
  const col = Number(f.col), dcol = f.detailCol === '' || f.detailCol == null ? -1 : Number(f.detailCol);
  return rows.slice(1).filter(r => String(r[col] || '').trim()).map((r, n) => ({
    id: uid(), no: String(n + 1), text: String(r[col]).trim().slice(0, 1000),
    detail: dcol >= 0 ? String(r[dcol] || '').trim().slice(0, 3000) : '', issueIds: [], mode: 'auto', note: ''
  }));
}

const KEEP_IDS = ['rqAddText', 'rqEditNo', 'rqEditText', 'rqEditDetail', 'rqListTitle', 'rqListDate'];
function renderInto(el){
  if(R.error){ el.innerHTML = `<div class="kb-state kb-state-sm"><p>${escapeHtml(R.error)}</p></div>`; return; }
  const edit = canEdit();
  const all = R.lists.map(listCounts).reduce((a, c) => { Object.keys(c).forEach(k => a[k] = (a[k] || 0) + c[k]); return a; }, {});
  const head = `<div class="rq-head">
    <div><b>Client requests</b> <span class="rq-muted">${R.lists.length ? `${R.lists.length} list${R.lists.length === 1 ? '' : 's'} · ${all.total || 0} points · ${all.done || 0} done · ${all.missing || 0} not in Redmine yet` : 'the client\'s own list, point by point, linked to Redmine issues'}</span></div>
    ${edit && !R.form ? `<button type="button" class="btn btn-primary btn-sm" onclick="openRequestForm()">+ Add request list</button>` : ''}
  </div>`;
  // every issue of the client, with where it sits in the tree
  const datalist = `<datalist id="rqIssueList">${issuesOfClient().map(i => {
    const p = parentIdOf(i) && issueById(parentIdOf(i)) ? ` (under #${parentIdOf(i)})` : '';
    const kind = isContainer(i.id) ? ' [group]' : hasChildren(i.id) ? ' [has sub-issues]' : '';
    return `<option value="${i.id}">#${i.id} ${escapeHtml(String(i.subject || '').slice(0, 90))}${kind}${p} · ${escapeHtml(i.status?.name || '')}</option>`;
  }).join('')}</datalist>`;
  const body = !R.loaded ? '<div class="kb-state kb-state-sm"><p>Loading…</p></div>'
    : R.lists.length ? R.lists.map(listCard).join('')
    : R.form ? '' : `<div class="kb-state kb-state-sm"><p>No request list for this client yet.${edit ? ' Paste the list the client sent (or import their Excel), then link each point to its Redmine issue.' : ''}</p></div>`;
  const y = window.scrollY;
  const keep = KEEP_IDS.map(id => { const x = document.getElementById(id); return x && el.contains(x) ? [id, x.value] : null; }).filter(Boolean);
  const act = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
  el.innerHTML = head + (R.form ? formHtml() : '') + body + datalist;
  keep.forEach(([id, v]) => { const x = document.getElementById(id); if(x) x.value = v; });
  if(act){ const x = document.getElementById(act); if(x) x.focus(); }
  window.scrollTo(0, y);
}

/* ---------------- actions ---------------- */
function openRequestForm(){
  if(!canEdit()) return;
  R.form = { mode: 'paste', title: '', date: new Date().toISOString().slice(0, 10), text: '', files: [] };
  rerender();
  setTimeout(() => $('rqTitle')?.focus(), 30);
}
function closeRequestForm(){ R.form = null; rerender(); }
let pasteTimer = null;
function R_setForm(key, value, soft){
  if(!R.form) return;
  R.form[key] = value;
  if(key === 'sheet'){ R.form.col = guessColumn(R.form.table.sheets[value] || []); R.form.detailCol = ''; }
  if(soft){ clearTimeout(pasteTimer); pasteTimer = setTimeout(() => {   // keep typing focus: redraw only the preview
    const box = document.querySelector('.rq-preview'); if(!box) return;
    const items = parseRequestText(R.form.text || '');
    box.innerHTML = items.length ? `<b>${items.length} point${items.length === 1 ? '' : 's'}</b>${items.slice(0, 6).map(p => `<div class="rq-prev-row"><span>${escapeHtml(p.no)}</span>${escapeHtml(p.text)}${p.detail ? `<small>${escapeHtml(p.detail.slice(0, 120))}</small>` : ''}</div>`).join('')}${items.length > 6 ? `<div class="rq-muted">…and ${items.length - 6} more</div>` : ''}` : '<span class="rq-muted">The points will show here.</span>';
  }, 200); return; }
  if(key !== 'title') rerender();
}
function R_setFiles(files){ if(R.form) R.form.files = [...(files || [])]; }
async function R_readExcel(file){
  if(!file || !R.form) return;
  try {
    const table = await readTable(file);
    const first = Object.keys(table.sheets)[0];
    Object.assign(R.form, { table, file, fileName: file.name, sheet: first, col: guessColumn(table.sheets[first] || []), detailCol: '', keepFile: true });
    if(!R.form.title) R.form.title = file.name.replace(/\.[^.]+$/, '');
    rerender();
  } catch(err){ toast(err.message || 'Could not read the file', 'error'); }
}

/* Cloudinary raw upload (any file type), signed by the server */
async function uploadFile(file){
  if(file.size > MAX_FILE) throw new Error(`${file.name} is larger than 20 MB`);
  const r = await apiFetch('/api/cloudinary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sign', kind: 'file' }) });
  const s = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(s.error ? `${s.error}${s.hint ? ' — ' + s.hint : ''}` : `Upload not available (${r.status})`);
  const form = new FormData();
  form.append('file', file); form.append('api_key', s.apiKey); form.append('timestamp', String(s.timestamp));
  form.append('folder', s.folder); form.append('signature', s.signature);
  const up = await fetch(s.uploadUrl, { method: 'POST', body: form });
  const d = await up.json().catch(() => ({}));
  if(!up.ok || !d.secure_url) throw new Error(d.error?.message || `Upload failed (${up.status})`);
  return { name: file.name, url: d.secure_url, publicId: d.public_id, bytes: d.bytes || file.size, type: file.type || '' };
}
async function uploadAll(files){
  const out = [];
  for(const f of files){
    try { out.push(await uploadFile(f)); }
    catch(err){ toast(`${f.name}: ${err.message}`, 'error'); }
  }
  return out;
}

async function saveRequestForm(){
  const f = R.form;
  if(!f || R.busy) return;
  const items = f.mode === 'excel' ? (f.table ? excelItems() : []) : parseRequestText(f.text || '');
  if(!items.length){ toast(f.mode === 'excel' ? 'Choose a file and the request column' : 'Paste the client\'s list first', 'error'); return; }
  R.busy = true; rerender();
  try {
    const toUpload = [...(f.files || [])];
    if(f.mode === 'excel' && f.file && f.keepFile !== false && !toUpload.some(x => x.name === f.file.name)) toUpload.unshift(f.file);
    const files = toUpload.length ? await uploadAll(toUpload) : [];
    const now = Date.now();
    const doc = ref().doc();
    await doc.set({ client: R.client, title: (f.title || '').trim().slice(0, 160) || `Requests ${fmtDate(f.date || now)}`, receivedAt: f.date || new Date().toISOString().slice(0, 10),
      source: f.mode, items, files, createdAt: now, createdBy: who(), updatedAt: now, updatedBy: who() });
    R.form = null; R.open.add(doc.id);
    toast(`Saved ${items.length} point${items.length === 1 ? '' : 's'} — now link them to Redmine issues (try "Link best suggestions")`);
  } catch(err){
    toast(err.code === 'permission-denied' ? 'Not allowed: publish the latest firestore.rules (v4.69.0)' : (err.message || 'Could not save'), 'error');
  } finally { R.busy = false; rerender(); }
}

function toggleRequestList(id){ if(R.open.has(id)) R.open.delete(id); else R.open.add(id); rerender(); }

function mutateItem(listId, itemId, fn){
  const list = listById(listId); if(!list) return;
  const items = (list.items || []).map(it => it.id === itemId ? fn({ ...it, issueIds: [...(it.issueIds || [])] }) : it);
  saveItems(list, items);
}
function linkRequestIssue(listId, itemId, raw){
  const id = String(raw || '').match(/\d{2,7}/)?.[0];
  if(!id){ toast('Type an issue number, e.g. 32312', 'error'); return; }
  if(!issueById(id)) toast(`#${id} is not in this client's issue list — linked anyway`);
  // linked exactly as picked (a request issue, a sub-issue, or a container)
  mutateItem(listId, itemId, it => { if(!it.issueIds.map(String).includes(id)) it.issueIds.push(id); return it; });
}
function unlinkRequestIssue(listId, itemId, id){ mutateItem(listId, itemId, it => { it.issueIds = it.issueIds.filter(x => String(x) !== String(id)); return it; }); }
function setRequestMode(listId, itemId, mode){ mutateItem(listId, itemId, it => { it.mode = ['done', 'dropped'].includes(mode) ? mode : 'auto'; return it; }); }
function setRequestNote(listId, itemId, note){ mutateItem(listId, itemId, it => { it.note = String(note || '').slice(0, 1000); return it; }); }
async function removeRequestItem(listId, itemId){
  const list = listById(listId); if(!list) return;
  const it = (list.items || []).find(x => x.id === itemId);
  const ok = await confirmDialog({ title: 'Remove this point?', message: escapeHtml(it?.text || ''), okText: 'Remove', type: 'danger' });
  if(!ok) return;
  const items = list.items || [], left = items.filter(x => x.id !== itemId);
  if(R.editItem === `${listId}:${itemId}`) R.editItem = null;
  saveItems(list, isSequential(items) ? renumber(left) : left);
}
function autoLinkRequests(listId){
  const list = listById(listId); if(!list) return;
  let n = 0;
  const items = (list.items || []).map(it => {
    if((it.issueIds || []).length || it.mode === 'dropped' || it.mode === 'done') return it;
    const best = suggestIssues(it, 1)[0];
    if(best && best.score >= 0.4){ n++; return { ...it, issueIds: [String(best.issue.id)] }; }
    return it;
  });
  if(!n){ toast('No confident match — link the points by hand or from the suggestions'); return; }
  saveItems(list, items);
  toast(`Linked ${n} point${n === 1 ? '' : 's'} to their best match — check them and fix any wrong one`);
}
function openAddRequestPoints(listId){ R.addTo = listId; rerender(); setTimeout(() => $('rqAddText')?.focus(), 30); }
function cancelAddRequestPoints(){ R.addTo = null; rerender(); }
function saveAddRequestPoints(listId){
  const list = listById(listId); if(!list) return;
  const more = parseRequestText($('rqAddText')?.value || '');
  if(!more.length){ toast('Paste at least one point', 'error'); return; }
  const start = (list.items || []).length;
  more.forEach((it, n) => { if(/^\d+$/.test(it.no) && Number(it.no) === n + 1) it.no = String(start + n + 1); });
  R.addTo = null;
  saveItems(list, [...(list.items || []), ...more]);
  toast(`Added ${more.length} point${more.length === 1 ? '' : 's'}`);
}
async function attachRequestFiles(listId, files){
  const list = listById(listId); if(!list || !files || !files.length) return;
  toast('Uploading…');
  const up = await uploadAll([...files]);
  if(up.length){ await saveList(listId, { files: [...(list.files || []), ...up] }); toast(`Attached ${up.length} file${up.length === 1 ? '' : 's'}`); }
}
/* ---- v4.70.0: edit list details, edit / move points, remove files ---- */
function renameRequestList(listId){
  if(!canEdit() || !listById(listId)) return;
  R.editList = listId; R.open.add(listId); rerender();
  setTimeout(() => { const x = $('rqListTitle'); if(x){ x.focus(); x.select(); } }, 30);
}
function cancelEditRequestList(){ R.editList = null; rerender(); }
async function saveEditRequestList(listId){
  const list = listById(listId); if(!list) return;
  const title = String($('rqListTitle')?.value || '').trim().slice(0, 160);
  const date = String($('rqListDate')?.value || '').trim();
  if(!title){ toast('The list needs a title', 'error'); return; }
  try {
    await saveList(listId, { title, ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { receivedAt: date } : {}) });
    R.editList = null; rerender(); toast('List updated');
  } catch(err){ toast(err.code === 'permission-denied' ? 'Not allowed: ask for editor access' : (err.message || 'Could not save'), 'error'); }
}
function editRequestItem(listId, itemId){
  if(!canEdit()) return;
  R.editItem = `${listId}:${itemId}`; rerender();
  setTimeout(() => { const x = $('rqEditText'); if(x){ x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 30);
}
function cancelEditRequestItem(){ R.editItem = null; rerender(); }
function saveEditRequestItem(listId, itemId){
  const text = String($('rqEditText')?.value || '').trim();
  if(!text){ toast('A point needs some text — use × to delete it instead', 'error'); return; }
  const no = String($('rqEditNo')?.value || '').trim().slice(0, 12);
  const detail = String($('rqEditDetail')?.value || '').trim().slice(0, 3000);
  R.editItem = null;
  mutateItem(listId, itemId, it => ({ ...it, no, text: text.slice(0, 1000), detail }));
  rerender();
}
// numbers that were 1, 2, 3 … stay 1, 2, 3 … after a point is moved or deleted
const isSequential = (items) => items.length > 0 && items.every((it, n) => String(it.no) === String(n + 1));
const renumber = (items) => items.map((it, n) => ({ ...it, no: String(n + 1) }));
function moveRequestItem(listId, itemId, dir){
  const list = listById(listId); if(!list) return;
  const items = [...(list.items || [])];
  const i = items.findIndex(x => x.id === itemId), j = i + dir;
  if(i < 0 || j < 0 || j >= items.length) return;
  const seq = isSequential(items);
  [items[i], items[j]] = [items[j], items[i]];
  saveItems(list, seq ? renumber(items) : items);
}
async function destroyFile(f){
  if(!f || !f.publicId) return;
  try { await apiFetch('/api/cloudinary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'destroy', kind: 'file', public_id: f.publicId }) }); }
  catch(_){ /* the link is gone from the list either way */ }
}
async function removeRequestFile(listId, index){
  const list = listById(listId); if(!list) return;
  const f = (list.files || [])[index]; if(!f) return;
  const ok = await confirmDialog({ title: 'Remove this file?', message: `<b>${escapeHtml(f.name || '')}</b> will be removed from the list and deleted from storage.`, okText: 'Remove', type: 'danger' });
  if(!ok) return;
  try {
    await saveList(listId, { files: (list.files || []).filter((_, i) => i !== index) });
    destroyFile(f);
    toast('File removed');
  } catch(err){ toast(err.message || 'Could not remove the file', 'error'); }
}
async function deleteRequestList(listId){
  const list = listById(listId); if(!list) return;
  const nf = (list.files || []).length;
  const ok = await confirmDialog({ title: 'Delete this request list?', message: `<b>${escapeHtml(list.title || '')}</b> and its ${(list.items || []).length} point(s)${nf ? ` and ${nf} attached file${nf === 1 ? '' : 's'}` : ''} will be removed. Redmine issues are not touched.`, okText: 'Delete', type: 'danger' });
  if(!ok) return;
  try {
    await ref().doc(listId).delete();
    (list.files || []).forEach(destroyFile);
    if(R.editList === listId) R.editList = null;
    toast('List deleted');
  } catch(err){ toast(err.message || 'Could not delete', 'error'); }
}

export {
  openRequestForm, closeRequestForm, R_setForm, R_setFiles, R_readExcel, saveRequestForm, toggleRequestList,
  linkRequestIssue, unlinkRequestIssue, setRequestMode, setRequestNote, removeRequestItem, autoLinkRequests,
  openAddRequestPoints, cancelAddRequestPoints, saveAddRequestPoints, attachRequestFiles, renameRequestList, deleteRequestList,
  cancelEditRequestList, saveEditRequestList, editRequestItem, cancelEditRequestItem, saveEditRequestItem, moveRequestItem, removeRequestFile,
  STATUS as REQUEST_STATUS
};
