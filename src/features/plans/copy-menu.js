/**
 * Plan card expand + copy dropdown
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { State } from '../../core/state.js';
import { formatDate, parseIssueLines, toast } from '../../core/helpers.js';
import { enrichPlanIssueCategories, renderPlans } from './plans.js';

/* ============================================================
   EXPAND/COLLAPSE PLAN CARD
   ============================================================ */
window.__expandedPlans = window.__expandedPlans || new Set();

async function togglePlanCard(planId, event){
  if(event){
    event.stopPropagation();
  }
  if(window.__expandedPlans.has(planId)){
    window.__expandedPlans.delete(planId);
    renderPlans();
    return;
  }
  window.__expandedPlans.add(planId);
  renderPlans(); // expand immediately
  const plan = State.plans.get(planId);
  if(plan){
    const updated = await enrichPlanIssueCategories(plan);
    if(updated) renderPlans(); // refresh labels from Redmine category cache
  }
}

/* ============================================================
   COPY DROPDOWN
   ============================================================ */
function buildCopyText(plan, format){
  const parsed = parseIssueLines(plan.issues);
  const title = plan.title || 'Update Plan';
  const dateStr = formatDate(plan.date);

  if(format === 'plain') {
    return parsed.map(p => p.url).join('\n');
  }

  if(format === 'numbered'){
    let out = `${title}\n`;
    out += `Date: ${dateStr}\n`;
    out += `Total: ${parsed.length} issues\n\n`;
    parsed.forEach((p, i)=>{
      const num = p.number || '—';
      out += `${i+1}. [#${num}] ${p.url}\n`;
    });
    return out.trim();
  }

  if(format === 'markdown'){
    let out = `*${title}*\n`;
    out += `_${dateStr} · ${parsed.length} issues_\n\n`;
    parsed.forEach((p)=>{
      const num = p.number || '—';
      out += `• [#${num}](${p.url})\n`;
    });
    return out.trim();
  }

  if(format === 'telegram-links'){
    // SDET: links only ("**" = bold when sent in Telegram)
    let out = `📋 **${title}**\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${parsed.length} issues\n\n`;
    parsed.forEach((p)=>{ out += `${p.url}\n`; });
    return out.trim();
  }

  if(format === 'telegram-full' || format === 'telegram'){
    // Link + description
    let out = `📋 **${title}**\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${parsed.length} issues\n\n`;
    parsed.forEach((p)=>{
      out += `${p.url}\n`;
      if(p.description) out += `${p.description}\n`;
      out += `\n`;
    });
    return out.trim();
  }

  return parsed.map(p => p.url).join('\n');
}

/* Rich version for Telegram: pasted into Telegram Desktop/Web it keeps the
 * bold title and clickable links (plain text is the fallback elsewhere). */
function buildCopyHtml(plan, format){
  if(format !== 'telegram-links' && format !== 'telegram-full' && format !== 'telegram') return '';
  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const parsed = parseIssueLines(plan.issues);
  const full = format !== 'telegram-links';
  let html = `📋 <b>${esc(plan.title || 'Update Plan')}</b><br>📅 ${esc(formatDate(plan.date))}<br>🔢 ${parsed.length} issues<br><br>`;
  parsed.forEach(p => {
    html += `<a href="${esc(p.url)}">${esc(p.url)}</a><br>`;
    if(full && p.description) html += `${esc(p.description)}<br>`;
    if(full) html += '<br>';
  });
  return html;
}

/* Copy that works on every browser: a synchronous copy inside the click
 * (keeps formatting), then the Clipboard API, and if both are blocked a
 * box with the text selected so it can be copied by hand.
 * The old code reported "copied" even when the fallback silently failed. */
function copyRichSync(text, html){
  // Put exactly our plain text + HTML on the clipboard via the copy event
  // (synchronous, inside the click, so no permission prompt is needed).
  let fired = false;
  const onCopy = (e) => {
    fired = true;
    e.clipboardData.setData('text/plain', text);
    if(html) e.clipboardData.setData('text/html', html);
    e.preventDefault();
  };
  const ta = document.createElement('textarea');
  ta.value = text || ' ';
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  document.addEventListener('copy', onCopy, true);
  let ok = false;
  try { ta.focus(); ta.select(); ok = document.execCommand('copy'); } catch(_){ ok = false; }
  document.removeEventListener('copy', onCopy, true);
  ta.remove();
  return ok && fired;
}

async function copyTextSmart(text, html){
  if(copyRichSync(text, html)) return true;
  try {
    if(html && window.ClipboardItem && navigator.clipboard?.write){
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      })]);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch(_){ return false; }
}

