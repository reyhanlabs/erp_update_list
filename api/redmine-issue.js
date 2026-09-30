/**
 * Redmine issue create + metadata
 * GET  ?meta=1&project_id=75  → trackers, priorities, categories
 * POST body { project_id, subject, description, tracker_id, priority_id, category_id }
 * Env: REDMINE_API_KEY
 */
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.REDMINE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'REDMINE_API_KEY not configured',
      hint: 'Add REDMINE_API_KEY in Vercel Environment Variables'
    });
  }

  try {
    if (req.method === 'GET') {
      const projectId = req.query.project_id;
      const [trackersR, prioritiesR, categoriesR] = await Promise.all([
        fetch(`${REDMINE_BASE}/trackers.json`, { headers: headers(apiKey) }),
        fetch(`${REDMINE_BASE}/enumerations/issue_priorities.json`, { headers: headers(apiKey) }),
        projectId
          ? fetch(`${REDMINE_BASE}/projects/${projectId}/issue_categories.json`, { headers: headers(apiKey) })
          : Promise.resolve(null)
      ]);

      const trackers = trackersR.ok ? ((await trackersR.json()).trackers || []) : [];
      const priorities = prioritiesR.ok ? ((await prioritiesR.json()).issue_priorities || []) : [];
      let categories = [];
      if (categoriesR && categoriesR.ok) {
        categories = (await categoriesR.json()).issue_categories || [];
      }

      return res.status(200).json({ trackers, priorities, categories });
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

      const r = await fetch(`${REDMINE_BASE}/issues.json`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({ issue })
      });
      const text = await r.text();
      let data = {};
      try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 500) }; }

      if (!r.ok) {
        const errs = data.errors || data.error || data.raw || text.slice(0, 400);
        return res.status(r.status).json({
          error: 'Redmine rejected create',
          status: r.status,
          detail: errs,
          sent: { project_id, tracker_id: issue.tracker_id || null, subject: issue.subject }
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
