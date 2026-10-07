/**
 * Client Report (v4.55.0)
 *
 * For one client: every request grouped by progress —
 *   Done (Resolved / Closed), In progress (In Progress, Ready for Testing,
 *   Feedback, Rework, On Deploy, …), Not started (New) —
 * with what was asked (from the issue description) and the latest progress
 * note from Redmine. Done items default to the last 90 days.
 * Copy as text (WhatsApp / Telegram) or export a CSV that opens in Excel.
 */
import { $, escapeHtml, toast } from '../core/helpers.js';
import { fetchRedmine } from '../redmine/client.js';
import { writeClipboard } from '../core/clipboard.js';

const GROUPS = [
  { key: 'todo',  label: 'Not started',  icon: '⏳', hint: 'New' },
  { key: 'doing', label: 'In progress',  icon: '🔧', hint: 'In Progress, Ready for Testing, Feedback, Rework, On Deploy' },
  { key: 'done',  label: 'Done',         icon: '✅', hint: 'Resolved, Closed' }
];
const DONE_DAYS = 90;
const REDMINE = 'https://pjm.zahironline.com/issues/';

const state = { showAllDone: false, journals: new Map(), loading: false };

function groupOf(issue){
  const n = String(issue.status?.name || '').toLowerCase();
  if(/^new$|^baru$/.test(n)) return 'todo';
  if(issue.closed_on || issue.status?.is_closed || /resolved|closed|fixed|done|selesai|rejected|cancel|duplicate/.test(n)) return 'done';
  return 'doing';
}

function finishedAt(issue){ return issue.closed_on || issue.updated_on || ''; }

