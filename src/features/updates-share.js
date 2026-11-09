/**
 * Update history link (v4.79.0) — Update Summaries → "Share link"
 * One read-only page per workspace at /u/<token>: every update with its FE / V2 / V3
 * versions and the issues that went out in it. No sign-in. "Stop sharing" switches it off.
 */
import { apiFetch } from '../api.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';
import { confirmDialog } from '../ui/confirm.js';

const S = { open: false, share: null, loading: false, busy: false, error: '' };
const linkOf = (t) => `${location.origin}/u/${t}`;
const fmt = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

async function call(method, body, query){
  const r = await apiFetch(`/api/report-share${query || ''}`, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error ? `${d.error}${d.hint ? ' — ' + d.hint : ''}` : `HTTP ${r.status}`);
  return d;
}

function paint(){
  const el = $('updatesSharePanel');
  if(!el) return;
  if(!S.open){ el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const head = `<div class="rs-share-head"><b>Share the update history</b><button type="button" class="btn btn-ghost btn-xs" onclick="closeUpdatesShare()">Close</button></div>`;
  if(S.loading){ el.innerHTML = head + '<p class="rs-share-muted">Loading…</p>'; return; }
  if(S.error){ el.innerHTML = head + `<p class="rs-share-err">${escapeHtml(S.error)}</p><div class="rs-share-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="openUpdatesShare(true)">Try again</button></div>`; return; }
  if(!S.share){
    el.innerHTML = head + `<p class="rs-share-muted">One page for the whole team — no sign-in: every update with its <b>FE / V2 / V3</b> versions and the issues that went out in it, newest first, filter per product, and search an issue number to see which version it shipped in. It follows the Update Summaries live.</p>
      <div class="rs-share-actions"><button type="button" class="btn btn-primary btn-sm" onclick="createUpdatesShare()"${S.busy ? ' disabled' : ''}>${S.busy ? 'Creating…' : 'Create link'}</button></div>`;
    return;
  }
  const url = linkOf(S.share.token);
  el.innerHTML = head + `<div class="rs-share-row">
      <input class="input rs-share-url" id="updatesShareUrl" readonly value="${escapeHtml(url)}" onclick="this.select()">
      <button type="button" class="btn btn-primary btn-sm" onclick="copyUpdatesShare()">Copy link</button>
      <a class="btn btn-secondary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a>
    </div>
    <p class="rs-share-muted">Live · created ${escapeHtml(fmt(S.share.createdAt))}${S.share.createdBy ? ` by ${escapeHtml(S.share.createdBy)}` : ''} · opened ${Number(S.share.views || 0)} time${Number(S.share.views || 0) === 1 ? '' : 's'}${S.share.lastViewedAt ? `, last ${escapeHtml(fmt(S.share.lastViewedAt))}` : ''}</p>
    <div class="rs-share-actions"><button type="button" class="btn btn-ghost btn-sm rs-share-stop" onclick="revokeUpdatesShare()"${S.busy ? ' disabled' : ''}>Stop sharing</button></div>`;
}

async function openUpdatesShare(force){
  if(S.open && !force){ closeUpdatesShare(); return; }
  Object.assign(S, { open: true, loading: true, error: '' });
  paint();
  try { const d = await call('GET', null, '?updates=1'); S.share = d.share || null; }
  catch(err){ S.error = err.message || String(err); }
  S.loading = false; paint();
}
function closeUpdatesShare(){ S.open = false; paint(); }
async function createUpdatesShare(){
  S.busy = true; paint();
  try {
    const d = await call('POST', { action: 'create-updates' });
    S.share = d.share;
    try { await writeClipboard(linkOf(d.share.token)); toast('Link created and copied'); } catch(_){ toast('Link created'); }
  } catch(err){ toast(err.message || 'Could not create the link', 'error'); }
  S.busy = false; paint();
}
async function copyUpdatesShare(){
  if(!S.share) return;
  try { await writeClipboard(linkOf(S.share.token)); toast('Link copied'); }
  catch(_){ const x = $('updatesShareUrl'); if(x){ x.focus(); x.select(); } }
}
async function revokeUpdatesShare(){
  if(!S.share) return;
  const ok = await confirmDialog({ title: 'Stop sharing the update history?', message: 'The link stops working right away. A new link will have a different address.', okText: 'Stop sharing', type: 'danger' });
  if(!ok) return;
  S.busy = true; paint();
  try { await call('POST', { action: 'revoke-updates', token: S.share.token }); S.share = null; toast('Link removed'); }
  catch(err){ toast(err.message || 'Could not remove the link', 'error'); }
  S.busy = false; paint();
}

export { openUpdatesShare, closeUpdatesShare, createUpdatesShare, copyUpdatesShare, revokeUpdatesShare };
