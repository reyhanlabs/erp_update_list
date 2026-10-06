/**
 * Orchestrator: window exposure + startApp()
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { auth } from './firebase.js';
import { $, toast, todayISO } from './core/helpers.js';
import { CloudSync } from './core/cloud-sync.js';
import { copyUID, setSyncStatus } from './ui/sync-status.js';
import { ThemeManager } from './ui/theme.js';
import { _closeConfirm } from './ui/confirm.js';
import {
  applyRouteFromUrl,
  currentView,
  initRouter,
  initSidebarCollapse,
  openPlansWithSync,
  switchView,
  syncUrlToRoute,
  toggleSidebar,
  toggleSyncPanel
} from './ui/navigation.js';
import { closeModal, openAddModal } from './ui/modal.js';
import { closeAllCopyMenus, copyPlan, toggleCopyMenu, togglePlanCard } from './features/plans/copy-menu.js';
import { addIssueRow, removeIssueRow, setIssueLines } from './features/plans/issue-editor.js';
import {
  deletePlan,
  editPlan,
  renderPlans,
  resetPlanForm,
  savePlan,
  setPlanFilter
} from './features/plans/plans.js';
import {
  autoGenerate,
  copySummary,
  deleteSummary,
  editSummary,
  onPlanRefChange,
  quickSummary,
  renderSummaries,
  resetSummaryForm,
  saveSummary
} from './features/summaries.js';
import {
  clearIssueSelection,
  copySelectedIssueLinks,
  copySelectedTelegram,
  toggleIssueSelect,
  toggleSelectAllIssues,
  updateBatchBar
} from './ui/batch-selection.js';
import {
  applyDensityOnBoot,
  matchesQuickFilter,
  setListDensity,
  setNavCount,
  setQuickFilter
} from './ui/list-controls.js';
import { openTesterCategory } from './features/tester/categories.js';
import {
  checkTesterNotifications,
  closeNotifPanel,
  markAllRftSeen,
  isTelegramRftEnabled,
  markNotifSeen,
  positionNotifPanel,
  pushNotifRecent,
  renderNotifRecent,
  setTelegramRftEnabled,
  startTesterNotifPoll,
  testTelegramRftAlert,
  toggleNotifPanel,
  toggleTesterNotifications,
  updateNotifToggleUI
} from './features/tester/notifications.js';
import {
  clearTesterFilters,
  copyTesterList,
  genericLoadingSkeleton,
  loadTesterReminder,
  renderTesterList,
  showMoreTester
} from './features/tester/queue.js';
import { onDatePresetChange, onRedmineProjectChange } from './redmine/projects.js';
import {
  finishSyncAndShowPlans,
  previewRedmineSync,
  syncFromRedmine,
  testRedmineConnection
} from './features/redmine-sync.js';
import { exportAll, importAll, wipeAll } from './features/backup.js';
import {
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
} from './features/account.js';
import {
  applyAppVersion,
  copyWorkspaceId,
  joinWorkspace,
  usePersonalWorkspace
} from './features/settings.js';
import {
  applyIssueStatusBadgesFromCache,
  openIssueStatusView,
  persistIssueStatusCache,
  prefetchAllIssueStatusBadges,
  restoreIssueStatusCache
} from './features/issue-status.js';
import {
  clearNewIssuesFilters,
  collectNewIssuesFlat,
  copyAllNewIssueLinks,
  copyGroupIssueLinks,
  copyNewIssueLinks,
  loadNewIssues,
  openNewIssuesView,
  prefetchActiveWorkCounts,
  prefetchNewIssueCounts,
  refreshDashNewIssueCounts,
  renderNewIssues
} from './features/new-issues.js';
import {
  copyActiveWorkLinks,
  loadActiveWork,
  openActiveWorkView,
  renderActiveWork
} from './features/active-work.js';
import {
  copyWhatNextList,
  createPlanFromWhatNext,
  loadWhatNext,
  openWhatNextView,
  refreshDashAttention,
  renderWhatNext
} from './features/what-next.js';
import { startBackgroundAutoRefresh } from './features/auto-refresh.js';
import {
  loadTelegramChatId,
  saveTelegramChatId,
  sendTelegramBriefing
} from './features/telegram-briefing.js';
import {
  generateIssueDescription,
  onCreateIssueProjectChange,
  openCreateIssueView,
  resetCreateIssueForm,
  submitCreateIssue
} from './features/create-issue.js';
import {
  bootShareMode,
  copyPlanShareLink,
  copySharedIssueLinks,
  copySharedTelegram,
  loadSharedPlanFromUrl,
  makeShareId
} from './features/share.js';
import { installPwaApp } from './features/pwa.js';
import { deleteNote, openNoteEditor, openNotesView, renderNotes } from './features/notes.js';
import { closeGlobalSearch, onGlobalSearchInput, openGlobalSearch } from './features/global-search.js';
import {
  getIssueClientName,
  loadClientIssues,
  openClientsView,
  renderClientIssues,
  resolveClientNameFieldId,
  searchClientFromGlobal
} from './features/clients.js';
import { openDocsView } from './features/docs.js';
import { openKbArticle, openKbView } from './features/kb.js';

function exposeAppGlobals(){
  const map = {
    openTesterCategory, switchView, toggleSidebar, openAddModal, closeModal,
    setPlanFilter, renderPlans, renderSummaries, renderTesterList, clearTesterFilters,
    loadTesterReminder, copyTesterList, openPlansWithSync, toggleSyncPanel,
    previewRedmineSync, syncFromRedmine, testRedmineConnection, onRedmineProjectChange,
    onDatePresetChange, onPlanRefChange, addIssueRow, autoGenerate, removeIssueRow,
    exportAll, importAll, wipeAll, copyUID,
    signInWithGoogle, signOutAccount, continueAsGuest,
    joinWorkspace, usePersonalWorkspace, copyWorkspaceId,
    toggleTesterNotifications, pushNotifRecent, markNotifSeen, renderNotifRecent, toggleNotifPanel, closeNotifPanel, positionNotifPanel, markAllRftSeen,
    // Plan cards
    togglePlanCard, toggleCopyMenu, closeAllCopyMenus, copyPlan, copyPlanShareLink, makeShareId, bootShareMode, installPwaApp, loadSharedPlanFromUrl, copySharedIssueLinks, copySharedTelegram, editPlan, deletePlan, savePlan,
    // Summaries
    editSummary, deleteSummary, copySummary, quickSummary, saveSummary, resetSummaryForm, resetPlanForm,
    finishSyncAndShowPlans,
    openNewIssuesView, openIssueStatusView, applyIssueStatusBadgesFromCache, prefetchAllIssueStatusBadges, persistIssueStatusCache, restoreIssueStatusCache, loadNewIssues, renderNewIssues, clearNewIssuesFilters, copyGroupIssueLinks, collectNewIssuesFlat, copyNewIssueLinks, copyAllNewIssueLinks, refreshDashNewIssueCounts,
    openActiveWorkView, openCreateIssueView, onCreateIssueProjectChange, generateIssueDescription, submitCreateIssue, resetCreateIssueForm, loadActiveWork, renderActiveWork, copyActiveWorkLinks,
    openWhatNextView, resolveClientNameFieldId, getIssueClientName, renderClientIssues, loadClientIssues, openClientsView, searchClientFromGlobal, showMoreTester, openNotesView, renderNotes, openNoteEditor, deleteNote, openGlobalSearch, setNavCount, applyDensityOnBoot, matchesQuickFilter, setListDensity, setQuickFilter, updateBatchBar, copySelectedTelegram, copySelectedIssueLinks, clearIssueSelection, toggleSelectAllIssues, toggleIssueSelect, closeGlobalSearch, onGlobalSearchInput, genericLoadingSkeleton, loadWhatNext, renderWhatNext, copyWhatNextList, createPlanFromWhatNext,
    applyRouteFromUrl, syncUrlToRoute, openDocsView, openKbView, openKbArticle,
    refreshDashAttention, saveTelegramChatId, sendTelegramBriefing, loadTelegramChatId, setTelegramRftEnabled, isTelegramRftEnabled, testTelegramRftAlert, checkTesterNotifications,
    CloudSync
  };
  Object.keys(map).forEach(k => {
    try {
      if(typeof map[k] === 'function' || (map[k] && typeof map[k] === 'object')) {
        window[k] = map[k];
      }
    } catch(e){ console.warn('expose failed', k, e); }
  });
}

export async function startApp(){
  exposeAppGlobals();
  try { initSidebarCollapse(); } catch(_){}
  try { startBackgroundAutoRefresh(); } catch(_){}
  try { loadTelegramChatId(); } catch(_){}

  // Restore notification preference
  try {
    updateNotifToggleUI();
    try {
      const tgOn = document.getElementById('telegramRftToggle');
      if(tgOn) tgOn.checked = isTelegramRftEnabled();
    } catch(_){}
    // Always poll RFT for accurate sidebar counts + Telegram alerts
    startTesterNotifPoll();
    // Lightweight sidebar counts (limit=1 per project)
    setTimeout(() => {
      prefetchNewIssueCounts().catch(()=>{});
      prefetchAllIssueStatusBadges().catch(()=>{});
      prefetchActiveWorkCounts().catch(()=>{});
    }, 1800);
    document.addEventListener('click', (e) => {
      const wrap = $('notifBellWrap');
      const panel = $('notifPanel');
      if(!panel || panel.classList.contains('hidden')) return;
      if(window.__notifOpenedAt && (Date.now() - window.__notifOpenedAt) < 300) return;
      const t = e.target;
      if(wrap && wrap.contains(t)) return;
      if(panel.contains(t)) return;
      closeNotifPanel();
    });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape'){
        const panel = $('notifPanel');
        if(panel && !panel.classList.contains('hidden')) closeNotifPanel();
      }
    });
    window.addEventListener('resize', () => { try { positionNotifPanel(); } catch(_){} });
  } catch(_){}

  // Formerly DOMContentLoaded handler
  // Show version immediately
  applyAppVersion();

  const okBtn = $('confirmOkBtn');
  const cancelBtn = $('confirmCancelBtn');
  const confirmOverlay = $('confirmModal');
  if(okBtn) okBtn.addEventListener('click', ()=> _closeConfirm(true));
  if(cancelBtn) cancelBtn.addEventListener('click', ()=> _closeConfirm(false));
  if(confirmOverlay) confirmOverlay.addEventListener('click', (e)=> {
    if(e.target === confirmOverlay) _closeConfirm(false);
  });

  document.addEventListener('keydown', (e)=>{
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;

    if(e.key === 'Escape'){
      if(confirmOverlay && confirmOverlay.classList.contains('show')){
        _closeConfirm(false);
      }
      closeAllCopyMenus();
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
      return;
    }

    // Don't trigger shortcuts while typing
    if(typing || e.metaKey || e.ctrlKey || e.altKey) return;

    // / → focus search on current list view
    if(e.key === '/'){
      e.preventDefault();
      const input = currentView === 'summaries' ? $('summarySearch') : $('planSearch');
      if(currentView !== 'plans' && currentView !== 'summaries'){
        switchView('plans');
      }
      setTimeout(()=> (currentView === 'summaries' ? $('summarySearch') : $('planSearch'))?.focus(), 50);
      return;
    }

    // N → new item
    if(e.key === 'n' || e.key === 'N'){
      e.preventDefault();
      if(currentView === 'summaries'){
        openAddModal();
      } else if(currentView === 'plans' || currentView === 'dashboard'){
        if(currentView !== 'plans') switchView('plans');
        openAddModal();
      }
    }
  });

  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if(e.target === ov) closeModal(ov.id); });
  });

  ThemeManager.init();
  $('planDate').value = todayISO();
  $('summaryDate').value = todayISO();

  // Init Redmine date filter — default: Today
  if ($('syncDatePreset')) $('syncDatePreset').value = 'today';
  if ($('syncFrom')) $('syncFrom').value = todayISO();
  if ($('syncTo'))   $('syncTo').value   = todayISO();
  onDatePresetChange();

  setIssueLines([]);
  renderAll();
  try { initRouter(); } catch(_){}
  try { applyRouteFromUrl({ replaceUrl: true }); } catch(_){ switchView('dashboard'); }

    // Public share link — skip login gate
  try {
    const q = new URLSearchParams(location.search);
    if(q.get('view') === 'share'){
      bootShareMode();
      return;
    }
  } catch(_){}

  $('loadingText').textContent = 'Connecting to Firebase...';

  // Restore session (Google) or fall back to anonymous guest
  // Complete Google redirect sign-in (mobile)
  try {
    const wasRedirect = sessionStorage.getItem('erp_auth_redirect') === '1';
    const redirectResult = await auth.getRedirectResult();
    if(redirectResult && redirectResult.user){
      sessionStorage.removeItem('erp_auth_redirect');
      sessionStorage.removeItem('erp_guest_ok');
      console.log('✅ Google redirect sign-in:', redirectResult.user.email || redirectResult.user.uid);
      const back = sessionStorage.getItem('erp_post_auth_path');
      sessionStorage.removeItem('erp_post_auth_path');
      if(back && back !== (location.pathname + location.search + location.hash)){
        try { history.replaceState(null, '', back); } catch(_){}
      }
      hideAuthGate();
      updateAccountUI(redirectResult.user);
      toast('Signed in with Google', 'success');
    } else if(wasRedirect){
      // Came back from Google without a user — show gate + hint
      sessionStorage.removeItem('erp_auth_redirect');
      console.warn('Redirect returned without user');
      const errEl = $('authError');
      if(errEl) errEl.textContent = 'Google sign-in was cancelled or failed. Please try again.';
    }
  } catch(redirErr){
    console.warn('Redirect sign-in error:', redirErr);
    sessionStorage.removeItem('erp_auth_redirect');
    const errEl = $('authError');
    const map = {
      'auth/unauthorized-domain': `Domain "${location.hostname}" not authorized in Firebase Console → Authentication → Authorized domains.`,
      'auth/operation-not-allowed': 'Enable Google sign-in in Firebase Console.',
      'auth/account-exists-with-different-credential': 'Account exists with a different method.'
    };
    const msg = map[redirErr.code] || redirErr.message || 'Google sign-in failed';
    if(errEl) errEl.textContent = msg;
    toast(msg, 'error');
  }

  let __authBootstrapped = false;
  let __authSigningIn = false;
  auth.onAuthStateChanged(async (user) => {
    try {
      if(!user){
        // No Firebase session → show login (don't auto-anonymous unless guest chosen)
        showAuthGate();
        return;
      }

      // Already loaded same user
      if(__authBootstrapped && CloudSync.uid === user.uid){
        updateAccountUI(user);
        if(isGoogleUser(user) || sessionStorage.getItem('erp_guest_ok') === '1'){
          hideAuthGate();
        }
        return;
      }

      console.log('✅ Auth session:', user.isAnonymous ? 'anonymous' : (user.email || user.uid));

      // Google user → never keep the login wall up
      if(isGoogleUser(user)){
        try { sessionStorage.removeItem('erp_guest_ok'); } catch(_){}
        hideAuthGate();
      }

      // Require Google unless user chose guest this session
      if(isAnonymousUser(user) && sessionStorage.getItem('erp_guest_ok') !== '1'){
        showAuthGate();
        updateAccountUI(user);
        return;
      }

      __authBootstrapped = true;
      hideAuthGate();
      await startAppForUser(user);
      // If we just returned from Google redirect with a snapshot, import it
      if(!isAnonymousUser(user)){
        await maybeMigrateGuestDataToCurrentUser();
      }
    } catch(err) {
      console.error('❌ Auth failed:', err);
      setSyncStatus('error', 'Auth failed');
      const msgMap = {
        'auth/unauthorized-domain': `Domain <b>${location.hostname}</b> is not authorized in Firebase Console.<br>Go to: Authentication → Settings → Authorized domains → Add domain.`,
        'auth/operation-not-allowed': 'Sign-in method not enabled.<br>Enable Anonymous and/or Google in Firebase Console → Authentication → Sign-in method.',
        'auth/network-request-failed': 'Could not reach Firebase. Check your internet or disable adblock.',
        'auth/invalid-api-key': 'Firebase API key is invalid.'
      };
      const friendly = msgMap[err.code] || `Error: ${err.code || err.message}`;
      $('loadingText').innerHTML = `
        <div style="max-width:420px;text-align:center;color:#ef4444;font-weight:600;margin-bottom:8px">
          Failed to connect to Firebase
        </div>
        <div style="max-width:420px;text-align:center;color:var(--text-secondary);font-size:12.5px;line-height:1.6">
          ${friendly}
        </div>`;
    }
  });

  applyAppVersion();

  // PWA service worker
  
  // PWA service worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg)=>{
      console.log('SW registered', reg.scope);
    }).catch((err)=>{
      console.warn('SW registration failed', err);
    });
  }
}
