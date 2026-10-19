/**
 * Client Report — summary (v4.66.0)
 *
 * One page per client for a PM, not a list of issue cards:
 *   - totals: all / done / in progress / not started (New)
 *   - status donut + progress per topic
 *   - not-started list and in-progress list (id, subject, assignee),
 *     done work summarised per topic
 *   - highlights written from the data (backlog, ageing, assignee load)
 * Topics come from the Redmine category when most issues have one, otherwise
 * from words the subjects share ("cost code", "uang muka", "psak 109" …).
 * Download as PNG / copy as image for WhatsApp, copy as text, or export CSV.
 * English throughout, like the rest of the app.
 */
import { $, escapeHtml, toast } from '../core/helpers.js';
import { writeClipboard } from '../core/clipboard.js';
import { groupOf, itemStatus, listCounts, REQUEST_STATUS } from './report-status.js';
export { groupOf };

/* Client requests come in through a setter so this module never imports Firebase:
   the app plugs in client-requests.js, the public page (/r/<token>) plugs in the lists
   the server sent. */
let requestSource = () => [];
export function setRequestSource(fn){ requestSource = typeof fn === 'function' ? fn : () => []; }

const REDMINE = 'https://pjm.zahironline.com/issues/';
const H2C_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const TOPIC_COLORS = ['#4f46e5', '#7c3aed', '#0284c7', '#c026d3', '#0d9488', '#db2777', '#64748b'];   // theme family; last = "other"
const MAX_TOPICS = 6;
const LIST_MAX = 10;        // not-started rows shown per topic
const DONE_MAX = 4;         // done titles shown per topic
const OLD_DAYS = 182;       // "older than 6 months"

const state = { mode: 'auto',      // auto | topic | category | tracker | product
  open: new Set(),                  // lists expanded with "+N more"
  all: false,                       // "Show all" in the toolbar
  full: false,                      // image export: everything, no buttons
  public: false };                  // v4.71.0: shared page for the client (no Redmine links, no internal tools)
/** v4.71.0: the public report page turns this on (and may set the grouping the link was made with). */
export function setReportPublic(on, mode){ state.public = !!on; if(mode && MODE_LABEL[mode]) state.mode = mode; }
const isOpen = (key) => state.full || state.all || state.open.has(key);
function moreBtn(key, hidden, li){
  if(state.full) return '';
  const tag = li ? 'li' : 'div';
  const k = escapeHtml(JSON.stringify(key));
  if(hidden > 0) return `<${tag} class="rs-more"><button type="button" class="rs-more-btn" onclick="toggleClientReportMore(${k})">+${hidden} more</button></${tag}>`;
  if(state.open.has(key) && !state.all) return `<${tag} class="rs-more"><button type="button" class="rs-more-btn" onclick="toggleClientReportMore(${k})">Show less</button></${tag}>`;
  return '';
}

/* ---------------- status buckets ---------------- */
/* The CURRENT status decides. closed_on is not used: Redmine keeps it when an
   issue is reopened, so a reopened issue (e.g. back In Progress) read as done (v4.69.4). */

/* ---------------- dates ---------------- */
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BULAN_PANJANG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function tgl(iso, long){
  const d = new Date(iso); if(!iso || isNaN(d)) return '';
  return `${d.getDate()} ${(long ? BULAN_PANJANG : BULAN)[d.getMonth()]} ${d.getFullYear()}`;
}
function ageDays(iso){ const t = new Date(iso).getTime(); return isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86400000); }

