/**
 * Telegram chat id + briefing
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { apiFetch } from '../api.js';
import { $, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { loadWhatNext, refreshDashAttention } from './what-next.js';

const TG_CHAT_KEY = 'erp_telegram_chat_id';

function loadTelegramChatId(){
  try {
    const v = localStorage.getItem(TG_CHAT_KEY) || '';
    const input = $('telegramChatId');
    if(input) input.value = v;
    const st = $('telegramStatus');
    if(st) st.textContent = v ? ('Chat ID: ' + v) : 'Chat ID not set';
  } catch(_){}
}

function saveTelegramChatId(){
  const v = ($('telegramChatId')?.value || '').trim();
  try { localStorage.setItem(TG_CHAT_KEY, v); } catch(_){}
  loadTelegramChatId();
  toast(v ? 'Telegram Chat ID saved' : 'Chat ID cleared');
}

function buildTelegramBriefing(){
  const att = window.__dashAttention || {};
  const wn = (window.__whatNextList || []).slice(0, 8);
  let text = '📋 *Zahir ERP — Daily briefing*\n\n';
  text += `🔴 Immediate New: ${att.immediate ?? '—'}\n`;
  text += `⏳ Stuck In Progress (>7d): ${att.stuck ?? '—'}\n`;
  text += `🚀 On Deploy: ${att.deploy ?? '—'}\n\n`;
  if(wn.length){
    text += '*What Next (top)*\n';
    wn.forEach((i, idx) => {
      text += `${idx+1}. #${i.id} [${i.priority?.name||'—'}] ${i.subject||''}\n`;
      text += `https://pjm.zahironline.com/issues/${i.id}\n`;
    });
  }
  return text;
}

async function sendTelegramBriefing(){
  const chatId = ($('telegramChatId')?.value || localStorage.getItem(TG_CHAT_KEY) || '').trim();
  if(!chatId){
    toast('Set Telegram Chat ID in Settings first', 'error');
    switchView('settings');
    return;
  }
  // Ensure we have some data
  try {
    if(!(window.__whatNextList||[]).length) await loadWhatNext(false);
    if(!window.__dashAttention) await refreshDashAttention();
  } catch(_){}

  const text = buildTelegramBriefing();
  try {
    const r = await apiFetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, text })
    });
    const data = await r.json().catch(() => ({}));
    if(!r.ok){
      try { await navigator.clipboard.writeText(text); } catch(_){}
      const detail = data.hint || data.error || data.description || ('HTTP ' + r.status);
      toast('Telegram: ' + detail + ' — text copied', 'error');
      console.warn('[telegram]', r.status, data);
      return;
    }
    toast('Briefing sent to Telegram');
  } catch(err){
    try { await navigator.clipboard.writeText(text); } catch(_){}
    toast('Send failed — briefing copied to clipboard', 'error');
  }
}

export {
  loadTelegramChatId,
  saveTelegramChatId,
  sendTelegramBriefing,
  TG_CHAT_KEY
};
