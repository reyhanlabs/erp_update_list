/**
 * Team & access (v4.64.0)
 *
 * Members live in Firestore and are written ONLY here (firebase-admin), so the
 * Firestore rules can trust them:
 *   workspaces/{ws}/members/{email}  { email, role, name, uid, addedBy, addedAt, lastSeenAt }
 *   directory/{email}                { workspaceId, role }   ← lets a user find their workspace
 * Roles: owner (one) > admin > editor > viewer.
 *
 * GET  /api/team                     → who am I: { email, member, workspaceId, role, canClaim }
 * POST { action:'claim', workspaceId } → app owners (ALLOWED_EMAILS / _DOMAINS) take over the
 *                                       workspace they already use: the first one becomes owner
 *                                       and fixes it as the team's workspace (system/team);
 *                                       later ones join that workspace as editor
 * POST { action:'add',    email, role }   admin+ (only the owner adds / changes admins)
 * POST { action:'role',   email, role }   same rules as add, member must exist
 * POST { action:'remove', email }         admin+; the owner can't be removed; anyone may leave
 * POST { action:'transfer', email }       owner hands ownership to an admin (becomes admin)
 */
import { adminDb } from './_lib/firebase-admin.js';
import { verifyUser, envAllowed, getMembership, forgetMembership } from './_lib/auth.js';

const EMAIL_RE = /^[^\s@/]{1,64}@[^\s@/]{1,190}\.[a-z]{2,}$/i;
const WS_RE = /^[A-Za-z0-9_\-]{3,128}$/;
const rank = (r) => ({ owner: 4, admin: 3, editor: 2, viewer: 1 }[r] || 0);

function bad(res, status, error, hint) { return res.status(status).json({ error, hint }); }

