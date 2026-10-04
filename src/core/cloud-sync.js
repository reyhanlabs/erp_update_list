/**
 * Firestore workspace sync (CloudSync)
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { auth, db } from '../firebase.js';
import { State } from './state.js';
import { $, toast, uid } from './helpers.js';
import { setSyncStatus, updateLastSync } from '../ui/sync-status.js';
import { renderPlans } from '../features/plans/plans.js';
import { renderSummaries } from '../features/summaries.js';
import { refreshCounts } from '../features/dashboard.js';
import { renderAll } from '../features/account.js';

/* ============================================================
   CLOUD SYNC
   ============================================================ */
const CloudSync = {
  uid: null,
  plansRef: null,
  summariesRef: null,
  unsubPlans: null,
  unsubSummaries: null,

  workspaceId: null,

  async init(uid){
    this.uid = uid;
    const uidEl = $('userUID');
    if(uidEl) uidEl.textContent = uid;

    // Resolve shared workspace (team) or personal default
    this.workspaceId = await this.resolveWorkspaceId(uid);
    this.plansRef = db.collection('workspaces').doc(this.workspaceId).collection('plans');
    this.summariesRef = db.collection('workspaces').doc(this.workspaceId).collection('summaries');

    // One-time migrate from legacy users/{uid}/… if workspace is empty
    await this.maybeMigrateLegacyUserData(uid);

    const wsEl = $('workspaceIdLabel');
    if(wsEl) wsEl.textContent = this.workspaceId;

    setSyncStatus('syncing', 'Syncing');
    await this.pullAll();
    this.subscribe();
    setSyncStatus('online', 'Synced');
    updateLastSync();
  },

  async resolveWorkspaceId(uid){
    try {
      const userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();
      let ws = snap.exists ? (snap.data().workspaceId || null) : null;
      if(!ws){
        try { ws = localStorage.getItem('erp_workspace_id') || null; } catch(_){}
      }
      if(!ws) ws = uid; // personal workspace = uid
      await userRef.set({
        workspaceId: ws,
        email: (auth.currentUser && auth.currentUser.email) || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      try { localStorage.setItem('erp_workspace_id', ws); } catch(_){}
      return ws;
    } catch(err){
      console.warn('resolveWorkspaceId', err);
      return uid;
    }
  },

  async maybeMigrateLegacyUserData(uid){
    try {
      const [wsPlans, legacyPlans] = await Promise.all([
        this.plansRef.limit(1).get(),
        db.collection('users').doc(uid).collection('plans').limit(1).get()
      ]);
      if(!wsPlans.empty || legacyPlans.empty) return;
      // Copy legacy personal data into workspace
      const [allPlans, allSums] = await Promise.all([
        db.collection('users').doc(uid).collection('plans').get(),
        db.collection('users').doc(uid).collection('summaries').get()
      ]);
      const batch = db.batch();
      allPlans.docs.forEach(d => batch.set(this.plansRef.doc(d.id), d.data(), { merge: true }));
      allSums.docs.forEach(d => batch.set(this.summariesRef.doc(d.id), d.data(), { merge: true }));
      await batch.commit();
      console.log('Migrated legacy user data → workspace', this.workspaceId);
      toast('Personal data moved into workspace');
    } catch(err){
      console.warn('legacy migrate skipped', err);
    }
  },

  async joinWorkspace(code){
    const id = String(code || '').trim();
    if(!id){
      toast('Enter a workspace code', 'error');
      return;
    }
    if(!this.uid){
      toast('Sign in first', 'error');
      return;
    }
    setSyncStatus('syncing', 'Switching workspace');
    try {
      await db.collection('users').doc(this.uid).set({ workspaceId: id }, { merge: true });
      try { localStorage.setItem('erp_workspace_id', id); } catch(_){}
      // Re-bind listeners
      if(this.unsubPlans) this.unsubPlans();
      if(this.unsubSummaries) this.unsubSummaries();
      await this.init(this.uid);
      toast('Joined workspace: ' + id);
    } catch(err){
      console.error(err);
      setSyncStatus('error', 'Workspace error');
      toast(err.message || 'Could not join workspace', 'error');
    }
  },

  async usePersonalWorkspace(){
    if(!this.uid) return;
    await this.joinWorkspace(this.uid);
  },

  async pullAll(){
    try {
      setSyncStatus('syncing', 'Syncing');
      const [plansSnap, sumsSnap] = await Promise.all([
        this.plansRef.get(),
        this.summariesRef.get()
      ]);
      State.plans.set(plansSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      State.summaries.set(sumsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderAll();
      setSyncStatus('online', 'Synced');
      updateLastSync();
      toast('Data synced from cloud');
    } catch(err){
      console.error('Pull failed:', err);
      setSyncStatus('error', 'Sync error');
      toast('Failed to load from cloud', 'error');
    }
  },

  subscribe(){
    if(this.unsubPlans) this.unsubPlans();
    if(this.unsubSummaries) this.unsubSummaries();

    this.unsubPlans = this.plansRef.onSnapshot(snap => {
      State.plans.set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderPlans();
      refreshCounts();
      setSyncStatus('online', 'Synced');
      updateLastSync();
    }, err => {
      console.error('Plans snapshot error:', err);
      setSyncStatus('error', 'Sync error');
    });

    this.unsubSummaries = this.summariesRef.onSnapshot(snap => {
      State.summaries.set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderSummaries();
      renderPlans();
      refreshCounts();
      setSyncStatus('online', 'Synced');
      updateLastSync();
    }, err => {
      console.error('Summaries snapshot error:', err);
      setSyncStatus('error', 'Sync error');
    });
  },

  async addPlan(data){
    setSyncStatus('syncing', 'Saving');
    try {
      const ref = await this.plansRef.add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
      return ref.id;
    } catch(err){
      console.error('addPlan failed:', err);
      setSyncStatus('error', 'Save error');
      throw err;
    }
  },

  async updatePlan(id, data){
    setSyncStatus('syncing', 'Saving');
    try {
      await this.plansRef.doc(id).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('updatePlan failed:', err);
      setSyncStatus('error', 'Update error');
      throw err;
    }
  },

  async deletePlan(id){
    setSyncStatus('syncing', 'Deleting');
    try {
      const linked = State.summaries.all().filter(s => s.planId === id);
      const batch = db.batch();
      batch.delete(this.plansRef.doc(id));
      linked.forEach(s => batch.delete(this.summariesRef.doc(s.id)));
      await batch.commit();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('deletePlan failed:', err);
      setSyncStatus('error', 'Delete error');
      throw err;
    }
  },

  async addSummary(data){
    setSyncStatus('syncing', 'Saving');
    try {
      const ref = await this.summariesRef.add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
      return ref.id;
    } catch(err){
      console.error('addSummary failed:', err);
      setSyncStatus('error', 'Save error');
      throw err;
    }
  },

  async updateSummary(id, data){
    setSyncStatus('syncing', 'Saving');
    try {
      await this.summariesRef.doc(id).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('updateSummary failed:', err);
      setSyncStatus('error', 'Update error');
      throw err;
    }
  },

  async deleteSummary(id){
    setSyncStatus('syncing', 'Deleting');
    try {
      await this.summariesRef.doc(id).delete();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('deleteSummary failed:', err);
      setSyncStatus('error', 'Delete error');
      throw err;
    }
  },

  async bulkImport(plans, summaries){
    setSyncStatus('syncing', 'Importing');
    try {
      const batch = db.batch();
      plans.forEach(p => {
        const id = p.id || uid();
        batch.set(this.plansRef.doc(id), { ...p, id });
      });
      summaries.forEach(s => {
        const id = s.id || uid();
        batch.set(this.summariesRef.doc(id), { ...s, id });
      });
      await batch.commit();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('bulkImport failed:', err);
      setSyncStatus('error', 'Import error');
      throw err;
    }
  },

  async wipeAll(){
    setSyncStatus('syncing', 'Clearing');
    try {
      const [plansSnap, sumsSnap] = await Promise.all([
        this.plansRef.get(),
        this.summariesRef.get()
      ]);
      const batch = db.batch();
      plansSnap.docs.forEach(d => batch.delete(d.ref));
      sumsSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setSyncStatus('online', 'Synced');
    } catch(err){
      console.error('wipeAll failed:', err);
      setSyncStatus('error', 'Clear error');
      throw err;
    }
  }
};

export {
  CloudSync
};
