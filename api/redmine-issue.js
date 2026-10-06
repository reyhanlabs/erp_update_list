/**
 * Redmine issue create + metadata
 * GET  ?meta=1&project_id=75  → trackers, priorities, categories
 * POST body { project_id, subject, description, tracker_id, priority_id, category_id,
 *             custom_fields?: [{ id, value }] }
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

      const [project, allTrackers, prioritiesData, sample] = await Promise.all([
        // trackers + categories + custom fields ENABLED FOR THIS PROJECT
        projectId ? getJson(`/projects/${pid}.json?include=trackers,issue_categories,issue_custom_fields`) : null,
        getJson('/trackers.json'),
        getJson('/enumerations/issue_priorities.json'),
        // recent issues: custom fields in use (+ their values) when the include above isn't supported
        projectId ? getJson(`/issues.json?project_id=${pid}&status_id=*&limit=50&sort=updated_on:desc`) : null
      ]);

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

      return res.status(200).json({
        trackers, priorities, categories: categories || [], customFields,
        project: proj ? { id: proj.id, name: proj.name } : null
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const projectRaw = body.project_id ?? body.projectId ?? '';
      const project_id = parseInt(String(projectRaw).trim(), 10);
      const subject = (body.subject || '').trim();
      const description = (body.description || '').trim();
      const tracker_id = body.tracker_id ? parseInt(String(body.tracker_id), 10) : null;
      const priority_id = body.priority_id ? parseInt(String(body.priority_id), 10) : null;
      const category_id = body.category_id ? parseInt(String(body.category_id), 10) : null;

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
