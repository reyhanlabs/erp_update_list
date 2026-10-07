/* ============================================================
   REDMINE API PROXY — Vercel Serverless Function
   Endpoint: /api/redmine
   ============================================================ */

import { requireUser } from './_lib/auth.js';

const REDMINE_BASE = 'https://pjm.zahironline.com';

async function fetchStatusesWithRetry(apiKey, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${REDMINE_BASE}/issue_statuses.json`, {
        method: 'GET',
        headers: {
          'X-Redmine-API-Key': apiKey,
          'Accept': 'application/json',
          'User-Agent': 'Zahir-ERP-Update-Manager/1.0'
        }
      });
      if (response.ok) {
        const data = await response.json();
        return data.issue_statuses || [];
      }
      lastErr = new Error(`Failed to load issue statuses (${response.status})`);
      // Retry on 502/503/504
      if (![502, 503, 504].includes(response.status)) throw lastErr;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
  throw lastErr || new Error('Failed to load issue statuses');
}

async function resolveStatusId(apiKey, statusName) {
  if (!statusName) return null;
  const needle = String(statusName).toLowerCase().trim();

  const statuses = await fetchStatusesWithRetry(apiKey);

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

/* ---- Client name catalogue (for Knowledge Base suggestions) ----
 * Collects every distinct value of the "Client Name" custom field by paging
 * through issues in all projects the API key can see. Works without admin
 * rights: the field id is read from the issues themselves when not given. */
const CLIENT_FIELD_RE = /^(client( name)?|customer( name)?)$/i;

async function redmineGet(apiKey, path) {
  const r = await fetch(`${REDMINE_BASE}${path}`, {
    headers: { 'X-Redmine-API-Key': apiKey, 'Accept': 'application/json', 'User-Agent': 'Zahir-ERP-Update-Manager/1.0' }
  });
  if (!r.ok) {
    const err = new Error(`Redmine ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function clientValuesOf(issue, cfId) {
  const f = (issue.custom_fields || []).find(cf =>
    cfId ? String(cf.id) === String(cfId) : CLIENT_FIELD_RE.test(String(cf.name || '').trim()));
  if (!f) return [];
  const v = Array.isArray(f.value) ? f.value : [f.value];
  return v.map(x => String(x || '').trim()).filter(Boolean);
}

async function collectClientNames(apiKey, cfIdParam) {
  const started = Date.now();
  const BUDGET_MS = 8000;      // stay under the serverless time limit
  const PAGE = 100;            // Redmine maximum
  const MAX_PAGES = 60;        // up to 6,000 issues
  const PARALLEL = 4;

  let cfId = /^\d+$/.test(String(cfIdParam || '')) ? String(cfIdParam) : null;
  let possible = [];

  // 1) list-type field: take its predefined values (needs admin; optional)
  try {
    const cf = await redmineGet(apiKey, '/custom_fields.json');
    const field = (cf.custom_fields || []).find(x => cfId ? String(x.id) === cfId : CLIENT_FIELD_RE.test(String(x.name || '').trim()));
    if (field) {
      cfId = String(field.id);
      possible = (field.possible_values || []).map(v => String(v.value ?? v.label ?? '').trim()).filter(Boolean);
    }
  } catch (_) { /* not admin: fall back to scanning issues */ }

  // 2) find the field id from issues when still unknown
  if (!cfId) {
    const probe = await redmineGet(apiKey, `/issues.json?status_id=*&limit=${PAGE}&sort=updated_on:desc`);
    for (const issue of probe.issues || []) {
      const f = (issue.custom_fields || []).find(cf => CLIENT_FIELD_RE.test(String(cf.name || '').trim()));
      if (f) { cfId = String(f.id); break; }
    }
    if (!cfId) return { clients: possible.map(name => ({ name, count: 0 })), fieldId: null, scanned: 0, total: 0, complete: true };
  }

  // 3) page through issues that have a client set
  const counts = new Map();
  const base = `/issues.json?status_id=*&cf_${cfId}=*&limit=${PAGE}&sort=updated_on:desc`;
  const first = await redmineGet(apiKey, `${base}&offset=0`);
  const total = first.total_count || 0;
  let scanned = 0;
  // per client: issue count + open count, statuses, projects, last update (v4.51.0)
  const stats = new Map();
  const take = (data) => {
    for (const issue of data.issues || []) {
      scanned++;
      const open = !issue.closed_on && !(issue.status && issue.status.is_closed);
      const st = (issue.status && issue.status.name) || 'Unknown';
      const pr = (issue.project && issue.project.name) || '';
      for (const name of clientValuesOf(issue, cfId)) {
        counts.set(name, (counts.get(name) || 0) + 1);
        const s0 = stats.get(name) || { open: 0, statuses: {}, projects: {}, updated: '', byProject: {} };
        const upd = String(issue.updated_on || '');
        if (open) s0.open++;
        s0.statuses[st] = (s0.statuses[st] || 0) + 1;
        if (pr) s0.projects[pr] = (s0.projects[pr] || 0) + 1;
        if (upd > s0.updated) s0.updated = upd;
        // same numbers per product, so the overview can be filtered by product (v4.52.0)
        const key = pr || 'Other';
        const bp = s0.byProject[key] || (s0.byProject[key] = { total: 0, open: 0, statuses: {}, updated: '' });
        bp.total++;
        if (open) bp.open++;
        bp.statuses[st] = (bp.statuses[st] || 0) + 1;
        if (upd > bp.updated) bp.updated = upd;
        stats.set(name, s0);
      }
    }
  };
  take(first);

  const offsets = [];
  for (let off = PAGE; off < total && offsets.length < MAX_PAGES - 1; off += PAGE) offsets.push(off);
  let complete = offsets.length === Math.ceil(Math.max(0, total - PAGE) / PAGE);
  for (let i = 0; i < offsets.length; i += PARALLEL) {
    if (Date.now() - started > BUDGET_MS) { complete = false; break; }
    const batch = offsets.slice(i, i + PARALLEL);
    const pages = await Promise.allSettled(batch.map(off => redmineGet(apiKey, `${base}&offset=${off}`)));
    pages.forEach(p => { if (p.status === 'fulfilled') take(p.value); else complete = false; });
  }

  possible.forEach(name => { if (!counts.has(name)) counts.set(name, 0); });
  const clients = [...counts.entries()]
    .map(([name, count]) => {
      const st = stats.get(name);
      return st ? { name, count, open: st.open, statuses: st.statuses, projects: st.projects, updated: st.updated, byProject: st.byProject } : { name, count, open: 0 };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { clients, fieldId: cfId, scanned, total, complete };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;


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
      assigned_to_id,
      issue_id,
      resource,
      client_name
    } = req.query;

    // Distinct client names (Knowledge Base suggestions)
    if (resource === 'client_names') {
      try {
        const out = await collectClientNames(apiKey, req.query.cf_id);
        return res.status(200).json(out);
      } catch (err) {
        return res.status(err.status || 502).json({ error: 'Could not load client names', detail: String(err.message || err) });
      }
    }

    // Latest progress notes per issue (Client Report, v4.55.0): ids=1,2,3 (max 50)
    if (resource === 'journals') {
      const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(x => /^\d{1,9}$/.test(x)).slice(0, 50);
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      const started = Date.now();
      const out = {};
      const one = async (id) => {
        if (Date.now() - started > 8000) return;          // stay inside the function time limit
        try {
          const d = await redmineGet(apiKey, `/issues/${id}.json?include=journals`);
          const js = ((d.issue && d.issue.journals) || []).filter(j => String(j.notes || '').trim());
          out[id] = {
            notes: js.slice(-2).reverse().map(j => ({
              text: String(j.notes).trim().slice(0, 1500),
              by: (j.user && j.user.name) || '',
              at: j.created_on || ''
            })),
            count: js.length
          };
        } catch (err) {
          out[id] = { error: err.status || 'failed' };
        }
      };
      for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(one));
      return res.status(200).json({ journals: out, partial: ids.some(id => !out[id]) });
    }

    // List custom fields (to resolve "Client Name" id, etc.)
    if (resource === 'custom_fields') {
      const cfRes = await fetch(`${REDMINE_BASE}/custom_fields.json`, {
        method: 'GET',
        headers: {
          'X-Redmine-API-Key': apiKey,
          'Accept': 'application/json',
          'User-Agent': 'Zahir-ERP-Update-Manager/1.0'
        }
      });
      const text = await cfRes.text();
      if (!cfRes.ok) {
        return res.status(cfRes.status).json({
          error: 'Redmine custom_fields error',
          detail: text.slice(0, 500)
        });
      }
      return res.status(200).json(JSON.parse(text));
    }

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
    if (issue_id)       url.searchParams.set('issue_id', issue_id);

    // Forward any cf_<id>=value custom field filters
    Object.keys(req.query || {}).forEach((k) => {
      if (/^cf_\d+$/i.test(k) && req.query[k] != null && req.query[k] !== '') {
        url.searchParams.set(k, String(req.query[k]));
      }
    });
    // Convenience: client_name + client_cf_id (set by app after resolving field id)
    if (client_name && req.query.client_cf_id) {
      url.searchParams.set('cf_' + String(req.query.client_cf_id), String(client_name));
    }

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
        updated_on: issue.updated_on,
        custom_fields: issue.custom_fields || [],
        // Client Report (v4.55.0): the request text and progress fields
        ...(req.query.with_description ? {
          description: String(issue.description || '').slice(0, 6000),
          done_ratio: issue.done_ratio ?? null,
          closed_on: issue.closed_on || null,
          due_date: issue.due_date || null
        } : {})
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