function showManualCopy(text){
  document.getElementById('manualCopyBox')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'manualCopyBox';
  wrap.className = 'manual-copy';
  wrap.innerHTML = `<div class="manual-copy-card" role="dialog" aria-label="Copy manually">
      <b>Your browser blocked copying</b>
      <p>The text is selected below: press <kbd>Ctrl</kbd>+<kbd>C</kbd> (or long-press → Copy), then close.</p>
      <textarea class="input" readonly rows="10"></textarea>
      <div class="manual-copy-actions"><button type="button" class="btn btn-primary btn-sm">Close</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const ta = wrap.querySelector('textarea');
  ta.value = text; ta.focus(); ta.select();
  const close = () => wrap.remove();
  wrap.querySelector('button').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if(e.target === wrap) close(); });
}

async function copyPlan(id, format){
  const plan = State.plans.get(id);
  if(!plan){ toast('Plan not found', 'error'); return; }
  const text = buildCopyText(plan, format);
  if(!text){ toast('No content to copy', 'error'); return; }

  const formatLabels = {
    plain: 'Plain URLs',
    numbered: 'Numbered list',
    markdown: 'Markdown links',
    telegram: 'Telegram (link + desc)',
    'telegram-links': 'Telegram (links only)',
    'telegram-full': 'Telegram (link + desc)'
  };

  closeAllCopyMenus();
  const ok = await copyTextSmart(text, buildCopyHtml(plan, format));
  if(ok) toast(`${formatLabels[format]} copied — ready to paste`);
  else showManualCopy(text);
}

function toggleCopyMenu(btn, event){
  if(event){
    event.stopPropagation();
    if(event.preventDefault) event.preventDefault();
  }

  const wrapper = btn.closest('.copy-menu-wrap');
  if(!wrapper) return;

  const planId = btn.getAttribute('data-plan-id');
  const menu = wrapper.querySelector('.copy-menu');
  const card = btn.closest('.plan-card');
  const isOpen = menu.classList.contains('open');

  if(isOpen && window.__openCopyMenuId === planId){
    closeAllCopyMenus();
    return;
  }

  closeAllCopyMenus();
  menu.classList.add('open');
  btn.classList.add('active');
  wrapper.classList.add('is-open');
  if(card) card.classList.add('menu-open');
  window.__openCopyMenuId = planId;
  placeCopyMenu(btn, menu);
}

/* The plan card clips its content (overflow:hidden), which cut the menu off
 * below the "Copy for Telegram" button so its items couldn't be clicked.
 * Pin the menu to the viewport instead, under the button — or above it when
 * there isn't room below. (v4.51.1) */
function placeCopyMenu(btn, menu){
  const r = btn.getBoundingClientRect();
  const gap = 6, margin = 8;
  menu.style.position = 'fixed';
  menu.style.maxHeight = '';
  menu.style.overflowY = '';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin);
  const below = window.innerHeight - r.bottom - gap - margin;
  const above = r.top - gap - margin;
  let top;
  if(h <= below) top = r.bottom + gap;
  else if(h <= above) top = r.top - gap - h;
  else if(below >= above){ top = r.bottom + gap; menu.style.maxHeight = `${below}px`; menu.style.overflowY = 'auto'; }
  else { top = margin; menu.style.maxHeight = `${above}px`; menu.style.overflowY = 'auto'; }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

// a viewport-pinned menu would drift away from its button: close it on scroll / resize
if(!window.__copyMenuScrollWired){
  window.__copyMenuScrollWired = true;
  const closeIfOpen = (e) => {
    if(!window.__openCopyMenuId) return;
    if(e && e.target && e.target.closest && e.target.closest('.copy-menu')) return;   // scrolling inside the menu
    closeAllCopyMenus();
  };
  window.addEventListener('scroll', closeIfOpen, true);
  window.addEventListener('resize', closeIfOpen);
}

function closeAllCopyMenus(){
  document.querySelectorAll('.copy-menu.open').forEach(m => {
    m.classList.remove('open');
    ['position', 'left', 'top', 'maxHeight', 'overflowY'].forEach(k => { m.style[k] = ''; });
  });
  document.querySelectorAll('.copy-menu-wrap .btn.active').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.copy-menu-wrap.is-open').forEach(w => w.classList.remove('is-open'));
  document.querySelectorAll('.plan-card.menu-open').forEach(c => c.classList.remove('menu-open'));
  window.__openCopyMenuId = null;
}

function restoreOpenCopyMenu(){
  const openId = window.__openCopyMenuId;
  if(!openId) return;

  const btn = document.querySelector(`.copy-menu-wrap .btn[data-plan-id="${openId}"]`);
  if(!btn){ window.__openCopyMenuId = null; return; }

  const wrapper = btn.closest('.copy-menu-wrap');
  const menu = wrapper?.querySelector('.copy-menu');
  const card = btn.closest('.plan-card');
  if(menu){
    menu.classList.add('open');
    btn.classList.add('active');
    wrapper.classList.add('is-open');
    if(card) card.classList.add('menu-open');
  }
}

document.addEventListener('click', (e) => {
  if(e.target.closest('.copy-menu-wrap')) return;
  closeAllCopyMenus();
});

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){
    closeAllCopyMenus();
  }
});

export {
  copyTextSmart,
  closeAllCopyMenus,
  copyPlan,
  restoreOpenCopyMenu,
  toggleCopyMenu,
  togglePlanCard
};
