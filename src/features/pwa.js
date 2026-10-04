/**
 * PWA install prompt
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { toast } from '../core/helpers.js';

/* ============================================================
   PWA install (module scope — must be global for onclick + expose)
   ============================================================ */
window.__deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__deferredPwaPrompt = e;
  const btn = document.getElementById('btnInstallPwa');
  if(btn) btn.classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  window.__deferredPwaPrompt = null;
  const btn = document.getElementById('btnInstallPwa');
  if(btn) btn.classList.add('hidden');
  try { toast('App installed on this device', 'success'); } catch(_){}
});

async function installPwaApp(){
  const e = window.__deferredPwaPrompt;
  if(!e){
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if(isIOS){
      toast('iPhone: Share → Add to Home Screen', 'info');
    } else {
      toast('Install is available from the browser menu (⋮ → Install app)', 'info');
    }
    return;
  }
  e.prompt();
  const choice = await e.userChoice;
  window.__deferredPwaPrompt = null;
  const btn = document.getElementById('btnInstallPwa');
  if(btn) btn.classList.add('hidden');
  if(choice && choice.outcome === 'accepted') toast('Installing…', 'success');
}

export {
  installPwaApp
};
