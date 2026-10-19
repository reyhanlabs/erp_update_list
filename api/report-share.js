/**
 * Live, read-only Client Report links (v4.71.0)
 *
 *   GET  /api/report-share?t=<token>        public — the report data for /r/<token>
 *   GET  /api/report-share?client=<name>    member — the client's current link (or null)
 *   POST /api/report-share {action:'create', client, cfId, projects:[{id,label}], mode, replace}
 *   POST /api/report-share {action:'revoke', token}           editor / admin / owner
 *
 * Links live in reportShares/{token} (server only — Firestore rules deny the browser):
 *   { ws, client, cfId, projects, mode, createdAt, createdBy, views, lastViewedAt }
 * The public answer holds only what the report shows: issue id, subject, status,
 * tracker, category, project, assignee name, dates, parent id — and the request
 * lists (number, text, note, linked issue ids, manual status). No descriptions,
 * custom fields, e-mails, files or Redmine URLs.
 */
import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { requireUser } from './_lib/auth.js';
import { adminDb } from './_lib/firebase-admin.js';

const REDMINE_BASE = 'https://pjm.zahironline.com';
const PAGE = 100;
const MAX_PAGES = 10;            // per project, like the app (1,000 issues)
const CACHE_MS = 60 * 1000;      // one Redmine read per link per minute at most
const EDIT_ROLES = ['owner', 'admin', 'editor'];
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const cache = new Map();         // token → { at, body }

const shares = () => adminDb().collection('reportShares');
const newToken = () => randomBytes(18).toString('base64url');   // 24 chars, 144 bits

function shareView(id, d){
  return { token: id, client: d.client, mode: d.mode || 'auto', createdAt: d.createdAt || 0, createdBy: d.createdBy || '',
    views: d.views || 0, lastViewedAt: d.lastViewedAt || 0 };
}

async function redmine(apiKey, path){
  const r = await fetch(`${REDMINE_BASE}${path}`, { headers: { 'X-Redmine-API-Key': apiKey, Accept: 'application/json', 'User-Agent': 'Zahir-ERP-Update-Manager/1.0' } });
  if(!r.ok) throw new Error(`Redmine ${r.status}`);
  return r.json();
}

const slim = (i) => ({
  id: i.id,
  subject: i.subject || '',
  status: i.status ? { name: i.status.name, is_closed: i.status.is_closed === true } : null,
  tracker: i.tracker ? { name: i.tracker.name } : null,
  category: i.category ? { name: i.category.name } : null,
  project: i.project ? { name: i.project.name } : null,
  assigned_to: i.assigned_to ? { name: i.assigned_to.name } : undefined,
  parent: i.parent ? { id: i.parent.id } : null,
  created_on: i.created_on || null,
  updated_on: i.updated_on || null,
  closed_on: i.closed_on || null
});

/* the client's issues, the same way the app loads them (Client Name field, per project) */
async function clientIssues(apiKey, share){
  const targets = (share.projects && share.projects.length) ? share.projects : [{ id: '' }];
  const byId = new Map();
  const want = String(share.client).toLowerCase();
  const nameOf = (i) => { const f = (i.custom_fields || []).find(c => String(c.id) === String(share.cfId)); return f ? String(Array.isArray(f.value) ? f.value.join(', ') : f.value || '') : ''; };
  await Promise.all(targets.map(async (t) => {
    const base = `/issues.json?status_id=*&sort=updated_on:desc&limit=${PAGE}&cf_${encodeURIComponent(share.cfId)}=${encodeURIComponent(share.client)}${t.id ? `&project_id=${encodeURIComponent(t.id)}` : ''}`;
    const first = await redmine(apiKey, `${base}&offset=0`);
    const pages = [first];
    const total = Math.min(Number(first.total_count || 0), PAGE * MAX_PAGES);
    const offs = [];
    for(let off = PAGE; off < total; off += PAGE) offs.push(off);
    for(let n = 0; n < offs.length; n += 4){
      const got = await Promise.all(offs.slice(n, n + 4).map(off => redmine(apiKey, `${base}&offset=${off}`)));
      pages.push(...got);
    }
    pages.forEach(p => (p.issues || []).forEach(i => {
      const name = nameOf(i).toLowerCase();
      if(name && !name.includes(want)) return;          // same safety check as the app
      byId.set(String(i.id), i);
    }));
  }));
  const issues = [...byId.values()].sort((a, b) => String(b.updated_on || '').localeCompare(String(a.updated_on || '')));
  // parent issues often lack the Client Name field — fetch them by id (client requests link them)
  const missing = [...new Set(issues.map(i => i.parent && i.parent.id ? String(i.parent.id) : '').filter(id => id && !byId.has(id)))];
  const parents = [];
  for(let n = 0; n < missing.length; n += 50){
    const d = await redmine(apiKey, `/issues.json?status_id=*&limit=${PAGE}&issue_id=${missing.slice(n, n + 50).join(',')}`);
    parents.push(...(d.issues || []));
  }
  return { issues: issues.map(slim), parents: parents.map(slim) };
}

