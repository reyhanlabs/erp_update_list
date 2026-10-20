/**
 * Meeting notes — Minutes of Meeting (v4.73.0)
 *
 * One record per meeting: title, date, optional client, attendees, place / link,
 * discussion notes, decisions and action items (owner, due date, done).
 * The client is optional; when set, the meeting also shows in that client's
 * "Meetings" tab under By Client.
 *
 * Stored per workspace: workspaces/{ws}/meetings/{id}
 *   { title, date, time, client, place, attendees, notes, decisions:[text],
 *     actions:[{id,text,owner,due,done,doneAt}], images:[{url,publicId,w,h,name}],
 *     updates:[{id,text,by,at}] (v4.76.0 follow-up log),
 *     createdAt, createdBy, updatedAt, updatedBy }
 * Images (v4.74.0) go to Cloudinary (signed by /api/cloudinary, kind 'meeting');
 * large photos are scaled down in the browser first.
 */
import { auth, db } from '../firebase.js';
import { CloudSync } from '../core/cloud-sync.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';
import { confirmDialog } from '../ui/confirm.js';
import { canEdit } from '../core/team.js';
import { siteNames } from './sites.js';
import { apiFetch } from '../api.js';
import { fetchRedmine } from '../redmine/client.js';

const M = {
  list: [], loaded: false, unsub: null, ws: null, error: '',
  q: '', client: 'all',       // filter on the Meeting notes page: all | none | <client>
  open: new Set(),            // (kept for old calls)
  sel: null,                  // v4.77.0: meeting shown in the detail pane
  quick: 'all',               // v4.77.0: all | open | overdue | internal
  pane: 'list',               // v4.77.0: on phones, list or detail
  form: null,                 // { id?, …fields, actions:[…] } while adding / editing
  inline: null,               // v4.76.0: { id, field: 'notes' | 'decisions' | 'act:<id>' } edited in place
  busy: false
};
const ref = () => db.collection('workspaces').doc(CloudSync.workspaceId).collection('meetings');
const uid = () => Math.random().toString(36).slice(2, 10);
const who = () => (auth.currentUser && (auth.currentUser.email || auth.currentUser.displayName)) || '';
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const sameClient = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const MAX_IMAGES = 30;
const MAX_BYTES = 20 * 1024 * 1024;     // before scaling down
const MAX_SIDE = 2400;                  // longest side kept, in px
const isCloudinary = (u) => /^https:\/\/res\.cloudinary\.com\//.test(String(u || ''));
const thumbOf = (u, w = 320, h = 220) => isCloudinary(u) ? u.replace('/upload/', `/upload/c_fill,w_${w},h_${h},q_auto,f_auto/`) : u;
const KEEP_IDS = ['mmTitle', 'mmDate', 'mmTime', 'mmClient', 'mmPlace', 'mmIssues', 'mmAttendees', 'mmNotes', 'mmDecisions'];

