/**
 * DOM, formatting & issue-parsing helpers
 * (split from the former monolithic src/app.js — v4.40.0)
 */

/* ============================================================
   HELPERS
   ============================================================ */
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const todayISO = () => new Date().toISOString().split('T')[0];

function toast(msg, type='info'){
  const t = $('toast');
  if(!t) return;
  const icons = {
    error: '✕',
    success: '✓',
    info: 'ℹ'
  };
  const icon = icons[type] || icons.info;
  t.className = 'toast show' + (type === 'error' ? ' error' : type === 'success' ? ' success' : type === 'info' ? ' info' : '');
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  clearTimeout(window.__toastTimer);
  const ms = type === 'error' ? 5200 : type === 'success' ? 3800 : 3200;
  window.__toastTimer = setTimeout(() => { t.classList.remove('show'); }, ms);
}

/** Disable button + show loading label while async work runs */
async function withBusy(btn, label, fn){
  if(!btn) return fn();
  const prev = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('is-busy');
  if(label) btn.innerHTML = `<span class="spinner-sm"></span> ${escapeHtml(label)}`;
  try {
    return await fn();
  } finally {
    btn.disabled = wasDisabled;
    btn.classList.remove('is-busy');
    btn.innerHTML = prev;
  }
}

function formatDate(iso){
  if(!iso) return '-';
  if(typeof iso === 'object' && iso.seconds){
    iso = new Date(iso.seconds * 1000).toISOString().split('T')[0];
  }
  if(typeof iso !== 'string' || !iso.includes('-')) return String(iso);
  const [y,m,d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function countIssues(text){
  return (text||'').split('\n').map(s=>s.trim()).filter(Boolean).length;
}

function extractIssueNumber(url){
  if(!url) return '';
  const m = String(url).match(/issues\/(\d+)/);
  return m ? m[1] : '';
}

function parseIssueLine(line){
  if(!line) return { url:'', description:'', category:'', tracker:'' };
  const trimmed = String(line).trim();
  const parts = trimmed.split('|').map(s => s.trim());
  if(parts.length >= 2){
    return {
      url: parts[0] || '',
      description: parts[1] || '',
      category: parts[2] || '',
      tracker: parts[3] || ''
    };
  }
  return { url: trimmed, description: '', category: '', tracker: '' };
}

function inferCategoryFromText(text){
  // Only strong prefixes at the START of the subject — never match words mid-sentence
  const s = String(text || '').trim();
  if(!s) return '';
  if(/^(FE|Front\s*-?\s*End)([\s\-–—:,.]|$)/i.test(s)) return 'Front End';
  if(/^(BE|Back\s*-?\s*End)([\s\-–—:,.]|$)/i.test(s)) return 'Backend';
  if(/^(DE|Design)([\s\-–—:,.]|$)/i.test(s)) return 'Design';
  return '';
}

function parseIssueLines(text){
  return (text||'').split('\n').map(s=>s.trim()).filter(Boolean).map(line => {
    const { url, description, category, tracker } = parseIssueLine(line);
    const number = extractIssueNumber(url);
    const cat = resolveIssueCategory(number, category, description);
    const trk = resolveIssueTracker(number, tracker, description);
    return { url, description, category: cat, tracker: trk, number };
  });
}

/** Cache Redmine category + tracker by issue id */
function rememberIssueMeta(issues){
  if(!window.__issueCategoryById) window.__issueCategoryById = {};
  if(!window.__issueTrackerById) window.__issueTrackerById = {};
  (issues || []).forEach(i => {
    if(!i || i.id == null) return;
    const id = String(i.id);
    const cat = i.category?.name;
    if(cat && String(cat).trim()) window.__issueCategoryById[id] = String(cat).trim();
    const tr = i.tracker?.name;
    if(tr && String(tr).trim()) window.__issueTrackerById[id] = String(tr).trim();
  });
}

function rememberIssueCategories(issues){
  rememberIssueMeta(issues);
}

function resolveIssueCategory(number, storedCategory, description){
  if(storedCategory && String(storedCategory).trim()) return String(storedCategory).trim();
  const id = number != null ? String(number) : '';
  if(id && window.__issueCategoryById && window.__issueCategoryById[id]){
    return window.__issueCategoryById[id];
  }
  return inferCategoryFromText(description) || '';
}

function resolveIssueTracker(number, storedTracker, description){
  if(storedTracker && String(storedTracker).trim()) return String(storedTracker).trim();
  const id = number != null ? String(number) : '';
  if(id && window.__issueTrackerById && window.__issueTrackerById[id]){
    return window.__issueTrackerById[id];
  }
  return '';
}

/** Classify for summary sections: feature / enhancement / optimization / bug / other */
function classifyIssueKind(trackerName, subject){
  const t = String(trackerName || '').toLowerCase().trim();
  const s = String(subject || '').toLowerCase().trim();

  // --- Tracker name (authoritative when present) ---
  if(t){
    if(/bug|defect|hotfix|error/.test(t)) return 'bug';
    if(/optim/.test(t)) return 'optimization';
    if(/enhanc|improve/.test(t)) return 'enhancement';
    if(/new\s*feature|feature|story|epic/.test(t)) return 'feature';
    if(/task|support|concept|documentation|doc/.test(t)) return 'other';
    // Unknown tracker name — still try subject, else other
  }

  // --- Subject heuristics (ID + EN) ---
  if(/\b(bug|defect|error|fix|gagal|tidak\s*(bisa|muncul|tampil)|broken|crash|exception|eror)\b/.test(s)
      || /^(fix|perbaiki|perbaikan)\b/.test(s)) return 'bug';
  if(/\b(optimasi|optimization|performance|perf|percepat|ringan(kan)?)\b/.test(s)) return 'optimization';
  if(/\b(enhance|enhancement|improvement|penyesuaian|sesuaikan|perbaiki\s*ui|ux)\b/.test(s)
      || /^(penyesuaian|sesuaikan)\b/.test(s)) return 'enhancement';
  if(/\b(new\s*feature|fitur\s*baru|penambahan|tambah(kan)?\s|implementasi)\b/.test(s)
      || /^(tambah|penambahan|implementasi|fitur)\b/.test(s)) return 'feature';

  // No signal → Other (do NOT dump everything into New Features)
  return 'other';
}

const ISSUE_KIND_META = {
  feature:      { title: 'New Features', emoji: '✨', order: 1 },
  enhancement:  { title: 'Enhancements', emoji: '🔧', order: 2 },
  optimization: { title: 'Optimizations', emoji: '⚡', order: 3 },
  bug:          { title: 'Bug Fixes', emoji: '🐛', order: 4 },
  other:        { title: 'Other', emoji: '📌', order: 5 }
};

function groupIssuesByKind(issueLines){
  const groups = { feature:[], enhancement:[], optimization:[], bug:[], other:[] };
  issueLines.forEach(it => {
    const kind = classifyIssueKind(it.tracker, it.desc || it.description);
    (groups[kind] || groups.other).push(it);
  });
  return groups;
}

function formatGroupedIssueSections(issueLines, lineFn){
  const groups = groupIssuesByKind(issueLines);
  const order = ['feature','enhancement','optimization','bug','other'];
  let out = '';
  order.forEach(k => {
    const list = groups[k];
    if(!list || !list.length) return;
    const meta = ISSUE_KIND_META[k];
    out += `${meta.emoji} *${meta.title}*\n`;
    list.forEach(it => { out += lineFn(it) + '\n'; });
    out += '\n';
  });
  return out.trimEnd();
}



export {
  $,
  classifyIssueKind,
  countIssues,
  escapeHtml,
  extractIssueNumber,
  formatDate,
  formatGroupedIssueSections,
  groupIssuesByKind,
  ISSUE_KIND_META,
  parseIssueLine,
  parseIssueLines,
  rememberIssueCategories,
  resolveIssueCategory,
  toast,
  todayISO,
  uid
};
