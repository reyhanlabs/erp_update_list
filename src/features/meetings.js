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
 *     actions:[{id,text,owner,due,done,doneAt}], createdAt, createdBy, updatedAt, updatedBy }
 */
import { auth, db } from '../firebase.js';
import { CloudSync } from '../core/cloud-sync.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';
import { confirmDialog } from '../ui/confirm.js';
import { canEdit } from '../core/team.js';
import { siteNames } from './sites.js';

const M = {
  list: [], loaded: false, unsub: null, ws: null, error: '',
  q: '', client: 'all',       // filter on the Meeting notes page: all | none | <client>
  open: new Set(),            // meeting ids expanded
  form: null,                 // { id?, …fields, actions:[…] } while adding / editing
  busy: false
};
const ref = () => db.collection('workspaces').doc(CloudSync.workspaceId).collection('meetings');
const uid = () => Math.random().toString(36).slice(2, 10);
const who = () => (auth.currentUser && (auth.currentUser.email || auth.currentUser.displayName)) || '';
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const sameClient = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const KEEP_IDS = ['mmTitle', 'mmDate', 'mmTime', 'mmClient', 'mmPlace', 'mmAttendees', 'mmNotes', 'mmDecisions'];

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
  const hay = [m.title, m.client, m.place, m.attendees, m.notes, (m.decisions || []).join(' '), (m.actions || []).map(a => `${a.text} ${a.owner}`).join(' ')].join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function card(m){
  const open = M.open.has(m.id);
  const acts = (m.actions || []).filter(a => String(a.text || '').trim());
  const done = acts.filter(a => a.done).length;
  const edit = canEdit();
  const people = String(m.attendees || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  return `<article class="mm-card${open ? ' is-open' : ''}">
    <header class="mm-head" onclick="if(!event.target.closest('button,a,input'))toggleMeeting('${m.id}')">
      <div class="mm-when"><b>${escapeHtml(fmtDate(m.date, m.time))}</b>${m.place ? `<span>${escapeHtml(m.place)}</span>` : ''}</div>
      <div class="mm-title">
        <b>${escapeHtml(m.title || 'Meeting')}</b>
        <div class="mm-sub">
          ${m.client && !fixedClient ? `<button type="button" class="mm-client" onclick="openMeetingClient(${escapeHtml(JSON.stringify(m.client))})" title="Open this client in By Client">${escapeHtml(m.client)}</button>` : ''}
          ${!m.client && !fixedClient ? '<span class="mm-noclient">No client</span>' : ''}
          ${people.length ? `<span>${people.length} attendee${people.length === 1 ? '' : 's'}</span>` : ''}
          ${(m.decisions || []).length ? `<span>${m.decisions.length} decision${m.decisions.length === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
      <div class="mm-progress">${acts.length ? `<span class="mm-acts${done === acts.length ? ' is-done' : ''}">${done}/${acts.length} actions done</span>` : '<span class="mm-acts is-none">No action items</span>'}</div>
      <button type="button" class="rq-toggle" aria-expanded="${open}" onclick="toggleMeeting('${m.id}')">${open ? 'Hide' : 'Show'}</button>
    </header>
    ${open ? `<div class="mm-body">
      ${people.length ? `<section><h5>Attendees</h5><div class="mm-people">${people.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div></section>` : ''}
      ${m.notes ? `<section><h5>Discussion</h5><div class="mm-notes">${escapeHtml(m.notes)}</div></section>` : ''}
      ${(m.decisions || []).length ? `<section><h5>Decisions</h5><ul class="mm-decisions">${m.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul></section>` : ''}
      ${acts.length ? `<section><h5>Action items</h5><ul class="mm-actions">${acts.map(a => `<li class="${a.done ? 'is-done' : ''}">
          <label><input type="checkbox" ${a.done ? 'checked' : ''} ${edit ? '' : 'disabled'} onchange="toggleMeetingAction('${m.id}','${a.id}',this.checked)"><span>${escapeHtml(a.text)}</span></label>
          <span class="mm-act-meta">${a.owner ? `<span class="mm-owner">${escapeHtml(a.owner)}</span>` : ''}${dueChip(a)}</span>
        </li>`).join('')}</ul></section>` : ''}
      <footer class="mm-foot">
        <span class="mm-by">${m.updatedBy ? `Last edited by ${escapeHtml(m.updatedBy)}` : m.createdBy ? `Written by ${escapeHtml(m.createdBy)}` : ''}</span>
        <span class="mm-foot-acts">
          <button type="button" class="btn btn-secondary btn-xs" onclick="copyMeeting('${m.id}')">Copy text</button>
          ${edit ? `<button type="button" class="btn btn-secondary btn-xs" onclick="editMeeting('${m.id}')">Edit</button>
          <button type="button" class="btn btn-ghost btn-xs rq-danger" onclick="deleteMeeting('${m.id}')">Delete</button>` : ''}
        </span>
      </footer>
    </div>` : ''}
  </article>`;
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
  return `<div class="rq-form mm-form" onkeydown="if(event.key==='Escape'){event.preventDefault();closeMeetingForm();}">
    <h4>${f.id ? 'Edit meeting notes' : 'New meeting notes'}</h4>
    <div class="mm-form-grid">
      <label class="field mm-span-2"><span>Title</span><input class="input" id="mmTitle" maxlength="160" value="${escapeHtml(f.title || '')}" placeholder="e.g. Weekly sync, UAT review, Kick-off"></label>
      <label class="field"><span>Date</span><input class="input" type="date" id="mmDate" value="${escapeHtml(f.date || '')}"></label>
      <label class="field"><span>Time (optional)</span><input class="input" type="time" id="mmTime" value="${escapeHtml(f.time || '')}"></label>
      <label class="field mm-span-2"><span>Client (optional)</span><input class="input" id="mmClient" list="mmClientList" maxlength="120" value="${escapeHtml(f.client || '')}" placeholder="Leave empty for an internal meeting"${fixedClient && !f.id ? ' readonly' : ''}></label>
      <label class="field mm-span-2"><span>Place / link (optional)</span><input class="input" id="mmPlace" maxlength="200" value="${escapeHtml(f.place || '')}" placeholder="Office, client site, Google Meet link …"></label>
      <label class="field mm-span-4"><span>Attendees</span><input class="input" id="mmAttendees" maxlength="600" value="${escapeHtml(f.attendees || '')}" placeholder="Names, separated by commas"></label>
      <label class="field mm-span-4"><span>Discussion</span><textarea class="input" id="mmNotes" rows="6" maxlength="20000" placeholder="What was discussed — paste from WhatsApp or your notes">${escapeHtml(f.notes || '')}</textarea></label>
      <label class="field mm-span-4"><span>Decisions (one per line)</span><textarea class="input" id="mmDecisions" rows="3" maxlength="5000" placeholder="Go-live moved to 3 Nov&#10;Use the new invoice layout">${escapeHtml(f.decisions || '')}</textarea></label>
    </div>
    <div class="mm-acts-edit">
      <div class="mm-acts-edit-head"><b>Action items</b><span>what · owner · due date</span></div>
      <div id="mmActRows">${f.actions.map(actionRow).join('')}</div>
      <button type="button" class="btn btn-secondary btn-xs" onclick="addMeetingActionRow()">+ Add action</button>
    </div>
    <div class="rq-form-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick="closeMeetingForm()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="saveMeetingForm()"${M.busy ? ' disabled' : ''}>${M.busy ? 'Saving…' : 'Save'}</button>
    </div>
  </div>`;
}

function paint(){
  const el = host;
  if(M.error){ el.innerHTML = `<div class="kb-state kb-state-sm"><p>${escapeHtml(M.error)}</p></div>`; return; }
  const edit = canEdit();
  const shown = M.list.filter(matches);
  const clients = clientNames();
  const usedClients = [...new Map(M.list.filter(m => m.client).map(m => [m.client.toLowerCase(), m.client])).values()].sort((a, b) => a.localeCompare(b));
  const totalOpen = shown.reduce((s, m) => s + openActions(m).length, 0);
  const head = fixedClient
    ? `<div class="rq-head"><div><b>Meetings</b> <span class="rq-muted">${shown.length ? `${shown.length} meeting${shown.length === 1 ? '' : 's'} with ${escapeHtml(fixedClient)} · ${totalOpen} open action item${totalOpen === 1 ? '' : 's'}` : `minutes of meetings with ${escapeHtml(fixedClient)}`}</span></div>
        ${edit && !M.form ? `<button type="button" class="btn btn-primary btn-sm" onclick="openMeetingForm()">+ New meeting notes</button>` : ''}</div>`
    : `<div class="mm-toolbar">
        <div class="mm-search"><input class="input" id="mmSearch" type="search" placeholder="Search title, client, notes, actions…" value="${escapeHtml(M.q)}" oninput="setMeetingSearch(this.value)"></div>
        <select class="select" aria-label="Client" onchange="setMeetingClient(this.value)">
          <option value="all"${M.client === 'all' ? ' selected' : ''}>All clients</option>
          <option value="none"${M.client === 'none' ? ' selected' : ''}>No client (internal)</option>
          ${usedClients.map(c => `<option value="${escapeHtml(c)}"${sameClient(M.client, c) ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <span class="rq-muted mm-count">${shown.length} meeting${shown.length === 1 ? '' : 's'} · ${totalOpen} open action item${totalOpen === 1 ? '' : 's'}</span>
        ${edit && !M.form ? `<button type="button" class="btn btn-primary btn-sm" onclick="openMeetingForm()">+ New meeting notes</button>` : ''}
      </div>`;
  let body;
  if(!M.loaded) body = '<div class="kb-state kb-state-sm"><p>Loading…</p></div>';
  else if(!shown.length) body = M.form ? '' : `<div class="kb-state kb-state-sm"><p>${M.list.length && !fixedClient ? 'No meeting matches the search or filter.' : fixedClient ? `No meeting notes with ${escapeHtml(fixedClient)} yet.` : 'No meeting notes yet.'}${edit && !(M.list.length && !fixedClient) ? ' Write the minutes after a meeting — what was discussed, what was decided and who does what by when.' : ''}</p></div>`;
  else {
    let month = '';
    body = shown.map(m => { const mo = monthOf(m.date); const sep = mo !== month ? `<div class="mm-month">${escapeHtml(mo)}</div>` : ''; month = mo; return sep + card(m); }).join('');
  }
  const keep = KEEP_IDS.map(id => { const x = document.getElementById(id); return x && el.contains(x) ? [id, x.value] : null; }).filter(Boolean);
  const act = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  const actId = act && act.id, actRow = act && act.closest && act.closest('.mm-act-row'), actIdx = actRow ? [...actRow.querySelectorAll('input')].indexOf(act) : -1, rowI = actRow ? actRow.dataset.i : null;
  const sel = act && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
  const y = window.scrollY;
  el.innerHTML = head + (M.form ? formHtml() : '') + `<div class="mm-list">${body}</div><datalist id="mmClientList">${clients.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>`;
  keep.forEach(([id, v]) => { const x = document.getElementById(id); if(x) x.value = v; });
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
  M.form = m
    ? { id: m.id, title: m.title || '', date: m.date || '', time: m.time || '', client: m.client || '', place: m.place || '', attendees: m.attendees || '', notes: m.notes || '', decisions: (m.decisions || []).join('\n'),
        actions: (m.actions || []).map(a => ({ ...a })).concat([{ id: uid(), text: '', owner: '', due: '', done: false }]) }
    : { title: '', date: today(), time: '', client: fixedClient || '', place: '', attendees: '', notes: '', decisions: '', actions: [{ id: uid(), text: '', owner: '', due: '', done: false }] };
  if(id) M.open.add(id);
  rerender();
  setTimeout(() => { const x = $('mmTitle'); if(x){ x.focus(); x.scrollIntoView({ block: 'nearest' }); } }, 30);
}
const editMeeting = (id) => openMeetingForm(id);
function closeMeetingForm(){ M.form = null; rerender(); }
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
    updatedAt: Date.now(), updatedBy: who()
  };
  M.busy = true; rerender();
  try {
    if(f.id) await ref().doc(f.id).set(doc, { merge: true });
    else { const d = ref().doc(); await d.set({ ...doc, createdAt: Date.now(), createdBy: who() }); M.open.add(d.id); }
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

async function deleteMeeting(id){
  const m = M.list.find(x => x.id === id); if(!m) return;
  const ok = await confirmDialog({ title: 'Delete these meeting notes?', message: `<b>${escapeHtml(m.title || '')}</b> (${escapeHtml(fmtDate(m.date))}) will be removed.`, okText: 'Delete', type: 'danger' });
  if(!ok) return;
  try { await ref().doc(id).delete(); M.open.delete(id); toast('Meeting notes deleted'); }
  catch(err){ toast(err.message || 'Could not delete', 'error'); }
}

function meetingText(m){
  const lines = [`*${m.title || 'Meeting'}*`, `${fmtDate(m.date, m.time).replace(/&amp;/g, '&')}${m.client ? ` · ${m.client}` : ''}${m.place ? ` · ${m.place}` : ''}`];
  if(m.attendees) lines.push('', `*Attendees:* ${m.attendees}`);
  if(m.notes) lines.push('', '*Discussion*', m.notes);
  if((m.decisions || []).length) lines.push('', '*Decisions*', ...m.decisions.map(d => `• ${d}`));
  const acts = (m.actions || []).filter(a => String(a.text || '').trim());
  if(acts.length) lines.push('', '*Action items*', ...acts.map(a => `${a.done ? '✅' : '☐'} ${a.text}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (due ${a.due})` : ''}`));
  return lines.join('\n');
}
async function copyMeeting(id){
  const m = M.list.find(x => x.id === id); if(!m) return;
  try { await writeClipboard(meetingText(m)); toast('Meeting notes copied — paste into WhatsApp or e-mail'); }
  catch(_){ toast('Could not copy', 'error'); }
}

function toggleMeeting(id){ if(M.open.has(id)) M.open.delete(id); else M.open.add(id); rerender(); }
let searchTimer = null;
function setMeetingSearch(v){ M.q = String(v || ''); clearTimeout(searchTimer); searchTimer = setTimeout(rerender, 150); }
function setMeetingClient(v){ M.client = v || 'all'; rerender(); }
function openMeetingClient(name){
  if(typeof window.switchView === 'function') window.switchView('clients');
  window.__clientTab = 'meetings';
  if(typeof window.openClientIssues === 'function') window.openClientIssues(name);
}

export {
  openMeetingForm, editMeeting, closeMeetingForm, saveMeetingForm, setMeetingAction, addMeetingActionRow, removeMeetingActionRow,
  toggleMeetingAction, deleteMeeting, copyMeeting, toggleMeeting, setMeetingSearch, setMeetingClient, openMeetingClient
};
