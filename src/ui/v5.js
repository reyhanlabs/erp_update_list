/**
 * v5.0.0 — pieces of the redesign that need a little script:
 *   · the two sidebar hubs (Issue Board, Tester Queue) mirror the count of their first tab
 *   · dashboard "Ready for update" card — the newest summary of each product
 *   · the dashboard numbers count up when they first arrive
 */
import { State } from '../core/state.js';
import { $, escapeHtml, formatDate, parseIssueLines } from '../core/helpers.js';
import { getPlanProjectKey, projectKeyLabel } from '../features/plans/plans.js';

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_){ return false; } };

/* ---------- sidebar hubs ---------- */
function mirror(fromId, toId){
  const from = $(fromId), to = $(toId);
  if(!from || !to) return;
  const copy = () => {
    to.textContent = from.textContent;
    if(from.hasAttribute('data-zero')) to.setAttribute('data-zero', from.getAttribute('data-zero')); else to.removeAttribute('data-zero');
  };
  copy();
  new MutationObserver(copy).observe(from, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-zero'] });
}

/* ---------- numbers count up ---------- */
function countUp(el){
  let busy = false, shown = null;
  new MutationObserver(() => {
    if(busy) return;
    const txt = el.textContent.trim(), n = /^\d+$/.test(txt) ? parseInt(txt, 10) : NaN;
    if(isNaN(n) || n === shown || n < 2 || reduced() || document.hidden){ shown = isNaN(n) ? null : n; return; }
    shown = n; busy = true;
    const t0 = performance.now(), ms = 700;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      el.textContent = String(Math.round(n * (1 - Math.pow(1 - t, 3))));
      if(t < 1) requestAnimationFrame(step);
      else { el.textContent = String(n); requestAnimationFrame(() => { busy = false; }); }
    };
    requestAnimationFrame(step);
  }).observe(el, { childList: true, characterData: true, subtree: true });
}

/* ---------- dashboard: Ready for update ---------- */
function readySummaries(){
  const seen = new Set(), out = [];
  [...State.summaries.all()]
    .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')) || String(y.fe || '').localeCompare(String(x.fe || '')))
    .forEach(s => {
      const plan = State.plans.get(s.planId) || null, pk = getPlanProjectKey(plan) || '';
      if(seen.has(pk)) return;
      seen.add(pk);
      out.push({ s, plan, label: pk ? projectKeyLabel(pk) : 'Other' });
    });
  return out;
}
/* which stage an Update Plan is in: no summary yet → waiting; its summary is the newest of the
   product → ready (installer built, users can be updated); otherwise → released earlier */
function readySummaryIds(){ return new Set(readySummaries().map(x => x.s.id)); }
function planStage(planId){
  const sums = State.summaries.all().filter(x => x.planId === planId);
  if(!sums.length) return 'waiting';
  const ready = readySummaryIds();
  return sums.some(x => ready.has(x.id)) ? 'ready' : 'released';
}
function stageChip(stage){
  if(stage === 'ready') return '<span class="summary-ready" title="The installer for this update is built and can be installed for users"><i aria-hidden="true"></i>Ready for update</span>';
  if(stage === 'released') return '<span class="stage-chip is-released" title="A newer installer has replaced this one">Released</span>';
  return '<span class="stage-chip is-waiting" title="No summary yet — the installer is not announced">Waiting for summary</span>';
}
const versionPill = (kind, label, v) => v ? `<span class="up-ver is-${kind}"><b>${label}</b><code>${escapeHtml(v)}</code></span>` : '';

function renderDashReady(){
  const box = $('dashReady');
  if(!box) return;
  const list = readySummaries();
  if(!list.length){ box.hidden = true; box.innerHTML = ''; return; }
  const behind = parseInt(($('countSites') || {}).textContent || '', 10);
  box.hidden = false;
  box.innerHTML = `
    <header class="dash-card-head">
      <span class="summary-ready"><i aria-hidden="true"></i>Ready for update</span>
      <h3>Installers ready for users</h3>
      <div class="dash-card-tools">
        <button type="button" class="dash-link" onclick="switchView('summaries'); openUpdatesShare()">Public link</button>
        <button type="button" class="dash-link" onclick="switchView('summaries')">All summaries</button>
      </div>
    </header>
    <div class="dash-ready-list">${list.map(({ s, plan, label }) => {
      const n = plan ? parseIssueLines(plan.issues || '').length : 0;
      return `<article class="dash-ready-item">
        <div class="dash-ready-top"><b>${escapeHtml(label)}</b><span>Installer built ${escapeHtml(formatDate(s.date))}</span></div>
        <div class="dash-ready-vers">${versionPill('fe', 'FE', s.fe)}${versionPill('v2', 'V2', s.v2)}${versionPill('v3', 'V3', s.v3)}</div>
        <div class="dash-ready-foot">
          <span>${n ? `${n} issue${n === 1 ? '' : 's'} in this update` : 'No issues listed'}</span>
          <button type="button" class="btn btn-primary btn-sm" onclick="copySummary('${escapeHtml(s.id)}')">Copy for WhatsApp</button>
        </div>
      </article>`; }).join('')}</div>
    ${behind > 0 ? `<p class="dash-ready-sites"><span>${behind} client site${behind === 1 ? ' is' : 's are'} still behind the latest version.</span><button type="button" class="dash-link" onclick="switchView('sites')">Client Versions</button></p>` : ''}`;
}

/* Settings → What's New: older entries live in /changelog-older.html and load on first open */
let olderAsked = false;
async function loadOlderChangelog(){
  const box = $('changelogOlder');
  if(!box || olderAsked) return;
  olderAsked = true;
  try {
    const r = await fetch(box.dataset.src, { cache: 'no-cache' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    box.outerHTML = await r.text();
  } catch(_){ olderAsked = false; }
}

function initV5(){
  mirror('countTesterAll', 'hubTesterCount');
  mirror('countStatusNew', 'hubIssueCount');
  document.querySelectorAll('.dash-att-value').forEach(countUp);
  const sites = $('countSites');
  if(sites) new MutationObserver(() => { try { renderDashReady(); } catch(_){} }).observe(sites, { childList: true, characterData: true, subtree: true });
}

export { initV5, loadOlderChangelog, renderDashReady, readySummaryIds, planStage, stageChip, versionPill };
