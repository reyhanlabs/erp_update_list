/**
 * Cron: poll Redmine RFT → Telegram (no browser tab needed)
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>
 * Env:
 *   CRON_SECRET          — required
 *   TELEGRAM_BOT_TOKEN   — required
 *   TELEGRAM_CHAT_ID     — required (group/user chat id)
 *   REDMINE_API_KEY      — required
 *   FIREBASE_SERVICE_ACCOUNT — required (service-account JSON; state is written
 *                              with firebase-admin, so Firestore rules can keep
 *                              /system locked to clients)
 *
 * Prefer the Authorization header — query-string secrets end up in access logs.
 *
 * Vercel → Settings → Cron Jobs, or vercel.json "crons"
 * Hobby plan may limit frequency; external cron (cron-job.org) also works.
 */

import { adminDb } from './_lib/firebase-admin.js';
import { safeEqual } from './_lib/auth.js';

const REDMINE_BASE = 'https://pjm.zahironline.com';
const STATE_DOC = 'system/rftTelegramState';

const RFT_PROJECTS = [
  { id: 75, label: 'Zahir ERP' },
  { id: 119, label: 'Zahir ERP One' },
  { id: 113, label: 'Zahir ERP Manufacturing' }
];

function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized', hint: 'Pass CRON_SECRET via Bearer token or ?secret=' });
}

function getSecret(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.query && req.query.secret) return String(req.query.secret);
  return '';
}

async function resolveRftStatusId(apiKey) {
  const r = await fetch(`${REDMINE_BASE}/issue_statuses.json`, {
    headers: { 'X-Redmine-API-Key': apiKey, Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`statuses ${r.status}`);
  const data = await r.json();
  const list = data.issue_statuses || [];
  const found =
    list.find((s) => (s.name || '').toLowerCase() === 'ready for testing') ||
    list.find((s) => /ready\s*for\s*testing/i.test(s.name || ''));
  if (!found) throw new Error('RFT status not found in Redmine');
  return found.id;
}

async function fetchRftForProject(apiKey, statusId, projectId) {
  const all = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${REDMINE_BASE}/issues.json`);
    url.searchParams.set('status_id', String(statusId));
    url.searchParams.set('project_id', String(projectId));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', 'updated_on:desc');
    const r = await fetch(url.toString(), {
      headers: { 'X-Redmine-API-Key': apiKey, Accept: 'application/json' }
    });
    if (!r.ok) throw new Error(`issues project ${projectId}: ${r.status}`);
    const data = await r.json();
    const batch = data.issues || [];
    all.push(...batch);
    const total = data.total_count;
    if (batch.length < limit) break;
    if (typeof total === 'number' && all.length >= total) break;
    offset += limit;
  }
  return all;
}

async function loadState() {
  try {
    const snap = await adminDb().doc(STATE_DOC).get();
    if (!snap.exists) return { notifiedIds: [], seeded: false };
    const d = snap.data() || {};
    let notifiedIds = [];
    // Stored as a JSON string (compatible with the old REST format)
    try {
      notifiedIds = Array.isArray(d.notifiedIds) ? d.notifiedIds : JSON.parse(d.notifiedIds || '[]');
    } catch (_) { notifiedIds = []; }
    if (!Array.isArray(notifiedIds)) notifiedIds = [];
    return { notifiedIds: notifiedIds.map(String), seeded: d.seeded === true };
  } catch (err) {
    console.warn('state load err', err.message);
    return { notifiedIds: [], seeded: false, stateError: err.message };
  }
}

async function saveState(notifiedIds, seeded) {
  // Keep last 2000 ids to bound size
  const trimmed = notifiedIds.map(String).slice(-2000);
  try {
    await adminDb().doc(STATE_DOC).set({
      notifiedIds: JSON.stringify(trimmed),
      seeded: !!seeded,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (err) {
    console.warn('state save err', err.message);
    return false;
  }
}

async function sendTelegram(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4000),
      disable_web_page_preview: true
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${r.status}`);
  }
  return data;
}

