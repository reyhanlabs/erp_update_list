/**
 * Request guard for user-facing API routes.
 *
 * Caller must send:  Authorization: Bearer <Firebase ID token>
 * The token must belong to a Google (non-anonymous) account whose verified
 * email is allowed by ALLOWED_EMAILS and/or ALLOWED_EMAIL_DOMAINS.
 *
 * Env:
 *   ALLOWED_EMAILS         — comma-separated, e.g. "a@x.com,b@y.com"
 *   ALLOWED_EMAIL_DOMAINS  — comma-separated, e.g. "zahiraccounting.com"
 * If neither is set the guard FAILS CLOSED (nobody gets in).
 */
import { timingSafeEqual } from 'crypto';
import { adminAuth } from './firebase-admin.js';

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

/**
 * Returns the decoded token on success, or null after sending an error response.
 * Usage:  const user = await requireUser(req, res); if (!user) return;
 */
export async function requireUser(req, res) {
  const emails = list('ALLOWED_EMAILS');
  const domains = list('ALLOWED_EMAIL_DOMAINS');
  if (!emails.length && !domains.length) {
    return deny(res, 500, 'APP_AUTH_NOT_CONFIGURED',
      'Server access list not configured',
      'Set ALLOWED_EMAILS and/or ALLOWED_EMAIL_DOMAINS in Vercel → Environment Variables, then redeploy.');
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return deny(res, 401, 'APP_AUTH_REQUIRED',
      'Sign-in required',
      'Sign in with Google (Settings → Sign in with Google) to use Redmine/Telegram features.');
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch (err) {
    return deny(res, 401, 'APP_AUTH_INVALID',
      'Session expired or invalid',
      'Reload the page and sign in again.');
  }

  if (decoded.firebase?.sign_in_provider === 'anonymous' || !decoded.email) {
    return deny(res, 403, 'APP_GUEST_FORBIDDEN',
      'Guest mode cannot use this feature',
      'Sign in with an allowed Google account.');
  }

  const email = String(decoded.email).toLowerCase();
  const domain = email.split('@')[1] || '';
  const allowed = decoded.email_verified === true &&
    (emails.includes(email) || domains.includes(domain));

  if (!allowed) {
    return deny(res, 403, 'APP_FORBIDDEN',
      `Account ${email} is not allowed`,
      'Ask the app owner to add your email to ALLOWED_EMAILS.');
  }
  return decoded;
}

/** Constant-time string compare (for shared secrets). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}