async function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  return b || {};
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await verifyUser(req, res);
  if (!user) return;
  const db = adminDb();
  const me = user.email;

  if (req.method === 'GET') {
    const m = await getMembership(me, { fresh: true });
    if (m) {
      // keep the member card fresh: name, uid, last seen
      db.doc(`workspaces/${m.workspaceId}/members/${me}`).set({
        name: user.name || '', uid: user.uid, lastSeenAt: Date.now()
      }, { merge: true }).catch(() => {});
    }
    return res.status(200).json({
      email: me, member: !!m, workspaceId: m?.workspaceId || null, role: m?.role || null,
      canClaim: !m && envAllowed(me)
    });
  }
  if (req.method !== 'POST') return bad(res, 405, 'Use GET or POST');

  const body = await readBody(req);
  const action = String(body.action || '');

  /* ---- claim: an app owner takes over the workspace they already use ---- */
  if (action === 'claim') {
    if (!envAllowed(me)) return bad(res, 403, 'Only app owners can claim a workspace', 'Ask an admin to invite you.');
    if (await getMembership(me, { fresh: true })) return bad(res, 409, 'You are already a member of a workspace');
    // the first claim fixes the team's workspace; later app owners join that one
    const mainRef = db.doc('system/team');
    const main = await mainRef.get();
    const ws = main.exists && main.data().workspaceId ? String(main.data().workspaceId) : String(body.workspaceId || '').trim();
    if (!WS_RE.test(ws)) return bad(res, 400, 'Invalid workspace id');
    const members = await db.collection(`workspaces/${ws}/members`).limit(1).get();
    const role = members.empty ? 'owner' : 'editor';
    const now = Date.now();
    const batch = db.batch();
    batch.set(db.doc(`workspaces/${ws}/members/${me}`), { email: me, role, name: user.name || '', uid: user.uid, addedBy: me, addedAt: now, lastSeenAt: now });
    batch.set(db.doc(`directory/${me}`), { workspaceId: ws, role, updatedAt: now });
    if (members.empty) batch.set(db.doc(`workspaces/${ws}`), { ownerEmail: me, createdAt: now }, { merge: true });
    if (!main.exists) batch.set(mainRef, { workspaceId: ws, claimedBy: me, claimedAt: now });
    await batch.commit();
    forgetMembership(me);
    return res.status(200).json({ ok: true, workspaceId: ws, role });
  }

  /* ---- everything else: managing the caller's own workspace ---- */
  const mine = await getMembership(me, { fresh: true });
  if (!mine) return bad(res, 403, 'You are not a member of a workspace');
  const ws = mine.workspaceId;
  const target = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(target)) return bad(res, 400, 'Enter a valid e-mail address');
  const targetRef = db.doc(`workspaces/${ws}/members/${target}`);
  const targetSnap = await targetRef.get();
  const targetRole = targetSnap.exists ? targetSnap.data().role : null;
  const now = Date.now();

  if (action === 'add' || action === 'role') {
    const role = String(body.role || '');
    if (!['admin', 'editor', 'viewer'].includes(role)) return bad(res, 400, 'Role must be admin, editor or viewer');
    if (rank(mine.role) < rank('admin')) return bad(res, 403, 'Only admins can manage members');
    if ((role === 'admin' || targetRole === 'admin') && mine.role !== 'owner') return bad(res, 403, 'Only the owner can add or change admins');
    if (targetRole === 'owner') return bad(res, 403, 'The owner keeps the owner role', 'Use “Make owner” to hand ownership over.');
    if (action === 'role' && !targetSnap.exists) return bad(res, 404, 'Not a member');
    if (action === 'add' && !targetSnap.exists) {
      const elsewhere = await db.doc(`directory/${target}`).get();
      if (elsewhere.exists && elsewhere.data().workspaceId !== ws) {
        return bad(res, 409, `${target} already belongs to another workspace`, 'They must be removed there first.');
      }
    }
    const batch = db.batch();
    batch.set(targetRef, targetSnap.exists
      ? { role, updatedBy: me, updatedAt: now }
      : { email: target, role, addedBy: me, addedAt: now }, { merge: true });
    batch.set(db.doc(`directory/${target}`), { workspaceId: ws, role, updatedAt: now });
    await batch.commit();
    forgetMembership(target);
    return res.status(200).json({ ok: true, email: target, role });
  }

  if (action === 'remove') {
    if (!targetSnap.exists) return bad(res, 404, 'Not a member');
    if (targetRole === 'owner') return bad(res, 403, 'The owner can’t be removed', 'Hand ownership over first.');
    const self = target === me;
    if (!self) {
      if (rank(mine.role) < rank('admin')) return bad(res, 403, 'Only admins can remove members');
      if (targetRole === 'admin' && mine.role !== 'owner') return bad(res, 403, 'Only the owner can remove admins');
    }
    const batch = db.batch();
    batch.delete(targetRef);
    batch.delete(db.doc(`directory/${target}`));
    await batch.commit();
    forgetMembership(target);
    return res.status(200).json({ ok: true, removed: target });
  }

  if (action === 'transfer') {
    if (mine.role !== 'owner') return bad(res, 403, 'Only the owner can hand ownership over');
    if (targetRole !== 'admin') return bad(res, 400, 'Make this member an admin first');
    const batch = db.batch();
    batch.set(targetRef, { role: 'owner', updatedBy: me, updatedAt: now }, { merge: true });
    batch.set(db.doc(`directory/${target}`), { workspaceId: ws, role: 'owner', updatedAt: now });
    batch.set(db.doc(`workspaces/${ws}/members/${me}`), { role: 'admin', updatedAt: now }, { merge: true });
    batch.set(db.doc(`directory/${me}`), { workspaceId: ws, role: 'admin', updatedAt: now });
    batch.set(db.doc(`workspaces/${ws}`), { ownerEmail: target }, { merge: true });
    await batch.commit();
    forgetMembership(target); forgetMembership(me);
    return res.status(200).json({ ok: true, owner: target });
  }

  return bad(res, 400, 'Unknown action');
}