export default async function handler(req, res) {
  // Vercel Cron sends GET; allow GET + POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({
      error: 'CRON_SECRET not configured',
      hint: 'Vercel → Env → add CRON_SECRET (random string) → Redeploy'
    });
  }
  if (!safeEqual(getSecret(req), cronSecret)) return unauthorized(res);

  const redmineKey = process.env.REDMINE_API_KEY;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!redmineKey) return res.status(500).json({ error: 'REDMINE_API_KEY missing' });
  if (!tgToken) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN missing' });
  if (!chatId) {
    return res.status(500).json({
      error: 'TELEGRAM_CHAT_ID missing',
      hint: 'Add TELEGRAM_CHAT_ID (same chat id as in app Settings) for server-side alerts'
    });
  }

  try {
    const statusId = await resolveRftStatusId(redmineKey);
    const merged = [];
    for (const p of RFT_PROJECTS) {
      try {
        const issues = await fetchRftForProject(redmineKey, statusId, p.id);
        issues.forEach((iss) => {
          merged.push({
            id: iss.id,
            subject: iss.subject || '',
            priority: iss.priority?.name || '',
            category: iss.category?.name || '',
            project: p.label
          });
        });
      } catch (err) {
        console.warn('project fetch', p.id, err.message);
      }
    }

    // Deduplicate
    const byId = new Map();
    merged.forEach((i) => { if (!byId.has(i.id)) byId.set(i.id, i); });
    const issues = Array.from(byId.values());

    const state = await loadState();
    // Never treat an unreadable state as "first run" — that would re-seed or spam
    if (state.stateError) {
      return res.status(500).json({
        error: 'Could not read cron state from Firestore',
        detail: state.stateError,
        hint: 'Check FIREBASE_SERVICE_ACCOUNT in Vercel → Environment Variables.'
      });
    }
    let notified = new Set(state.notifiedIds || []);

    // First successful run: seed only (no spam of entire queue)
    if (!state.seeded || notified.size === 0) {
      issues.forEach((i) => notified.add(String(i.id)));
      const saved = await saveState(Array.from(notified), true);
      return res.status(200).json({
        ok: true,
        action: 'seeded',
        count: issues.length,
        stateSaved: saved,
        hint: saved
          ? 'Baseline saved. Next new RFT will notify Telegram.'
          : 'Could not save state — check FIREBASE_SERVICE_ACCOUNT.'
      });
    }

    const fresh = issues.filter((i) => !notified.has(String(i.id)));
    if (!fresh.length) {
      return res.status(200).json({ ok: true, action: 'none', rftTotal: issues.length, newCount: 0 });
    }

    // Notify
    let text = `🆕 Ready for Testing — ${fresh.length} new\n\n`;
    fresh.slice(0, 15).forEach((i) => {
      text += `#${i.id}`;
      if (i.priority) text += ` [${i.priority}]`;
      if (i.category) text += ` · ${i.category}`;
      if (i.project) text += ` · ${i.project}`;
      text += `\n${(i.subject || '').slice(0, 120)}\nhttps://pjm.zahironline.com/issues/${i.id}\n\n`;
    });
    if (fresh.length > 15) text += `…and ${fresh.length - 15} more\n`;

    await sendTelegram(tgToken, chatId, text.trim());

    fresh.forEach((i) => notified.add(String(i.id)));
    // Drop ids no longer in RFT queue (optional cleanup)
    const current = new Set(issues.map((i) => String(i.id)));
    notified = new Set(Array.from(notified).filter((id) => current.has(id) || fresh.some((f) => String(f.id) === id)));
    // Keep notified of current RFT + just sent
    issues.forEach((i) => notified.add(String(i.id)));

    const saved = await saveState(Array.from(notified), true);

    return res.status(200).json({
      ok: true,
      action: 'notified',
      newCount: fresh.length,
      ids: fresh.map((i) => i.id),
      stateSaved: saved
    });
  } catch (err) {
    console.error('cron-rft-telegram', err);
    return res.status(500).json({ error: err.message || 'Cron failed' });
  }
}
