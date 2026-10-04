/**
 * Backup / restore / wipe
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { State } from '../core/state.js';
import { toast, todayISO } from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { confirmDialog } from '../ui/confirm.js';

/* ============================================================
   BACKUP / RESTORE
   ============================================================ */
function exportAll(){
  const data = {
    plans: State.plans.all(),
    summaries: State.summaries.all(),
    exportedAt: new Date().toISOString(),
    uid: CloudSync.uid
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zahir-erp-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}

function importAll(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if(!data.plans || !data.summaries) throw new Error('Invalid format');

      const ok = await confirmDialog({
        title: 'Import backup data?',
        message: `This will import <b>${data.plans.length} plans</b> and <b>${data.summaries.length} summaries</b>.<br><br>Your current data will be <b>overwritten</b>. Continue?`,
        okText: 'Import Data',
        cancelText: 'Cancel',
        type: 'warning'
      });
      if(!ok){ ev.target.value = ''; return; }

      await CloudSync.bulkImport(data.plans, data.summaries);
      toast('Import successful');
    } catch(err){
      console.error(err);
      toast('Invalid file', 'error');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

async function wipeAll(){
  const plansCount = State.plans.all().length;
  const sumsCount = State.summaries.all().length;

  const ok = await confirmDialog({
    title: 'Delete ALL data?',
    message: `You are about to permanently delete <b>${plansCount} plan(s)</b> and <b>${sumsCount} summary(ies)</b> from the cloud.<br><br>This action <b>cannot be undone</b>.`,
    okText: 'Delete Everything',
    cancelText: 'Cancel',
    type: 'danger'
  });
  if(!ok) return;

  try {
    await CloudSync.wipeAll();
    toast('All data deleted');
  } catch(err){
    toast('Failed to clear data', 'error');
  }
}

export {
  exportAll,
  importAll,
  wipeAll
};
