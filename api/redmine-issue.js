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
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
      }

      const project_id = body.project_id;
      const subject = (body.subject || '').trim();
      const description = (body.description || '').trim();
      if (!project_id) return res.status(400).json({ error: 'project_id required' });
      if (!subject) return res.status(400).json({ error: 'subject required' });

      const issue = {
        project_id: Number(project_id),
        subject: subject.slice(0, 255),
        description
      };
      if (body.tracker_id) issue.tracker_id = Number(body.tracker_id);
      if (body.priority_id) issue.priority_id = Number(body.priority_id);
      if (body.category_id) issue.category_id = Number(body.category_id);

      const r = await fetch(`${REDMINE_BASE}/issues.json`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({ issue })
      });
      const text = await r.text();
      let data = {};
      try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 500) }; }

      if (!r.ok) {
        return res.status(r.status).json({
          error: 'Redmine rejected create',
          status: r.status,
          detail: data.errors || data.error || data.raw || text.slice(0, 400)
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
