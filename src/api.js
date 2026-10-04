/**
 * fetch() wrapper for our own /api/* routes.
 * Attaches the current Firebase ID token so the server can check
 * that the caller is an allowed Google account.
 */
import { auth } from './firebase.js';

function localDenied(code, error, hint) {
  return new Response(JSON.stringify({ error, code, hint }), {
    status: code === 'APP_AUTH_REQUIRED' ? 401 : 403,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const user = auth && auth.currentUser;
  // Guests / signed-out: the server would reject anyway — skip the network
  // round-trip (background polls run every 90s and would waste invocations).
  if (!user) {
    return localDenied('APP_AUTH_REQUIRED', 'Sign-in required',
      'Sign in with Google (Settings → Sign in with Google) to use Redmine/Telegram features.');
  }
  if (user.isAnonymous) {
    return localDenied('APP_GUEST_FORBIDDEN', 'Guest mode cannot use this feature',
      'Sign in with an allowed Google account.');
  }
  try {
    // Cached by Firebase; refreshes automatically when near expiry
    const token = await user.getIdToken();
    headers.set('Authorization', 'Bearer ' + token);
  } catch (err) {
    console.warn('[api] could not get ID token', err);
  }
  return fetch(url, { ...options, headers });
}
