/**
 * Version display + workspace controls
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { APP_VERSION, APP_VERSION_DATE, APP_VERSION_NOTE } from '../config.js';
import { $, toast } from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { writeClipboard } from '../core/clipboard.js';

/* ============================================================
   VERSION DISPLAY
   ============================================================ */
function applyAppVersion(){
  const ver = `v${APP_VERSION}`;
  const label = $('appVersionLabel');
  const labelSettings = $('appVersionLabelSettings');
  const dateEl = $('appVersionDate');

  if(label) label.textContent = ver;
  if(labelSettings) labelSettings.textContent = ver;
  if(dateEl){
    dateEl.textContent = APP_VERSION_DATE;
    dateEl.title = APP_VERSION_NOTE || '';
  }

  // Also log to console so easy to check
  console.log(`%c Zahir ERP Update Manager ${ver} `, 'background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-weight:600', `· ${APP_VERSION_DATE} · ${APP_VERSION_NOTE}`);
}


/** Expose functions used by HTML onclick/onchange (ES modules are not global) */

function joinWorkspace(){
  const input = $('workspaceCodeInput');
  const code = input ? input.value.trim() : '';
  return CloudSync.joinWorkspace(code);
}
function usePersonalWorkspace(){
  return CloudSync.usePersonalWorkspace();
}
function copyWorkspaceId(){
  const id = CloudSync.workspaceId || '';
  if(!id){ toast('No workspace yet', 'error'); return; }
  writeClipboard(id).then(()=>toast('Workspace code copied')).catch(()=>toast(id));
}

export {
  applyAppVersion,
  copyWorkspaceId,
  joinWorkspace,
  usePersonalWorkspace
};
