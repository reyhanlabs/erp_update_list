/** DOM & format helpers */
import { ICON } from './icons.js';

export const $ = id => document.getElementById(id);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const todayISO = () => new Date().toISOString().split('T')[0];

export function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toast(msg, type){
  const t = $('toast');
  if(!t) return;
  const icon = type === 'error' ? ICON.alert : ICON.check;
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  t.classList.add('show');
  clearTimeout(t._t);
  const ms = type === 'error' ? 5200 : 2600;
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

export async function withBusy(btn, label, fn){
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
