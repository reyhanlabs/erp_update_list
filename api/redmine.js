/* ============================================================
   REDMINE API PROXY — Vercel Serverless Function
   Endpoint: /api/redmine
   Forwards requests to Redmine with X-Redmine-API-Key header.
   Solves CORS issue since Redmine doesn't send CORS headers.
   ============================================================ */

export default async function handler(req, res) {
  // CORS headers — allow browser to call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  // API key must be set in Vercel Environment Variables
  const apiKey = process.env.REDMINE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'REDMINE_API_KEY not configured',
      hint: 'Add REDMINE_API_KEY in Vercel Project Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    // Build Redmine URL with forwarded query params
    const { status_id, updated_on, limit, offset, project_id, sort, assigned_to_id } = req.query;

    const url = new URL('https://pjm.zahironline.com/issues.json');

    if (status_id) url.searchParams.set('status_id', status_id);
    if (updated_on) url.searchParams.set('updated_on', updated_on);
    if (offset) url.searchParams.set('offset', offset);
    if (project_id) url.searchParams.set('project_id', project_id);
    if (assigned_to_id) url.searchParams.set('assigned_to_id', assigned_to_id);
    if (sort) url.searchParams.set('sort', sort);

    // Default limit: 100, max 100 per Redmine default
    url.searchParams.set('limit', limit || '100');

    // Forward to Redmine with API key
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Redmine-API-Key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'Zahir-ERP-Update-Manager/1.0'
      }
    });

    // Handle Redmine errors
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

    // Parse and forward response
    const data = await response.json();

    // Optional: trim response to only needed fields to reduce payload size
    if (data.issues && Array.isArray(data.issues)) {
      data.issues = data.issues.map(issue => ({
        id: issue.id,
        subject: issue.subject,
        status: issue.status,
        priority: issue.priority,
        project: issue.project,
        tracker: issue.tracker,
        author: issue.author,
        assigned_to: issue.assigned_to,
        created_on: issue.created_on,
        updated_on: issue.updated_on
      }));
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