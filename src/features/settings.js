/**
 * Version display (workspace controls moved to src/core/team.js in v4.64.0)
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { APP_VERSION, APP_VERSION_DATE, APP_VERSION_NOTE } from '../config.js';
import { $ } from '../core/helpers.js';

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


export {
  applyAppVersion
};
