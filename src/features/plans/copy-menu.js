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
    // SDET: links only
    let out = `📋 *${title}*\n`;
    out += `📅 ${dateStr}\n`;
    out += `🔢 ${parsed.length} issues\n\n`;
    parsed.forEach((p)=>{ out += `${p.url}\n`; });
    return out.trim();
  }

  if(format === 'telegram-full' || format === 'telegram'){
    // Link + description
    let out = `📋 *${title}*\n`;
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

  try {
    await navigator.clipboard.writeText(text);
    toast(`${formatLabels[format]} copied — ready to paste`);
  } catch(e){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(`${formatLabels[format]} copied`);
    } catch(err){
      toast('Failed to copy', 'error');
    }
    ta.remove();
  }
  closeAllCopyMenus();
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
}

function closeAllCopyMenus(){
  document.querySelectorAll('.copy-menu.open').forEach(m => m.classList.remove('open'));
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
  closeAllCopyMenus,
  copyPlan,
  restoreOpenCopyMenu,
  toggleCopyMenu,
  togglePlanCard
};
