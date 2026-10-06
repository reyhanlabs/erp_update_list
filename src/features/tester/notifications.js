/**
 * RFT notifications (browser + Telegram) & polling
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { apiFetch } from '../../api.js';
import { RedmineState } from '../../core/state.js';
import { $, escapeHtml, toast } from '../../core/helpers.js';
import {
  countNewByCategory,
  getIssueTesterCategory,
  getSeenIssueIds,
  markCategoryIssuesSeen,
  openTesterCategory,
  updateTesterCategoryBadges
} from './categories.js';
import { fetchRftForProject, resolveTesterProjectIds } from './queue.js';
import { loadRedmineProjects } from '../../redmine/projects.js';
import { prefetchAllIssueStatusBadges } from '../issue-status.js';
import { prefetchActiveWorkCounts, prefetchNewIssueCounts } from '../new-issues.js';
import { TG_CHAT_KEY } from '../telegram-briefing.js';

/* ===== Browser notifications: new Ready for Testing ===== */
const NOTIF_PREF_KEY = 'erp_tester_notif_enabled';
const NOTIF_LAST_KEY = 'erp_tester_notif_last_ids';
let __testerNotifTimer = null;

function isTesterNotifEnabled(){
  try { return localStorage.getItem(NOTIF_PREF_KEY) === '1'; } catch(_){ return false; }
}

