/**
 * Team & access (v4.64.0)
 *
 * Who may use the app is decided on the server (/api/team): every member is a
 * row in workspaces/{ws}/members/{email} with a role, written only by the server.
 *   owner  — one per team: everything, plus admins, hand-over and Delete All Data
 *   admin  — invite / remove editors and viewers, change their role
 *   editor — create, edit and delete plans, summaries, guides, client sites
 *   viewer — read only
 * The UI hides what a role can't do (body[data-role] + data-perm="edit|admin|owner");
 * Firestore rules enforce it.
 */
import { auth, db } from '../firebase.js';
import { $, escapeHtml, toast } from './helpers.js';
import { apiFetch } from '../api.js';
import { confirmDialog } from '../ui/confirm.js';

const RANK = { owner: 4, admin: 3, editor: 2, viewer: 1 };
const ROLE_INFO = {
  owner: 'Everything, plus managing admins and Delete All Data',
  admin: 'Edit everything and invite or remove editors and viewers',
  editor: 'Create, edit and delete plans, summaries, guides and client sites',
  viewer: 'Read only'
};

const Team = {
  email: '', role: null, workspaceId: null,
  members: [], unsub: null, busy: false
};

const rank = (r) => RANK[r] || 0;
function canEdit(){ return rank(Team.role) >= RANK.editor; }
function canAdmin(){ return rank(Team.role) >= RANK.admin; }
function isOwner(){ return Team.role === 'owner'; }

function applyRole(role){
  Team.role = role || null;
  if(role) document.body.dataset.role = role;
  else delete document.body.dataset.role;
  const el = $('teamMyRole');
  if(el) el.textContent = role ? role[0].toUpperCase() + role.slice(1) : '—';
  const info = $('teamMyRoleInfo');
  if(info) info.textContent = role ? ROLE_INFO[role] : '';
}

async function readJson(r){
  const d = await r.json().catch(() => ({}));
  if(!r.ok) {
    const e = new Error(d.error || `HTTP ${r.status}`);
    e.hint = d.hint || ''; e.status = r.status; e.code = d.code || '';
    throw e;
  }
  return d;
}

/* the workspace this browser used before v4.64.0 (claimed once by an app owner) */
async function legacyWorkspaceId(uid){
  try {
    const snap = await db.collection('users').doc(uid).get();
    const ws = snap.exists ? snap.data().workspaceId : null;
    if(ws) return String(ws);
  } catch(_){}
  try { const ws = localStorage.getItem('erp_workspace_id'); if(ws) return ws; } catch(_){}
  return uid;
}

/**
 * Find the signed-in user's workspace and role.
 * Returns { workspaceId, role } or { denied: true, email, error, hint }.
 */
async function resolveAccess(user){
  Team.email = String(user.email || '').toLowerCase();
  let me = await readJson(await apiFetch('/api/team'));
  if(!me.member && me.canClaim){
    const ws = await legacyWorkspaceId(user.uid);
    const c = await readJson(await apiFetch('/api/team', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', workspaceId: ws })
    }));
    toast(c.role === 'owner' ? 'You are the owner of this workspace' : `Joined the workspace as ${c.role}`);
    me = { member: true, workspaceId: c.workspaceId, role: c.role };
  }
  if(!me.member) return { denied: true, email: me.email || Team.email };
  Team.workspaceId = me.workspaceId;
  applyRole(me.role);
  try { localStorage.setItem('erp_workspace_id', me.workspaceId); } catch(_){}
  return { workspaceId: me.workspaceId, role: me.role };
}

/* ---------------- no-access screen ---------------- */
function showNoAccess({ email, error, hint } = {}){
  const gate = $('authGate');
  const loading = $('loadingOverlay');
  if(loading) loading.classList.add('hidden');
  document.body.classList.add('auth-locked');
  if(!gate) return;
  gate.classList.remove('hidden');
  gate.classList.add('is-denied');
  const box = $('authDenied');
  if(!box) return;
  const who = $('authDeniedEmail');
  if(who) who.textContent = email || Team.email || '';
  const msg = $('authDeniedText');
  if(msg){
    msg.textContent = error
      ? `Could not check your access: ${error}${hint ? ' — ' + hint : ''}`
      : 'This account has not been added yet. Ask the owner or an admin to add this e-mail in Settings → Team & access, then press Try again.';
  }
}
function hideNoAccess(){
  const gate = $('authGate');
  if(gate) gate.classList.remove('is-denied');
}
function retryAccess(){ location.reload(); }