/* ---- Redmine links (v4.75.0) ---- */
const REDMINE = 'https://pjm.zahironline.com/issues/';
/** "#32312, 32315 https://pjm.zahironline.com/issues/32320" → ['32312','32315','32320'] */
function parseIssueIds(text){
  const out = [], t = String(text || '');
  const add = (id) => { if(id && !out.includes(id)) out.push(id); };
  t.replace(/issues\/(\d{1,7})|#?\b(\d{3,7})\b/g, (_, a, b) => { add(a || b); return ''; });   // in the order typed
  return out.slice(0, 50);
}
/* #32312 and Redmine URLs in free text become links (text is escaped first) */
function linkify(text){
  return escapeHtml(text)
    .replace(/https:\/\/pjm\.zahironline\.com\/issues\/(\d{1,7})[^\s<]*/g, (_, id) => `<a class="mm-ilink" href="${REDMINE}${id}" target="_blank" rel="noopener">#${id}</a>`)
    .replace(/(^|[\s(\[,;])#(\d{3,7})\b/g, (_, pre, id) => `${pre}<a class="mm-ilink" href="${REDMINE}${id}" target="_blank" rel="noopener">#${id}</a>`);
}
/* subject + status of linked issues: the client's issues if loaded, else fetched once per id */
const issueInfo = new Map();
const pendingIds = new Set();
function knownIssue(id){
  if(issueInfo.has(id)) return issueInfo.get(id);
  const all = [...(window.__clientIssues || []), ...(window.__clientParents || [])];
  const i = all.find(x => String(x.id) === String(id));
  if(i){ issueInfo.set(id, { subject: i.subject, status: i.status?.name || '' }); return issueInfo.get(id); }
  return null;
}
let fetchTimer = null;
function wantIssues(ids){
  ids.filter(id => !knownIssue(id) && !pendingIds.has(id)).forEach(id => pendingIds.add(id));
  if(!pendingIds.size || fetchTimer) return;
  fetchTimer = setTimeout(async () => {
    fetchTimer = null;
    const batch = [...pendingIds].slice(0, 50);
    try {
      const { data } = await fetchRedmine(`/api/redmine?issue_id=${batch.join(',')}&status_id=*&limit=100`);
      (data.issues || []).forEach(i => issueInfo.set(String(i.id), { subject: i.subject, status: i.status?.name || '' }));
      batch.forEach(id => { if(!issueInfo.has(id)) issueInfo.set(id, { missing: true }); });
    } catch(_){ batch.forEach(id => issueInfo.set(id, { missing: true })); }
    batch.forEach(id => pendingIds.delete(id));
    rerender();
    if(pendingIds.size) wantIssues([]);
  }, 60);
}
function issueChips(ids){
  wantIssues(ids);
  return ids.map(id => {
    const i = knownIssue(id);
    const closed = i && /closed|resolved|rejected|done|finish|selesai|cancel/i.test(i.status || '');
    return `<a class="mm-issue${closed ? ' is-closed' : ''}" href="${REDMINE}${id}" target="_blank" rel="noopener" title="${escapeHtml(i && i.subject ? `${i.subject} — ${i.status}` : 'Open in Redmine')}">
      <b>#${escapeHtml(id)}</b>${i && i.subject ? `<span class="mm-issue-subj">${escapeHtml(i.subject)}</span><span class="mm-issue-st">${escapeHtml(i.status)}</span>` : i && i.missing ? '' : '<span class="mm-issue-subj is-loading">…</span>'}</a>`;
  }).join('');
}

/* ---------------- data ---------------- */
function listen(){
  const ws = CloudSync.workspaceId;
  if(!ws) return;
  if(M.unsub && M.ws === ws) return;
  if(M.unsub){ try { M.unsub(); } catch(_){} }
  M.ws = ws; M.loaded = false;
  M.unsub = ref().onSnapshot(snap => {
    M.list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.time || '').localeCompare(String(a.time || '')) || (b.createdAt || 0) - (a.createdAt || 0));
    M.loaded = true; M.error = '';
    updateCount();
    rerender();
  }, err => {
    console.warn('meetings', err);
    M.loaded = true; M.unsub = null;
    M.error = err.code === 'permission-denied' ? 'Firestore refused: publish the latest firestore.rules (v4.73.0 adds meeting notes).' : (err.message || String(err));
    rerender();
  });
}
export function ensureMeetingsLoaded(){ listen(); }
export const getMeetings = () => M.list;

const openActions = (m) => (m.actions || []).filter(a => !a.done && String(a.text || '').trim());
function updateCount(){
  const el = $('countMeetings');
  if(!el) return;
  const n = M.list.reduce((s, m) => s + openActions(m).length, 0);
  el.textContent = String(n);
  el.dataset.zero = n ? '0' : '1';
}

/* client names for the picker: Redmine clients seen in By Client + Client Versions sites + earlier meetings */
function clientNames(){
  const names = new Map();
  const add = (n) => { const t = String(n || '').trim(); if(t && !names.has(t.toLowerCase())) names.set(t.toLowerCase(), t); };
  try {
    const ov = window.__clientOverview || JSON.parse(localStorage.getItem('erp_client_overview_v2') || 'null');
    (ov && ov.clients || []).forEach(c => add(c.name));
  } catch(_){}
  try { siteNames().forEach(add); } catch(_){}
  M.list.forEach(m => add(m.client));
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/* ---------------- render ---------------- */
let host = null, fixedClient = '';
function rerender(){ if(host && host.isConnected) paint(); }

/** Meeting notes page */
export function renderMeetingsView(){
  listen();
  host = $('meetingsBody'); fixedClient = '';
  if(host) paint();
}
/** "Meetings" tab of a client under By Client */
export function renderClientMeetings(el, clientName){
  listen();
  host = el; fixedClient = clientName || '';
  if(host) paint();
}

function fmtDate(iso, time){
  const d = new Date(String(iso || '') + 'T00:00:00');
  if(isNaN(d)) return escapeHtml(iso || '');
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${time ? ` · ${escapeHtml(time)}` : ''}`;
}
const monthOf = (iso) => { const d = new Date(String(iso || '') + 'T00:00:00'); return isNaN(d) ? 'No date' : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
function dueChip(a){
  if(!a.due) return '';
  const late = !a.done && a.due < today();
  const d = new Date(a.due + 'T00:00:00');
  return `<span class="mm-due${late ? ' is-late' : ''}" title="${late ? 'Overdue' : 'Due date'}">${late ? 'Overdue · ' : 'Due '}${escapeHtml(isNaN(d) ? a.due : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>`;
}

function matches(m){
  if(fixedClient) return sameClient(m.client, fixedClient);
  if(M.client === 'none' && m.client) return false;
  if(M.client !== 'all' && M.client !== 'none' && !sameClient(m.client, M.client)) return false;
  const q = M.q.trim().toLowerCase();
  if(!q) return true;
  const hay = [m.title, m.client, m.place, m.attendees, m.notes, (m.updates || []).map(u => u.text).join(' '), (m.issueIds || []).map(id => '#' + id).join(' '), (m.decisions || []).join(' '), (m.actions || []).map(a => `${a.text} ${a.owner}`).join(' ')].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

/* ---- v4.76.0: edit one part in place (double-click) ---- */
const isInline = (m, field) => M.inline && M.inline.id === m.id && M.inline.field === field;
const inlineKeys = (m, field) => `onkeydown="if(event.key==='Escape'){event.preventDefault();cancelMeetingInline();}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey||this.tagName==='INPUT')){event.preventDefault();saveMeetingInline('${m.id}','${field}');}"`;
const inlineButtons = (m, field) => `<div class="mm-inline-acts"><span>${field === 'notes' || field === 'decisions' ? 'Ctrl+Enter to save · Esc to cancel' : 'Enter to save · Esc to cancel'}</span><button type="button" class="btn btn-secondary btn-xs" onclick="cancelMeetingInline()">Cancel</button><button type="button" class="btn btn-primary btn-xs" onclick="saveMeetingInline('${m.id}','${field}')">Save</button></div>`;
const dbl = (m, field, edit) => edit ? ` ondblclick="editMeetingInline('${m.id}','${field}')" title="Double-click to edit"` : '';
function notesSection(m, edit){
  if(isInline(m, 'notes')) return `<section class="mm-sec is-notes"><h5>Discussion</h5><textarea class="input mm-inline" id="mmInline" data-keep data-k="${m.id}:${M.inline.field}" rows="6" maxlength="20000" ${inlineKeys(m, 'notes')}>${escapeHtml(m.notes || '')}</textarea>${inlineButtons(m, 'notes')}</section>`;
  if(m.notes) return `<section class="mm-sec is-notes"><h5>Discussion</h5><div class="mm-notes mm-editable"${dbl(m, 'notes', edit)}>${linkify(m.notes)}</div></section>`;
  return edit ? `<section class="mm-sec is-notes"><h5>Discussion</h5><button type="button" class="mm-empty" onclick="editMeetingInline('${m.id}','notes')">+ Add discussion notes</button></section>` : '';
}
function decisionsSection(m, edit){
  const list = m.decisions || [];
  if(isInline(m, 'decisions')) return `<section class="mm-sec is-dec"><h5>Decisions <small>one per line</small></h5><textarea class="input mm-inline" id="mmInline" data-keep data-k="${m.id}:${M.inline.field}" rows="${Math.max(3, list.length + 1)}" maxlength="5000" ${inlineKeys(m, 'decisions')}>${escapeHtml(list.join('\n'))}</textarea>${inlineButtons(m, 'decisions')}</section>`;
  if(list.length) return `<section class="mm-sec is-dec"><h5>Decisions</h5><ul class="mm-decisions mm-editable"${dbl(m, 'decisions', edit)}>${list.map(d => `<li>${linkify(d)}</li>`).join('')}</ul></section>`;
  return edit ? `<section class="mm-sec is-dec"><h5>Decisions</h5><button type="button" class="mm-empty" onclick="editMeetingInline('${m.id}','decisions')">+ Add decisions</button></section>` : '';
}
function actionsSection(m, acts, edit){
  if(!acts.length && !edit) return '';
  const dn = acts.filter(a => a.done).length, pct = acts.length ? Math.round(dn * 100 / acts.length) : 0;
  return `<section class="mm-sec is-acts"><h5>Action items ${acts.length ? `<small>${dn} of ${acts.length} done</small>` : ''}</h5>
    ${acts.length ? `<div class="mm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Action items done"><i style="width:${pct}%"></i></div>` : ''}
    ${acts.length ? `<ul class="mm-actions">${acts.map(a => isInline(m, 'act:' + a.id)
      ? `<li class="mm-act-inline"><div class="mm-act-row">
          <input class="input" id="mmInline" data-keep data-k="${m.id}:${M.inline.field}" maxlength="500" value="${escapeHtml(a.text || '')}" ${inlineKeys(m, 'act:' + a.id)} aria-label="Action">
          <input class="input" id="mmInlineOwner" data-keep data-k="${m.id}:${M.inline.field}" maxlength="80" value="${escapeHtml(a.owner || '')}" placeholder="Owner" ${inlineKeys(m, 'act:' + a.id)} aria-label="Owner">
          <input class="input" type="date" id="mmInlineDue" data-keep data-k="${m.id}:${M.inline.field}" value="${escapeHtml(a.due || '')}" ${inlineKeys(m, 'act:' + a.id)} aria-label="Due date">
          <button type="button" class="rq-tool rq-del" title="Delete this action" aria-label="Delete this action" onclick="deleteMeetingAction('${m.id}','${a.id}')">×</button>
        </div>${inlineButtons(m, 'act:' + a.id)}</li>`
      : `<li class="${a.done ? 'is-done' : ''}">
          <label><input type="checkbox" ${a.done ? 'checked' : ''} ${edit ? '' : 'disabled'} onchange="toggleMeetingAction('${m.id}','${a.id}',this.checked)"><span class="mm-editable"${dbl(m, 'act:' + a.id, edit)}>${linkify(a.text)}</span></label>
          <span class="mm-act-meta">${dueChip(a)}${a.owner ? `<span class="mm-owner" title="${escapeHtml(a.owner)}">${avatar(a.owner, 'sm')}<span>${escapeHtml(a.owner)}</span></span>` : ''}</span>
        </li>`).join('')}</ul>` : ''}
    ${edit ? `<div class="mm-quick"><input class="input" id="mmQa-${m.id}" data-keep maxlength="500" placeholder="+ Add an action item — e.g. Kirim build ke client @Reyhan" onkeydown="if(event.key==='Enter'){event.preventDefault();addMeetingQuickAction('${m.id}',this.value);}"></div>` : ''}
  </section>`;
}
/* ---- v4.76.0: follow-up updates, newest at the bottom ---- */
function updatesSection(m, edit){
  const ups = m.updates || [];
  if(!ups.length && !edit) return '';
  const me = who();
  return `<section class="mm-sec is-upd mm-updates"><h5>Updates ${ups.length ? `<small>${ups.length}</small>` : ''}</h5>
    ${ups.length ? `<ol class="mm-timeline">${ups.map(u => `<li>
      <div class="mm-upd-head">${avatar(u.by || '?', 'xs')}<b>${escapeHtml(new Date(u.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</b><span>${escapeHtml(String(u.by || '').split('@')[0])}</span>
        ${edit && (u.by === me || canEdit()) ? `<button type="button" class="mm-upd-del" title="Delete this update" aria-label="Delete this update" onclick="deleteMeetingUpdate('${m.id}','${u.id}')">×</button>` : ''}</div>
      <div class="mm-upd-text">${linkify(u.text)}</div></li>`).join('')}</ol>` : ''}
    ${edit ? `<div class="mm-quick mm-upd-add"><textarea class="input" id="mmUpd-${m.id}" data-keep rows="1" maxlength="3000" placeholder="Add an update… (Enter to add)" title="Enter to add · Shift+Enter for a new line" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,200)+'px'" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();addMeetingUpdate('${m.id}',this.value);}"></textarea><button type="button" class="btn btn-primary btn-xs" onclick="addMeetingUpdate('${m.id}',document.getElementById('mmUpd-${m.id}').value)">Add</button></div>` : ''}
  </section>`;
}

function actionRow(a, n){
  return `<div class="mm-act-row" data-i="${n}">
    <input class="input" placeholder="What needs to be done" value="${escapeHtml(a.text || '')}" maxlength="500" oninput="setMeetingAction(${n},'text',this.value)" aria-label="Action ${n + 1}">
    <input class="input" placeholder="Owner" value="${escapeHtml(a.owner || '')}" maxlength="80" oninput="setMeetingAction(${n},'owner',this.value)" aria-label="Owner of action ${n + 1}">
    <input class="input" type="date" value="${escapeHtml(a.due || '')}" onchange="setMeetingAction(${n},'due',this.value)" aria-label="Due date of action ${n + 1}">
    <button type="button" class="rq-tool rq-del" title="Remove this action" aria-label="Remove action ${n + 1}" onclick="removeMeetingActionRow(${n})">×</button>
  </div>`;
}

function formHtml(){
  const f = M.form;
  return `<div class="rq-form mm-form" data-k="${f.key}" onpaste="pasteMeetingImages(event)" onkeydown="if(event.key==='Escape'){event.preventDefault();closeMeetingForm();}">
    <h4>${f.id ? 'Edit meeting notes' : 'New meeting notes'}</h4>
    <div class="mm-form-grid">
      <label class="field mm-span-2"><span>Title</span><input class="input" id="mmTitle" maxlength="160" value="${escapeHtml(f.title || '')}" placeholder="e.g. Weekly sync, UAT review, Kick-off"></label>
      <label class="field"><span>Date</span><input class="input" type="date" id="mmDate" value="${escapeHtml(f.date || '')}"></label>
      <label class="field"><span>Time (optional)</span><input class="input" type="time" id="mmTime" value="${escapeHtml(f.time || '')}"></label>
      <label class="field mm-span-2"><span>Client (optional)</span><input class="input" id="mmClient" list="mmClientList" maxlength="120" value="${escapeHtml(f.client || '')}" placeholder="Leave empty for an internal meeting"${fixedClient && !f.id ? ' readonly' : ''}></label>
      <label class="field mm-span-2"><span>Place / link (optional)</span><input class="input" id="mmPlace" maxlength="200" value="${escapeHtml(f.place || '')}" placeholder="Office, client site, Google Meet link …"></label>
      <label class="field mm-span-4"><span>Redmine issues (optional)</span><input class="input" id="mmIssues" maxlength="2000" value="${escapeHtml(f.issues || '')}" placeholder="#32312, #32315 — or paste Redmine links"></label>
      <label class="field mm-span-4"><span>Attendees</span><input class="input" id="mmAttendees" maxlength="600" value="${escapeHtml(f.attendees || '')}" placeholder="Names, separated by commas"></label>
      <label class="field mm-span-4"><span>Discussion</span><textarea class="input" id="mmNotes" rows="6" maxlength="20000" placeholder="What was discussed — paste from WhatsApp or your notes">${escapeHtml(f.notes || '')}</textarea></label>
      <label class="field mm-span-4"><span>Decisions (one per line)</span><textarea class="input" id="mmDecisions" rows="3" maxlength="5000" placeholder="Go-live moved to 3 Nov&#10;Use the new invoice layout">${escapeHtml(f.decisions || '')}</textarea></label>
    </div>
    <div class="mm-images-edit" ondragover="event.preventDefault();this.classList.add('is-drag')" ondragleave="this.classList.remove('is-drag')" ondrop="event.preventDefault();this.classList.remove('is-drag');addMeetingImages(event.dataTransfer.files)">
      <div class="mm-acts-edit-head"><b>Images</b><span>photos of the whiteboard, screenshots … — choose, drag here, or paste (Ctrl+V)</span></div>
      <div class="mm-gallery">
        ${f.images.map((im, i) => `<div class="mm-thumb is-edit"><img src="${escapeHtml(thumbOf(im.url))}" alt="${escapeHtml(im.name || 'Image')}"><button type="button" class="mm-thumb-del" aria-label="Remove ${escapeHtml(im.name || 'image')}" title="Remove" onclick="removeMeetingImage(${i})">×</button></div>`).join('')}
        ${f.uploading ? `<div class="mm-thumb is-loading"><span>Uploading ${f.uploading}…</span></div>` : ''}
        ${f.images.length < MAX_IMAGES ? `<label class="mm-thumb is-add"><input type="file" accept="image/*" multiple hidden onchange="addMeetingImages(this.files);this.value=''"><span>+ Add images</span></label>` : ''}
      </div>
    </div>
    <div class="mm-acts-edit">
      <div class="mm-acts-edit-head"><b>Action items</b><span>what · owner · due date</span></div>
      <div id="mmActRows">${f.actions.map(actionRow).join('')}</div>
      <button type="button" class="btn btn-secondary btn-xs" onclick="addMeetingActionRow()">+ Add action</button>
    </div>
    <div class="rq-form-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick="closeMeetingForm()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="saveMeetingForm()"${M.busy || f.uploading ? ' disabled' : ''}>${M.busy ? 'Saving…' : 'Save'}</button>
    </div>
  </div>`;
}

/* ---------------- layout (v4.77.0) ----------------
   Summary tiles (also filters) · toolbar · list on the left, the chosen meeting
   on the right (on phones: list, then the meeting with a Back button). Each client
   gets its own accent colour; internal meetings are slate. */
const ACCENTS = ['#4f46e5', '#7c3aed', '#0284c7', '#c026d3', '#0d9488', '#db2777', '#ea580c', '#2563eb'];
function hashOf(t){ let h = 0; for(const ch of String(t || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
const accentOf = (m) => m.client ? ACCENTS[hashOf(m.client) % ACCENTS.length] : '#64748b';
const initials = (n) => { const w = String(n || '').replace(/\(.*?\)/g, '').split(/[\s@._-]+/).filter(Boolean); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase(); };
const avatar = (name, size = '') => `<span class="mm-av${size ? ' is-' + size : ''}" style="--av:${ACCENTS[hashOf(name) % ACCENTS.length]}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
const overdueOf = (m) => (m.actions || []).filter(a => !a.done && a.due && a.due < today() && String(a.text || '').trim());
const peopleOf = (m) => String(m.attendees || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
function quickOk(m){
  if(M.quick === 'open') return openActions(m).length > 0;
  if(M.quick === 'overdue') return overdueOf(m).length > 0;
  if(M.quick === 'internal') return !m.client;
  return true;
}

function statsHtml(all){
  const month = today().slice(0, 7);
  const thisMonth = all.filter(m => String(m.date || '').startsWith(month)).length;
  const open = all.reduce((n, m) => n + openActions(m).length, 0);
  const late = all.reduce((n, m) => n + overdueOf(m).length, 0);
  const clients = new Set(all.filter(m => m.client && String(m.date || '').startsWith(month)).map(m => m.client.toLowerCase())).size;
  const tile = (cls, label, n, sub, quick) => `<button type="button" class="mm-stat ${cls}${quick && M.quick === quick ? ' is-active' : ''}"${quick ? ` onclick="setMeetingQuick('${quick}')" aria-pressed="${M.quick === quick}"` : ' tabindex="-1"'}><span>${label}</span><b>${n}</b><small>${sub}</small></button>`;
  return `<div class="mm-stats">
    ${tile('is-month', 'This month', thisMonth, `meeting${thisMonth === 1 ? '' : 's'} in ${new Date().toLocaleDateString('en-GB', { month: 'long' })}`, '')}
    ${tile('is-open', 'Open actions', open, open ? 'click to show those meetings' : 'nothing waiting', 'open')}
    ${tile('is-late', 'Overdue', late, late ? 'past their due date' : 'all on time', 'overdue')}
    ${fixedClient ? tile('is-total', 'All meetings', all.length, `with ${escapeHtml(fixedClient)}`, '') : tile('is-clients', 'Clients met', clients, 'this month', '')}
  </div>`;
}

function itemHtml(m){
  const d = new Date(String(m.date || '') + 'T00:00:00');
  const acts = (m.actions || []).filter(a => String(a.text || '').trim()), done = acts.filter(a => a.done).length, late = overdueOf(m).length;
  const sel = M.sel === m.id;
  return `<button type="button" class="mm-item${sel ? ' is-sel' : ''}" style="--acc:${accentOf(m)}" onclick="selectMeeting('${m.id}')" aria-current="${sel}">
    <span class="mm-cal"><small>${isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { month: 'short' })}</small><b>${isNaN(d) ? '?' : d.getDate()}</b></span>
    <span class="mm-item-main">
      <b>${escapeHtml(m.title || 'Meeting')}</b>
      <span class="mm-item-sub">${m.client && !fixedClient ? `<span class="mm-tag">${escapeHtml(m.client)}</span>` : !m.client ? '<span class="mm-tag is-internal">Internal</span>' : ''}<span>${isNaN(d) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short' })}${m.time ? ' · ' + escapeHtml(m.time) : ''}</span></span>
      <span class="mm-item-icons">
        ${acts.length ? `<span class="${done === acts.length ? 'is-ok' : ''}" title="Action items done">✓ ${done}/${acts.length}</span>` : ''}
        ${late ? `<span class="is-late" title="Overdue action items">⏰ ${late}</span>` : ''}
        ${(m.issueIds || []).length ? `<span title="Redmine issues">#${m.issueIds.length}</span>` : ''}
        ${(m.images || []).length ? `<span title="Images">▣ ${m.images.length}</span>` : ''}
        ${(m.updates || []).length ? `<span title="Updates">↻ ${m.updates.length}</span>` : ''}
      </span>
    </span>
  </button>`;
}

function detailHtml(m){
  const edit = canEdit();
  const acts = (m.actions || []).filter(a => String(a.text || '').trim());
  const people = peopleOf(m);
  const d = new Date(String(m.date || '') + 'T00:00:00');
  const images = (m.images || []).length ? `<section class="mm-sec is-img"><h5>Images <small>${m.images.length}</small></h5><div class="mm-gallery">${m.images.map((im, i) => `<button type="button" class="mm-thumb" onclick="openMeetingImage('${m.id}',${i})" title="${escapeHtml(im.name || 'Image')}"><img src="${escapeHtml(thumbOf(im.url))}" alt="${escapeHtml(im.name || 'Meeting image')}" loading="lazy"></button>`).join('')}</div></section>` : '';
  const issues = (m.issueIds || []).length ? `<section class="mm-sec is-iss"><h5>Redmine issues <small>${m.issueIds.length}</small></h5><div class="mm-issues">${issueChips(m.issueIds)}</div></section>` : '';
  const ppl = people.length ? `<section class="mm-sec is-ppl"><h5>Attendees <small>${people.length}</small></h5><ul class="mm-people">${people.map(p => `<li>${avatar(p)}<span>${escapeHtml(p)}</span></li>`).join('')}</ul></section>` : '';
  return `<article class="mm-detail" style="--acc:${accentOf(m)}">
    <header class="mm-hero">
      <button type="button" class="mm-back" onclick="meetingBackToList()">← All meetings</button>
      <div class="mm-hero-top">
        <span class="mm-hero-when">${isNaN(d) ? escapeHtml(m.date || '') : escapeHtml(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${m.time ? ` · ${escapeHtml(m.time)}` : ''}</span>
        <span class="mm-hero-acts">
          <button type="button" class="mm-hbtn" onclick="copyMeeting('${m.id}')" title="Copy as text for WhatsApp or e-mail">Copy text</button>
          ${edit ? `<button type="button" class="mm-hbtn" onclick="editMeeting('${m.id}')">Edit</button><button type="button" class="mm-hbtn is-danger" onclick="deleteMeeting('${m.id}')" aria-label="Delete">Delete</button>` : ''}
        </span>
      </div>
      <h3>${escapeHtml(m.title || 'Meeting')}</h3>
      <div class="mm-hero-meta">
        ${m.client ? (fixedClient ? `<span class="mm-hero-client">${escapeHtml(m.client)}</span>` : `<button type="button" class="mm-hero-client" onclick="openMeetingClient(${escapeHtml(JSON.stringify(m.client))})" title="Open this client in By Client">${escapeHtml(m.client)} ↗</button>`) : '<span class="mm-hero-client is-internal">Internal meeting</span>'}
        ${m.place ? `<span class="mm-hero-place">📍 ${/^https?:\/\//.test(m.place) ? `<a href="${escapeHtml(m.place)}" target="_blank" rel="noopener">${escapeHtml(m.place.replace(/^https?:\/\//, '').slice(0, 40))}</a>` : escapeHtml(m.place)}</span>` : ''}
        ${people.length ? `<span class="mm-stack" title="${escapeHtml(people.join(', '))}">${people.slice(0, 5).map(p => avatar(p, 'sm')).join('')}${people.length > 5 ? `<span class="mm-av is-sm is-more">+${people.length - 5}</span>` : ''}</span>` : ''}
      </div>
    </header>
    <div class="mm-detail-grid">
      <div class="mm-col">
        ${notesSection(m, edit)}
        ${decisionsSection(m, edit)}
        ${updatesSection(m, edit)}
      </div>
      <div class="mm-col">
        ${actionsSection(m, acts, edit)}
        ${issues}
        ${images}
        ${ppl}
      </div>
    </div>
    <footer class="mm-foot"><span class="mm-by">${m.createdBy ? `Written by ${escapeHtml(m.createdBy)}` : ''}${m.updatedBy ? ` · last edited by ${escapeHtml(m.updatedBy)}${m.updatedAt ? ' ' + escapeHtml(new Date(m.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : ''}` : ''}</span></footer>
  </article>`;
}

function emptyHtml(kind){
  const edit = canEdit();
  const text = kind === 'filter' ? 'No meeting matches the search or filter.'
    : fixedClient ? `No meeting notes with ${escapeHtml(fixedClient)} yet.` : 'No meeting notes yet.';
  return `<div class="mm-emptybox"><div class="mm-empty-ic" aria-hidden="true">🗒️</div><b>${text}</b>
    ${kind !== 'filter' ? '<p>Write the minutes right after a meeting: what was discussed, what was decided, and who does what by when.</p>' : ''}
    ${kind === 'filter' ? `<button type="button" class="btn btn-secondary btn-sm" onclick="clearMeetingFilters()">Clear filters</button>` : edit ? `<button type="button" class="btn btn-primary btn-sm" onclick="openMeetingForm()">+ New meeting notes</button>` : ''}</div>`;
}

function paint(){
  const el = host;
  if(M.error){ el.innerHTML = `<div class="kb-state kb-state-sm"><p>${escapeHtml(M.error)}</p></div>`; return; }
  const edit = canEdit();
  const scope = fixedClient ? M.list.filter(m => sameClient(m.client, fixedClient)) : M.list;
  const shown = M.list.filter(m => matches(m) && quickOk(m));
  if(!M.sel || !shown.some(m => m.id === M.sel)) M.sel = shown.length ? shown[0].id : null;
  const cur = shown.find(m => m.id === M.sel);
  const clients = clientNames();
  const usedClients = [...new Map(M.list.filter(m => m.client).map(m => [m.client.toLowerCase(), m.client])).values()].sort((a, b) => a.localeCompare(b));
  const chip = (v, label) => `<button type="button" class="mm-chip${M.quick === v ? ' is-active' : ''}" onclick="setMeetingQuick('${v}')" aria-pressed="${M.quick === v}">${label}</button>`;
  const toolbar = `<div class="mm-toolbar">
      ${fixedClient ? '' : `<div class="mm-search"><span aria-hidden="true">⌕</span><input class="input" id="mmSearch" type="search" placeholder="Search title, client, notes, actions, #issue…" value="${escapeHtml(M.q)}" oninput="setMeetingSearch(this.value)"></div>
      <select class="select" aria-label="Client" onchange="setMeetingClient(this.value)">
        <option value="all"${M.client === 'all' ? ' selected' : ''}>All clients</option>
        <option value="none"${M.client === 'none' ? ' selected' : ''}>Internal (no client)</option>
        ${usedClients.map(c => `<option value="${escapeHtml(c)}"${sameClient(M.client, c) ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>`}
      <div class="mm-chips">${chip('all', 'All')}${chip('open', 'Open actions')}${chip('overdue', 'Overdue')}${fixedClient ? '' : chip('internal', 'Internal')}</div>
      ${edit ? `<button type="button" class="btn btn-primary btn-sm mm-new" onclick="openMeetingForm()"${M.form && !M.form.id ? ' disabled' : ''}>+ New meeting notes</button>` : ''}
    </div>`;
  let main;
  if(!M.loaded) main = '<div class="kb-state kb-state-sm"><p>Loading…</p></div>';
  else if(!scope.length && !M.form) main = emptyHtml('none');
  else {
    let month = '';
    const list = shown.length ? shown.map(m => { const mo = monthOf(m.date); const sep = mo !== month ? `<div class="mm-month">${escapeHtml(mo)}</div>` : ''; month = mo; return sep + itemHtml(m); }).join('') : emptyHtml('filter');
    const right = M.form ? formHtml() : cur ? detailHtml(cur) : '<div class="mm-emptybox is-pane"><b>Choose a meeting on the left</b></div>';
    main = `<div class="mm-split${M.pane === 'detail' || M.form ? ' show-detail' : ''}">
      <nav class="mm-rail" aria-label="Meetings">${list}</nav>
      <div class="mm-pane">${right}</div>
    </div>`;
  }
  // v4.76.1: a typed value only comes back into the SAME form / the same meeting's field —
  // never into another meeting's form opened in its place
  const ownerKey = (x) => x.dataset.k || (x.closest('.mm-form') && x.closest('.mm-form').dataset.k) || '';
  const keepIds = [...KEEP_IDS, ...[...el.querySelectorAll('[data-keep][id]')].map(x => x.id)];
  const keep = keepIds.map(id => { const x = document.getElementById(id); return x && el.contains(x) ? [id, x.value, ownerKey(x)] : null; }).filter(Boolean);
  const act = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  const actId = act && act.id, actRow = act && act.closest && act.closest('.mm-act-row'), actIdx = actRow ? [...actRow.querySelectorAll('input')].indexOf(act) : -1, rowI = actRow ? actRow.dataset.i : null;
  const sel = act && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
  const y = window.scrollY;
  const railTop = el.querySelector('.mm-rail')?.scrollTop || 0;
  el.innerHTML = (M.loaded && (scope.length || M.form) ? statsHtml(scope) + toolbar : '') + main + `<datalist id="mmClientList">${clients.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>`;
  const rail = el.querySelector('.mm-rail'); if(rail) rail.scrollTop = railTop;
  el.classList.toggle('is-detail', !!el.querySelector('.mm-split.show-detail'));   // phones: hide tiles + toolbar while a meeting is open
  keep.forEach(([id, v, k]) => { const x = document.getElementById(id); if(x && ownerKey(x) === k) x.value = v; });
  let back = actId ? document.getElementById(actId) : (rowI != null ? el.querySelectorAll(`.mm-act-row[data-i="${rowI}"] input`)[actIdx] : null);
  if(back){ back.focus(); if(sel && back.setSelectionRange) try { back.setSelectionRange(sel[0], sel[1]); } catch(_){} }
  window.scrollTo(0, y);
}

/* ---------------- actions ---------------- */
function readForm(){
  const f = M.form; if(!f) return;
  KEEP_IDS.forEach(id => { const x = $(id); if(x) f[id.slice(2).toLowerCase()] = x.value; });
}
function openMeetingForm(id){
  if(!canEdit()) return;
  const m = id ? M.list.find(x => x.id === id) : null;
  if(M.form) (M.form.added || []).forEach(destroyImage);   // another form was open: its unsaved uploads go
  M.inline = null;
  M.form = m
    ? { id: m.id, title: m.title || '', date: m.date || '', time: m.time || '', client: m.client || '', place: m.place || '', issues: (m.issueIds || []).map(id => '#' + id).join(', '), attendees: m.attendees || '', notes: m.notes || '', decisions: (m.decisions || []).join('\n'),
        actions: (m.actions || []).map(a => ({ ...a })).concat([{ id: uid(), text: '', owner: '', due: '', done: false }]),
        images: (m.images || []).map(im => ({ ...im })), added: [], removed: [], uploading: 0, key: uid() }
    : { title: '', date: today(), time: '', client: fixedClient || '', place: '', issues: '', attendees: '', notes: '', decisions: '', actions: [{ id: uid(), text: '', owner: '', due: '', done: false }],
        images: [], added: [], removed: [], uploading: 0, key: uid() };
  if(id) M.sel = id;
  rerender();
  setTimeout(() => { const x = $('mmTitle'); if(x){ x.focus(); x.scrollIntoView({ block: 'nearest' }); } }, 30);
}
const editMeeting = (id) => openMeetingForm(id);
function closeMeetingForm(){
  // images uploaded in this form but never saved are deleted again
  if(M.form) (M.form.added || []).forEach(destroyImage);
  M.form = null; rerender();
}
function setMeetingAction(n, key, value){ if(M.form && M.form.actions[n]) M.form.actions[n][key] = value; }
function addMeetingActionRow(){ if(!M.form) return; readForm(); M.form.actions.push({ id: uid(), text: '', owner: '', due: '', done: false }); rerender(); setTimeout(() => { const rows = document.querySelectorAll('.mm-act-row'); rows[rows.length - 1]?.querySelector('input')?.focus(); }, 20); }
function removeMeetingActionRow(n){ if(!M.form) return; readForm(); M.form.actions.splice(n, 1); if(!M.form.actions.length) M.form.actions.push({ id: uid(), text: '', owner: '', due: '', done: false }); rerender(); }

async function saveMeetingForm(){
  if(!M.form || M.busy) return;
  readForm();
  const f = M.form;
  const title = String(f.title || '').trim().slice(0, 160);
  if(!title){ toast('Give the meeting a title', 'error'); $('mmTitle')?.focus(); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''))){ toast('Pick the meeting date', 'error'); $('mmDate')?.focus(); return; }
  const doc = {
    title, date: f.date, time: /^\d{2}:\d{2}$/.test(f.time || '') ? f.time : '',
    client: String(f.client || '').trim().slice(0, 120), place: String(f.place || '').trim().slice(0, 200),
    attendees: String(f.attendees || '').trim().slice(0, 600), notes: String(f.notes || '').trim().slice(0, 20000),
    decisions: String(f.decisions || '').split('\n').map(s => s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 100).map(s => s.slice(0, 500)),
    actions: f.actions.filter(a => String(a.text || '').trim()).slice(0, 100).map(a => ({ id: a.id || uid(), text: String(a.text).trim().slice(0, 500), owner: String(a.owner || '').trim().slice(0, 80),
      due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '', done: !!a.done, doneAt: a.done ? (a.doneAt || Date.now()) : null })),
    issueIds: parseIssueIds(f.issues),
    images: (f.images || []).slice(0, MAX_IMAGES).map(im => ({ url: im.url, publicId: im.publicId || '', w: im.w || 0, h: im.h || 0, name: String(im.name || '').slice(0, 120) })),
    updatedAt: Date.now(), updatedBy: who()
  };
  if(f.uploading){ toast('Wait until the images are uploaded', 'error'); return; }
  M.busy = true; rerender();
  try {
    if(f.id) await ref().doc(f.id).set(doc, { merge: true });
    else { const d = ref().doc(); await d.set({ ...doc, createdAt: Date.now(), createdBy: who() }); M.sel = d.id; M.pane = 'detail'; }
    (f.removed || []).forEach(destroyImage);   // removed in the form → gone from storage too
    M.form = null;
    toast(f.id ? 'Meeting notes updated' : 'Meeting notes saved');
  } catch(err){
    toast(err.code === 'permission-denied' ? 'Not allowed: publish the latest firestore.rules (v4.73.0), or ask for editor access' : (err.message || 'Could not save'), 'error');
  } finally { M.busy = false; rerender(); }
}

async function toggleMeetingAction(id, actionId, done){
  const m = M.list.find(x => x.id === id); if(!m) return;
  const actions = (m.actions || []).map(a => a.id === actionId ? { ...a, done: !!done, doneAt: done ? Date.now() : null } : a);
  try { await ref().doc(id).set({ actions, updatedAt: Date.now(), updatedBy: who() }, { merge: true }); }
  catch(err){ toast(err.message || 'Could not update', 'error'); rerender(); }
}

/* ---- v4.76.0: in-place edits, quick actions, updates ---- */
function editMeetingInline(id, field){
  if(!canEdit()) return;
  M.inline = { id, field }; M.sel = id; rerender();
  setTimeout(() => { const x = $('mmInline'); if(x){ x.focus(); const n = x.value.length; try { x.setSelectionRange(n, n); } catch(_){} } }, 30);
}
function cancelMeetingInline(){ M.inline = null; rerender(); }
async function saveMeetingInline(id, field){
  const m = M.list.find(x => x.id === id); if(!m) return;
  const val = String($('mmInline')?.value || '');
  let patch;
  if(field === 'notes') patch = { notes: val.trim().slice(0, 20000) };
  else if(field === 'decisions') patch = { decisions: val.split('\n').map(x => x.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 100).map(x => x.slice(0, 500)) };
  else if(field.startsWith('act:')){
    const aid = field.slice(4), text = val.trim();
    if(!text){ toast('An action needs some text — use × to delete it', 'error'); return; }
    const owner = String($('mmInlineOwner')?.value || '').trim().slice(0, 80), due = String($('mmInlineDue')?.value || '');
    patch = { actions: (m.actions || []).map(a => a.id === aid ? { ...a, text: text.slice(0, 500), owner, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '' } : a) };
  } else return;
  M.inline = null;
  try { await ref().doc(id).set({ ...patch, updatedAt: Date.now(), updatedBy: who() }, { merge: true }); }
  catch(err){ toast(err.code === 'permission-denied' ? 'Not allowed: ask for editor access' : (err.message || 'Could not save'), 'error'); }
  rerender();
}
async function deleteMeetingAction(id, aid){
  const m = M.list.find(x => x.id === id); if(!m) return;
  M.inline = null;
  try { await ref().doc(id).set({ actions: (m.actions || []).filter(a => a.id !== aid), updatedAt: Date.now(), updatedBy: who() }, { merge: true }); }
  catch(err){ toast(err.message || 'Could not delete', 'error'); }
  rerender();
}
/* "Kirim build ke client @Reyhan" → owner Reyhan (the @name at the end is optional) */
async function addMeetingQuickAction(id, raw){
  const m = M.list.find(x => x.id === id); if(!m) return;
  let text = String(raw || '').trim(), owner = '';
  const at = text.match(/\s@([^@]{1,60})$/);
  if(at){ owner = at[1].trim(); text = text.slice(0, at.index).trim(); }
  if(!text) return;
  const input = $('mmQa-' + id); if(input) input.value = '';
  try { await ref().doc(id).set({ actions: [...(m.actions || []), { id: uid(), text: text.slice(0, 500), owner: owner.slice(0, 80), due: '', done: false, doneAt: null }], updatedAt: Date.now(), updatedBy: who() }, { merge: true }); }
  catch(err){ if(input) input.value = raw; toast(err.message || 'Could not add', 'error'); }
}
async function addMeetingUpdate(id, raw){
  const text = String(raw || '').trim();
  if(!text) return;
  const input = $('mmUpd-' + id); if(input){ input.value = ''; input.style.height = ''; }
  const u = { id: uid(), text: text.slice(0, 3000), by: who(), at: Date.now() };
  try { await ref().doc(id).set({ updates: firebase.firestore.FieldValue.arrayUnion(u), updatedAt: Date.now(), updatedBy: who() }, { merge: true }); }
  catch(err){ if(input) input.value = raw; toast(err.code === 'permission-denied' ? 'Not allowed: ask for editor access' : (err.message || 'Could not add the update'), 'error'); }
}
async function deleteMeetingUpdate(id, uidv){
  const m = M.list.find(x => x.id === id); if(!m) return;
  const ok = await confirmDialog({ title: 'Delete this update?', message: escapeHtml(((m.updates || []).find(u => u.id === uidv) || {}).text || ''), okText: 'Delete', type: 'danger' });
  if(!ok) return;
  try { await ref().doc(id).set({ updates: (m.updates || []).filter(u => u.id !== uidv), updatedAt: Date.now(), updatedBy: who() }, { merge: true }); }
  catch(err){ toast(err.message || 'Could not delete', 'error'); }
}

async function deleteMeeting(id){
  const m = M.list.find(x => x.id === id); if(!m) return;
  const ok = await confirmDialog({ title: 'Delete these meeting notes?', message: `<b>${escapeHtml(m.title || '')}</b> (${escapeHtml(fmtDate(m.date))}) will be removed.`, okText: 'Delete', type: 'danger' });
  if(!ok) return;
  try { await ref().doc(id).delete(); (m.images || []).forEach(destroyImage); if(M.sel === id){ M.sel = null; M.pane = 'list'; } toast('Meeting notes deleted'); }
  catch(err){ toast(err.message || 'Could not delete', 'error'); }
}

function meetingText(m){
  const lines = [`*${m.title || 'Meeting'}*`, `${fmtDate(m.date, m.time).replace(/&amp;/g, '&')}${m.client ? ` · ${m.client}` : ''}${m.place ? ` · ${m.place}` : ''}`];
  if(m.attendees) lines.push('', `*Attendees:* ${m.attendees}`);
  if(m.notes) lines.push('', '*Discussion*', m.notes);
  if((m.decisions || []).length) lines.push('', '*Decisions*', ...m.decisions.map(d => `• ${d}`));
  const acts = (m.actions || []).filter(a => String(a.text || '').trim());
  if(acts.length) lines.push('', '*Action items*', ...acts.map(a => `${a.done ? '✅' : '☐'} ${a.text}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (due ${a.due})` : ''}`));
  if((m.updates || []).length) lines.push('', '*Updates*', ...m.updates.map(u => `${new Date(u.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${u.by ? ` (${u.by.split('@')[0]})` : ''}: ${u.text}`));
  if((m.issueIds || []).length) lines.push('', '*Redmine*', ...m.issueIds.map(id => { const i = knownIssue(id); return `${REDMINE}${id}${i && i.subject ? ` — ${i.subject}` : ''}`; }));
  if((m.images || []).length) lines.push('', '*Images*', ...m.images.map(im => im.url));
  return lines.join('\n');
}
async function copyMeeting(id){
  const m = M.list.find(x => x.id === id); if(!m) return;
  try { await writeClipboard(meetingText(m)); toast('Meeting notes copied — paste into WhatsApp or e-mail'); }
  catch(_){ toast('Could not copy', 'error'); }
}

function toggleMeeting(id){ selectMeeting(id); }
function selectMeeting(id){
  if(M.form){ toast('Save or cancel the notes you are editing first', 'error'); return; }
  M.sel = id; M.inline = null; M.pane = 'detail'; rerender();
  if(window.innerWidth <= 980) host?.scrollIntoView({ block: 'start' });
}
function meetingBackToList(){ M.pane = 'list'; M.inline = null; rerender(); }
function setMeetingQuick(v){ M.quick = ['open', 'overdue', 'internal'].includes(v) && M.quick !== v ? v : 'all'; rerender(); }
function clearMeetingFilters(){ M.q = ''; M.client = 'all'; M.quick = 'all'; rerender(); }
let searchTimer = null;
function setMeetingSearch(v){ M.q = String(v || ''); clearTimeout(searchTimer); searchTimer = setTimeout(rerender, 150); }
function setMeetingClient(v){ M.client = v || 'all'; rerender(); }
function openMeetingClient(name){
  if(typeof window.switchView === 'function') window.switchView('clients');
  window.__clientTab = 'meetings';
  if(typeof window.openClientIssues === 'function') window.openClientIssues(name);
}

/* ---------------- images (v4.74.0) ---------------- */
function loadImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name || 'Image'} is not a readable image`)); };
    img.src = url;
  });
}
/* big photos → longest side 2400 px, WebP; small screenshots are sent as they are */
async function prepareImage(file){
  const { img, url } = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  try {
    if(Math.max(w, h) <= MAX_SIDE && file.size <= 1.5 * 1024 * 1024) return { blob: file, w, h };
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.88)) || await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    return { blob: blob && blob.size < file.size ? blob : file, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}
async function uploadImage(file){
  if(file.size > MAX_BYTES) throw new Error(`${file.name || 'Image'} is larger than 20 MB`);
  const { blob, w, h } = await prepareImage(file);
  const r = await apiFetch('/api/cloudinary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sign', kind: 'meeting' }) });
  const s = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(s.error ? `${s.error}${s.hint ? ' — ' + s.hint : ''}` : `Upload not available (${r.status})`);
  const form = new FormData();
  form.append('file', blob, file.name || 'image'); form.append('api_key', s.apiKey); form.append('timestamp', String(s.timestamp));
  form.append('folder', s.folder); form.append('signature', s.signature);
  const up = await fetch(s.uploadUrl, { method: 'POST', body: form });
  const d = await up.json().catch(() => ({}));
  if(!up.ok || !d.secure_url) throw new Error(d.error?.message || `Upload failed (${up.status})`);
  return { url: d.secure_url, publicId: d.public_id, w: d.width || w, h: d.height || h, name: String(file.name || 'image').slice(0, 120) };
}
async function addMeetingImages(files){
  const f = M.form;
  if(!f || !files) return;
  readForm();
  const list = [...files].filter(x => /^image\//.test(x.type || ''));
  if(!list.length){ toast('Only images can be attached here', 'error'); return; }
  const room = MAX_IMAGES - f.images.length - (f.uploading || 0);
  if(room <= 0){ toast(`Up to ${MAX_IMAGES} images per meeting`, 'error'); return; }
  const take = list.slice(0, room);
  if(list.length > room) toast(`Only ${room} more image${room === 1 ? '' : 's'} fit (max ${MAX_IMAGES})`);
  f.uploading = (f.uploading || 0) + take.length; rerender();
  for(const file of take){
    try {
      const im = await uploadImage(file);
      if(M.form !== f){ destroyImage(im); continue; }      // form closed meanwhile
      f.images.push(im); f.added.push(im);
    } catch(err){ toast(err.message || 'Upload failed', 'error'); }
    finally { f.uploading = Math.max(0, f.uploading - 1); if(M.form === f){ readForm(); rerender(); } }
  }
}
function pasteMeetingImages(ev){
  const items = [...((ev.clipboardData && ev.clipboardData.items) || [])].filter(i => i.kind === 'file' && /^image\//.test(i.type));
  if(!items.length) return;                                   // plain text paste goes on as usual
  ev.preventDefault();
  addMeetingImages(items.map((i, n) => { const fl = i.getAsFile(); return fl && !fl.name.replace(/^image\.\w+$/, '') ? new File([fl], `pasted-${Date.now()}-${n + 1}.${(fl.type.split('/')[1] || 'png')}`, { type: fl.type }) : fl; }).filter(Boolean));
}
function removeMeetingImage(i){
  const f = M.form; if(!f) return;
  readForm();
  const [im] = f.images.splice(i, 1);
  if(im){
    if(f.added.includes(im)){ f.added = f.added.filter(x => x !== im); destroyImage(im); }   // never saved: delete now
    else f.removed.push(im);                                                               // saved before: delete on Save
  }
  rerender();
}
async function destroyImage(im){
  if(!im || !im.publicId) return;
  try { await apiFetch('/api/cloudinary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'destroy', kind: 'meeting', public_id: im.publicId }) }); }
  catch(_){ /* the link is gone from the notes either way */ }
}

/* simple viewer: ← → to browse, Esc to close */
let viewer = null;
function openMeetingImage(id, i){
  const m = M.list.find(x => x.id === id); if(!m || !(m.images || []).length) return;
  viewer = { m, i: Math.max(0, Math.min(i, m.images.length - 1)) };
  let box = document.getElementById('mmViewer');
  if(!box){
    box = document.createElement('div');
    box.id = 'mmViewer'; box.className = 'mm-viewer'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.addEventListener('click', (e) => { if(e.target === box) closeMeetingImage(); });
    document.body.appendChild(box);
    document.addEventListener('keydown', (e) => {
      if(!viewer) return;
      if(e.key === 'Escape') closeMeetingImage();
      else if(e.key === 'ArrowRight') stepMeetingImage(1);
      else if(e.key === 'ArrowLeft') stepMeetingImage(-1);
    });
  }
  paintViewer();
  box.classList.add('is-open');
}
function paintViewer(){
  const box = document.getElementById('mmViewer'); if(!box || !viewer) return;
  const { m, i } = viewer, im = m.images[i], n = m.images.length;
  box.innerHTML = `<figure class="mm-viewer-fig">
      <img src="${escapeHtml(isCloudinary(im.url) ? im.url.replace('/upload/', '/upload/q_auto,f_auto/') : im.url)}" alt="${escapeHtml(im.name || 'Meeting image')}">
      <figcaption><span>${escapeHtml(m.title || 'Meeting')} · ${i + 1} / ${n}</span><a href="${escapeHtml(im.url)}" target="_blank" rel="noopener">Open original</a></figcaption>
    </figure>
    ${n > 1 ? `<button type="button" class="mm-viewer-nav is-prev" aria-label="Previous image" onclick="stepMeetingImage(-1)">‹</button><button type="button" class="mm-viewer-nav is-next" aria-label="Next image" onclick="stepMeetingImage(1)">›</button>` : ''}
    <button type="button" class="mm-viewer-close" aria-label="Close" onclick="closeMeetingImage()">×</button>`;
}
function stepMeetingImage(d){ if(!viewer) return; const n = viewer.m.images.length; viewer.i = (viewer.i + d + n) % n; paintViewer(); }
function closeMeetingImage(){ viewer = null; const box = document.getElementById('mmViewer'); if(box){ box.classList.remove('is-open'); box.innerHTML = ''; } }

export {
  selectMeeting, meetingBackToList, setMeetingQuick, clearMeetingFilters,
  editMeetingInline, cancelMeetingInline, saveMeetingInline, deleteMeetingAction, addMeetingQuickAction, addMeetingUpdate, deleteMeetingUpdate,
  addMeetingImages, pasteMeetingImages, removeMeetingImage, openMeetingImage, stepMeetingImage, closeMeetingImage,
  openMeetingForm, editMeeting, closeMeetingForm, saveMeetingForm, setMeetingAction, addMeetingActionRow, removeMeetingActionRow,
  toggleMeetingAction, deleteMeeting, copyMeeting, toggleMeeting, setMeetingSearch, setMeetingClient, openMeetingClient
};