function getLastNotifiedIds(){
  try {
    const raw = localStorage.getItem(NOTIF_LAST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch(_){ return new Set(); }
}
function saveLastNotifiedIds(set){
  try {
    localStorage.setItem(NOTIF_LAST_KEY, JSON.stringify(Array.from(set).slice(-500)));
  } catch(_){}
}

function updateNotifToggleUI(){
  const btn = $('btnToggleTesterNotif');
  const status = $('testerNotifStatus');
  const pill = $('testerNotifStatusPill');
  const bell = $('btnNotifBell');
  const dot = $('notifBellDot');
  const badge = $('notifBellBadge');
  const tgHint = $('notifTelegramHint');
  const on = isTesterNotifEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if(btn){
    btn.textContent = on ? 'Disable browser alerts' : 'Enable browser alerts';
    btn.classList.toggle('btn-primary', !on);
    btn.classList.toggle('btn-secondary', on);
  }
  if(status){
    if(typeof Notification === 'undefined'){
      status.textContent = 'Not supported in this browser';
    } else if(Notification.permission === 'denied'){
      status.textContent = 'Blocked — allow in browser site settings';
    } else if(on){
      status.textContent = 'On · checks while this tab is open';
    } else {
      status.textContent = 'Browser alerts off';
    }
  }
  if(pill){
    pill.classList.remove('on','blocked');
    if(typeof Notification !== 'undefined' && Notification.permission === 'denied'){
      pill.textContent = 'Blocked';
      pill.classList.add('blocked');
    } else if(on){
      pill.textContent = 'On';
      pill.classList.add('on');
    } else {
      pill.textContent = 'Off';
    }
  }
  if(bell) bell.classList.toggle('is-on', on);
  const recent = window.__notifRecent || [];
  const unread = recent.filter(x => !x.seen).length;
  const counts = (typeof countNewByCategory === 'function') ? countNewByCategory() : {};
  const totalNew = Object.values(counts).reduce((a,b)=>a+(b||0), 0);
  if(dot){
    // Red dot = Ready for Testing issues you haven't opened yet (listed in the panel).
    // A number badge takes over when there are unread alerts from this session.
    dot.classList.toggle('hidden', !(unread === 0 && totalNew > 0));
  }
  if(bell){
    bell.setAttribute('aria-label', unread > 0 ? `Notifications: ${unread} new alert${unread === 1 ? '' : 's'}`
      : totalNew > 0 ? `Notifications: ${totalNew} unopened Ready for Testing issue${totalNew === 1 ? '' : 's'}` : 'Notifications');
  }
  renderNotifUnseen(counts, totalNew);
  if(badge){
    if(unread > 0){
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  if(tgHint){
    const chat = (localStorage.getItem(typeof TG_CHAT_KEY !== 'undefined' ? TG_CHAT_KEY : 'erp_telegram_chat') || '').trim();
    const tgOn = typeof isTelegramRftEnabled === 'function' && isTelegramRftEnabled();
    tgHint.textContent = chat
      ? (tgOn ? 'Telegram: RFT alerts on' : 'Telegram: Chat ID set, alerts off')
      : 'Telegram: set Chat ID in Settings';
  }
  renderNotifRecent();
}

/* "Not opened yet" block in the panel: explains the red dot */
const CAT_LABELS = { frontend: 'Front End', backend: 'Backend', design: 'Design', other: 'Other' };
function renderNotifUnseen(counts, totalNew){
  const box = $('notifUnseen');
  if(!box) return;
  if(!totalNew){
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }
  const links = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) =>
    `<button type="button" class="notif-unseen-cat" onclick="closeNotifPanel(); openTesterCategory('${k}')">${escapeHtml(CAT_LABELS[k] || k)} <b>${n}</b></button>`).join('');
  box.innerHTML = `<div class="notif-unseen-head">
      <span><b>${totalNew}</b> Ready for Testing issue${totalNew === 1 ? '' : 's'} not opened yet</span>
      <button type="button" class="notif-unseen-clear" onclick="markAllRftSeen()">Mark all as seen</button>
    </div>
    <div class="notif-unseen-cats">${links}</div>`;
  box.classList.remove('hidden');
}

function markAllRftSeen(){
  ['frontend', 'backend', 'design', 'other'].forEach(k => { try { markCategoryIssuesSeen(k); } catch(_){} });
  try { updateNotifToggleUI(); } catch(_){}
}

function renderNotifRecent(){
  const box = $('notifRecentList');
  if(!box) return;
  const list = window.__notifRecent || [];
  if(!list.length){
    box.innerHTML = '<p class="notif-empty">No new RFT alerts yet in this session.</p>';
    return;
  }
  box.innerHTML = list.slice(0, 12).map(item => {
    const pri = (item.priority || '').toLowerCase();
    const priClass = /immediate|urgent/.test(pri) ? 'immediate' : /high/.test(pri) ? 'high' : '';
    const priLabel = item.priority ? `<span class="notif-item-pri ${priClass}">${escapeHtml(item.priority)}</span>` : '';
    const meta = [item.project, item.category].filter(Boolean).join(' · ');
    return `<a class="notif-item" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener" onclick="markNotifSeen('${item.id}')">
      <div class="notif-item-top">
        <span class="notif-item-id">#${escapeHtml(String(item.id))}</span>
        ${priLabel}
      </div>
      <div class="notif-item-sub">${escapeHtml(item.subject || '')}</div>
      <div class="notif-item-meta">${escapeHtml(meta)}${item.at ? ' · ' + escapeHtml(item.at) : ''}</div>
    </a>`;
  }).join('');
}

function markNotifSeen(id){
  const list = window.__notifRecent || [];
  list.forEach(x => { if(String(x.id) === String(id)) x.seen = true; });
  updateNotifToggleUI();
}

function pushNotifRecent(issues){
  if(!issues || !issues.length) return;
  window.__notifRecent = window.__notifRecent || [];
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const existing = new Set(window.__notifRecent.map(x => String(x.id)));
  issues.forEach(i => {
    const id = String(i.id);
    if(existing.has(id)) return;
    window.__notifRecent.unshift({
      id,
      subject: i.subject || '',
      priority: i.priority?.name || '',
      category: i.category?.name || '',
      project: i._projectLabel || i.project?.name || '',
      url: `https://pjm.zahironline.com/issues/${id}`,
      at: now,
      seen: false
    });
  });
  window.__notifRecent = window.__notifRecent.slice(0, 30);
  updateNotifToggleUI();
}

function positionNotifPanel(){
  const panel = $('notifPanel');
  const btn = $('btnNotifBell');
  if(!panel || !btn || panel.classList.contains('hidden')) return;
  const r = btn.getBoundingClientRect();
  const pw = Math.min(340, window.innerWidth - 24);
  let left = r.right - pw;
  if(left < 12) left = 12;
  if(left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  let top = r.bottom + 8;
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.style.right = 'auto';
}
function toggleNotifPanel(ev){
  if(ev){
    ev.preventDefault();
    ev.stopPropagation();
  }
  const panel = $('notifPanel');
  if(!panel) return;
  const opening = panel.classList.contains('hidden');
  if(opening){
    panel.classList.remove('hidden');
    positionNotifPanel();
    (window.__notifRecent || []).forEach(x => { x.seen = true; });
    window.__notifOpenedAt = Date.now();
  } else {
    closeNotifPanel();
  }
  try { updateNotifToggleUI(); } catch(_){}
}
function closeNotifPanel(ev){
  if(ev){
    try { ev.preventDefault(); ev.stopPropagation(); } catch(_){}
  }
  const panel = $('notifPanel');
  if(panel) panel.classList.add('hidden');
}
async function toggleTesterNotifications(){
  if(typeof Notification === 'undefined'){
    toast('This browser does not support notifications', 'error');
    return;
  }
  if(isTesterNotifEnabled()){
    try { localStorage.setItem(NOTIF_PREF_KEY, '0'); } catch(_){}
    stopTesterNotifPoll();
    updateNotifToggleUI();
    toast('Notifications disabled');
    return;
  }
  let perm = Notification.permission;
  if(perm === 'default'){
    perm = await Notification.requestPermission();
  }
  if(perm !== 'granted'){
    try { localStorage.setItem(NOTIF_PREF_KEY, '0'); } catch(_){}
    updateNotifToggleUI();
    toast('Permission denied — enable notifications for this site in the browser', 'error');
    return;
  }
  try { localStorage.setItem(NOTIF_PREF_KEY, '1'); } catch(_){}
  startTesterNotifPoll();
    // Lightweight sidebar counts (limit=1 per project)
    setTimeout(() => {
      prefetchNewIssueCounts().catch(()=>{});
      prefetchAllIssueStatusBadges().catch(()=>{});
      prefetchActiveWorkCounts().catch(()=>{});
    }, 2500);
  updateNotifToggleUI();
  toast('Browser notifications enabled');
  // Immediate check
  checkTesterNotifications().catch(()=>{});
}

function notifyNewTesterIssues(issues){
  if(!issues || !issues.length) return;

  const seen = getSeenIssueIds();
  const last = getLastNotifiedIds();

  // First run: seed baseline so we don't spam Telegram with the whole queue
  if(!last.size){
    const seed = new Set(issues.map(i => String(i.id)));
    saveLastNotifiedIds(seed);
    console.info('[tester] seeded notified baseline', seed.size);
    return;
  }

  // Telegram: any RFT id not yet notified (independent of browser "seen")
  const freshForTelegram = issues.filter(i => !last.has(String(i.id)));
  // Browser: also skip issues the user already opened in a category
  const freshForBrowser = freshForTelegram.filter(i => !seen.has(String(i.id)));

  if(!freshForTelegram.length) return;

  // Remember notified ids (avoid spam) — mark before send to avoid duplicates on retry
  const next = getLastNotifiedIds();
  freshForTelegram.forEach(i => next.add(String(i.id)));
  saveLastNotifiedIds(next);

  console.info('[tester] new RFT detected', freshForTelegram.map(i => i.id));
  pushNotifRecent(freshForTelegram);
  // In-app toast when tab is visible
  if(!document.hidden){
    const n = freshForTelegram.length;
    toast(`${n} new Ready for Testing issue${n>1?'s':''}`, 'success');
  }


  // Use telegram list for Telegram; browser list for Notification API
  var fresh = freshForBrowser;

  // Browser notification (optional)
  if(isTesterNotifEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted'){
    try {
      const nCount = fresh.length;
      const title = nCount === 1
        ? `RFT #${fresh[0].id}`
        : `${nCount} new Ready for Testing`;
      const lines = fresh.slice(0, 3).map(i => {
        const pri = i.priority?.name ? `[${i.priority.name}] ` : '';
        return `${pri}#${i.id} ${(i.subject || '').slice(0, 80)}`;
      });
      if(nCount > 3) lines.push(`…and ${nCount - 3} more`);
      const body = lines.join('\n');
      const n = new Notification(title, {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        tag: 'erp-rft-new',
        renotify: true,
        requireInteraction: nCount >= 3
      });
      n.onclick = () => {
        try { window.focus(); } catch(_){}
        const counts = { frontend:0, backend:0, design:0, other:0 };
        fresh.forEach(i => { const c = getIssueTesterCategory(i); if(c) counts[c] = (counts[c]||0)+1; });
        const best = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0] || 'frontend';
        openTesterCategory(best);
      };
    } catch(err){
      console.warn('browser notification failed', err);
    }
  }

  // Telegram notification for new RFT (uses all new ids, not browser-seen filter)
  if(isTelegramRftEnabled()){
    sendTelegramRftAlert(freshForTelegram).catch(err => console.warn('telegram RFT alert', err));
  } else {
    console.info('[telegram RFT] skipped — enable Chat ID + toggle in Settings');
  }
}

function isTelegramRftEnabled(){
  try {
    const chat = (localStorage.getItem(TG_CHAT_KEY) || '').trim();
    if(!chat) return false;
    const pref = localStorage.getItem('erp_telegram_rft_notif');
    // default ON when chat id is set
    if(pref === null || pref === undefined || pref === '') return true;
    return pref === '1';
  } catch(_){ return false; }
}

function setTelegramRftEnabled(on){
  try { localStorage.setItem('erp_telegram_rft_notif', on ? '1' : '0'); } catch(_){}
  const el = $('telegramRftToggle');
  if(el) el.checked = !!on;
}

async function testTelegramRftAlert(){
  const chatId = ($('telegramChatId')?.value || localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId){
    toast('Set Telegram Chat ID first', 'error');
    return;
  }
  await sendTelegramRftAlert([{
    id: 'TEST',
    subject: 'Test alert from Zahir ERP Update Manager — RFT notifications OK',
    priority: { name: 'Normal' },
    category: { name: 'Front End' },
    _projectLabel: 'Zahir ERP',
    project: { name: 'Zahir ERP' }
  }]);
}

async function sendTelegramRftAlert(fresh){
  const chatId = ($('telegramChatId')?.value || localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId || !fresh || !fresh.length) return;

  let text = `🆕 Ready for Testing — ${fresh.length} new\n\n`;
  fresh.slice(0, 15).forEach(i => {
    const proj = i._projectLabel || i.project?.name || '';
    const pri = i.priority?.name || '';
    const sub = (i.subject || '').slice(0, 120);
    const cat = i.category?.name || '';
    text += `#${i.id}`;
    if(pri) text += ` [${pri}]`;
    if(cat) text += ` · ${cat}`;
    if(proj) text += ` · ${proj}`;
    text += `\n${sub}\nhttps://pjm.zahironline.com/issues/${i.id}\n\n`;
  });
  if(fresh.length > 15) text += `…and ${fresh.length - 15} more\n`;

  try {
    const r = await apiFetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, text: text.trim() })
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      console.warn('[telegram RFT]', r.status, data);
      toast('Telegram RFT alert failed: ' + (data.hint || data.error || r.status), 'error');
      return;
    }
    console.info('[telegram RFT] sent', fresh.length);
    toast('Telegram: ' + fresh.length + ' new RFT notified');
  } catch(err){
    console.warn('[telegram RFT] network', err);
    toast('Telegram RFT alert network error', 'error');
  }
}


