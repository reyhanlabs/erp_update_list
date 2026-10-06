/**
 * Redmine issue create + metadata
 * GET  ?meta=1&project_id=75  → trackers, priorities, categories
 * POST body { project_id, subject, description, tracker_id, priority_id, category_id,
 *             status_id?, assigned_to_id?, custom_fields?: [{ id, value }],
 *             uploads?: [{ token, filename, content_type }] }
 * POST body { action: 'upload', filename, content_type, data (base64) } → { token }
 * GET returns trackers enabled for the project, priorities, categories, and the
 * project's issue custom fields (with values seen on recent issues).
 * Env: REDMINE_API_KEY
 */
import { requireUser } from './_lib/auth.js';

const REDMINE_BASE = 'https://pjm.zahironline.com';

function headers(apiKey) {
  return {
    'X-Redmine-API-Key': apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Zahir-ERP-Update-Manager/1.0'
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  // Some runtimes leave body as stream / empty — try raw if available
  return {};
}

/* The team's own description layout, learned per tracker from recent issues:
 * section headings that appear in at least ~30% of that tracker's issues,
 * in their usual order. Used by "Generate description". */
function headingsOf(desc) {
  const out = [];
  String(desc || '').split(/\r?\n/).forEach((line, idx) => {
    const t = line.trim();
    // "## X" = Markdown heading; a single "# " is a Textile numbered item
    const m = t.match(/^#{2,4}\s+(.+)$/) || t.match(/^h[1-6]\.\s+(.+)$/i)
      || t.match(/^\*\*([^*]{3,60})\*\*\s*:?$/) || t.match(/^\*([^*]{3,60})\*\s*:?$/)
      || t.match(/^([A-Za-z][^:*#|]{2,40}):\s*$/);
    if (!m) return;
    const h = m[1].replace(/[:*\s]+$/, '').replace(/^\*+/, '').trim();
    if (h.length >= 3 && h.length <= 60 && !/^https?:/i.test(h)) out.push({ h, idx });
  });
  return out;
}

function learnTemplates(issues) {
  const byTracker = new Map();
  issues.forEach(issue => {
    const tid = issue.tracker && issue.tracker.id;
    if (!tid) return;
    if (!byTracker.has(tid)) byTracker.set(tid, { name: issue.tracker.name, n: 0, heads: new Map() });
    const t = byTracker.get(tid);
    const hs = headingsOf(issue.description);
    if (!hs.length) return;
    t.n++;
    const seen = new Set();
    hs.forEach(({ h }, pos) => {
      const key = h.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return;
      seen.add(key);
      const e = t.heads.get(key) || { labels: new Map(), count: 0, pos: 0 };
      e.labels.set(h, (e.labels.get(h) || 0) + 1);
      e.count++;
      e.pos += pos / Math.max(1, hs.length - 1);
      t.heads.set(key, e);
    });
  });
  const out = {};
  byTracker.forEach((t, tid) => {
    if (t.n < 2) return;
    const min = Math.max(2, Math.ceil(t.n * 0.3));
    const heads = [...t.heads.values()]
      .filter(e => e.count >= min)
      .map(e => ({ label: [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0][0], avg: e.pos / e.count, count: e.count }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 10)
      .map(e => e.label);
    if (heads.length >= 2) out[tid] = { tracker: t.name, headings: heads, basedOn: t.n };
  });
  return out;
}

async function fetchMemberships(apiKey, pid) {
  const out = [];
  for (let offset = 0; offset < 500; offset += 100) {
    try {
      const r = await fetch(`${REDMINE_BASE}/projects/${pid}/memberships.json?limit=100&offset=${offset}`, { headers: headers(apiKey) });
      if (!r.ok) break;
      const d = await r.json();
      out.push(...(d.memberships || []));
      if (!d.total_count || out.length >= d.total_count) break;
    } catch (_) { break; }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;


  const apiKey = process.env.REDMINE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'REDMINE_API_KEY not configured',
      hint: 'Add REDMINE_API_KEY in Vercel Environment Variables'
    });
  }

  try {
    if (req.method === 'GET') {
      // Only numeric ids or Redmine identifiers — never raw path segments
      const projectRaw = String(req.query.project_id || '').trim();
      const projectId = /^[a-z0-9_-]{1,100}$/i.test(projectRaw) ? projectRaw : '';
      if (projectRaw && !projectId) {
        return res.status(400).json({ error: 'Invalid project_id' });
      }
      const pid = encodeURIComponent(projectId);
      const getJson = async (path) => {
        try {
          const r = await fetch(`${REDMINE_BASE}${path}`, { headers: headers(apiKey) });
          return r.ok ? await r.json() : null;
        } catch (_) { return null; }
      };

      const [project, allTrackers, prioritiesData, sample, statusesData, members] = await Promise.all([
        // trackers + categories + custom fields ENABLED FOR THIS PROJECT
        projectId ? getJson(`/projects/${pid}.json?include=trackers,issue_categories,issue_custom_fields`) : null,
        getJson('/trackers.json'),
        getJson('/enumerations/issue_priorities.json'),
        // recent issues: custom fields in use (+ their values) when the include above isn't supported
        projectId ? getJson(`/issues.json?project_id=${pid}&status_id=*&limit=100&sort=updated_on:desc`) : null,
        getJson('/issue_statuses.json'),
        projectId ? fetchMemberships(apiKey, pid) : []
      ]);
      const statuses = ((statusesData && statusesData.issue_statuses) || []).filter(st => !st.is_closed || /resolved/i.test(st.name));
      // Assignees: project members; developers first (role name contains dev / programmer / engineer)
      const DEV_RE = /dev|program|engineer|coder|backend|frontend|front end|back end/i;
      const byId = new Map();
      members.forEach(m => {
        const who = m.user || m.group;
        if (!who || !who.id) return;
        const roles = (m.roles || []).map(r => r.name);
        const prev = byId.get(who.id) || { id: who.id, name: who.name, group: !!m.group, roles: [] };
        prev.roles = [...new Set([...prev.roles, ...roles])];
        byId.set(who.id, prev);
      });
      const assignees = [...byId.values()]
        .map(a => ({ ...a, developer: a.roles.some(r => DEV_RE.test(r)) }))
        .sort((a, b) => (b.developer - a.developer) || a.name.localeCompare(b.name));

      const proj = project && project.project ? project.project : null;
      // Using the global tracker list let users pick trackers the project doesn't
      // allow, which Redmine rejects with "Tracker is not included in the list".
      const trackers = (proj && Array.isArray(proj.trackers) && proj.trackers.length)
        ? proj.trackers
        : ((allTrackers && allTrackers.trackers) || []);
      const priorities = (prioritiesData && prioritiesData.issue_priorities) || [];
      let categories = (proj && Array.isArray(proj.issue_categories)) ? proj.issue_categories : null;
      if (!categories && projectId) {
        const c = await getJson(`/projects/${pid}/issue_categories.json`);
        categories = (c && c.issue_categories) || [];
      }

      // Custom fields: from the project (Redmine 4.2+), else from recent issues
      const cfMap = new Map();
      ((proj && proj.issue_custom_fields) || []).forEach(cf => cfMap.set(cf.id, { id: cf.id, name: cf.name, values: new Set() }));
      ((sample && sample.issues) || []).forEach(issue => {
        (issue.custom_fields || []).forEach(cf => {
          if (!cfMap.has(cf.id)) cfMap.set(cf.id, { id: cf.id, name: cf.name, values: new Set(), multiple: !!cf.multiple });
          const entry = cfMap.get(cf.id);
          if (cf.multiple) entry.multiple = true;
          (Array.isArray(cf.value) ? cf.value : [cf.value]).forEach(v => {
            const t = String(v ?? '').trim();
            if (t && entry.values.size < 200) entry.values.add(t);
          });
        });
      });
      const customFields = [...cfMap.values()].map(cf => ({
        id: cf.id, name: cf.name, multiple: !!cf.multiple, values: [...cf.values].sort((a, b) => a.localeCompare(b))
      }));

      // Redmine text formatting (Textile vs Markdown) isn't exposed to non-admins:
      // guess it from recent descriptions so inline images use the right syntax.
      let md = 0, tx = 0;
      ((sample && sample.issues) || []).forEach(i => {
        const d = String(i.description || '');
        md += (d.match(/^#{1,4}\s|\*\*[^*\n]+\*\*|!\[[^\]]*\]\([^)]+\)|^\s*[-*]\s|```/gm) || []).length;
        tx += (d.match(/^h[1-6]\.\s|^bq\.\s|!(?!\[)[^\s!]+\.(png|jpe?g|gif|webp)!|^\s*#\s|<pre>/gim) || []).length;
      });
      const textFormat = md === 0 && tx === 0 ? 'unknown' : (tx > md ? 'textile' : 'markdown');
      const templates = learnTemplates((sample && sample.issues) || []);

      return res.status(200).json({
        textFormat,
        templates,
        trackers, priorities, categories: categories || [], customFields, statuses, assignees,
        project: proj ? { id: proj.id, name: proj.name } : null
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);

      // Attachment upload → Redmine token (sent as base64 JSON to work on every runtime)
      if (body.action === 'upload') {
        const filename = String(body.filename || 'attachment').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'attachment';
        const contentType = String(body.content_type || 'application/octet-stream').slice(0, 100);
        let buf;
        try { buf = Buffer.from(String(body.data || ''), 'base64'); } catch (_) { buf = null; }
        if (!buf || !buf.length) return res.status(400).json({ error: 'Empty file' });
        if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 3 MB per file)' });  // base64 must stay under Vercel's 4.5 MB body limit
        const up = await fetch(`${REDMINE_BASE}/uploads.json?filename=${encodeURIComponent(filename)}`, {
          method: 'POST',
          headers: { 'X-Redmine-API-Key': apiKey, 'Content-Type': 'application/octet-stream', Accept: 'application/json', 'User-Agent': 'Zahir-ERP-Update-Manager/1.0' },
          body: buf
        });
        const t = await up.text();
        let d = {}; try { d = JSON.parse(t); } catch (_) {}
        if (!up.ok || !d.upload || !d.upload.token) {
          return res.status(up.status || 502).json({
            error: `Upload failed (${up.status})`,
            errors: Array.isArray(d.errors) ? d.errors : [],
            hint: up.status === 422 ? 'Redmine refused the file (size or type limit in Administration → Settings → Files).' : ''
          });
        }
        return res.status(201).json({ token: d.upload.token, filename, content_type: contentType, size: buf.length });
      }

      const projectRaw = body.project_id ?? body.projectId ?? '';
      const project_id = parseInt(String(projectRaw).trim(), 10);
      const subject = (body.subject || '').trim();
      const description = (body.description || '').trim();
      const tracker_id = body.tracker_id ? parseInt(String(body.tracker_id), 10) : null;
      const priority_id = body.priority_id ? parseInt(String(body.priority_id), 10) : null;
      const category_id = body.category_id ? parseInt(String(body.category_id), 10) : null;
      const status_id = body.status_id ? parseInt(String(body.status_id), 10) : null;
      const assigned_to_id = body.assigned_to_id ? parseInt(String(body.assigned_to_id), 10) : null;

      if (!projectRaw || !Number.isFinite(project_id) || project_id <= 0) {
        return res.status(400).json({
          error: 'project_id required',
          detail: 'Select a project in the form (Zahir ERP / One / Manufacturing).',
          received: body.project_id
        });
      }
      if (!subject) return res.status(400).json({ error: 'subject required' });
      if (!description) return res.status(400).json({ error: 'description required' });

      const issue = {
        project_id,
        subject: subject.slice(0, 255),
        description
      };
      if (Number.isFinite(tracker_id) && tracker_id > 0) issue.tracker_id = tracker_id;
      if (Number.isFinite(priority_id) && priority_id > 0) issue.priority_id = priority_id;
      if (Number.isFinite(category_id) && category_id > 0) issue.category_id = category_id;
      if (Number.isFinite(status_id) && status_id > 0) issue.status_id = status_id;
      if (Number.isFinite(assigned_to_id) && assigned_to_id > 0) issue.assigned_to_id = assigned_to_id;
      if (Array.isArray(body.uploads)) {
        const ups = body.uploads
          .filter(u => u && typeof u.token === 'string' && u.token)
          .slice(0, 10)
          .map(u => ({ token: u.token, filename: String(u.filename || 'attachment').slice(0, 120), content_type: String(u.content_type || 'application/octet-stream').slice(0, 100) }));
        if (ups.length) issue.uploads = ups;
      }
      // custom fields: [{ id, value }] — only non-empty values are sent
      if (Array.isArray(body.custom_fields)) {
        const cfs = body.custom_fields
          .map(cf => ({ id: parseInt(String(cf && cf.id), 10), value: cf && cf.value }))
          .filter(cf => Number.isFinite(cf.id) && cf.id > 0 &&
            (Array.isArray(cf.value) ? cf.value.length : String(cf.value ?? '').trim() !== ''))
          .map(cf => ({ id: cf.id, value: Array.isArray(cf.value) ? cf.value.map(String) : String(cf.value).trim() }));
        if (cfs.length) issue.custom_fields = cfs;
      }

      const r = await fetch(`${REDMINE_BASE}/issues.json`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({ issue })
      });
      const text = await r.text();
      let data = {};
      try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 500) }; }

      if (!r.ok) {
        const errors = Array.isArray(data.errors) ? data.errors.map(String) : [];
        const hints = {
          401: 'The REDMINE_API_KEY on the server is invalid or expired.',
          403: 'The Redmine account behind REDMINE_API_KEY is not allowed to add issues in this project (Redmine → project → Members / Roles → "Add issues").',
          404: 'Project not found, or the Redmine account cannot see it.',
          422: 'Redmine refused the values. See the list above.'
        };
        return res.status(r.status).json({
          error: r.status === 422 ? 'Redmine rejected the issue' : `Redmine returned ${r.status}`,
          status: r.status,
          errors,
          detail: errors.length ? errors : (data.error || (data.raw ? 'Unexpected response from Redmine' : '')),
          hint: hints[r.status] || '',
          sent: { project_id, tracker_id: issue.tracker_id || null, subject: issue.subject,
            custom_fields: (issue.custom_fields || []).map(c => c.id) }
        });
      }

      const created = data.issue || {};
      return res.status(201).json({
        ok: true,
        id: created.id,
        issue: created,
        url: created.id ? `https://pjm.zahironline.com/issues/${created.id}` : null
      });
    }

    return res.status(405).json({ error: 'GET or POST only' });
  } catch (err) {
    console.error('redmine-issue', err);
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}
