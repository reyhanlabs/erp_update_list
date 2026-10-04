/**
 * Background auto-refresh
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { currentView } from '../ui/navigation.js';
import { loadTesterReminder, prefetchTesterCount } from './tester/queue.js';
import { prefetchAllIssueStatusBadges } from './issue-status.js';
import { loadNewIssues, refreshDashNewIssueCounts } from './new-issues.js';
import { loadActiveWork } from './active-work.js';
import { loadWhatNext, refreshDashAttention } from './what-next.js';

/* ===== Background auto-refresh ===== */
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
let __autoRefreshTimer = null;

function startBackgroundAutoRefresh(){
  if(__autoRefreshTimer) return;
  __autoRefreshTimer = setInterval(() => {
    if(document.hidden) return;
    try {
      if(currentView === 'newissues') loadNewIssues(false);
      else if(currentView === 'activework') loadActiveWork(false);
      else if(currentView === 'whatnext') loadWhatNext(false);
      else if(currentView === 'tester') loadTesterReminder(false);
      else if(currentView === 'dashboard'){
        refreshDashNewIssueCounts();
        refreshDashAttention();
      }
      // Keep tester sidebar counts accurate even outside Tester Queue
      if(currentView !== 'tester'){
        prefetchTesterCount().catch(()=>{});
      }
      // Keep Issue Status sidebar badges warm
      prefetchAllIssueStatusBadges().catch(()=>{});
    } catch(e){ console.warn('auto-refresh', e); }
  }, AUTO_REFRESH_MS);
}

export {
  startBackgroundAutoRefresh
};
