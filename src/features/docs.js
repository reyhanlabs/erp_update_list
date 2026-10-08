/**
 * Documentation view — in-app feature guide (v4.41.0)
 * Content is static HTML in index.html (#view-docs); this module wires up
 * search, table-of-contents scroll-spy, section icons and "open this view" buttons.
 */
import { $ } from '../core/helpers.js';
import { switchView, openPlansWithSync } from '../ui/navigation.js';
import { openTesterCategory } from './tester/categories.js';
import { openIssueStatusView } from './issue-status.js';
import { openCreateIssueView } from './create-issue.js';
import { openWhatNextView } from './what-next.js';
import { openClientsView } from './clients.js';
import { openNotesView } from './notes.js';
import { openGlobalSearch } from './global-search.js';
import { openActiveWorkView } from './active-work.js';

/* Icons: reuse the sidebar's own SVG where the feature has a menu item,
 * so the guide and the navigation look like the same thing. */
const SIDEBAR_ICON_FROM = {
  dashboard: '.nav-item[data-view="dashboard"] svg',
  plans: '.nav-item[data-view="plans"] svg',
  summaries: '.nav-item[data-view="summaries"] svg',
  tester: '.nav-item[data-view="tester"] svg',
  status: '.nav-item[data-issue-status="progress"] svg',
  whatnext: '.nav-item[data-view="whatnext"] svg',
  clients: '.nav-item[data-view="clients"] svg',
  newissue: '.nav-item[data-view="createissue"] svg',
  account: '.nav-item[data-view="settings"] svg',
  kb: '.nav-item[data-view="kb"] svg'
};
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const EXTRA_ICONS = {
  account: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  workspace: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>'),
  look: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  pwa: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  sync: svg('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>'),
  activework: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>'),
  lists: svg('<path d="M3 6h18"/><path d="M6 12h12"/><path d="M10 18h4"/>'),
  telegram: svg('<path d="M21.5 4.5 2.5 11.8l6.7 2.4 2.4 6.8 3.6-5 5.1 3.7z"/><path d="m9.2 14.2 6.8-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  backup: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  faq: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>')
};

/* "Buka …" buttons → the real view */
const GO = {
  dashboard: () => switchView('dashboard'),
  plans: () => switchView('plans'),
  sync: () => openPlansWithSync(),
  summaries: () => switchView('summaries'),
  tester: () => openTesterCategory('all'),
  status: () => openIssueStatusView('new'),
  activework: () => openActiveWorkView(),
  whatnext: () => openWhatNextView(),
  clients: () => openClientsView(),
  createissue: () => openCreateIssueView(),
  notes: () => openNotesView(),
  search: () => openGlobalSearch(),
  settings: () => switchView('settings'),
  kb: () => switchView('kb'),
  sites: () => switchView('sites')
};

let wired = false;
let spy = null;

function scroller(){
  return document.querySelector('.content') || document.scrollingElement;
}

function scrollToSection(id){
  const el = document.getElementById(id);
  if(!el) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Scroll only the content pane. scrollIntoView() would also scroll the
  // overflow:hidden ancestors (.main / body) and shift the whole layout.
  const sc = scroller();
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 12;
  sc.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  setActiveToc(id);
}

function setActiveToc(id){
  document.querySelectorAll('.docs-toc a').forEach(a => {
    a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
  });
}

function fillIcons(){
  document.querySelectorAll('#view-docs [data-docs-icon]').forEach(slot => {
    if(slot.firstChild) return;
    const key = slot.dataset.docsIcon;
    const sel = SIDEBAR_ICON_FROM[key];
    const src = sel ? document.querySelector('.sidebar ' + sel) : null;
    if(src && key !== 'account'){
      const c = src.cloneNode(true);
      c.removeAttribute('class');
      c.setAttribute('aria-hidden', 'true');
      slot.appendChild(c);
    } else if(EXTRA_ICONS[key]){
      slot.innerHTML = EXTRA_ICONS[key];
    }
  });
}

function filterDocs(q){
  const needle = String(q || '').toLowerCase().trim();
  const sections = [...document.querySelectorAll('#view-docs .docs-sec')];
  let shown = 0;
  sections.forEach(sec => {
    const hay = (sec.textContent + ' ' + (sec.dataset.keywords || '')).toLowerCase();
    const hit = !needle || needle.split(/\s+/).every(w => hay.includes(w));
    sec.classList.toggle('hidden', !hit);
    if(hit) shown++;
    // open matching FAQ answers so the hit is visible
    if(needle && hit) sec.querySelectorAll('details').forEach(d => {
      d.open = d.textContent.toLowerCase().includes(needle);
    });
    const link = document.querySelector(`.docs-toc a[href="#${sec.id}"]`);
    if(link) link.classList.toggle('is-dim', !hit);
  });
  // hide group headings with no visible sections after them
  document.querySelectorAll('#view-docs [data-docs-group]').forEach(h => {
    let n = h.nextElementSibling, any = false;
    while(n && !n.hasAttribute('data-docs-group')){
      if(n.classList.contains('docs-sec') && !n.classList.contains('hidden')){ any = true; break; }
      n = n.nextElementSibling;
    }
    h.classList.toggle('hidden', !any);
  });
  document.querySelector('#view-docs .docs-flow')?.classList.toggle('hidden', !!needle);
  $('docsEmpty')?.classList.toggle('hidden', shown > 0);
}

function startScrollSpy(){
  if(spy || !('IntersectionObserver' in window)) return;
  const root = scroller();
  spy = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if(visible[0]) setActiveToc(visible[0].target.id);
  }, { root: root === document.scrollingElement ? null : root, rootMargin: '0px 0px -65% 0px', threshold: 0 });
  document.querySelectorAll('#view-docs .docs-sec').forEach(s => spy.observe(s));
}

function wireDocs(){
  if(wired) return;
  const view = $('view-docs');
  if(!view) return;
  wired = true;
  fillIcons();

  view.addEventListener('click', (e) => {
    const go = e.target.closest('[data-docs-go]');
    if(go){
      e.preventDefault();
      const fn = GO[go.dataset.docsGo];
      if(fn) fn();
      return;
    }
    const jump = e.target.closest('[data-docs-jump], .docs-toc a');
    if(jump){
      e.preventDefault();
      const id = jump.dataset.docsJump || (jump.getAttribute('href') || '').slice(1);
      if(id) scrollToSection(id);
    }
  });

  const input = $('docsSearch');
  if(input){
    input.addEventListener('input', () => filterDocs(input.value));
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && input.value){
        e.stopPropagation();
        input.value = '';
        filterDocs('');
      }
    });
  }
  startScrollSpy();
}

function openDocsView(){
  switchView('docs');
}

/* Called by switchView('docs') */
function onDocsShown(){
  wireDocs();
}

export { openDocsView, onDocsShown };
