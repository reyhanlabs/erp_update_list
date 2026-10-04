/**
 * Quick notes
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { $, escapeHtml, toast, uid } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { emptyState } from '../ui/list-controls.js';

/* ============================================================
   QUICK NOTES (workspace-local via localStorage; optional cloud later)
   ============================================================ */
const NOTES_KEY = 'erp_quick_notes_v1';
function getNotes(){
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]') || []; } catch(_){ return []; }
}
function setNotes(arr){
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(arr.slice(0, 200))); } catch(_){}
}
function openNotesView(){
  switchView('notes');
  renderNotes();
}
function renderNotes(){
  const el = $('notesList');
  if(!el) return;
  const q = ($('notesSearch')?.value || '').trim().toLowerCase();
  let list = getNotes().slice().sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  if(q) list = list.filter(n => (n.title||'').toLowerCase().includes(q) || (n.body||'').toLowerCase().includes(q));
  if(!list.length){
    el.innerHTML = emptyState(ICON.inbox, 'No notes yet', 'Jot down testing notes, blockers, or reminders.', [
      { label: 'Add note', action: 'openNoteEditor()', primary: true }
    ]);
    return;
  }
  el.innerHTML = list.map(n => `
    <div class="note-card" data-id="${escapeHtml(n.id)}">
      <div class="note-card-top">
        <strong>${escapeHtml(n.title || 'Untitled')}</strong>
        <span class="note-card-date">${escapeHtml(n.updatedAt ? new Date(n.updatedAt).toLocaleString() : '')}</span>
      </div>
      <div class="note-card-body">${escapeHtml((n.body||'').slice(0, 280))}${(n.body||'').length>280?'…':''}</div>
      <div class="note-card-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="openNoteEditor('${n.id}')">Edit</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="deleteNote('${n.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}
function openNoteEditor(id){
  const n = id ? getNotes().find(x => x.id === id) : null;
  const title = prompt('Note title', n?.title || '');
  if(title === null) return;
  const body = prompt('Note body', n?.body || '');
  if(body === null) return;
  const list = getNotes();
  if(n){
    const i = list.findIndex(x => x.id === id);
    if(i >= 0) list[i] = { ...list[i], title: title.trim() || 'Untitled', body: body, updatedAt: Date.now() };
  } else {
    list.push({ id: uid(), title: title.trim() || 'Untitled', body: body, updatedAt: Date.now(), createdAt: Date.now() });
  }
  setNotes(list);
  renderNotes();
  toast('Note saved', 'success');
}
function deleteNote(id){
  if(!confirm('Delete this note?')) return;
  setNotes(getNotes().filter(n => n.id !== id));
  renderNotes();
  toast('Note deleted');
}

export {
  deleteNote,
  getNotes,
  openNoteEditor,
  openNotesView,
  renderNotes
};
