/**
 * Backup / restore / wipe
 * v4.53.0: the backup also contains the Knowledge Base (guides, menus,
 * screenshots) and your private issue notes. Older v1 files still import.
 */
import { State } from '../core/state.js';
import { escapeHtml, toast, todayISO } from '../core/helpers.js';
import { CloudSync } from '../core/cloud-sync.js';
import { canAdmin, isOwner } from '../core/team.js';
import { confirmDialog } from '../ui/confirm.js';
import { db } from '../firebase.js';
import { getAllIssueNotes, importIssueNotes } from './issue-notes.js';

const KB_STRUCTURE_ID = '_structure';

function kbRef(){
  if(!CloudSync.workspaceId) throw new Error('Workspace not ready yet');
  return db.collection('workspaces').doc(CloudSync.workspaceId).collection('kb');
}

/* every guide with its screenshots, plus the menu structure */
async function collectKb(){
  const snap = await kbRef().get();
  const guides = []; let structure = null; let images = 0;
  for(const d of snap.docs){
    if(d.id === KB_STRUCTURE_ID){ structure = d.data(); continue; }
    const imgSnap = await kbRef().doc(d.id).collection('images').get();
    const imgs = imgSnap.docs.map(x => ({ id: x.id, ...x.data() }));
    images += imgs.length;
    guides.push({ id: d.id, ...d.data(), images: imgs });
  }
  return { guides, structure, images };
}

/* Client Versions list (v4.56.0) */
function sitesRef(){ return db.collection('workspaces').doc(CloudSync.workspaceId).collection('sites'); }
async function collectSites(){
  const snap = await sitesRef().get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function exportAll(){
  toast('Preparing backup…');
  let kb = { guides: [], structure: null, images: 0 };
  try { kb = await collectKb(); }
  catch(err){ console.warn('backup kb', err); toast('Knowledge Base could not be read; backing up plans and summaries only', 'error'); }
  const notes = getAllIssueNotes();
  let sites = [];
  try { sites = await collectSites(); } catch(err){ console.warn('backup sites', err); }
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    uid: CloudSync.uid,
    workspaceId: CloudSync.workspaceId,
    plans: State.plans.all(),
    summaries: State.summaries.all(),
    kb: { guides: kb.guides, structure: kb.structure },
    issueNotes: notes,
    sites
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zahir-erp-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Backup downloaded: ${data.plans.length} plans, ${data.summaries.length} summaries, ${kb.guides.length} guides (${kb.images} images), ${Object.keys(notes).length} notes, ${sites.length} client sites`);
}

async function restoreKb(kb){
  const ref = kbRef();
  let guides = 0, images = 0;
  if(kb.structure) await ref.doc(KB_STRUCTURE_ID).set(kb.structure);
  for(const g of (kb.guides || [])){
    if(!g || !g.id || g.id === KB_STRUCTURE_ID) continue;
    const { id, images: imgs, ...data } = g;
    await ref.doc(id).set(data);
    guides++;
    for(const img of (imgs || [])){
      if(!img || !img.id) continue;
      const { id: imgId, ...imgData } = img;
      await ref.doc(id).collection('images').doc(imgId).set(imgData);
      images++;
    }
  }
  return { guides, images };
}

function importAll(ev){
  const file = ev.target.files[0];
  if(!file) return;
  if(!canAdmin()){ toast('Only admins can restore a backup', 'error'); ev.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if(!Array.isArray(data.plans) || !Array.isArray(data.summaries)) throw new Error('Invalid format');
      const kb = data.kb && Array.isArray(data.kb.guides) ? data.kb : null;
      const notes = data.issueNotes && typeof data.issueNotes === 'object' ? data.issueNotes : null;
      const sites = Array.isArray(data.sites) ? data.sites.filter(x => x && x.id && x.name && x.url) : null;
      const imgCount = kb ? kb.guides.reduce((n, g) => n + ((g.images || []).length), 0) : 0;
      const lines = [
        `<b>${data.plans.length} plans</b> and <b>${data.summaries.length} summaries</b> (replace the current ones)`,
        kb ? `<b>${kb.guides.length} Knowledge Base guides</b> with ${imgCount} images${kb.structure ? ' and the menu structure' : ''} (guides with the same id are replaced)` : '',
        notes ? `<b>${Object.keys(notes).length} private issue notes</b> (merged, newer note wins)` : '',
        sites && sites.length ? `<b>${sites.length} client sites</b> for Client Versions (same id is replaced)` : ''
      ].filter(Boolean);

      const ok = await confirmDialog({
        title: 'Import backup data?',
        message: `This will import:<br>• ${lines.join('<br>• ')}<br><br>Continue?`,
        okText: 'Import Data',
        cancelText: 'Cancel',
        type: 'warning'
      });
      if(!ok){ ev.target.value = ''; return; }

      await CloudSync.bulkImport(data.plans, data.summaries);
      let kbRes = { guides: 0, images: 0 }, noteCount = 0;
      if(kb){
        try { kbRes = await restoreKb(kb); }
        catch(err){ console.error(err); toast('Knowledge Base restore failed: ' + escapeHtml(err.message || String(err)), 'error'); }
      }
      if(notes){
        try { noteCount = await importIssueNotes(notes); } catch(err){ console.error(err); }
      }
      if(sites && sites.length){
        try { for(const { id, ...rest } of sites) await sitesRef().doc(id).set(rest); }
        catch(err){ console.error(err); toast('Client sites restore failed: ' + (err.message || err), 'error'); }
      }
      toast(`Import done: ${data.plans.length} plans, ${data.summaries.length} summaries${kb ? `, ${kbRes.guides} guides` : ''}${notes ? `, ${noteCount} notes` : ''}`);
    } catch(err){
      console.error(err);
      toast('Invalid file', 'error');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

async function wipeAll(){
  if(!isOwner()){ toast('Only the owner can delete all data', 'error'); return; }
  const plansCount = State.plans.all().length;
  const sumsCount = State.summaries.all().length;

  const ok = await confirmDialog({
    title: 'Delete ALL data?',
    message: `You are about to permanently delete <b>${plansCount} plan(s)</b> and <b>${sumsCount} summary(ies)</b> from the cloud.<br><br>Knowledge Base guides and your issue notes are not deleted.<br><br>This action <b>cannot be undone</b>.`,
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
