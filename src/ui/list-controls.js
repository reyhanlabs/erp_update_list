/**
 * Quick filters, density, nav counts, persisted filters
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { $, escapeHtml } from '../core/helpers.js';
import { renderPlans } from '../features/plans/plans.js';
import { formatAssignee, priorityClass, renderTesterList } from '../features/tester/queue.js';
import { renderNewIssues } from '../features/new-issues.js';
import { renderActiveWork } from '../features/active-work.js';
import { daysSince, renderWhatNext } from '../features/what-next.js';

/* ============================================================
   G) QUICK FILTER CHIPS + H) DENSITY MODE
   ============================================================ */
window.__quickFilter = window.__quickFilter || 'all'; // all | immediate | unassigned | updated7d

function setQuickFilter(key, renderFn){
  window.__quickFilter = key || 'all';
  document.querySelectorAll('.quick-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.quick === window.__quickFilter);
  });
  try { savePersistedFilters({ quickFilter: window.__quickFilter }); } catch(_){}
  if(typeof renderFn === 'function') renderFn();
  else {
    try { renderTesterList(); } catch(_){}
    try { renderNewIssues(); } catch(_){}
    try { renderActiveWork(); } catch(_){}
    try { renderWhatNext(); } catch(_){}
  }
}

function matchesQuickFilter(issue){
  const qf = window.__quickFilter || 'all';
  if(qf === 'all') return true;
  if(qf === 'immediate'){
    return (typeof priorityClass === 'function' ? priorityClass(issue.priority?.name) : '') === 'pri-immediate';
  }
  if(qf === 'unassigned'){
    const name = (typeof formatAssignee === 'function') ? formatAssignee(issue.assigned_to) : (issue.assigned_to?.name || '');
    return !issue.assigned_to || name === 'Unassigned';
  }
  if(qf === 'updated7d'){
    const days = (typeof daysSince === 'function') ? daysSince(issue.updated_on || issue.created_on) : 999;
    return days <= 7;
  }
  return true;
}

function quickFilterBarHtml(renderCall){
  const qf = window.__quickFilter || 'all';
  const chips = [
    ['all', 'All'],
    ['immediate', 'Immediate'],
    ['unassigned', 'Unassigned'],
    ['updated7d', 'Updated 7d']
  ];
  return `<div class="quick-filter-bar">
    ${chips.map(([k, label]) =>
      `<button type="button" class="quick-chip${qf === k ? ' active' : ''}" data-quick="${k}"
        onclick="setQuickFilter('${k}', ${renderCall})">${label}</button>`
    ).join('')}
  </div>`;
}

/* H) Density */
function getListDensity(){
  try { return localStorage.getItem('erp_list_density') || 'comfortable'; } catch(_){ return 'comfortable'; }
}
function setListDensity(mode){
  const m = mode === 'compact' ? 'compact' : 'comfortable';
  try { localStorage.setItem('erp_list_density', m); } catch(_){}
  document.documentElement.setAttribute('data-density', m);
  document.querySelectorAll('.density-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.density === m);
  });
}
function densityToggleHtml(){
  const m = getListDensity();
  return `<div class="density-toggle" title="Row density">
    <button type="button" class="density-chip${m === 'comfortable' ? ' active' : ''}" data-density="comfortable" onclick="setListDensity('comfortable')">Comfortable</button>
    <button type="button" class="density-chip${m === 'compact' ? ' active' : ''}" data-density="compact" onclick="setListDensity('compact')">Compact</button>
  </div>`;
}
function applyDensityOnBoot(){
  document.documentElement.setAttribute('data-density', getListDensity());
}


function setNavCount(idOrEl, n){
  const el = typeof idOrEl === 'string' ? $(idOrEl) : idOrEl;
  if(!el) return;
  const v = (n == null || n === '' || n === '—') ? '—' : String(n);
  el.textContent = v;
  const num = parseInt(v, 10);
  el.dataset.zero = (!isNaN(num) && num === 0) || v === '—' ? '1' : '0';
}

