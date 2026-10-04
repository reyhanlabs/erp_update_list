/**
 * Shared firebase-admin bootstrap for Vercel functions.
 * Files/folders prefixed with "_" are NOT exposed as routes by Vercel.
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT — full service-account JSON (one line).
 *                              Required for Firestore writes (cron state).
 *                              Optional for ID-token verification only.
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const FIREBASE_PROJECT_ID = 'erpupdate-f0b18';

let app = null;
let hasCredential = false;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    // Vercel UI sometimes keeps literal "\n" in the private key
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    return sa;
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
}

export function getAdminApp() {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0];
    return app;
  }
  const sa = parseServiceAccount();
  if (sa) {
    app = initializeApp({ credential: cert(sa), projectId: sa.project_id || FIREBASE_PROJECT_ID });
    hasCredential = true;
  } else {
    // Token verification only needs the project id (public Google certs)
    app = initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }
  return app;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function adminDb() {
  getAdminApp();
  if (!hasCredential) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT not configured — required for server-side Firestore access');
  }
  return getFirestore(app);
}
