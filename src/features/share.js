/**
 * Public share links
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { auth, db } from '../firebase.js';
import { State } from '../core/state.js';
import { $, escapeHtml, formatDate, parseIssueLines, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { closeAllCopyMenus } from './plans/copy-menu.js';
import { updateNotifToggleUI } from './tester/notifications.js';

/* ============================================================
   PUBLIC SHARE LINK (no workspace / no login)
   Data is embedded in the URL hash — anyone with the link can view.
   ============================================================ */
function encodeSharePayload(obj){
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSharePayload(str){
  try {
    const b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch(err){
    console.warn('decodeSharePayload', err);
    return null;
  }
}

function buildPlanShareData(plan){
  if(!plan) return null;
  const issues = parseIssueLines(plan.issues || '').map(it => ({
    url: it.url || '',
    number: it.number || '',
    description: it.description || '',
    category: it.category || '',
    tracker: it.tracker || ''
  }));
  return {
    v: 1,
    title: plan.title || 'Update Plan',
    date: plan.date || '',
    note: plan.note || '',
    projectKey: plan.projectKey || '',
    issues
  };
}

async function copyPlanShareLink(planId){
  const plan = State.plans.get(planId);
  if(!plan){ toast('Plan not found', 'error'); return; }
  const data = buildPlanShareData(plan);
  if(!data){ toast('Nothing to share', 'error'); return; }

  // Short link via Firestore: /share?id=xxxxxxxx
  try {
    if(!auth?.currentUser){
      throw new Error('Sign in required to create a short share link');
    }
    const id = makeShareId();
    await db.collection('shares').doc(id).set({
      v: 1,
      title: data.title || 'Update Plan',
      date: data.date || '',
      note: data.note || '',
      projectKey: data.projectKey || '',
      issues: data.issues || [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.currentUser.uid
    });
    const url = `${location.origin}/share?id=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Short share link copied');
    } catch(_){
      prompt('Copy this share link:', url);
    }
    closeAllCopyMenus();
    return;
  } catch(err){
    console.warn('short share failed', err);
    // Fallback: long hash link (still works offline)
    try {
      const token = encodeSharePayload(data);
      if(token.length > 12000){
        toast('Could not create share link. Check Firestore rules for /shares, or use Copy for Telegram.', 'error');
        return;
      }
      const url = `${location.origin}/share.html#${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('Share link copied (long form — publish Firestore /shares rules for short links)');
      } catch(_){
        prompt('Copy this share link:', url);
      }
    } catch(e2){
      toast('Share failed: ' + (err.message || err), 'error');
    }
  }
  closeAllCopyMenus();
}

function makeShareId(){
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for(let i = 0; i < arr.length; i++) id += alphabet[arr[i] % alphabet.length];
  return id;
}


function isShareRoute(){
  try {
    const q = new URLSearchParams(location.search);
    return q.get('view') === 'share' || (location.hash && location.hash.length > 20 && q.get('view') === 'share');
  } catch(_){ return false; }
}

function loadSharedPlanFromUrl(){
  const body = $('shareBody');
  if(!body) return;
  const hash = (location.hash || '').replace(/^#/, '');
  if(!hash){
    body.innerHTML = `<div class="empty" style="padding:40px 16px"><p style="margin:0;color:var(--text-tertiary)">Invalid share link (missing data).</p></div>`;
    return;
  }
  const data = decodeSharePayload(hash);
  if(!data || !Array.isArray(data.issues)){
    body.innerHTML = `<div class="empty" style="padding:40px 16px"><p style="margin:0;color:var(--text-tertiary)">Could not read this share link.</p></div>`;
    return;
  }
  renderSharedPlan(data);
}

function renderSharedPlan(data){
  const body = $('shareBody');
  if(!body) return;
  const issues = data.issues || [];
  const rows = issues.map((it, idx) => {
    const num = it.number || (it.url || '').match(/\/issues\/(\d+)/)?.[1] || '';
    const url = it.url || (num ? `https://pjm.zahironline.com/issues/${num}` : '#');
    const cat = it.category ? `<span class="sp-cat">${escapeHtml(it.category)}</span>` : '';
    const trk = it.tracker ? `<span class="meta-chip" style="font-size:11px">${escapeHtml(it.tracker)}</span>` : '';
    return `<tr>
      <td class="share-num">${idx + 1}</td>
      <td class="share-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">#${escapeHtml(String(num || '—'))}</a></td>
      <td class="share-desc">${escapeHtml(it.description || '')}</td>
      <td>${cat} ${trk}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="share-card">
      <h2 class="share-title">${escapeHtml(data.title || 'Update Plan')}</h2>
      <div class="share-meta">
        ${data.date ? `<span>📅 ${escapeHtml(formatDate(data.date) || data.date)}</span>` : ''}
        <span>${issues.length} issue(s)</span>
        ${data.projectKey ? `<span class="meta-chip">${escapeHtml(data.projectKey)}</span>` : ''}
      </div>
      ${data.note ? `<p class="share-note">${escapeHtml(data.note)}</p>` : ''}
      <div class="share-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="copySharedIssueLinks()">Copy all links</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="copySharedTelegram()">Copy for Telegram</button>
      </div>
      <div class="table-wrap share-table-wrap">
        <table class="data-table share-table">
          <thead>
            <tr><th>#</th><th>Issue</th><th>Description</th><th>Category</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">No issues</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  window.__sharedPlanData = data;
}

function copySharedIssueLinks(){
  const data = window.__sharedPlanData;
  if(!data) return;
  const lines = (data.issues || []).map(it => it.url || (it.number ? `https://pjm.zahironline.com/issues/${it.number}` : '')).filter(Boolean);
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Links copied')).catch(() => toast('Copy failed', 'error'));
}

function copySharedTelegram(){
  const data = window.__sharedPlanData;
  if(!data) return;
  const lines = (data.issues || []).map(it => {
    const url = it.url || (it.number ? `https://pjm.zahironline.com/issues/${it.number}` : '');
    return url;
  }).filter(Boolean);
  const text = `${data.title || 'Update Plan'}\n\n` + lines.join('\n');
  navigator.clipboard.writeText(text).then(() => toast('Copied for Telegram')).catch(() => toast('Copy failed', 'error'));
}

function bootShareMode(){
  // Hide auth gate & show app shell for public share
  const gate = $('authGate');
  if(gate) gate.classList.add('hidden');
  const loading = $('loadingScreen') || $('appLoading');
  if(loading) loading.classList.add('hidden');
  document.body.classList.add('share-mode');
  // Hide sidebar nav complexity for pure share? keep simple - just switch view
  try {
    switchView('share', { replaceUrl: true });
  } catch(_){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const v = $('view-share');
    if(v) v.classList.add('active');
  }
  loadSharedPlanFromUrl();
  // Minimal chrome: still show topbar version
  updateNotifToggleUI?.();
}

export {
  bootShareMode,
  copyPlanShareLink,
  copySharedIssueLinks,
  copySharedTelegram,
  loadSharedPlanFromUrl,
  makeShareId
};
