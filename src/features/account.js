/**
 * Auth gate, Google sign-in, guest migration, app start per user
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { MIGRATE_SNAP_KEY } from '../config.js';
import { auth } from '../firebase.js';
import { State } from '../core/state.js';
import { $, toast } from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
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
   ACCOUNT — Google Sign-In (cross-device sync)
   - Guest (anonymous): random UID per device
   - Google: same UID on PC & phone after sign-in
   - Linking anonymous → Google keeps existing data on same UID
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

async function continueAsGuest(){
  try {
    const err = $('authError');
    if(err) err.textContent = '';
    let user = auth.currentUser;
    if(!user){
      const cred = await auth.signInAnonymously();
      user = cred.user;
    }
    // Mark this session as intentionally guest so we don't re-show gate
    sessionStorage.setItem('erp_guest_ok', '1');
    hideAuthGate();
    await startAppForUser(user);
    toast('Continuing as guest — data stays on this device');
  } catch(e){
    console.error(e);
    const err = $('authError');
    if(err) err.textContent = e.message || 'Could not continue as guest';
  }
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
    if(identity) identity.textContent = 'Guest (anonymous) — data stays on this device only';
    if(statusText) statusText.textContent = 'Guest';
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


/* ============================================================
   GUEST → GOOGLE DATA MIGRATION
   Snapshot local in-memory data before auth change; import if
   the destination account is empty.
   ============================================================ */
function snapshotLocalWorkspace(){
  try {
    const plans = (State.plans && State.plans.all) ? State.plans.all() : [];
    const summaries = (State.summaries && State.summaries.all) ? State.summaries.all() : [];
    if(!plans.length && !summaries.length) return null;
    const payload = {
      at: Date.now(),
      fromUid: CloudSync.uid || (auth.currentUser && auth.currentUser.uid) || null,
      plans: plans.map(p => {
        const { id, ...rest } = p;
        // Strip server timestamps that can't be re-written as-is
        const clean = { ...rest };
        delete clean.createdAt;
        delete clean.updatedAt;
        return { id, ...clean };
      }),
      summaries: summaries.map(s => {
        const { id, ...rest } = s;
        const clean = { ...rest };
        delete clean.createdAt;
        delete clean.updatedAt;
        return { id, ...clean };
      })
    };
    sessionStorage.setItem(MIGRATE_SNAP_KEY, JSON.stringify(payload));
    return payload;
  } catch(e){
    console.warn('snapshotLocalWorkspace failed', e);
    return null;
  }
}

function readMigrateSnapshot(){
  try {
    const raw = sessionStorage.getItem(MIGRATE_SNAP_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch(_){ return null; }
}

function clearMigrateSnapshot(){
  try { sessionStorage.removeItem(MIGRATE_SNAP_KEY); } catch(_){}
}

async function maybeMigrateGuestDataToCurrentUser(){
  const snap = readMigrateSnapshot();
  if(!snap || (!snap.plans?.length && !snap.summaries?.length)) return false;
  if(!CloudSync.uid) return false;

  // Only migrate if destination is empty (avoid overwriting existing Google data)
  try {
    const [plansSnap, sumsSnap] = await Promise.all([
      CloudSync.plansRef.limit(1).get(),
      CloudSync.summariesRef.limit(1).get()
    ]);
    const destHasData = !plansSnap.empty || !sumsSnap.empty;
    if(destHasData){
      console.log('Skip migration — destination account already has data');
      clearMigrateSnapshot();
      return false;
    }

    await CloudSync.bulkImport(snap.plans || [], snap.summaries || []);
    clearMigrateSnapshot();
    toast(`Migrated ${snap.plans.length} plan(s) & ${snap.summaries.length} summary(ies) to this account`);
    return true;
  } catch(err){
    console.error('Migration failed:', err);
    toast('Could not migrate guest data — use Export/Import in Settings', 'error');
    return false;
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
    try { snapshotLocalWorkspace(); } catch(_){}

    if(preferRedirect){
      try {
        sessionStorage.setItem('erp_auth_redirect', '1');
        sessionStorage.setItem('erp_post_auth_path', location.pathname + location.search + location.hash);
      } catch(_){}
      // Same Google account as laptop: clear anonymous/guest session first so
      // Firebase does a clean sign-in (avoids link/credential conflicts on mobile).
      try {
        sessionStorage.removeItem('erp_guest_ok');
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
    const current = auth.currentUser;
    if(current && current.isAnonymous){
      try {
        cred = await current.linkWithPopup(provider);
        toast('Google linked — data kept on this account');
      } catch(linkErr){
        if(linkErr.code === 'auth/credential-already-in-use' ||
           linkErr.code === 'auth/email-already-in-use'){
          cred = await auth.signInWithPopup(provider);
          toast('Signed in with Google');
        } else if(linkErr.code === 'auth/popup-blocked' || linkErr.code === 'auth/popup-closed-by-user'){
          sessionStorage.setItem('erp_auth_redirect', '1');
          sessionStorage.setItem('erp_post_auth_path', location.pathname + location.search + location.hash);
          setBusy(true, 'Redirecting to Google…');
          await auth.signInWithRedirect(provider);
          return;
        } else {
          throw linkErr;
        }
      }
    } else {
      try {
        cred = await auth.signInWithPopup(provider);
        toast('Signed in with Google');
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
    }

    sessionStorage.removeItem('erp_guest_ok');
    const user = (cred && cred.user) || auth.currentUser;
    hideAuthGate();
    updateAccountUI(user);
    if(user){
      await startAppForUser(user);
      await maybeMigrateGuestDataToCurrentUser();
    }
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
    sessionStorage.removeItem('erp_guest_ok');
    await auth.signOut();
    toast('Signed out');
    showAuthGate();
  } catch(err){
    console.error(err);
    toast(err.message || 'Sign out failed', 'error');
  }
}

async function startAppForUser(user){
  if(!user || !user.uid){
    console.error('startAppForUser: missing user');
    return;
  }
  try {
    updateAccountUI(user);
    const loadingText = $('loadingText');
    if(loadingText) loadingText.textContent = 'Loading your data...';
    await CloudSync.init(user.uid);
    try { loadIssueNotes(); } catch(e){ console.warn('loadIssueNotes', e); }
    const overlay = $('loadingOverlay');
    if(overlay) overlay.classList.add('hidden');
    // Non-blocking prefetch
    try { prefetchTesterCount(); } catch(e){ console.warn('prefetchTesterCount', e); }
  } catch(err){
    console.error('startAppForUser failed:', err);
    setSyncStatus('error', 'Load failed');
    const overlay = $('loadingOverlay');
    if(overlay) overlay.classList.add('hidden');
    toast(err.message || 'Failed to load data', 'error');
  }
}

export {
  continueAsGuest,
  hideAuthGate,
  isAnonymousUser,
  isGoogleUser,
  maybeMigrateGuestDataToCurrentUser,
  renderAll,
  showAuthGate,
  signInWithGoogle,
  signOutAccount,
  startAppForUser,
  updateAccountUI
};
