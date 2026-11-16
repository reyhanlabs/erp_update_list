/**
 * Share Links (v5.3.0) — every public link of the workspace in one place:
 * the Update history link (/u/…) and the Client Report links (/r/…).
 * Open, copy or stop sharing. Data: /api/report-share?links=1.
 */
import { apiFetch } from '../api.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { confirmDialog } from '../ui/confirm.js';
import { writeClipboard } from '../core/clipboard.js';
import { canEdit } from '../core/team.js';

const L = { data: null, loading: false, error: '' };
const urlOf = (kind, t) => `${location.origin}/${kind === 'updates' ? 'u' : 'r'}/${t}`;
const when = (ms) => ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

async function call(method, body, query){
  const r = await apiFetch('/api/report-share' + (query || ''), method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error || 'The request failed');
  return d;
}

function row(kind, title, sub, s){
  const url = urlOf(kind, s.token), edit = canEdit();
  return `<div class="sl-row">
    <div class="sl-main"><b>${escapeHtml(title)}</b><small>${escapeHtml(sub)}</small><a class="sl-url" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a></div>
    <div class="sl-facts"><span><b>${s.views || 0}</b> view${s.views === 1 ? '' : 's'}</span><span>Last opened ${escapeHtml(when(s.lastViewedAt))}</span><span>Created ${escapeHtml(when(s.createdAt))}${s.createdBy ? ' · ' + escapeHtml(s.createdBy) : ''}</span></div>
    <div class="sl-acts">
      <a class="btn btn-secondary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a>
      <button type="button" class="btn btn-secondary btn-sm" onclick="copyShareLink('${kind}','${escapeHtml(s.token)}')">Copy link</button>
      ${edit ? `<button type="button" class="btn btn-danger btn-sm" onclick="stopShareLink('${kind}','${escapeHtml(s.token)}')">Stop sharing</button>` : ''}
    </div>
  </div>`;
}

function paint(){
  const box = $('shareLinksBody');
  if(!box) return;
  if(L.loading && !L.data){ box.innerHTML = '<div class="kb-state"><p>Loading the links…</p></div>'; return; }
  if(L.error){ box.innerHTML = `<div class="kb-state"><p><b>${escapeHtml(L.error)}</b></p><button type="button" class="btn btn-secondary btn-sm" onclick="openShareLinksView(true)">Try again</button></div>`; return; }
  const d = L.data || { updates: null, reports: [] };
  const n = (d.updates ? 1 : 0) + d.reports.length;
  const badge = $('shareLinksCount'); if(badge) badge.textContent = String(n);
  box.innerHTML = `
    <section class="sl-group">
      <h4>Update history <span>${d.updates ? 1 : 0}</span></h4>
      ${d.updates ? row('updates', 'Update history', 'Every update with its versions and issues — for the internal team', d.updates)
        : `<div class="sl-empty"><p>No link yet. The page lists every update, which installer is ready, and the issues inside.</p>${canEdit() ? '<button type="button" class="btn btn-primary btn-sm" onclick="createUpdatesLink()">Create the link</button>' : ''}</div>`}
    </section>
    <section class="sl-group">
      <h4>Client reports <span>${d.reports.length}</span></h4>
      ${d.reports.length ? d.reports.map(s => row('report', s.client || 'Client', 'Live report of this client\'s issues', s)).join('')
        : '<div class="sl-empty"><p>No client report is shared. Open a client in By Client → Report → Share link to create one.</p></div>'}
    </section>
    <p class="sl-note">Shared Plan links (<code>/share?id=…</code>) are one-off snapshots without an owner list, so they are not shown here.</p>`;
}

async function openShareLinksView(force){
  if(L.loading) return;
  if(L.data && !force){ paint(); }
  L.loading = true; L.error = ''; paint();
  try { L.data = await call('GET', null, '?links=1'); }
  catch(err){ L.error = err.message || 'Could not load the links'; }
  L.loading = false; paint();
}
async function copyShareLink(kind, token){
  const url = urlOf(kind, token);
  try { await writeClipboard(url); toast('Link copied'); } catch(_){ prompt('Copy this link', url); }
}
async function stopShareLink(kind, token){
  const ok = await confirmDialog({ title: 'Stop sharing this link?', message: 'The link stops working right away. A new link will have a different address.', okText: 'Stop sharing', type: 'danger' });
  if(!ok) return;
  try { await call('POST', { action: kind === 'updates' ? 'revoke-updates' : 'revoke', token }); toast('Link switched off'); }
  catch(err){ toast(err.message || 'Could not switch the link off', 'error'); }
  openShareLinksView(true);
}
async function createUpdatesLink(){
  try { await call('POST', { action: 'create-updates' }); toast('Link created'); }
  catch(err){ toast(err.message || 'Could not create the link', 'error'); }
  openShareLinksView(true);
}

/* Update History (in-app): the public page, loaded with the member's own sign-in */
function openHistoryView(){
  const f = $('historyFrame');
  if(f && !f.getAttribute('src')) f.setAttribute('src', '/updates.html?app=1');
}
function reloadHistoryView(){
  const f = $('historyFrame');
  if(f) f.setAttribute('src', '/updates.html?app=1&r=' + Date.now());
}

export { openShareLinksView, copyShareLink, stopShareLink, createUpdatesLink, openHistoryView, reloadHistoryView };