/* ---------------- members list (Settings → Team & access) ---------------- */
function watchMembers(){
  if(Team.unsub) { Team.unsub(); Team.unsub = null; }
  if(!Team.workspaceId) return;
  Team.unsub = db.collection('workspaces').doc(Team.workspaceId).collection('members')
    .onSnapshot(snap => {
      Team.members = snap.docs.map(d => ({ email: d.id, ...d.data() }));
      const mine = Team.members.find(m => m.email === Team.email);
      if(mine && mine.role !== Team.role){
        applyRole(mine.role);
        toast(`Your role is now ${mine.role}`);
      }
      if(!mine && Team.role){
        // removed from the team while the app is open
        applyRole(null);
        showNoAccess({ email: Team.email });
      }
      renderTeam();
    }, err => {
      console.warn('members snapshot', err);
      Team.members = [];
      renderTeam();
    });
}
function stopTeam(){
  if(Team.unsub) { Team.unsub(); Team.unsub = null; }
  Team.members = []; Team.workspaceId = null;
  applyRole(null);
}

function fmtSeen(ms){
  if(!ms) return 'not signed in yet';
  const d = Date.now() - ms;
  if(d < 5 * 60000) return 'active now';
  if(d < 3600000) return `seen ${Math.round(d / 60000)} min ago`;
  if(d < 86400000) return `seen ${Math.round(d / 3600000)} h ago`;
  return `seen ${new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/* which roles the current user may give to a member (empty = can't change) */
function assignable(target){
  if(target.role === 'owner' || target.email === Team.email) return [];
  if(isOwner()) return ['admin', 'editor', 'viewer'];
  if(Team.role === 'admin' && target.role !== 'admin') return ['editor', 'viewer'];
  return [];
}

function renderTeam(){
  const list = $('teamMembers');
  if(!list) return;
  const count = $('teamCount');
  if(count) count.textContent = Team.members.length ? String(Team.members.length) : '';
  const addRole = $('teamAddRole');
  if(addRole){
    const keep = addRole.value;
    addRole.innerHTML = (isOwner() ? ['viewer', 'editor', 'admin'] : ['viewer', 'editor'])
      .map(r => `<option value="${r}">${r[0].toUpperCase() + r.slice(1)}</option>`).join('');
    if([...addRole.options].some(o => o.value === keep)) addRole.value = keep;
  }
  if(!Team.members.length){
    list.innerHTML = '<p class="team-empty">No members loaded yet.</p>';
    return;
  }
  const rows = Team.members.slice().sort((a, b) => rank(b.role) - rank(a.role) || a.email.localeCompare(b.email));
  list.innerHTML = rows.map(m => {
    const me = m.email === Team.email;
    const roles = assignable(m);
    const e = escapeHtml(JSON.stringify(m.email));
    const roleCell = roles.length
      ? `<select class="team-role-select" aria-label="Role of ${escapeHtml(m.email)}" onchange="setMemberRole(${e}, this.value)">${roles.map(r => `<option value="${r}"${r === m.role ? ' selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select>`
      : `<span class="team-role is-${escapeHtml(m.role)}">${escapeHtml(m.role)}</span>`;
    const actions = [];
    if(isOwner() && m.role === 'admin') actions.push(`<button type="button" class="btn btn-ghost btn-xs" onclick="makeTeamOwner(${e})" title="Hand ownership to this admin">Make owner</button>`);
    if(roles.length) actions.push(`<button type="button" class="btn btn-ghost btn-xs team-remove" onclick="removeMember(${e})" aria-label="Remove ${escapeHtml(m.email)}">Remove</button>`);
    if(me && m.role !== 'owner') actions.push(`<button type="button" class="btn btn-ghost btn-xs team-remove" onclick="removeMember(${e})">Leave</button>`);
    return `<div class="team-row${me ? ' is-me' : ''}">
      <div class="team-who">
        <div class="team-email">${escapeHtml(m.name || m.email)}${me ? ' <small>(you)</small>' : ''}</div>
        <div class="team-sub">${m.name ? escapeHtml(m.email) + ' · ' : ''}${fmtSeen(m.lastSeenAt)}</div>
      </div>
      <div class="team-role-cell">${roleCell}</div>
      <div class="team-actions">${actions.join('')}</div>
    </div>`;
  }).join('');
}

