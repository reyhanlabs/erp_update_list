/**
 * Confirm dialog
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { $ } from '../core/helpers.js';

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */
let _confirmResolve = null;

function confirmDialog(opts){
  return new Promise(resolve => {
    const overlay = $('confirmModal');
    const box = $('confirmBox');
    const icon = $('confirmIcon');
    const titleEl = $('confirmTitle');
    const msgEl = $('confirmMessage');
    const okBtn = $('confirmOkBtn');
    const cancelBtn = $('confirmCancelBtn');

    const type = opts.type || 'warning';
    box.classList.toggle('danger', type === 'danger');
    icon.innerHTML = type === 'danger' ? ICON.danger : ICON.warning;
    titleEl.textContent = opts.title || 'Are you sure?';
    msgEl.innerHTML = opts.message || 'This action cannot be undone.';
    okBtn.textContent = opts.okText || 'Confirm';
    cancelBtn.textContent = opts.cancelText || 'Cancel';

    okBtn.className = 'btn ' + (type === 'danger' ? 'btn-danger-solid' : 'btn-primary');

    _confirmResolve = resolve;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(()=> okBtn.focus(), 50);
  });
}

function _closeConfirm(result){
  const overlay = $('confirmModal');
  overlay.classList.remove('show');
  document.body.style.overflow = '';
  if(_confirmResolve){
    _confirmResolve(result);
    _confirmResolve = null;
  }
}

export {
  _closeConfirm,
  confirmDialog
};