/* ---------------- topics ---------------- */
const STOP = new Set(('lap laporan report reports fe be di dan yang tidak tdk untuk utk pada dengan dgn ke dari saat ada belum bisa dapat data filter menu error bug gagal muncul tampil ' +
  'menampilkan tampilkan ditampilkan perbaikan perbaiki enhancement request req penambahan tambah tambahkan menambahkan field kolom button tombol dialog form list detail rincian per by the of on in ' +
  'for and to a an is zahir erp online v1 v2 v3 issue masih harus agar jika ketika sudah akan atau juga sebagai seperti terjadi nilai baru lama semua pada saat sesuai tidak muncul new ' +
  'implementasi implementation desain design mohon minta permintaan custom update hasil proses fitur feature menjadi dibagi jumlah sisi').split(/\s+/));
const ACRONYM = new Set(['psak', 'opz', 'coa', 'ppn', 'pph', 'api', 'csv', 'pdf', 'pos', 'hpp', 'sku', 'baz', 'po', 'so', 'do', 'dp', 'ar', 'ap', 'gl', 'bpjs', 'npwp', 'efaktur', 'spt']);
function words(subject){
  return String(subject || '').toLowerCase()
    .replace(/^\s*\[?(fe|be)\]?\s*[-:]\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
function keep(w){ return !STOP.has(w) && (w.length >= 3 || ACRONYM.has(w)) && !/^\d+$/.test(w); }
function termsOf(subject){
  const w = words(subject), out = new Set();
  for(let i = 0; i < w.length; i++){
    if(keep(w[i]) && w[i].length >= 4) out.add(w[i]);
    const a = w[i], b = w[i + 1];
    if(!b) continue;
    if((keep(a) && keep(b)) || (keep(a) && /^\d{2,4}$/.test(b))) out.add(a + ' ' + b);   // "uang muka", "psak 109"
  }
  return out;
}
const titleCase = (t) => t.split(' ').map(x => ACRONYM.has(x) ? x.toUpperCase() : /^\d+$/.test(x) ? x : x[0].toUpperCase() + x.slice(1)).join(' ');

/* Greedy: the term shared by most remaining issues becomes a topic (two-word terms preferred). */
function topicsFromSubjects(issues){
  const min = issues.length >= 15 ? 3 : 2;
  const termSets = new Map(issues.map(i => [i, termsOf(i.subject)]));
  const left = new Set(issues);
  const topics = [];
  while(topics.length < MAX_TOPICS && left.size){
    const count = new Map();
    left.forEach(i => termSets.get(i).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
    let best = null, bestScore = 0;
    count.forEach((n, t) => {
      if(n < min) return;
      const score = n * (t.includes(' ') ? 1.6 : 1);
      if(score > bestScore){ best = t; bestScore = score; }
    });
    if(!best) break;
    const members = [...left].filter(i => termSets.get(i).has(best));
    members.forEach(i => left.delete(i));
    topics.push({ name: titleCase(best), issues: members });
  }
  if(left.size) topics.push({ name: topics.length ? 'Other' : 'All issues', issues: [...left], other: true });
  return topics;
}

function topicsBy(issues, keyFn, emptyLabel){
  const map = new Map();
  issues.forEach(i => { const k = keyFn(i) || emptyLabel; if(!map.has(k)) map.set(k, []); map.get(k).push(i); });
  const list = [...map.entries()].map(([name, iss]) => ({ name, issues: iss, other: name === emptyLabel }))
    .sort((a, b) => (a.other - b.other) || b.issues.length - a.issues.length);
  if(list.length <= MAX_TOPICS + 1) return list;
  const head = list.filter(t => !t.other).slice(0, MAX_TOPICS);
  const rest = list.filter(t => !head.includes(t)).flatMap(t => t.issues);
  return [...head, { name: 'Other', issues: rest, other: true }];
}

function effectiveMode(issues){
  if(state.mode !== 'auto') return state.mode;
  const withCat = issues.filter(i => i.category && i.category.name).length;
  return withCat >= issues.length * 0.6 ? 'category' : 'topic';
}
function buildTopics(issues, mode){
  if(mode === 'category') return topicsBy(issues, i => i.category?.name, 'No category');
  if(mode === 'tracker') return topicsBy(issues, i => i.tracker?.name, 'Other');
  if(mode === 'product') return topicsBy(issues, i => i.project?.name, 'Other');
  return topicsFromSubjects(issues);
}

/* ---------------- model ---------------- */
function buildModel(clientName, issues){
  const mode = effectiveMode(issues);
  const topics = buildTopics(issues, mode).map((t, n) => {
    const by = { todo: [], doing: [], done: [] };
    t.issues.forEach(i => by[groupOf(i)].push(i));
    by.todo.sort((a, b) => String(a.created_on).localeCompare(String(b.created_on)));
    by.doing.sort((a, b) => String(b.updated_on).localeCompare(String(a.updated_on)));
    by.done.sort((a, b) => String(b.closed_on || b.updated_on).localeCompare(String(a.closed_on || a.updated_on)));
    return { ...t, color: t.other ? TOPIC_COLORS[TOPIC_COLORS.length - 1] : TOPIC_COLORS[n % (TOPIC_COLORS.length - 1)], by, total: t.issues.length };
  });
  const all = { todo: [], doing: [], done: [] };
  issues.forEach(i => all[groupOf(i)].push(i));
  const statusCount = (list) => {
    const m = new Map(); list.forEach(i => { const s = i.status?.name || '—'; m.set(s, (m.get(s) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const created = issues.map(i => i.created_on).filter(Boolean).sort();
  const products = [...new Set(issues.map(i => i.project?.name).filter(Boolean))];
  return { clientName, issues, mode, topics, all, total: issues.length, created, products,
    doneStatus: statusCount(all.done), doingStatus: statusCount(all.doing) };
}

const pct = (a, b) => b ? Math.round(a * 100 / b) : 0;

function highlights(m){
  const out = [];
  const { todo, doing, done } = m.all;
  if(m.requests && m.requests.length){
    const c = m.requests.map(listCounts).reduce((a, x) => { Object.keys(x).forEach(k => a[k] = (a[k] || 0) + x[k]); return a; }, {});
    out.push(`Client requests: ${c.done} of ${c.active} point${c.active === 1 ? '' : 's'} (${pct(c.done, c.active)}%) are done, ${c.doing} in progress, ${c.todo} not started` + (c.missing ? `; ${c.missing} point${c.missing === 1 ? ' has' : 's have'} no Redmine issue yet.` : '.'));
  }
  const backlog = m.topics.filter(t => t.by.todo.length).sort((a, b) => b.by.todo.length - a.by.todo.length);
  let s = `${done.length} of ${m.total} issues (${pct(done.length, m.total)}%) are done`;
  if(backlog.length) s += `; the biggest New backlog${backlog[1] ? 's are' : ' is'} ${backlog[0].name} (${backlog[0].by.todo.length})` + (backlog[1] ? ` and ${backlog[1].name} (${backlog[1].by.todo.length})` : '') + '.';
  else s += '; nothing is waiting to be started.';
  out.push(s);
  if(doing.length) out.push(`${doing.length} issue${doing.length === 1 ? '' : 's'} in progress: ${m.doingStatus.map(([k, n]) => `${k} ${n}`).join(', ')}.`);
  if(todo.length){
    const old = todo.filter(i => ageDays(i.created_on) > OLD_DAYS).length;
    const newest = todo.map(i => i.created_on).filter(Boolean).sort().pop();
    const sameDay = newest ? todo.filter(i => String(i.created_on).slice(0, 10) === newest.slice(0, 10)).length : 0;
    out.push(`Ageing: ${old} of ${todo.length} New issues are older than 6 months` + (newest ? `; the newest was created ${tgl(newest)}${sameDay > 1 ? ` (${sameDay} issues that day)` : ''}.` : '.'));
    const by = new Map(); let none = [];
    todo.forEach(i => { const a = i.assigned_to?.name; if(!a) none.push(i); else by.set(a, (by.get(a) || 0) + 1); });
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    let a = top ? `Assignee load: ${top[1]} of ${todo.length} New issues are with ${top[0]}` : 'Assignee load: no New issue has an assignee yet';
    if(none.length) a += `${top ? ', and ' : '; '}${none.length} issue${none.length === 1 ? ' has' : 's have'} no assignee (${none.slice(0, 4).map(i => '#' + i.id).join(', ')}${none.length > 4 ? ', …' : ''})`;
    out.push(a + '.');
  }
  const recent = done.filter(i => i.closed_on && ageDays(i.closed_on) <= 30).length;
  if(recent) out.push(`${recent} issue${recent === 1 ? '' : 's'} finished in the last 30 days.`);
  return out;
}

/* ---------------- render ---------------- */
function donut(m){
  const r = 52, c = 2 * Math.PI * r;
  const css = getComputedStyle(document.body);
  const v = (name, fb) => (css.getPropertyValue(name) || '').trim() || fb;
  const parts = [['done', v('--success', '#059669')], ['doing', v('--warning', '#d97706')], ['todo', v('--danger', '#dc2626')]];
  let offset = 0;
  const arcs = parts.map(([k, color]) => {
    const n = m.all[k].length; if(!n) return '';
    const len = c * n / m.total, gap = m.total > n ? 2 : 0;
    const arc = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="22" stroke-dasharray="${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"/>`;
    offset += len; return arc;
  }).join('');
  return `<div class="rs-donut-wrap"><svg width="170" height="170" viewBox="0 0 140 140" class="rs-donut" role="img" aria-label="${pct(m.all.done.length, m.total)}% done">
    <circle cx="70" cy="70" r="${r}" fill="none" class="rs-donut-track" stroke-width="22"/>${arcs}
    <text x="70" y="70" text-anchor="middle" class="rs-donut-pct">${pct(m.all.done.length, m.total)}%</text>
    <text x="70" y="90" text-anchor="middle" class="rs-donut-sub">done</text></svg></div>`;
}

function bars(m){
  const max = Math.max(1, ...m.topics.map(t => t.total));
  return m.topics.map(t => {
    const seg = (k, cls) => { const n = t.by[k].length; return n ? `<span class="rs-seg ${cls}" style="flex:${n}">${n * 100 / max >= 7 ? n : ''}</span>` : ''; };
    return `<div class="rs-bar-row">
      <div class="rs-bar-label"><b>${escapeHtml(t.name)}</b><small>${t.total} issue${t.total === 1 ? '' : 's'} | ${pct(t.by.done.length, t.total)}% done</small></div>
      <div class="rs-bar-track"><div class="rs-bar" style="width:${t.total * 100 / max}%">${seg('done', 'is-done')}${seg('doing', 'is-doing')}${seg('todo', 'is-todo')}</div></div>
    </div>`;
  }).join('');
}

const idLink = (i) => state.public ? `<span class="rs-id">#${i.id}</span>` : `<a class="rs-id" href="${REDMINE}${i.id}" target="_blank" rel="noopener">#${i.id}</a>`;
const topicHead = (t, right) => `<div class="rs-topic"><i style="background:${t.color}"></i><b style="color:${t.color}">${escapeHtml(t.name)}</b><span>${right}</span></div>`;

function todoList(m){
  const ts = m.topics.filter(t => t.by.todo.length);
  if(!ts.length) return '<p class="rs-none">Nothing waiting to be started.</p>';
  return ts.map(t => { const key = 'todo:' + t.name, n = isOpen(key) ? t.by.todo.length : LIST_MAX;
    return topicHead(t, `${t.by.todo.length} issue${t.by.todo.length === 1 ? '' : 's'}`) + t.by.todo.slice(0, n).map(i => `<div class="rs-row">
      ${idLink(i)}<span class="rs-subj">${escapeHtml(i.subject || '—')}</span>
      <span class="rs-who${i.assigned_to ? '' : ' is-none'}">${escapeHtml(i.assigned_to?.name || 'No assignee')}</span></div>`).join('')
    + moreBtn(key, t.by.todo.length - n, false); }).join('');
}

function doingList(m){
  if(!m.all.doing.length) return '<p class="rs-none">Nothing in progress.</p>';
  const n = isOpen('doing') ? m.all.doing.length : 12;
  return m.all.doing.slice().sort((a, b) => String(b.updated_on).localeCompare(String(a.updated_on))).slice(0, n).map(i => `<div class="rs-row rs-row-doing">
      ${idLink(i)}<span class="rs-subj">${escapeHtml(i.subject || '—')}<em class="rs-chip">${escapeHtml(i.status?.name || '')}${i.done_ratio ? ` · ${i.done_ratio}%` : ''}</em></span>
      <span class="rs-who${i.assigned_to ? '' : ' is-none'}">${escapeHtml(i.assigned_to?.name || 'No assignee')}</span></div>`).join('')
    + moreBtn('doing', m.all.doing.length - n, false);
}

function doneList(m){
  const ts = m.topics.filter(t => t.by.done.length);
  if(!ts.length) return '<p class="rs-none">Nothing finished yet.</p>';
  return ts.map(t => { const key = 'done:' + t.name, n = isOpen(key) ? t.by.done.length : DONE_MAX;
    return `<div class="rs-done-block">${topicHead(t, `<em class="rs-done-pill">${t.by.done.length} done</em>`)}
      <ul class="rs-done-list">${t.by.done.slice(0, n).map(i => `<li>${state.public ? `<span class="rs-done-id">#${i.id}</span>` : `<a class="rs-done-id" href="${REDMINE}${i.id}" target="_blank" rel="noopener">#${i.id}</a>`} ${escapeHtml(i.subject || '—')}</li>`).join('')}
      ${moreBtn(key, t.by.done.length - n, true)}</ul></div>`; }).join('');
}

/* the client's own request list(s), point by point (v4.69.0) */
const REQ_MAX = 8;
let reqListening = false;
function requestsSection(m){
  const lists = m.requests || [];
  if(!lists.length) return '';
  return `<section class="rs-card rs-req"><div class="rs-card-head"><h3>Client requests</h3><span class="rs-req-legend">${['done', 'doing', 'todo', 'missing'].map(k => `<span class="rq-status ${REQUEST_STATUS[k].cls}">${REQUEST_STATUS[k].label}</span>`).join('')}</span></div>
    ${lists.map(l => {
      const c = listCounts(l), key = 'req:' + l.id, items = l.items || [], n = isOpen(key) ? items.length : REQ_MAX;
      return `<div class="rs-req-list">
        <div class="rs-req-head"><b>${escapeHtml(l.title || 'Requests')}</b><small>${l.receivedAt ? `received ${escapeHtml(tgl(l.receivedAt))} · ` : ''}${c.done} of ${c.active} done (${pct(c.done, c.active)}%)${c.missing ? ` · ${c.missing} no issue yet` : ''}</small></div>
        ${items.slice(0, n).map(it => { const st = itemStatus(it); return `<div class="rs-req-row">
          <span class="rs-req-no">${escapeHtml(it.no || '')}</span>
          <span class="rs-req-text">${escapeHtml(it.text || '')}${it.note ? `<small>${escapeHtml(it.note)}</small>` : ''}</span>
          <span class="rs-req-ids">${(it.issueIds || []).map(id => `#${escapeHtml(String(id))}`).join(' ')}</span>
          <span class="rq-status ${REQUEST_STATUS[st].cls}">${REQUEST_STATUS[st].label}</span></div>`; }).join('')}
        ${moreBtn(key, items.length - n, false)}
      </div>`; }).join('')}
  </section>`;
}

const MODE_LABEL = { auto: 'Auto', topic: 'Topic (from subjects)', category: 'Redmine category', tracker: 'Tracker', product: 'Product' };

function paper(m){
  const { todo, doing, done } = m.all;
  const today = tgl(new Date().toISOString(), true);
  const range = m.created.length ? `Created ${tgl(m.created[0])} - ${tgl(m.created[m.created.length - 1])}` : '';
  const prod = m.products.length ? m.products.map(p => escapeHtml(p)).join(', ') : '—';
  const kpi = (cls, label, n, sub) => `<div class="rs-kpi ${cls}"><span>${label}</span><b>${n}</b><small>${sub}</small></div>`;
  const legend = `<div class="rs-legend"><span><i class="is-done"></i>Done</span><span><i class="is-doing"></i>In progress</span><span><i class="is-todo"></i>Not started (New)</span></div>`;
  const statusLine = (list) => list.map(([k, n]) => `${escapeHtml(k)} ${n}`).join(', ') || '—';
  return `<div class="rs-paper" id="clientReportPaper">
    <header class="rs-top">
      <div><h2>${escapeHtml(m.clientName)} — Report Summary</h2><p>Issue progress | Product: ${prod} | Data as of ${today}</p></div>
      <div class="rs-top-right"><b>${m.total} issue${m.total === 1 ? '' : 's'}</b><p>${range}</p></div>
    </header>
    <div class="rs-content">
      <div class="rs-kpis">
        ${kpi('is-total', 'Total issues', m.total, 'all statuses')}
        ${kpi('is-done', 'Done', done.length, `${pct(done.length, m.total)}% of total`)}
        ${kpi('is-doing', 'In progress', doing.length, escapeHtml(m.doingStatus.map(([k]) => k).slice(0, 3).join(' & ') || '—'))}
        ${kpi('is-todo', 'Not started', todo.length, 'status New')}
      </div>
      <div class="rs-grid-2 rs-charts">
        <section class="rs-card rs-comp"><h3>Status Breakdown</h3>${donut(m)}</section>
        <section class="rs-card"><div class="rs-card-head"><h3>Progress by ${m.mode === 'category' ? 'Category' : m.mode === 'tracker' ? 'Tracker' : m.mode === 'product' ? 'Product' : 'Topic'}</h3>${legend}</div>${bars(m)}</section>
      </div>
      ${requestsSection(m)}
      <div class="rs-grid-2">
        <section>
          <div class="rs-band is-todo"><span>Not started (status New)</span><b>${todo.length} issue${todo.length === 1 ? '' : 's'}</b></div>
          <div class="rs-card rs-list">${todoList(m)}</div>
        </section>
        <section>
          <div class="rs-band is-doing"><span>In progress</span><b>${doing.length} issue${doing.length === 1 ? '' : 's'}</b></div>
          <div class="rs-card rs-list">${doingList(m)}</div>
          <div class="rs-band is-done"><span>Done</span><b>${done.length} issue${done.length === 1 ? '' : 's'}</b></div>
          <div class="rs-card rs-list">${doneList(m)}</div>
        </section>
      </div>
      <section class="rs-high"><h3>${state.public ? 'Highlights' : 'Highlights for the PM'}</h3><ul>${highlights(m).map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul></section>
      <p class="rs-foot">Source: Redmine (pjm.zahironline.com) | Done = ${statusLine(m.doneStatus)} | In progress = ${statusLine(m.doingStatus)} | Not started = New ${todo.length}</p>
    </div>
  </div>`;
}

export function renderClientReport(el, clientName, issues){
  window.__clientReportCtx = { clientName, issues };
  if(!el) return;
  const m = buildModel(clientName, issues);
  m.requests = requestSource(clientName) || [];
  window.__clientReportModel = m;
  if(!reqListening){ reqListening = true; window.addEventListener('requests:updated', (e) => { const c = window.__clientReportCtx; if(c && e.detail?.client === c.clientName && $('clientReportPaper')) rerender(); }); }
  el.innerHTML = `<div class="rs-toolbar">
      <label class="rs-mode">Group by
        <select class="select" onchange="setClientReportGroup(this.value)">${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}"${state.mode === k ? ' selected' : ''}>${v}${k === 'auto' ? ` (${MODE_LABEL[m.mode].split(' ')[0].toLowerCase()})` : ''}</option>`).join('')}</select>
      </label>
      <div class="rs-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="toggleClientReportAll()">${state.all ? 'Collapse lists' : 'Show all issues'}</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="downloadClientReportPng()">Download image</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="copyClientReportImage()">Copy image</button>
        ${state.public ? '' : `<button type="button" class="btn btn-secondary btn-sm" onclick="copyClientReport()">Copy text</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="exportClientReport()">Export CSV</button>
        <button type="button" class="btn btn-secondary btn-sm" data-perm="edit" onclick="openReportShare()">Share link</button>`}
      </div>
    </div>
    ${state.public ? '' : '<div id="reportSharePanel" class="rs-share hidden"></div>'}
    <div class="rs-scroll">${paper(m)}</div>`;
  if(!state.public) afterRender();
}
let afterRender = () => {};
/** report-share.js redraws its panel after each render (the toolbar is rebuilt). */
export function setReportAfterRender(fn){ afterRender = typeof fn === 'function' ? fn : () => {}; }
export const getReportMode = () => state.mode;

function rerender(){
  const ctx = window.__clientReportCtx, host = $('clientReportBody');
  if(ctx && host) renderClientReport(host, ctx.clientName, ctx.issues);
}
export function setClientReportGroup(mode){ state.mode = MODE_LABEL[mode] ? mode : 'auto'; state.open.clear(); rerender(); }
export function toggleClientReportMore(key){
  if(state.open.has(key)) state.open.delete(key); else state.open.add(key);
  const y = window.scrollY; rerender(); window.scrollTo(0, y);
}
export function toggleClientReportAll(){ state.all = !state.all; if(!state.all) state.open.clear(); const y = window.scrollY; rerender(); window.scrollTo(0, y); }
export function toggleClientReportDone(){ rerender(); }   // kept for old links; the summary covers every issue

/* ---------------- image ---------------- */
let h2cPromise = null;
function loadHtml2Canvas(){
  if(window.html2canvas) return Promise.resolve(window.html2canvas);
  if(!h2cPromise){
    h2cPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = H2C_URL; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas missing'));
      s.onerror = () => { h2cPromise = null; reject(new Error('Could not load the image tool (check the connection)')); };
      document.head.appendChild(s);
    });
  }
  return h2cPromise;
}
/* The image always holds every issue: lists are drawn in full for the capture, then put back. */
async function reportBlob(){
  if(!$('clientReportPaper')) throw new Error('Open the Report tab first');
  const h2c = await loadHtml2Canvas();
  const y = window.scrollY;
  state.full = true; rerender();
  try {
    const node = $('clientReportPaper');
    await new Promise(r => requestAnimationFrame(() => r()));
    const canvas = await h2c(node, { scale: 2, backgroundColor: getComputedStyle(node).backgroundColor || '#ffffff', useCORS: true, logging: false, windowWidth: node.scrollWidth });
    return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Image failed')), 'image/png'));
  } finally {
    state.full = false; rerender(); window.scrollTo(0, y);
  }
}
function fileName(ext){
  const ctx = window.__clientReportCtx || { clientName: 'client' };
  return `report-summary-${ctx.clientName.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
export async function downloadClientReportPng(){
  try {
    toast('Making the image…');
    const blob = await reportBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName('png'); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('Image downloaded');
  } catch(err){ toast(err.message || 'Could not make the image', 'error'); }
}
export async function copyClientReportImage(){
  try {
    if(!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('This browser can’t copy images — use Download image');
    // Safari needs the promise passed straight to ClipboardItem
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': reportBlob() })]);
    toast('Image copied, paste it in WhatsApp / Telegram');
  } catch(err){ toast(err.message || 'Could not copy the image', 'error'); }
}

/* ---------------- text / CSV ---------------- */
function reportText(){
  const m = window.__clientReportModel;
  if(!m) return '';
  const { todo, doing, done } = m.all;
  let out = `📋 *${m.clientName} — Report Summary*\n📅 Data as of ${tgl(new Date().toISOString(), true)}\n`;
  out += `${m.total} issues · ✅ ${done.length} done (${pct(done.length, m.total)}%) · 🔧 ${doing.length} in progress · ⏳ ${todo.length} not started\n`;
  out += `\n*Progress by ${m.mode === 'category' ? 'category' : 'topic'}*\n`;
  m.topics.forEach(t => { out += `• ${t.name}: ${t.by.done.length}/${t.total} done${t.by.doing.length ? `, ${t.by.doing.length} in progress` : ''}${t.by.todo.length ? `, ${t.by.todo.length} not started` : ''}\n`; });
  if(doing.length){ out += `\n*🔧 In progress (${doing.length})*\n`; doing.forEach(i => { out += `• #${i.id} ${i.subject} [${i.status?.name || ''}]\n`; }); }
  if(todo.length){ out += `\n*⏳ Not started (${todo.length})*\n`; todo.forEach(i => { out += `• #${i.id} ${i.subject}${i.assigned_to ? ` (${i.assigned_to.name})` : ''}\n`; }); }
  if(done.length){ out += `\n*✅ Done (${done.length})*\n`; m.topics.filter(t => t.by.done.length).forEach(t => { out += `_${t.name}_\n`; t.by.done.forEach(i => { out += `• #${i.id} ${i.subject}\n`; }); }); }
  (m.requests || []).forEach(l => {
    const c = listCounts(l);
    out += `\n*📝 Client requests — ${l.title || 'Requests'}* (${c.done}/${c.active} done)\n`;
    (l.items || []).forEach(it => { const st = itemStatus(it); out += `${it.no ? it.no + '. ' : '• '}${it.text} — ${REQUEST_STATUS[st].label}${(it.issueIds || []).length ? ` (${it.issueIds.map(x => '#' + x).join(', ')})` : ''}\n`; });
  });
  out += `\n*Highlights*\n${highlights(m).map(h => `• ${h}`).join('\n')}`;
  return out.trim();
}
export async function copyClientReport(){
  const text = reportText();
  if(!text) return;
  try { await writeClipboard(text); toast('Summary copied, ready to paste'); } catch(_){}
}
export function exportClientReport(){
  const m = window.__clientReportModel;
  if(!m) return;
  const label = { todo: 'Not started', doing: 'In progress', done: 'Done' };
  const rows = [['Group', 'Topic', 'Issue', 'Subject', 'Status', 'Product', 'Assignee', 'Created', 'Updated', 'Closed', 'Link']];
  m.topics.forEach(t => ['todo', 'doing', 'done'].forEach(k => t.by[k].forEach(i => rows.push([label[k], t.name, i.id, i.subject, i.status?.name || '', i.project?.name || '', i.assigned_to?.name || '',
    tgl(i.created_on), tgl(i.updated_on), tgl(i.closed_on), `${REDMINE}${i.id}`]))));
  (m.requests || []).forEach(l => (l.items || []).forEach(it => rows.push(['Client request', l.title || '', (it.issueIds || []).join(' '), `${it.no ? it.no + '. ' : ''}${it.text}`, REQUEST_STATUS[itemStatus(it)].label, '', '', l.receivedAt || '', '', '', it.note || ''])));
  const cell = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = fileName('csv'); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${rows.length - 1} issue(s)`);
}

export function resetClientReport(){ /* nothing cached any more (progress notes are no longer loaded) */ }