function emptyState(iconSvg, title, desc, actions){
  const btns = (actions || []).map(a =>
    `<button type="button" class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="${a.action}">${escapeHtml(a.label)}</button>`
  ).join('');
  return `<div class="empty">
    <div class="empty-icon">${iconSvg}</div>
    <h4>${escapeHtml(title)}</h4>
    <p>${escapeHtml(desc)}</p>
    ${btns ? `<div class="empty-actions">${btns}</div>` : ''}
  </div>`;
}


/* ============================================================
   PERSISTED FILTERS
   ============================================================ */
const FILTER_STORE_KEY = 'erp_ui_filters_v1';
function loadPersistedFilters(){
  try {
    return JSON.parse(localStorage.getItem(FILTER_STORE_KEY) || '{}') || {};
  } catch(_){ return {}; }
}
function savePersistedFilters(patch){
  try {
    const cur = loadPersistedFilters();
    const next = { ...cur, ...patch };
    localStorage.setItem(FILTER_STORE_KEY, JSON.stringify(next));
  } catch(_){}
}
function applyPersistedFiltersToDom(){
  const f = loadPersistedFilters();
  if(f.planFilter) window.__planFilter = f.planFilter;
  if(f.planSearch && $('planSearch')) $('planSearch').value = f.planSearch;
  if(f.planProject && $('planProjectFilter')) $('planProjectFilter').value = f.planProject;
  if(f.planSort && $('planSort')) $('planSort').value = f.planSort;
  if(f.testerProject && $('testerProjectFilter')) $('testerProjectFilter').value = f.testerProject;
  if(f.testerCategory) window.__testerCategory = f.testerCategory;
  // New issues / active work filters if present
  ['niDateFrom','niDateTo','niStatus','niPriority','niProject',
   'awDateFrom','awDateTo','awStatus','awPriority','awProject'].forEach(id => {
    if(f[id] != null && $(id)) $(id).value = f[id];
  });
}
function wireFilterPersistence(){
  const map = [
    ['planSearch', 'planSearch', () => renderPlans()],
    ['planProjectFilter', 'planProject', () => renderPlans()],
    ['planSort', 'planSort', () => renderPlans()],
    ['testerProjectFilter', 'testerProject', () => renderTesterList()],
  ];
  map.forEach(([id, key, cb]) => {
    const el = $(id);
    if(!el || el.dataset.persistWired) return;
    el.dataset.persistWired = '1';
    el.addEventListener('change', () => { savePersistedFilters({ [key]: el.value }); cb && cb(); });
    el.addEventListener('input', () => { savePersistedFilters({ [key]: el.value }); });
  });
}


/* ============================================================
   LIST COVERAGE NOTE (v4.43.3)
   Explains why a list shows fewer rows than its sidebar count:
   active filters, or Redmine holding more issues than were loaded.
   ============================================================ */
function clockTime(ms){
  const d = new Date(ms || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function activeFilterLabels(extra){
  const out = [...(extra || [])];
  const qf = window.__quickFilter || 'all';
  const qfNames = { immediate: 'Immediate', unassigned: 'Unassigned', updated7d: 'Updated 7d' };
  if(qf !== 'all' && qfNames[qf]) out.push(qfNames[qf]);
  return out;
}

function renderListCoverage(elId, { matching, loaded, remote, filters, clearAction }){
  const el = $(elId);
  if(!el) return;
  const parts = [];
  if(matching < loaded){
    const f = (filters || []).length ? ` (filter: ${filters.map(escapeHtml).join(', ')})` : '';
    parts.push(`<span>Showing <b>${matching}</b> of <b>${loaded}</b> issues${f}.</span>
      <button type="button" class="list-coverage-clear" onclick="${clearAction}">Clear filters</button>`);
  }
  if(remote && remote > loaded){
    parts.push(`<span>Redmine has <b>${remote}</b> issues here; the latest <b>${loaded}</b> are loaded.</span>`);
  }
  el.innerHTML = parts.join('<span class="list-coverage-sep" aria-hidden="true"></span>');
  el.classList.toggle('hidden', !parts.length);
}

export {
  activeFilterLabels,
  clockTime,
  renderListCoverage,
  applyDensityOnBoot,
  emptyState,
  matchesQuickFilter,
  savePersistedFilters,
  setListDensity,
  setNavCount,
  setQuickFilter
};
