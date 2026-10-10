/**
 * Auth gate, Google sign-in, guest migration, app start per user
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { auth } from '../firebase.js';
import { $, toast } from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { resolveAccess, showNoAccess, hideNoAccess, watchMembers, stopTeam } from '../core/team.js';
import { setSyncStatus } from '../ui/sync-status.js';
import { renderPlans } from './plans/plans.js';
import { populatePlanDropdown, renderSummaries } from './summaries.js';
import { refreshCounts } from './dashboard.js';
import { prefetchTesterCount } from './tester/queue.js';
import { loadIssueNotes } from './issue-notes.js';

/* ============================================================
   INIT
   ============================================================ */
function renderAll(){
  renderPlans();
  renderSummaries();
  populatePlanDropdown();
  refreshCounts();
}


/* ============================================================
   ACCOUNT — Google Sign-In
   - Google only (guest mode removed in v4.64.0)
   - Access comes from the team membership (src/core/team.js)
   ============================================================ */
function isAnonymousUser(user){
  return !!(user && user.isAnonymous);
}

function isGoogleUser(user){
  if(!user || user.isAnonymous) return false;
  const providers = (user.providerData || []).map(p => p.providerId);
  return providers.includes('google.com') || !!(user.email);
}

function showAuthGate(msg){
  const gate = $('authGate');
  const loading = $('loadingOverlay');
  if(loading) loading.classList.add('hidden');
  if(gate) gate.classList.remove('hidden');
  const err = $('authError');
  if(err) err.textContent = msg || '';
  // Hide main app chrome while gated
  document.body.classList.add('auth-locked');
}

function hideAuthGate(){
  const gate = $('authGate');
  if(gate) gate.classList.add('hidden');
  document.body.classList.remove('auth-locked');
}

function updateAccountUI(user){
  const identity = $('accountIdentity');
  const statusText = $('accountStatusText');
  const pill = $('accountStatusPill');
  const btnIn = $('btnGoogleSignIn');
  const btnOut = $('btnSignOut');
  const uidEl = $('userUID');

  if(uidEl) uidEl.textContent = user ? user.uid : '—';

  if(!user){
    if(identity) identity.textContent = 'Not signed in';
    if(statusText) statusText.textContent = 'Signed out';
    if(btnIn) btnIn.classList.remove('hidden');
    if(btnOut) btnOut.classList.add('hidden');
    return;
  }

  if(isAnonymousUser(user)){
    if(identity) identity.textContent = 'Not signed in';
    if(statusText) statusText.textContent = 'Signed out';
    if(pill) pill.classList.remove('ok');
    if(btnIn) btnIn.classList.remove('hidden');
    if(btnOut) btnOut.classList.add('hidden');
  } else {
    const email = user.email || user.providerData?.[0]?.email || user.displayName || 'Signed in';
    if(identity) identity.textContent = email;
    if(statusText) statusText.textContent = 'Google';
    if(pill) pill.classList.add('ok');
    if(btnIn) btnIn.classList.add('hidden');
    if(btnOut) btnOut.classList.remove('hidden');
  }
}


