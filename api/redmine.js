/* ============================================================
   REDMINE API PROXY — Vercel Serverless Function
   Endpoint: /api/redmine
   ============================================================ */

const REDMINE_BASE = 'https://pjm.zahironline.com';

async function resolveStatusId(apiKey, statusName) {
  if (!statusName) return null;
  const needle = String(statusName).toLowerCase().trim();

  const response = await fetch(`${REDMINE_BASE}/issue_statuses.json`, {
    method: 'GET',
    headers: {
      'X-Redmine-API-Key': apiKey,
      'Accept': 'application/json',
      'User-Agent': 'Zahir-ERP-Update-Manager/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load issue statuses (${response.status})`);
  }

  const data = await response.json();
  const statuses = data.issue_statuses || [];

  // Exact match first, then partial (contains)
  let found = statuses.find(s => (s.name || '').toLowerCase() === needle);
  if (!found) {
    found = statuses.find(s => (s.name || '').toLowerCase().includes(needle));
  }
  // Prefer names that look like "ready for testing"
  if (!found && needle.includes('ready')) {
    found = statuses.find(s => {
      const n = (s.name || '').toLowerCase();
      return n.includes('ready') && (n.includes('test') || n.includes('testing'));
    });
  }

  return found ? { id: found.id, name: found.name } : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const apiKey = process.env.REDMINE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'REDMINE_API_KEY not configured',
      hint: 'Add REDMINE_API_KEY in Vercel Project Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    const {
      status_id,
      status_name,
      updated_on,
      created_on,
      from,
      to,
      date_field,
      limit,
      offset,
      project_id,
      sort,
      assigned_to_id
    } = req.query;

    let resolvedStatusId = status_id || null;
    let resolvedStatusMeta = null;

    // Resolve custom status by name (e.g. "Ready for Testing")
    if (!resolvedStatusId && status_name) {
      resolvedStatusMeta = await resolveStatusId(apiKey, status_name);
      if (!resolvedStatusMeta) {
        return res.status(404).json({
          error: 'Status not found',
          detail: `No Redmine status matching "${status_name}". Check Administration → Issue statuses.`,
          issues: [],
          total_count: 0
        });
      }
      resolvedStatusId = String(resolvedStatusMeta.id);
    }

    const url = new URL(`${REDMINE_BASE}/issues.json`);

    if (resolvedStatusId) url.searchParams.set('status_id', resolvedStatusId);
    if (updated_on)     url.searchParams.set('updated_on', updated_on);
    if (created_on)     url.searchParams.set('created_on', created_on);
    if (offset)         url.searchParams.set('offset', offset);
    if (project_id)     url.searchParams.set('project_id', project_id);
    if (assigned_to_id) url.searchParams.set('assigned_to_id', assigned_to_id);
    if (sort)           url.searchParams.set('sort', sort);

    // Range builder — Redmine pakai sintaks "><from|to" (eksklusif)
    if (from || to) {
      const field = date_field === 'created' ? 'created_on' : 'updated_on';
      const pad = n => String(n).padStart(2, '0');
      const nextDay = (dateStr) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      };

      if (from && to) {
        url.searchParams.set(field, `><${from}|${nextDay(to)}`);
      } else if (from) {
        url.searchParams.set(field, `>=${from}`);
      } else {
        url.searchParams.set(field, `<${nextDay(to)}`);
      }
    }

    url.searchParams.set('limit', limit || '100');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Redmine-API-Key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'Zahir-ERP-Update-Manager/1.0'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Redmine API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Redmine API error',
        status: response.status,
        statusText: response.statusText,
        detail: errorText.slice(0, 500)
      });
    }

    const data = await response.json();

    if (data.issues && Array.isArray(data.issues)) {
      data.issues = data.issues.map(issue => ({
        id: issue.id,
        subject: issue.subject,
        status: issue.status,
        priority: issue.priority,
        project: issue.project,
        tracker: issue.tracker,
        category: issue.category || null,
        author: issue.author,
        assigned_to: issue.assigned_to,
        created_on: issue.created_on,
        updated_on: issue.updated_on
      }));
    }

    if (resolvedStatusMeta) {
      data.resolved_status = resolvedStatusMeta;
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({
      error: 'Proxy failed',
      detail: err.message,
      hint: 'Check that pjm.zahironline.com is reachable and REDMINE_API_KEY is valid.'
    });
  }
}
