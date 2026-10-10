/**
 * Request guard for user-facing API routes (v4.64.0: team members).
 *
 * Caller must send:  Authorization: Bearer <Firebase ID token>
 * The token must belong to a Google (non-anonymous) account with a verified
 * email that is EITHER
 *   - a member of a workspace (directory/{email} written by /api/team), or
 *   - listed in ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAINS (app owners; also used
 *     once to claim the existing workspace).
 *
 * Env:
 *   ALLOWED_EMAILS         — comma-separated, e.g. "a@x.com,b@y.com"
 *   ALLOWED_EMAIL_DOMAINS  — comma-separated, e.g. "zahiraccounting.com"
 */
import { timingSafeEqual } from 'crypto';
import { adminAuth, adminDb } from './firebase-admin.js';

export const ROLES = ['owner', 'admin', 'editor', 'viewer'];

function list(envName) {
  return String(process.env[envName] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function deny(res, status, code, error, hint) {
  res.status(status).json({ error, code, hint });
  return null;
}

/** e-mail allowed by the env lists (app owners). */
export function envAllowed(email) {
  const e = String(email || '').toLowerCase();
  const domain = e.split('@')[1] || '';
  return list('ALLOWED_EMAILS').includes(e) || (!!domain && list('ALLOWED_EMAIL_DOMAINS').includes(domain));
}

/* membership lookup: directory/{email} → { workspaceId, role }; cached briefly per instance */
const memberCache = new Map();
export async function getMembership(email, { fresh = false } = {}) {
  const key = String(email || '').toLowerCase();
  if (!key) return null;
  const hit = memberCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  let value = null;
  try {
    const snap = await adminDb().doc(`directory/${key}`).get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.workspaceId && ROLES.includes(d.role)) value = { workspaceId: String(d.workspaceId), role: d.role };
    }
  } catch (err) {
    console.warn('membership lookup failed', err.message);
  }
  memberCache.set(key, { at: Date.now(), value });
  return value;
}
export function forgetMembership(email) { memberCache.delete(String(email || '').toLowerCase()); }

/**
 * Signed-in Google user with a verified e-mail (no access check).
 * Returns the decoded token, or null after sending 401/403.
 */
export async function verifyUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return deny(res, 401, 'APP_AUTH_REQUIRED', 'Sign-in required', 'Sign in with Google.');
  }
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch (err) {
    return deny(res, 401, 'APP_AUTH_INVALID', 'Session expired or invalid', 'Reload the page and sign in again.');
  }
  if (decoded.firebase?.sign_in_provider === 'anonymous' || !decoded.email) {
    return deny(res, 403, 'APP_GUEST_FORBIDDEN', 'Guest mode cannot use this feature', 'Sign in with Google.');
  }
  if (decoded.email_verified !== true) {
    return deny(res, 403, 'APP_EMAIL_UNVERIFIED', 'E-mail not verified', 'Use a Google account with a verified e-mail.');
  }
  decoded.email = String(decoded.email).toLowerCase();
  return decoded;
}

/**
 * Returns the decoded token (with .member = { workspaceId, role } when the
 * user is a workspace member) on success, or null after sending an error.
 * Usage:  const user = await requireUser(req, res); if (!user) return;
 */
export async function requireUser(req, res) {
  const decoded = await verifyUser(req, res);
  if (!decoded) return null;
  const member = await getMembership(decoded.email);
  decoded.member = member;
  if (member || envAllowed(decoded.email)) return decoded;
  return deny(res, 403, 'APP_FORBIDDEN',
    `Account ${decoded.email} has no access`,
    'Ask the app owner or an admin to add your e-mail in Settings → Team & access.');
}

/** Constant-time string compare (for shared secrets). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}
