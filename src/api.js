/**
 * fetch() wrapper for our own /api/* routes.
 * Attaches the current Firebase ID token so the server can check
 * that the caller is an allowed Google account.
 */
import { auth } from './firebase.js';

export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const user = auth && auth.currentUser;
  if (user && !user.isAnonymous) {
    try {
      // Cached by Firebase; refreshes automatically when near expiry
      const token = await user.getIdToken();
      headers.set('Authorization', 'Bearer ' + token);
    } catch (err) {
      console.warn('[api] could not get ID token', err);
    }
  }
  return fetch(url, { ...options, headers });
}
