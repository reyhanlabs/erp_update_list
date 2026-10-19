/**
 * Share the Client Report as a live, read-only link (v4.71.0)
 *
 *   https://<app>/r/<token>  — no sign-in. The server (api/report-share.js) reads
 *   Redmine and the client's request lists each time the page is opened, so the
 *   client always sees the current status. One link per client; "Stop sharing"
 *   deletes it and the old link stops working at once.
 */
import { apiFetch } from '../api.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';
import { confirmDialog } from '../ui/confirm.js';
import { setReportAfterRender, getReportMode } from './client-report.js';
import { resolveNewIssueProjectIds } from './new-issues.js';

const S = { open: false, client: '', share: null, loading: false, busy: false, error: '' };
const linkOf = (t) => `${location.origin}/r/${t}`;
const clientNow = () => (window.__clientReportCtx && window.__clientReportCtx.clientName) || '';

async function call(method, body, query){
  const r = await apiFetch(`/api/report-share${query || ''}`, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error ? `${d.error}${d.hint ? ' — ' + d.hint : ''}` : `HTTP ${r.status}`);
  return d;
}

function fmt(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function paint(){
  const el = $('reportSharePanel');
  if(!el) return;
  if(!S.open || S.client !== clientNow()){ el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const head = `<div class="rs-share-head"><b>Share this report</b><button type="button" class="btn btn-ghost btn-xs" onclick="closeReportShare()" aria-label="Close">Close</button></div>`;
  if(S.loading){ el.innerHTML = head + '<p class="rs-share-muted">Loading…</p>'; return; }
  if(S.error){ el.innerHTML = head + `<p class="rs-share-err">${escapeHtml(S.error)}</p><div class="rs-share-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="openReportShare(true)">Try again</button></div>`; return; }
  const sh = S.share;
  if(!sh){
    el.innerHTML = head + `<p class="rs-share-muted">Anyone with the link can open this report — no sign-in. It is <b>live</b>: issue status comes from Redmine each time the page is opened, together with the client's request lists. Redmine links, Copy text and CSV are left out. You can stop sharing at any time.</p>
      <div class="rs-share-actions"><button type="button" class="btn btn-primary btn-sm" onclick="createReportShare()"${S.busy ? ' disabled' : ''}>${S.busy ? 'Creating…' : 'Create link'}</button></div>`;
    return;
  }
  const url = linkOf(sh.token);
  el.innerHTML = head + `<div class="rs-share-row">
      <input class="input rs-share-url" id="reportShareUrl" readonly value="${escapeHtml(url)}" onclick="this.select()">
      <button type="button" class="btn btn-primary btn-sm" onclick="copyReportShare()">Copy link</button>
      <a class="btn btn-secondary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a>
    </div>
    <p class="rs-share-muted">Live · created ${escapeHtml(fmt(sh.createdAt))}${sh.createdBy ? ` by ${escapeHtml(sh.createdBy)}` : ''} · opened ${Number(sh.views || 0)} time${Number(sh.views || 0) === 1 ? '' : 's'}${sh.lastViewedAt ? `, last ${escapeHtml(fmt(sh.lastViewedAt))}` : ''} · grouped by ${escapeHtml(sh.mode || 'auto')}</p>
    <div class="rs-share-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick="createReportShare(true)"${S.busy ? ' disabled' : ''} title="Use the current “Group by” for the shared page">Update grouping</button>
      <button type="button" class="btn btn-ghost btn-sm rs-share-stop" onclick="revokeReportShare()"${S.busy ? ' disabled' : ''}>Stop sharing</button>
    </div>`;
}

async function openReportShare(force){
  const client = clientNow();
  if(!client) return;
  if(S.open && S.client === client && !force){ closeReportShare(); return; }
  Object.assign(S, { open: true, client, loading: true, error: '', share: S.client === client && !force ? S.share : null });
  paint();
  try {
    const d = await call('GET', null, `?client=${encodeURIComponent(client)}`);
    if(S.client !== client) return;
    S.share = d.share || null;
  } catch(err){ S.error = err.message || String(err); }
  S.loading = false; paint();
}
function closeReportShare(){ S.open = false; paint(); }

async function createReportShare(update){
  const client = clientNow();
  const meta = window.__clientMeta || {};
  if(!client) return;
  if(!meta.cfId){ toast('The Client Name field of Redmine is not known yet — reload the client and try again', 'error'); return; }
  S.busy = true; paint();
  try {
    const projects = (resolveNewIssueProjectIds() || []).filter(t => t && t.projectId).map(t => ({ id: String(t.projectId), label: t.projectName || t.label || '' }));
    const d = await call('POST', { action: 'create', client, cfId: String(meta.cfId), projects, mode: getReportMode(), replace: !!update });
    S.share = d.share;
    if(!update){ try { await writeClipboard(linkOf(d.share.token)); toast('Link created and copied'); } catch(_){ toast('Link created'); } }
    else toast('Shared page now uses the current grouping');
  } catch(err){ toast(err.message || 'Could not create the link', 'error'); }
  S.busy = false; paint();
}

async function copyReportShare(){
  if(!S.share) return;
  const url = linkOf(S.share.token);
  try { await writeClipboard(url); toast('Link copied'); }
  catch(_){ const x = $('reportShareUrl'); if(x){ x.focus(); x.select(); } }
}

async function revokeReportShare(){
  if(!S.share) return;
  const ok = await confirmDialog({ title: 'Stop sharing this report?', message: 'The link stops working right away. You can create a new link later (it will be a different address).', okText: 'Stop sharing', type: 'danger' });
  if(!ok) return;
  S.busy = true; paint();
  try { await call('POST', { action: 'revoke', token: S.share.token }); S.share = null; toast('Link removed'); }
  catch(err){ toast(err.message || 'Could not remove the link', 'error'); }
  S.busy = false; paint();
}

setReportAfterRender(paint);

export { openReportShare, closeReportShare, createReportShare, copyReportShare, revokeReportShare };
