/**
 * Entry point — Vite builds from here
 */
import { initFirebase } from './firebase.js';
import { startApp } from './app.js';
import { APP_VERSION } from './config.js';

console.log('[erp] boot', APP_VERSION);

try {
  initFirebase();
  // startApp registers listeners & auth; call after DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => {
      startApp().catch(err => console.error('startApp failed', err));
    });
  } else {
    startApp().catch(err => console.error('startApp failed', err));
  }
} catch(err){
  console.error('Boot failed:', err);
  const el = document.getElementById('loadingText');
  if(el) el.textContent = 'Boot failed: ' + (err.message || err);
}