async function checkTesterNotifications(){
  const lc = $('notifLastCheck');
  if(lc) lc.textContent = 'Last check: checking…';

  // Always refresh multi-project RFT list for accurate sidebar badges.
  // Browser / Telegram alerts only when enabled.
  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const targets = resolveTesterProjectIds();
    if(!targets.length) return;

    const merged = [];
    await Promise.all(targets.map(async (t) => {
      try {
        // force:true so new RFT is not hidden behind session cache
        const r = await fetchRftForProject(t.id, true);
        (r.issues || []).forEach(iss => {
          merged.push({ ...iss, _projectId: t.id, _projectLabel: t.label });
        });
        const _lcOk = $('notifLastCheck');
    if(_lcOk) _lcOk.textContent = 'Last check: ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  } catch(err){
        console.warn('[tester] notif fetch', t.label, err);
      }
    }));
    const byId = new Map();
    merged.forEach(iss => { if(!byId.has(iss.id)) byId.set(iss.id, iss); });
    const issues = Array.from(byId.values());

    window.__testerIssues = issues;
    window.__testerMeta = {
      ...(window.__testerMeta || {}),
      fromCache: true,
      projects: targets.map(t => t.label).join(', '),
      at: Date.now()
    };
    updateTesterCategoryBadges();

    // Detect brand-new RFT for browser + Telegram
    notifyNewTesterIssues(issues);
    const _lcOk = $('notifLastCheck');
    if(_lcOk) _lcOk.textContent = 'Last check: ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  } catch(err){
    const lcErr = $('notifLastCheck');
    if(lcErr) lcErr.textContent = 'Last check: failed';
    const _lc = $('notifLastCheck');
    if(_lc) _lc.textContent = 'Last check: failed';
    console.warn('checkTesterNotifications', err);
  }
}

function startTesterNotifPoll(){
  if(__testerNotifTimer) return;
  const tick = () => {
    if(document.hidden) return; // skip while tab hidden — cron/Telegram cover that
    checkTesterNotifications().catch(()=>{});
  };
  // Adaptive: every 90s while focused (was ~3 min)
  __testerNotifTimer = setInterval(tick, 90 * 1000);
  setTimeout(tick, 4000);
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) checkTesterNotifications().catch(()=>{});
  });
}
function stopTesterNotifPoll(){
  if(__testerNotifTimer){
    clearInterval(__testerNotifTimer);
    __testerNotifTimer = null;
  }
}

export {
  markAllRftSeen,
  checkTesterNotifications,
  closeNotifPanel,
  isTelegramRftEnabled,
  markNotifSeen,
  notifyNewTesterIssues,
  positionNotifPanel,
  pushNotifRecent,
  renderNotifRecent,
  setTelegramRftEnabled,
  startTesterNotifPoll,
  testTelegramRftAlert,
  toggleNotifPanel,
  toggleTesterNotifications,
  updateNotifToggleUI
};