function daysAgo(iso){
  if(!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}
function ago(iso){
  const d = daysAgo(iso);
  if(d == null) return '';
  if(d <= 0) return 'today';
  if(d === 1) return 'yesterday';
  if(d < 30) return `${d} days ago`;
  const m = Math.round(d / 30);
  return m < 12 ? `${m} month${m > 1 ? 's' : ''} ago` : `${Math.round(d / 365)} year(s) ago`;
}
function shortDate(iso){
  if(!iso) return '';
  const d = new Date(iso); if(isNaN(d)) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

/* Markdown / Textile → plain text */
function plain(text){
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // md images
    .replace(/![^\s!]+\.(png|jpe?g|gif|webp)(\([^)]*\))?!/gi, '')   // textile images
    .replace(/<\/?[^>]+>/g, '')
    .replace(/^\s*h[1-6]\.\s*/gim, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/"([^"]+)":https?:\S+/g, '$1')
    .replace(/@([^@\n]+)@/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* What was asked: the QA format's Actual / Expected / Summary sections when
 * present, otherwise the first lines of the description. */
function requestSummary(issue){
  const text = plain(issue.description);
  if(!text) return '';
  const sec = (re) => {
    const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:${re})\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*[A-Z][A-Za-z /]{2,30}:?\\s*\\n|$)`, 'i'));
    return m ? m[1].replace(/^\s*(?:[-*•]|\d+[.)])\s*/gm, '').trim() : '';
  };
  const parts = [];
  const summary = sec('summary|deskripsi masalah|deskripsi|feature overview|ringkasan');
  const actual = sec('actual results?|hasil saat ini|current (?:condition|behavior)');
  const expected = sec('expected results?|hasil yang diharapkan|harapan|requirements?|kebutuhan|proposed behavior');
  if(summary) parts.push(summary);
  if(actual) parts.push('Now: ' + actual.replace(/\n+/g, '; '));
  if(expected) parts.push('Wanted: ' + expected.replace(/\n+/g, '; '));
  let out = parts.length ? parts.join('\n') : text;
  out = out.replace(/^\s*[-*•]\s*/gm, '').replace(/\n{2,}/g, '\n');
  return out.length > 360 ? out.slice(0, 357).replace(/\s+\S*$/, '') + '…' : out;
}

function lastNote(id){
  const j = state.journals.get(String(id));
  return j && j.notes && j.notes[0] ? j.notes[0] : null;
}

/* ---- data: latest progress notes, loaded in batches when the report opens ---- */
async function loadJournals(issues, rerender){
  const key = (i) => `${i.id}@${i.updated_on || ''}`;
  let cached = {};
  try { cached = JSON.parse(sessionStorage.getItem('erp_client_journals_v1') || '{}'); } catch(_){}
  issues.forEach(i => { if(cached[key(i)]) state.journals.set(String(i.id), cached[key(i)]); });
  const missing = issues.filter(i => !state.journals.has(String(i.id)));
  if(!missing.length || state.loading) return;
  state.loading = true;
  rerender();
  try {
    for(let i = 0; i < missing.length; i += 40){
      const batch = missing.slice(i, i + 40);
      const { data } = await fetchRedmine(`/api/redmine?resource=journals&ids=${batch.map(x => x.id).join(',')}`, { force: true });
      Object.entries((data && data.journals) || {}).forEach(([id, j]) => {
        if(j && !j.error){
          state.journals.set(id, j);
          const iss = batch.find(x => String(x.id) === id);
          if(iss) cached[key(iss)] = j;
        }
      });
      try { sessionStorage.setItem('erp_client_journals_v1', JSON.stringify(cached)); } catch(_){}
      rerender();
    }
  } catch(err){
    console.warn('client report journals', err);
    toast('Could not load progress notes from Redmine', 'error');
  } finally {
    state.loading = false;
    rerender();
  }
}

/* issues → { todo, doing, done, hiddenDone } */
function buildGroups(issues){
  const g = { todo: [], doing: [], done: [] };
  let hiddenDone = 0;
  issues.forEach(i => {
    const k = groupOf(i);
    if(k === 'done' && !state.showAllDone){
      const d = daysAgo(finishedAt(i));
      if(d != null && d > DONE_DAYS){ hiddenDone++; return; }
    }
    g[k].push(i);
  });
  g.todo.sort((a, b) => String(a.created_on).localeCompare(String(b.created_on)));            // oldest waiting first
  g.doing.sort((a, b) => String(b.updated_on).localeCompare(String(a.updated_on)));
  g.done.sort((a, b) => String(finishedAt(b)).localeCompare(String(finishedAt(a))));
  return { ...g, hiddenDone };
}

function card(i, groupKey){
  const note = lastNote(i.id);
  const req = requestSummary(i);
  const full = plain(i.description);
  const who = i.assigned_to?.name || 'Unassigned';
  const prod = String(i.project?.name || '').replace(/^Zahir\s+/i, '');
  const pct = i.done_ratio != null && groupKey === 'doing' && i.done_ratio > 0 ? ` · ${i.done_ratio}%` : '';
  const when = groupKey === 'done' ? `done ${ago(finishedAt(i))}`
    : groupKey === 'todo' ? `waiting since ${shortDate(i.created_on)}` : `updated ${ago(i.updated_on)}`;
  return `<article class="cr-card">
    <header class="cr-card-head">
      <a class="cr-id" href="${REDMINE}${i.id}" target="_blank" rel="noopener">#${i.id}</a>
      <h4 class="cr-subject">${escapeHtml(i.subject || '—')}</h4>
    </header>
    <div class="cr-meta"><span class="cr-status">${escapeHtml(i.status?.name || '')}${pct}</span><span>${escapeHtml(prod)}</span><span>${escapeHtml(who)}</span><span>${escapeHtml(when)}</span></div>
    <div class="cr-block">
      <span class="cr-label">Request</span>
      <p class="cr-text">${req ? escapeHtml(req) : '<i class="cr-empty">No description in Redmine</i>'}</p>
      ${full && full.length > req.length + 20 ? `<details class="cr-more"><summary>Full description</summary><div class="cr-full">${escapeHtml(full)}</div></details>` : ''}
    </div>
    <div class="cr-block">
      <span class="cr-label">Latest progress</span>
      ${note
        ? `<p class="cr-text">${escapeHtml(note.text.length > 400 ? note.text.slice(0, 397) + '…' : note.text)}</p><span class="cr-note-by">${escapeHtml(note.by)} · ${escapeHtml(shortDate(note.at))}</span>`
        : `<p class="cr-text"><i class="cr-empty">${state.journals.has(String(i.id)) ? 'No notes yet' : (state.loading ? 'Loading…' : '—')}</i></p>`}
    </div>
  </article>`;
}

function renderInto(el, clientName, issues){
  const g = buildGroups(issues);
  const total = g.todo.length + g.doing.length + g.done.length;
  const sections = GROUPS.map(G => {
    const items = g[G.key];
    const extra = G.key === 'done' && (g.hiddenDone || state.showAllDone)
      ? `<button type="button" class="cr-toggle" onclick="toggleClientReportDone()">${state.showAllDone ? `Show only the last ${DONE_DAYS} days` : `Show ${g.hiddenDone} older`}</button>` : '';
    return `<section class="cr-group cr-group-${G.key}">
      <h3 class="cr-group-title"><span aria-hidden="true">${G.icon}</span> ${G.label} <span class="cr-count">${items.length}</span>
        <small>${escapeHtml(G.hint)}${G.key === 'done' && !state.showAllDone ? ` · last ${DONE_DAYS} days` : ''}</small>${extra}</h3>
      ${items.length ? `<div class="cr-cards">${items.map(i => card(i, G.key)).join('')}</div>` : '<p class="cr-none">Nothing here.</p>'}
    </section>`;
  }).join('');
  el.innerHTML = `
    <div class="cr-head">
      <div class="cr-summary">
        <b>${escapeHtml(clientName)}</b>: ${total} request${total === 1 ? '' : 's'} ·
        <span class="cr-s-done">${g.done.length} done</span> ·
        <span class="cr-s-doing">${g.doing.length} in progress</span> ·
        <span class="cr-s-todo">${g.todo.length} not started</span>
        ${state.loading ? '<span class="cr-loading">loading progress notes…</span>' : ''}
      </div>
      <div class="cr-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="copyClientReport()">Copy for WhatsApp / Telegram</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="exportClientReport()">Export Excel (CSV)</button>
      </div>
    </div>
    ${sections}`;
  return g;
}

export function renderClientReport(el, clientName, issues){
  window.__clientReportCtx = { clientName, issues };
  const g = renderInto(el, clientName, issues);
  loadJournals([...g.todo, ...g.doing, ...g.done], () => {
    const ctx = window.__clientReportCtx;
    const host = $('clientReportBody');
    if(ctx && host && host.isConnected){
      // keep open "Full description" panels and scroll position
      const open = [...host.querySelectorAll('details[open]')].map(d => d.closest('.cr-card')?.querySelector('.cr-id')?.textContent);
      renderInto(host, ctx.clientName, ctx.issues);
      host.querySelectorAll('.cr-card').forEach(c => { if(open.includes(c.querySelector('.cr-id')?.textContent)) c.querySelector('details')?.setAttribute('open', ''); });
    }
  });
}

export function toggleClientReportDone(){
  state.showAllDone = !state.showAllDone;
  const ctx = window.__clientReportCtx;
  const host = $('clientReportBody');
  if(ctx && host) renderClientReport(host, ctx.clientName, ctx.issues);
}

/* ---- copy / export ---- */
function reportText(){
  const ctx = window.__clientReportCtx;
  if(!ctx) return '';
  const g = buildGroups(ctx.issues);
  const total = g.todo.length + g.doing.length + g.done.length;
  const d = new Date();
  let out = `📋 **Laporan ${ctx.clientName}**\n📅 ${shortDate(d.toISOString())}\n${total} permintaan · ${g.done.length} selesai · ${g.doing.length} dikerjakan · ${g.todo.length} belum\n`;
  const titles = { done: '✅ Selesai', doing: '🔧 Sedang dikerjakan', todo: '⏳ Belum dikerjakan' };
  ['done', 'doing', 'todo'].forEach(k => {
    if(!g[k].length) return;
    out += `\n**${titles[k]} (${g[k].length})**\n`;
    g[k].forEach((i, n) => {
      out += `${n + 1}. #${i.id} ${i.subject} [${i.status?.name || ''}]\n`;
      const note = lastNote(i.id);
      if(note && k !== 'todo') out += `   ↳ ${note.text.replace(/\s+/g, ' ').slice(0, 160)}\n`;
    });
  });
  return out.trim();
}

