/**
 * Public Client Report page — /r/<token> (v4.71.0)
 * No Firebase, no sign-in: the data comes from /api/report-share?t=<token>,
 * which reads Redmine and the client's request lists on the server.
 */
import { renderClientReport, setReportPublic, setRequestSource, setClientReportGroup, toggleClientReportMore,
  toggleClientReportAll, downloadClientReportPng, copyClientReportImage } from '../features/client-report.js';
import { escapeHtml } from '../core/helpers.js';

Object.assign(window, { setClientReportGroup, toggleClientReportMore, toggleClientReportAll, downloadClientReportPng, copyClientReportImage });

const host = document.getElementById('clientReportBody');
const token = (location.pathname.match(/^\/r\/([A-Za-z0-9_-]+)/) || [])[1] || new URLSearchParams(location.search).get('t') || '';

function fail(msg){
  host.innerHTML = `<div class="pr-state"><p><b>${escapeHtml(msg)}</b></p><p class="pr-muted">If you need the report, ask the Zahir ERP team for a new link.</p></div>`;
}
const when = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function load(){
  if(!token){ fail('This link is incomplete.'); return; }
  let d;
  try {
    const r = await fetch(`/api/report-share?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
    d = await r.json().catch(() => ({}));
    if(!r.ok){ fail(d.error || 'The report could not be loaded.'); return; }
  } catch(_){ fail('The report could not be loaded. Check your connection and refresh the page.'); return; }
  window.__clientIssues = d.issues || [];
  window.__clientParents = d.parents || [];
  setRequestSource(() => d.requests || []);
  setReportPublic(true, d.mode);
  document.title = `${d.client} · Client Report`;
  document.getElementById('prClient').textContent = d.client;
  document.getElementById('prMeta').innerHTML = `<span class="pr-live"><i></i>Live</span><span>Updated ${escapeHtml(when(d.generatedAt))}${d.stale ? ' (latest available)' : ''}</span><button type="button" class="btn btn-secondary btn-sm" id="prRefresh">Refresh</button>`;
  document.getElementById('prRefresh').onclick = () => location.reload();
  renderClientReport(host, d.client, window.__clientIssues);
}
load();