async function signInWithGoogle(){
  const btn = $('btnGoogleSignIn');
  const btnAuth = $('btnAuthGoogle');
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const errEl = $('authError');
  if(errEl) errEl.textContent = '';

  const setBusy = (busy, label) => {
    [btn, btnAuth].forEach(b => {
      if(!b) return;
      b.disabled = !!busy;
      if(busy){
        b.dataset.prevLabel = b.dataset.prevLabel || b.textContent;
        b.textContent = label || 'Opening Google…';
      } else if(b.dataset.prevLabel){
        // restore only settings button; auth gate keeps HTML structure
        if(b.id === 'btnGoogleSignIn') b.textContent = b.dataset.prevLabel;
        delete b.dataset.prevLabel;
      }
    });
    if(!busy && btnAuth){
      // restore Google button label (keep SVG)
      btnAuth.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg> Sign in with Google`;
    }
  };

  // Mobile / PWA / coarse pointer → redirect (popups blocked on most phones)
  const preferRedirect = (() => {
    try {
      const ua = navigator.userAgent || '';
      const mobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(ua);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const touch = (navigator.maxTouchPoints || 0) > 1;
      return mobile || standalone || coarse || touch;
    } catch(_){ return true; }
  })();

  try {
    setBusy(true, preferRedirect ? 'Redirecting to Google…' : 'Opening Google…');

    if(preferRedirect){
      try {
        sessionStorage.setItem('erp_auth_redirect', '1');
        sessionStorage.setItem('erp_post_auth_path', location.pathname + location.search + location.hash);
      } catch(_){}
      // Same Google account as laptop: clear anonymous/guest session first so
      // Firebase does a clean sign-in (avoids link/credential conflicts on mobile).
      try {
        if(auth.currentUser && auth.currentUser.isAnonymous){
          await auth.signOut();
        }
      } catch(signOutErr){
        console.warn('pre-redirect signOut', signOutErr);
      }
      try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch(_){}
      await auth.signInWithRedirect(provider);
      return;
    }

    // Desktop: popup, fallback redirect
    let cred;
    try {
      if(auth.currentUser && auth.currentUser.isAnonymous) await auth.signOut();   // old guest session
      cred = await auth.signInWithPopup(provider);
    } catch(popErr){
      if(popErr.code === 'auth/popup-blocked' || popErr.code === 'auth/popup-closed-by-user'){
        sessionStorage.setItem('erp_auth_redirect', '1');
        sessionStorage.setItem('erp_post_auth_path', location.pathname + location.search + location.hash);
        setBusy(true, 'Redirecting to Google…');
        await auth.signInWithRedirect(provider);
        return;
      }
      throw popErr;
    }

    const user = (cred && cred.user) || auth.currentUser;
    updateAccountUI(user);
    if(user) await startAppForUser(user);
  } catch(err){
    console.error('Google sign-in failed:', err);
    const map = {
      'auth/popup-closed-by-user': 'Sign-in cancelled',
      'auth/popup-blocked': 'Popup blocked — try again (will use full-page Google sign-in)',
      'auth/operation-not-allowed': 'Google sign-in is not enabled in Firebase Console',
      'auth/unauthorized-domain': `Domain "${location.hostname}" is not authorized. Firebase Console → Authentication → Settings → Authorized domains → add this domain.`,
      'auth/account-exists-with-different-credential': 'Account exists with a different sign-in method',
      'auth/network-request-failed': 'Network error — check connection and try again',
      'auth/internal-error': 'Google sign-in failed (internal). Try again or use Safari/Chrome.'
    };
    const msg = map[err.code] || (err.message || 'Sign-in failed');
    if(errEl) errEl.textContent = msg;
    toast(msg, 'error');
  } finally {
    setBusy(false);
  }
}


async function signOutAccount(){
  try {
    stopTeam();
    await auth.signOut();
    toast('Signed out');
    location.reload();   // drop everything the previous account had loaded
  } catch(err){
    console.error(err);
    toast(err.message || 'Sign out failed', 'error');
  }
}

/* Check access (team membership) first, then load the workspace. Runs once per account. */
let startedUid = null;
let starting = null;
function startAppForUser(user){
  if(!user || !user.uid){
    console.error('startAppForUser: missing user');
    return Promise.resolve();
  }
  if(startedUid === user.uid && starting) return starting;
  startedUid = user.uid;
  starting = (async () => {
    const overlay = $('loadingOverlay');
    const loadingText = $('loadingText');
    try {
      updateAccountUI(user);
      if(overlay) overlay.classList.remove('hidden');
      if(loadingText) loadingText.textContent = 'Checking access...';
      let access;
      try {
        access = await resolveAccess(user);
      } catch(err){
        console.error('access check failed', err);
        startedUid = null;
        showNoAccess({ email: user.email, error: err.message || String(err), hint: err.hint });
        return;
      }
      if(access.denied){
        startedUid = null;
        showNoAccess({ email: access.email });
        return;
      }
      hideNoAccess();
      hideAuthGate();
      if(loadingText) loadingText.textContent = 'Loading your data...';
      await CloudSync.init(user.uid, access.workspaceId);
      watchMembers();
      try { loadIssueNotes(); } catch(e){ console.warn('loadIssueNotes', e); }
      if(overlay) overlay.classList.add('hidden');
      // Non-blocking prefetch
      try { prefetchTesterCount(); } catch(e){ console.warn('prefetchTesterCount', e); }
    } catch(err){
      console.error('startAppForUser failed:', err);
      setSyncStatus('error', 'Load failed');
      if(overlay) overlay.classList.add('hidden');
      toast(err.message || 'Failed to load data', 'error');
    }
  })();
  return starting;
}

export {
  hideAuthGate,
  isAnonymousUser,
  isGoogleUser,
  renderAll,
  showAuthGate,
  signInWithGoogle,
  signOutAccount,
  startAppForUser,
  updateAccountUI
};