async function clientRequests(share){
  const snap = await adminDb().collection(`workspaces/${share.ws}/requests`).where('client', '==', share.client).get();
  return snap.docs.map(d => {
    const l = d.data() || {};
    return { id: d.id, title: l.title || '', receivedAt: l.receivedAt || '', createdAt: l.createdAt || 0,
      items: (l.items || []).map(it => ({ id: it.id, no: it.no || '', text: it.text || '', note: it.note || '',
        issueIds: (it.issueIds || []).map(String), mode: it.mode || 'auto' })) };
  }).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)) || (b.createdAt || 0) - (a.createdAt || 0));
}

async function publicReport(req, res, token){
  if(!TOKEN_RE.test(token)) return res.status(404).json({ error: 'This link is not valid.' });
  let doc;
  try { doc = await shares().doc(token).get(); }
  catch(err){ return res.status(500).json({ error: 'The report is not available right now.', detail: err.message }); }
  if(!doc.exists) return res.status(404).json({ error: 'This link has been switched off or does not exist.' });
  const share = doc.data();
  shares().doc(token).update({ views: FieldValue.increment(1), lastViewedAt: Date.now() }).catch(() => {});
  const hit = cache.get(token);
  if(hit && Date.now() - hit.at < CACHE_MS && hit.body.mode === (share.mode || 'auto')) return res.status(200).json(hit.body);
  const apiKey = process.env.REDMINE_API_KEY;
  if(!apiKey) return res.status(500).json({ error: 'The report is not available right now.' });
  try {
    const [iss, requests] = await Promise.all([clientIssues(apiKey, share), clientRequests(share)]);
    const body = { client: share.client, mode: share.mode || 'auto', generatedAt: Date.now(), ...iss, requests };
    cache.set(token, { at: Date.now(), body });
    if(cache.size > 200) cache.delete(cache.keys().next().value);
    return res.status(200).json(body);
  } catch(err){
    if(hit) return res.status(200).json({ ...hit.body, stale: true });
    return res.status(502).json({ error: 'Redmine could not be reached. Please try again in a moment.', detail: err.message });
  }
}

export default async function handler(req, res){
  const token = String((req.query && req.query.t) || '');
  if(req.method === 'GET' && token) return publicReport(req, res, token);

  const user = await requireUser(req, res);
  if(!user) return;
  const ws = user.member && user.member.workspaceId;
  if(!ws) return res.status(403).json({ error: 'Only team members can share reports', hint: 'Ask an admin to add you in Settings → Team & access.' });

  try {
    if(req.method === 'GET'){
      const client = String(req.query.client || '').trim();
      if(!client) return res.status(400).json({ error: 'client is required' });
      const snap = await shares().where('ws', '==', ws).where('client', '==', client).limit(1).get();
      return res.status(200).json({ share: snap.empty ? null : shareView(snap.docs[0].id, snap.docs[0].data()) });
    }
    if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if(!EDIT_ROLES.includes(user.member.role)) return res.status(403).json({ error: 'Viewers cannot share reports', hint: 'Ask an admin for editor access.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if(body.action === 'create'){
      const client = String(body.client || '').trim().slice(0, 200);
      const cfId = String(body.cfId || '').trim();
      if(!client) return res.status(400).json({ error: 'client is required' });
      if(!/^\d{1,6}$/.test(cfId)) return res.status(400).json({ error: 'The Client Name field id is missing', hint: 'Reload the client and try again.' });
      const projects = (Array.isArray(body.projects) ? body.projects : []).slice(0, 10)
        .map(p => ({ id: String(p && p.id || '').trim(), label: String(p && p.label || '').slice(0, 80) })).filter(p => /^[\w-]{1,40}$/.test(p.id));
      const mode = ['auto', 'topic', 'category', 'tracker', 'product'].includes(body.mode) ? body.mode : 'auto';
      const existing = await shares().where('ws', '==', ws).where('client', '==', client).limit(1).get();
      if(!existing.empty){
        const d = existing.docs[0];
        const patch = body.replace ? { mode, projects, cfId } : {};
        if(body.replace){ await d.ref.update(patch); cache.delete(d.id); }
        return res.status(200).json({ share: shareView(d.id, { ...d.data(), ...patch }) });
      }
      const token = newToken();
      const doc = { ws, client, cfId, projects, mode, createdAt: Date.now(), createdBy: user.email, views: 0, lastViewedAt: 0 };
      await shares().doc(token).set(doc);
      return res.status(200).json({ share: shareView(token, doc) });
    }

    if(body.action === 'revoke'){
      const t = String(body.token || '');
      if(!TOKEN_RE.test(t)) return res.status(400).json({ error: 'Invalid link' });
      const ref = shares().doc(t), d = await ref.get();
      if(!d.exists || d.data().ws !== ws) return res.status(404).json({ error: 'Link not found' });
      await ref.delete();
      cache.delete(t);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch(err){
    return res.status(500).json({ error: 'Could not update the shared link', detail: err.message });
  }
}
