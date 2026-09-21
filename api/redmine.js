/* ============================================================
   REDMINE API PROXY — Vercel Serverless Function
   Endpoint: /api/redmine
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
    const {
      status_id,
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

    const url = new URL('https://pjm.zahironline.com/issues.json');

    if (status_id)      url.searchParams.set('status_id', status_id);
    if (updated_on)     url.searchParams.set('updated_on', updated_on);
    if (created_on)     url.searchParams.set('created_on', created_on);
    if (offset)         url.searchParams.set('offset', offset);
    if (project_id)     url.searchParams.set('project_id', project_id);
    if (assigned_to_id) url.searchParams.set('assigned_to_id', assigned_to_id);
    if (sort)           url.searchParams.set('sort', sort);

    // Range builder — Redmine pakai sintaks "><from|to" (eksklusif)
    // Kalau cuma satu sisi: ">=YYYY-MM-DD" atau "<YYYY-MM-DD"
    if (from || to) {
      const field = date_field === 'created' ? 'created_on' : 'updated_on';
      const pad = n => String(n).padStart(2, '0');
      const nextDay = (dateStr) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      };

      if (from && to) {
        // dua sisi → "><from|to+1"
        url.searchParams.set(field, `><${from}|${nextDay(to)}`);
      } else if (from) {
        url.searchParams.set(field, `>=${from}`);
      } else {
        // hanya "to" → inklusif sampai akhir hari
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