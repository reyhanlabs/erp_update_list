/**
 * Private issue notes (v4.47.0)
 *
 * A personal note on any Redmine issue in the lists (Tester Queue, Issue Status,
 * Active Work, What Next, By Client), e.g. "client hasn't sent the sample file".
 * Optional "Missing info" flag to mark issues that can't be worked on yet.
 *
 * Private by design: stored only in the signed-in user's own document
 *   users/{uid}  →  issueNotes: { "<issueId>": { text, missing, at } }
 * (Firestore rules already restrict users/{uid} to its owner). Never sent to
 * Redmine, never in copied text, never in the shared workspace. A local copy in
 * localStorage makes notes show instantly and work offline.
 */
import { auth, db } from '../firebase.js';
import { escapeHtml, toast } from '../core/helpers.js';

const LS_KEY = 'erp_issue_notes_v1';
const MAX_LEN = 1000;

let notes = {};          // id → { text, missing, at }
let loadedUid = null;
let popover = null;

/* ---------------- storage ---------------- */
function readLocal(){
  try { notes = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch(_){ notes = {}; }
}
function writeLocal(){
  try { localStorage.setItem(LS_KEY, JSON.stringify(notes)); } catch(_){}
}
readLocal();

function userDoc(){
  const u = auth && auth.currentUser;
  return u ? db.collection('users').doc(u.uid) : null;
}

/** Called after sign-in: merge cloud notes into the local copy. */
async function loadIssueNotes(){
  const ref = userDoc();
  if(!ref) return;
  const uid = auth.currentUser.uid;
  if(loadedUid === uid) return;
  try {
    const snap = await ref.get();
    const cloud = (snap.exists && snap.data() && snap.data().issueNotes) || {};
    // newest wins per issue
    const merged = { ...notes };
    Object.entries(cloud).forEach(([id, n]) => {
      if(!n) return;
      if(!merged[id] || (n.at || 0) >= (merged[id].at || 0)) merged[id] = n;
    });
    Object.keys(merged).forEach(id => { if(!merged[id] || (!merged[id].text && !merged[id].missing)) delete merged[id]; });
    notes = merged;
    loadedUid = uid;
    writeLocal();
    refreshAllNoteChips();
  } catch(err){
    console.warn('issue notes load', err);
  }
}

async function saveNote(id, text, missing){
  const key = String(id);
  const clean = String(text || '').slice(0, MAX_LEN).trim();
  const ref = userDoc();
  if(!clean && !missing){
    delete notes[key];
    writeLocal();
    refreshNoteChips(key);
    if(ref){
      try {
        await ref.set({ issueNotes: { [key]: firebase.firestore.FieldValue.delete() } }, { merge: true });
      } catch(err){ console.warn('issue note delete', err); }
    }
    return;
  }
  const entry = { text: clean, missing: !!missing, at: Date.now() };
  notes[key] = entry;
  writeLocal();
  refreshNoteChips(key);
  if(ref){
    try { await ref.set({ issueNotes: { [key]: entry } }, { merge: true }); }
    catch(err){
      console.warn('issue note save', err);
      toast('Note kept on this device only (cloud save failed)', 'error');
    }
  }
}

function getIssueNote(id){ return notes[String(id)] || null; }
function hasIssueNote(id){ const n = getIssueNote(id); return !!(n && (n.text || n.missing)); }

/* ---------------- rendering ---------------- */
const NOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/><path d="M8 9h8M8 13h5"/></svg>';

/** Chip shown in the issue's description cell. */
function issueNoteChip(id){
  const key = String(id);
  const n = getIssueNote(key);
  if(!n || (!n.text && !n.missing)){
    return `<button type="button" class="issue-note is-empty" data-note-id="${escapeHtml(key)}" title="Add a private note" aria-label="Add a private note to #${escapeHtml(key)}">${NOTE_ICON}<span>Note</span></button>`;
  }
  const label = n.missing ? (n.text ? `Missing info: ${n.text}` : 'Missing info') : n.text;
  return `<button type="button" class="issue-note${n.missing ? ' is-missing' : ''}" data-note-id="${escapeHtml(key)}" title="${escapeHtml(label)}" aria-label="Private note on #${escapeHtml(key)}: ${escapeHtml(label)}">${NOTE_ICON}<span>${escapeHtml(label)}</span></button>`;
}

function refreshNoteChips(key){
  document.querySelectorAll(`.issue-note[data-note-id="${CSS.escape(String(key))}"]`).forEach(el => {
    el.outerHTML = issueNoteChip(key);
  });
}
function refreshAllNoteChips(){
  const ids = new Set([...document.querySelectorAll('.issue-note[data-note-id]')].map(el => el.dataset.noteId));
  ids.forEach(refreshNoteChips);
}

/* ---------------- editor popover ---------------- */
function closeNoteEditor(){
  if(!popover) return;
  document.querySelectorAll('.issue-note.is-open').forEach(el => el.classList.remove('is-open'));
  popover.remove();
  popover = null;
  document.removeEventListener('keydown', onPopoverKey, true);
  document.removeEventListener('mousedown', onOutside, true);
}

function onPopoverKey(e){
  if(!popover) return;
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeNoteEditor(); }
  if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); popover.querySelector('[data-act="save"]').click(); }
}
function onOutside(e){
  if(popover && !popover.contains(e.target) && !e.target.closest('.issue-note')) closeNoteEditor();
}

function openNoteEditor(anchor, id){
  closeNoteEditor();
  const key = String(id);
  const n = getIssueNote(key) || { text: '', missing: false };
  popover = document.createElement('div');
  popover.className = 'issue-note-pop';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', `Private note for #${key}`);
  popover.innerHTML = `
    <div class="inp-head"><b>Private note</b><span>#${escapeHtml(key)}</span></div>
    <textarea class="input inp-text" maxlength="${MAX_LEN}" rows="4" placeholder="e.g. Waiting for the client's sample file">${escapeHtml(n.text || '')}</textarea>
    <label class="inp-missing"><input type="checkbox"${n.missing ? ' checked' : ''}> Information is missing</label>
    <p class="inp-hint">Only you can see this. It isn't sent to Redmine.</p>
    <div class="inp-actions">
      ${n.text || n.missing ? '<button type="button" class="btn btn-secondary btn-sm inp-del" data-act="delete">Delete</button>' : ''}
      <button type="button" class="btn btn-secondary btn-sm" data-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" data-act="save">Save note</button>
    </div>`;
  document.body.appendChild(popover);
  anchor.classList.add('is-open');   // keep the chip visible while editing

  // position under the chip, kept inside the viewport
  const r = anchor.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 16);
  popover.style.width = `${w}px`;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  const h = popover.offsetHeight;
  if(top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  const ta = popover.querySelector('textarea');
  const cb = popover.querySelector('input[type="checkbox"]');
  popover.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if(act === 'cancel') closeNoteEditor();
    if(act === 'save'){ saveNote(key, ta.value, cb.checked); closeNoteEditor(); toast('Note saved'); }
    if(act === 'delete'){ saveNote(key, '', false); closeNoteEditor(); toast('Note deleted'); }
  });
  document.addEventListener('keydown', onPopoverKey, true);
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* One delegated listener: chips live inside table rows that open Redmine on click */
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.issue-note[data-note-id]');
  if(!chip) return;
  e.preventDefault();
  e.stopPropagation();
  openNoteEditor(chip, chip.dataset.noteId);
}, true);

export { issueNoteChip, getIssueNote, hasIssueNote, loadIssueNotes, closeNoteEditor };
