/* ============================================================
   REDMINE PROJECTS API — Vercel Serverless Function
   Endpoint: /api/redmine-projects
   Fetch list of projects from Redmine for dropdown selection.
   ============================================================ */

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
    const url = new URL('https://pjm.zahironline.com/projects.json');
    url.searchParams.set('limit', '100');
    url.searchParams.set('sort', 'name');

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
      console.error('Redmine projects API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Redmine API error',
        status: response.status,
        detail: errorText.slice(0, 500)
      });
    }

    const data = await response.json();

    // Trim to only needed fields
    if (data.projects && Array.isArray(data.projects)) {
      data.projects = data.projects.map(p => ({
        id: p.id,
        identifier: p.identifier,
        name: p.name,
        status: p.status,
        parent: p.parent ? { id: p.parent.id, name: p.parent.name } : null
      }));
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({
      error: 'Proxy failed',
      detail: err.message
    });
  }
}