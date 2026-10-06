/**
 * Cloudinary for Knowledge Base screenshots (v4.54.0)
 *
 * The browser uploads images straight to Cloudinary (no Vercel body limit),
 * using a short-lived signature from here; the API secret never leaves the
 * server. Only signed-in, allowed users (same guard as Redmine) can sign.
 *
 *   GET  /api/cloudinary                → { configured, cloudName, folder }
 *   POST /api/cloudinary {action:'sign'}                 → upload signature
 *   POST /api/cloudinary {action:'destroy', public_id}   → delete one image
 *
 * Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
 *      CLOUDINARY_FOLDER (optional, default "erp-update-list/kb")
 */
import crypto from 'node:crypto';
import { requireUser } from './_lib/auth.js';

function cfg() {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  const folder = (process.env.CLOUDINARY_FOLDER || 'erp-update-list/kb').trim().replace(/^\/+|\/+$/g, '');
  return { cloudName, apiKey, apiSecret, folder, ok: !!(cloudName && apiKey && apiSecret) };
}

// Cloudinary signature: sha1 of the sorted "k=v&k=v" params + api_secret
function sign(params, secret) {
  const str = Object.keys(params).sort()
    .filter(k => params[k] !== undefined && params[k] !== '')
    .map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(str + secret).digest('hex');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return {};
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;   // requireUser already answered 401/403

  const c = cfg();
  if (req.method === 'GET') {
    return res.status(200).json({ configured: c.ok, cloudName: c.ok ? c.cloudName : null, folder: c.ok ? c.folder : null });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!c.ok) {
    return res.status(503).json({ error: 'Cloudinary is not configured', hint: 'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Vercel, then redeploy.' });
  }

  const body = await readBody(req);
  const timestamp = Math.floor(Date.now() / 1000);

  if (body.action === 'sign') {
    const params = { folder: c.folder, timestamp };
    return res.status(200).json({
      cloudName: c.cloudName,
      apiKey: c.apiKey,
      folder: c.folder,
      timestamp,
      signature: sign(params, c.apiSecret),
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/image/upload`
    });
  }

  if (body.action === 'destroy') {
    const publicId = String(body.public_id || '');
    // only images in our own folder can be deleted
    if (!publicId.startsWith(c.folder + '/') || !/^[\w\-/.]+$/.test(publicId) || publicId.includes('..')) {
      return res.status(400).json({ error: 'Invalid public_id' });
    }
    const params = { public_id: publicId, timestamp };
    const form = new URLSearchParams({ ...params, api_key: c.apiKey, signature: sign(params, c.apiSecret) });
    try {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/image/destroy`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
      });
      const d = await r.json().catch(() => ({}));
      return res.status(r.ok ? 200 : r.status).json({ result: d.result || null, error: d.error ? d.error.message : undefined });
    } catch (err) {
      return res.status(502).json({ error: 'Cloudinary destroy failed', detail: String(err.message || err) });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
