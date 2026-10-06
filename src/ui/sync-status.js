/**
 * Sync / Redmine status indicators
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { $, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';

/* ============================================================
   SYNC STATUS UI
   ============================================================ */
function setSyncStatus(status, label){
  const ind = $('syncIndicator');
  const dot = $('statusDot');
  const pill = $('cloudStatusPill');
  const pillText = $('cloudStatusText');

  if(ind){
    ind.className = 'sync-indicator ' + (status === 'online' ? '' : status);
    const lbl = $('syncLabel');
    if(lbl) lbl.textContent = label;
  }
  if(dot){
    dot.className = 'dot-status ' + (status === 'online' ? '' : status);
    dot.textContent = status === 'online' ? 'Synced' : (status === 'syncing' ? 'Syncing' : 'Error');
  }
  if(pill){
    pill.className = 'status-pill ' + (status === 'online' ? '' : (status === 'syncing' ? 'syncing' : 'error'));
    if(pillText){
      pillText.textContent = status === 'online' ? 'Connected'
        : status === 'syncing' ? 'Syncing'
        : status === 'offline' ? 'Offline'
        : 'Error';
    }
  }
}

function setRedmineStatus(status, label){
  const pill = $('redmineStatusPill');
  const text = $('redmineStatusText');
  if(!pill || !text) return;
  if(status === 'loading'){
    pill.className = 'status-pill syncing';
    text.textContent = label || 'Loading';
  } else if(status === 'error'){
    pill.className = 'status-pill error';
    text.textContent = label || 'Error';
  } else {
    pill.className = 'status-pill';
    text.textContent = label || 'Ready';
  }
}

function updateLastSync(){
  const el = $('lastSyncTime');
  if(!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  el.textContent = `${hh}:${mm}:${ss}`;
}

function copyUID(){
  const uidText = $('userUID')?.textContent;
  if(!uidText || uidText === '—') return;
  writeClipboard(uidText).then(()=>{
    toast('UID copied to clipboard');
  }).catch(()=>{
    toast('Failed to copy', 'error');
  });
}

export {
  copyUID,
  setRedmineStatus,
  setSyncStatus,
  updateLastSync
};