async function teamPost(body){
  if(Team.busy) return null;
  Team.busy = true;
  try {
    return await readJson(await apiFetch('/api/team', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }));
  } catch(err){
    toast(err.message + (err.hint ? ` — ${err.hint}` : ''), 'error');
    return null;
  } finally {
    Team.busy = false;
  }
}

async function addMember(ev){
  if(ev) ev.preventDefault();
  const input = $('teamAddEmail');
  const role = $('teamAddRole')?.value || 'viewer';
  const emails = String(input?.value || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if(!emails.length){ toast('Enter an e-mail address', 'error'); input?.focus(); return; }
  let added = 0;
  for(const email of emails){
    if(Team.members.some(m => m.email === email)){ toast(`${email} is already a member`, 'error'); continue; }
    const r = await teamPost({ action: 'add', email, role });
    if(r) added++;
  }
  if(added){
    if(input) input.value = '';
    toast(added === 1 ? `Added ${emails[0]} as ${role}. They can sign in with Google now.` : `Added ${added} people as ${role}`);
  }
}

async function setMemberRole(email, role){
  const r = await teamPost({ action: 'role', email, role });
  if(r) toast(`${email} is now ${role}`);
  else renderTeam();
}

async function removeMember(email){
  const me = email === Team.email;
  const ok = await confirmDialog({
    title: me ? 'Leave this team?' : 'Remove member?',
    message: me ? 'You will lose access to this workspace until someone adds you again.' : `<b>${escapeHtml(email)}</b> will lose access to this workspace right away.`,
    okText: me ? 'Leave' : 'Remove', type: 'danger'
  });
  if(!ok) return;
  const r = await teamPost({ action: 'remove', email });
  if(r){
    toast(me ? 'You left the team' : `Removed ${email}`);
    if(me) setTimeout(() => location.reload(), 600);
  }
}

async function makeTeamOwner(email){
  const ok = await confirmDialog({
    title: 'Hand ownership over?',
    message: `<b>${escapeHtml(email)}</b> becomes the owner. You stay on the team as an admin.`,
    okText: 'Make owner', type: 'danger'
  });
  if(!ok) return;
  const r = await teamPost({ action: 'transfer', email });
  if(r) toast(`${email} is now the owner`);
}

/* Firestore says no (e.g. a viewer, or a role changed in the meantime) */
function isPermissionError(err){
  return !!err && (err.code === 'permission-denied' || /insufficient permissions/i.test(err.message || ''));
}
function installPermissionToast(){
  let last = 0;
  window.addEventListener('unhandledrejection', (ev) => {
    if(!isPermissionError(ev.reason)) return;
    if(Date.now() - last < 4000) return;
    last = Date.now();
    toast(Team.role === 'viewer' ? 'Viewers can only read — ask an admin for editor access' : 'Not allowed for your role', 'error');
  });
}

function currentEmail(){ return Team.email || (auth.currentUser && auth.currentUser.email) || ''; }

export {
  Team, ROLE_INFO, canEdit, canAdmin, isOwner, resolveAccess, showNoAccess, hideNoAccess,
  retryAccess, watchMembers, stopTeam, renderTeam, addMember, setMemberRole, removeMember,
  makeTeamOwner, installPermissionToast, isPermissionError, currentEmail
};
