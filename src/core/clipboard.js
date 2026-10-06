/**
 * Clipboard helpers shared by every copy button (v4.53.0)
 *
 * 1. synchronous copy inside the click, via the `copy` event (works on http,
 *    in most locked-down browsers, and keeps optional HTML formatting)
 * 2. the async Clipboard API
 * 3. a box with the text selected so it can be copied by hand
 * The old per-button code sometimes said "copied" when nothing was copied.
 */

export function copyRichSync(text, html){
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
  const prev = document.activeElement;
  document.body.appendChild(ta);
  document.addEventListener('copy', onCopy, true);
  let ok = false;
  try { ta.focus(); ta.select(); ok = document.execCommand('copy'); } catch(_){ ok = false; }
  document.removeEventListener('copy', onCopy, true);
  ta.remove();
  try { prev && prev.focus && prev.focus({ preventScroll: true }); } catch(_){}
  return ok && fired;
}

export async function copyTextSmart(text, html){
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

export function showManualCopy(text){
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
  wrap.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
}

/**
 * Drop-in replacement for navigator.clipboard.writeText(text):
 * resolves when copied; otherwise opens the manual-copy box and rejects
 * (so existing ".catch(() => toast('Copy failed'))" handlers still run).
 */
export async function writeClipboard(text, html){
  const value = String(text ?? '');
  if(await copyTextSmart(value, html)) return;
  showManualCopy(value);
  const err = new Error('Clipboard blocked — manual copy box shown');
  err.manual = true;
  throw err;
}
