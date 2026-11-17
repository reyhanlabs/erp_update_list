/**
 * Client Updates — /c/<token> (v5.5.0)
 * Which client servers already run each update. The same view as the Client Updates
 * menu inside the app; here the states are worked out on the server.
 * No Firebase, no sign-in: data from /api/report-share?c=<token>.
 */
import { escapeHtml } from '../core/helpers.js';
import { viewHtml, reportText, markReady } from '../features/client-updates-view.js';

const host = document.getElementById('cuBody');
const token = (location.pathname.match(/^\/c\/([A-Za-z0-9_-]{20,64})\/?$/) || [])[1] || new URLSearchParams(location.search).get('c') || '';
const S = { data: null, at: 0, q: '', status: 'all', client: '', showAll: false, open: new Set(), pub: true };

function fail(msg){
  host.innerHTML = `<div class="pr-state"><p><b>${escapeHtml(msg)}</b></p><p class="pr-muted">Ask the Zahir ERP team for a new link if you need this page.</p></div>`;
}
function all(){
  const ready = markReady(S.data.updates);
  return S.data.updates.map(u => ({ u, ready: ready.has(u.id), clients: u.clients, noClient: u.noClient || 0 }));
}
function render(){
  const active = document.activeElement && document.activeElement.id === 'cuSearch';
  const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  host.innerHTML = viewHtml(S, all()).html;
  if(active){ const el = document.getElementById('cuSearch'); if(el){ el.focus(); try { el.setSelectionRange(sel[0], sel[1]); } catch(_){} } }
}
function toastMsg(t){ const el = document.getElementById('toast'); if(!el) return; el.textContent = t; el.className = 'toast show'; clearTimeout(toastMsg.t); toastMsg.t = setTimeout(() => { el.className = 'toast'; }, 2200); }

async function load(){
  if(!token){ fail('This link is incomplete.'); return; }
  try {
    const r = await fetch(`/api/report-share?c=${encodeURIComponent(token)}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if(!r.ok){ fail(d.error || 'This page is not available.'); return; }
    S.data = d; S.at = d.generatedAt || Date.now();
  } catch(_){ if(!S.data) fail('The page could not be loaded. Check your connection and refresh.'); return; }
  document.getElementById('prMeta').innerHTML = `<span class="pr-live"><i></i>Live</span><span>Updated ${escapeHtml(new Date(S.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span><button type="button" class="btn btn-secondary btn-sm" onclick="cuReload()">Refresh</button>`;
  render();
}

let searchTimer = null;
Object.assign(window, {
  cuSearch(v){ S.q = String(v || ''); clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); },
  cuStatus(k){ S.status = S.status === k && k !== 'all' ? 'all' : k; render(); },
  cuClient(v){ S.client = String(v || ''); render(); },
  cuShowAll(){ S.showAll = true; render(); },
  cuToggle(key){ if(S.open.has(key)) S.open.delete(key); else S.open.add(key); render(); },
  async cuCopy(id){
    const x = all().find(y => y.u.id === id);
    if(!x) return;
    const text = reportText(x);
    try { await navigator.clipboard.writeText(text); toastMsg('Report copied'); } catch(_){ prompt('Copy this report', text); }
  },
  cuReload(){ load(); }
});

load();
setInterval(() => { if(!document.hidden) load(); }, 5 * 60 * 1000);