export async function copyClientReport(){
  const text = reportText();
  if(!text) return;
  try { await writeClipboard(text); toast('Report copied, ready to paste'); } catch(_){}
}

export function exportClientReport(){
  const ctx = window.__clientReportCtx;
  if(!ctx) return;
  const all = [...ctx.issues].sort((a, b) => ['todo', 'doing', 'done'].indexOf(groupOf(a)) - ['todo', 'doing', 'done'].indexOf(groupOf(b)));
  const rows = [['Group', 'Issue', 'Subject', 'Status', 'Product', 'Assignee', 'Request', 'Latest progress', 'Progress by', 'Progress date', 'Created', 'Updated', 'Closed', 'Link']];
  const label = { todo: 'Not started', doing: 'In progress', done: 'Done' };
  all.forEach(i => {
    const n = lastNote(i.id);
    rows.push([label[groupOf(i)], i.id, i.subject, i.status?.name || '', i.project?.name || '', i.assigned_to?.name || '',
      requestSummary(i), n ? n.text : '', n ? n.by : '', n ? shortDate(n.at) : '',
      shortDate(i.created_on), shortDate(i.updated_on), shortDate(i.closed_on), `${REDMINE}${i.id}`]);
  });
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report-${ctx.clientName.replace(/[^\w]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${all.length} issue(s)`);
}

export function resetClientReport(){ state.journals.clear(); state.showAllDone = false; }
