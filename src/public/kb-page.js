/**
 * Knowledge Base — /k/<token> (v5.7.0)
 * Either the whole library (list + search, a guide opens in place) or a single guide.
 * No Firebase, no sign-in: data from /api/report-share?k=<token>[&a=<id>].
 */
import { escapeHtml } from '../core/helpers.js';
import { renderMarkdown } from '../core/markdown.js';

const host = document.getElementById('kbBody');
const token = (location.pathname.match(/^\/k\/([A-Za-z0-9_-]{20,64})\/?$/) || [])[1] || new URLSearchParams(location.search).get('k') || '';
const PRODUCTS = { erp: 'Zahir ERP', one: 'Zahir ERP One', mfg: 'Manufacturing', mrp: 'Zahir MRP' };
const K = { scope: '', articles: [], article: null, q: '', product: 'all', cache: new Map(), busy: false };

const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const prodLabel = (p) => PRODUCTS[p] || p || '';

function fail(msg){
  host.innerHTML = `<div class="pr-state"><p><b>${escapeHtml(msg)}</b></p><p class="pr-muted">Ask the Zahir ERP team for a new link if you need this page.</p></div>`;
}
async function get(params){
  const r = await fetch(`/api/report-share?k=${encodeURIComponent(token)}${params || ''}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error || 'This page is not available.');
  return d;
}

function matches(a){
  if(K.product !== 'all' && a.product !== K.product) return false;
  const q = K.q.trim().toLowerCase();
  if(!q) return true;
  return `${a.title} ${a.summary || ''} ${a.module || ''} ${a.submenu || ''} ${a.client || ''} ${(a.tags || []).join(' ')}`.toLowerCase().includes(q);
}

function listHtml(){
  const list = K.articles.filter(matches);
  const products = [...new Set(K.articles.map(a => a.product).filter(Boolean))];
  const groups = new Map();
  list.forEach(a => { const g = `${prodLabel(a.product)} · ${a.module || 'Other'}`; if(!groups.has(g)) groups.set(g, []); groups.get(g).push(a); });
  return `
    <div class="kbp-toolbar">
      <div class="up-search"><span aria-hidden="true">⌕</span><input class="input" id="kbpSearch" type="search" value="${escapeHtml(K.q)}" placeholder="Search a guide, module or tag…" oninput="kbpSearch(this.value)" autocomplete="off" aria-label="Search"></div>
      <div class="up-stage" role="group" aria-label="Product">
        ${[['all', 'All'], ...products.map(p => [p, prodLabel(p)])].map(([k, l]) => `<button type="button" class="up-stage-btn${K.product === k ? ' is-active' : ''}" aria-pressed="${K.product === k}" onclick="kbpProduct('${escapeHtml(k)}')">${escapeHtml(l)}</button>`).join('')}
      </div>
      <span class="kbp-count">${list.length} of ${K.articles.length} guide${K.articles.length === 1 ? '' : 's'}</span>
    </div>
    ${list.length ? [...groups].map(([g, items]) => `
      <section class="kbp-group">
        <h3>${escapeHtml(g)}</h3>
        ${items.map(a => `<button type="button" class="kbp-row" onclick="kbpOpen('${escapeHtml(a.id)}')">
          <span class="kbp-row-main"><b>${escapeHtml(a.title || 'Untitled')}</b>${a.summary ? `<small>${escapeHtml(a.summary)}</small>` : ''}</span>
          <span class="kbp-row-meta">${a.submenu ? `<span class="kbp-tag">${escapeHtml(a.submenu)}</span>` : ''}${a.version ? `<span class="kbp-tag">${escapeHtml(a.version)}</span>` : ''}<small>${escapeHtml(fmtDate(a.updatedAt))}</small></span>
        </button>`).join('')}
      </section>`).join('') : '<div class="pr-state"><p>No guide matches that search.</p></div>'}`;
}

function articleHtml(a, withBack){
  const meta = [
    a.client ? `<span>Client <b>${escapeHtml(a.client)}</b></span>` : '',
    a.version ? `<span>Applies to <b>${escapeHtml(a.version)}</b></span>` : '',
    a.updatedAt ? `<span>Updated ${escapeHtml(fmtDate(a.updatedAt))}${a.updatedBy ? ` by ${escapeHtml(a.updatedBy)}` : ''}</span>` : ''
  ].filter(Boolean).join('');
  return `
    <article class="kbp-article">
      ${withBack ? '<button type="button" class="kbp-back" onclick="kbpBack()">← All guides</button>' : ''}
      <p class="kbp-crumb">${escapeHtml(prodLabel(a.product))}${a.module ? ` › ${escapeHtml(a.module)}` : ''}${a.submenu ? ` › ${escapeHtml(a.submenu)}` : ''}</p>
      <h2 class="kbp-title">${escapeHtml(a.title || 'Untitled')}</h2>
      ${a.summary ? `<p class="kbp-lede">${escapeHtml(a.summary)}</p>` : ''}
      ${meta ? `<p class="kbp-meta">${meta}</p>` : ''}
      ${(a.tags || []).length ? `<p class="kbp-tags">${a.tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      <div class="md-body kbp-md">${renderMarkdown(a.content || '')}</div>
    </article>`;
}

/* the renderer leaves kbimg: references as <img data-kbimg="…"> — fill them from the payload */
function fillImages(images){
  host.querySelectorAll('img[data-kbimg]').forEach(img => {
    const d = images && images[img.dataset.kbimg];
    if(d) img.src = d; else img.closest('figure')?.classList.add('md-figure-missing');
  });
}

function render(){
  if(K.article){ host.innerHTML = articleHtml(K.article, K.scope === 'all'); fillImages(K.article.images); window.scrollTo(0, 0); return; }
  const active = document.activeElement && document.activeElement.id === 'kbpSearch';
  const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  host.innerHTML = listHtml();
  if(active){ const el = document.getElementById('kbpSearch'); if(el){ el.focus(); try { el.setSelectionRange(sel[0], sel[1]); } catch(_){} } }
}

async function openArticle(id){
  if(K.busy) return;
  if(K.cache.has(id)){ K.article = K.cache.get(id); render(); return; }
  K.busy = true;
  host.innerHTML = '<div class="pr-state"><div class="pr-spin"></div><p>Loading the guide…</p></div>';
  try {
    const d = await get('&a=' + encodeURIComponent(id));
    K.cache.set(id, d.article); K.article = d.article;
  } catch(err){ fail(err.message); K.busy = false; return; }
  K.busy = false;
  render();
}

let searchTimer = null;
Object.assign(window, {
  kbpSearch(v){ K.q = String(v || ''); clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); },
  kbpProduct(p){ K.product = p; render(); },
  kbpOpen(id){ history.replaceState(null, '', location.pathname + location.search + '#' + id); openArticle(id); },
  kbpBack(){ K.article = null; history.replaceState(null, '', location.pathname + location.search); render(); }
});

(async function load(){
  if(!token){ fail('This link is incomplete.'); return; }
  let d;
  try { d = await get(''); }
  catch(err){ fail(err.message); return; }
  K.scope = d.scope;
  const meta = document.getElementById('prMeta');
  if(d.scope === 'one'){
    K.article = d.article;
    if(meta) meta.innerHTML = '<span class="pr-live"><i></i>Live</span>';
    render();
    return;
  }
  K.articles = d.articles || [];
  if(meta) meta.innerHTML = `<span class="pr-live"><i></i>Live</span><span>${K.articles.length} guide${K.articles.length === 1 ? '' : 's'}</span>`;
  const want = location.hash.replace('#', '');
  if(want && K.articles.some(a => a.id === want)) openArticle(want); else render();
})();
