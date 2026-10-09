/**
 * Cron: check every client's Zahir ERP version on the server (v4.61.0)
 *
 * No browser needed. Each run:
 *   1. reads all Client Versions sites (every workspace, firebase-admin)
 *   2. checks the ones that are failing first, then the ones not checked for
 *      SITES_CRON_STALE_HOURS, as many as fit in the time budget
 *   3. writes the same fields the app writes (versions, history, errors) plus
 *      failCount / downSince, and
 *   4. sends one Telegram message: version changes, sites that went DOWN
 *      (failed DOWN_AFTER checks in a row) and sites that are back UP.
 *   If sites are left over, it starts the next round itself (max ROUNDS_MAX).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (Vercel Cron sends it) or ?secret=
 * Env:
 *   CRON_SECRET, FIREBASE_SERVICE_ACCOUNT  — required
 *   TELEGRAM_BOT_TOKEN                     — for alerts
 *   SITES_TELEGRAM_CHAT_ID                 — optional, default TELEGRAM_CHAT_ID
 *   SITES_TELEGRAM                         — "off" to disable alerts
 *   SITES_CRON_STALE_HOURS                 — default 12
 *   SITES_CRON_BUDGET_MS                   — default 50000 (function maxDuration is 60 s)
 *
 * Vercel Cron runs it once a day (vercel.json). For down alerts within the day,
 * call it more often from an external scheduler (e.g. cron-job.org every 30 min).
 */
import { adminDb } from './_lib/firebase-admin.js';
import { safeEqual } from './_lib/auth.js';
import { detectVersion } from './erp-version.js';

const DOWN_AFTER = 2;            // consecutive failed checks before a site counts as down
const HISTORY_MAX = 50;
const PARALLEL = 8;
const ROUNDS_MAX = 20;
const API_KEYS = ['v2', 'v3'];
const LABEL = { fe: 'FE', v2: 'V2', v3: 'V3' };

function getSecret(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.query && req.query.secret) return String(req.query.secret);
  return '';
}

function releaseOf(raw) {
  const m = String(raw || '').match(/"(?:release_?date|releaseDate|released_?at|build_?date|date)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : '';
}

/* Same fields the app writes in src/features/sites.js (checkSite). */
export function buildPatch(site, d, now) {
  const patch = { checkedAt: now, checkedBy: 'server' };
  const backend = d.backend || {};
  API_KEYS.forEach(k => {
    const b = backend[k];
    if (!b) return;
    patch[k + 'Raw'] = b.raw || '';
    patch[k + 'Error'] = b.version ? '' : (b.error || 'not found');
    if (b.version) {
      patch[k] = b.version;
      patch[k + 'Release'] = b.releaseDate || releaseOf(b.raw);
      if (site[k] && site[k] !== b.version) { patch[k + 'Prev'] = site[k]; patch[k + 'ChangedAt'] = now; }
    }
  });
  const down = !!d.error;
  if (down) {
    Object.assign(patch, { checkError: d.error, checkHint: d.hint || '' });
  } else {
    Object.assign(patch, {
      checkError: d.version ? '' : 'Version not found on the login page', checkHint: '',
      confidence: d.confidence || '', versionSource: d.source || '', tlsNote: d.tlsNote || '',
      candidates: (d.candidates || []).slice(0, 6)
    });
    if (d.chunkHint) patch.chunkHint = String(d.chunkHint);
    if (d.version) {
      patch.version = d.version;
      if (site.version && site.version !== d.version) { patch.prevVersion = site.version; patch.versionChangedAt = now; }
      if (!site.version) patch.versionChangedAt = now;
    }
  }
  // version history: only real changes, not the first reading
  const changes = [];
  const add = (part, from, to) => { if (from && to && from !== to) changes.push({ at: now, part, from, to }); };
  add('fe', site.version, patch.version);
  API_KEYS.forEach(k => add(k, site[k], patch[k]));
  if (changes.length) patch.history = [...(Array.isArray(site.history) ? site.history : []), ...changes].slice(-HISTORY_MAX);

  // down / up tracking
  let event = null;
  if (down) {
    patch.failCount = (site.failCount || 0) + 1;
    patch.downSince = site.downSince || now;
    if (patch.failCount >= DOWN_AFTER && !site.downNotifiedAt) { patch.downNotifiedAt = now; event = 'down'; }
  } else {
    patch.failCount = 0;
    patch.downSince = null;
    if (site.downNotifiedAt) { patch.downNotifiedAt = null; event = 'up'; }
  }
  return { patch, changes, event };
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = String(process.env.SITES_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId || String(process.env.SITES_TELEGRAM || '').toLowerCase() === 'off') return { sent: false };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true })
  });
  const data = await r.json().catch(() => ({}));
  return { sent: !!(r.ok && data.ok), error: data.description };
}

const host = (url) => { try { return new URL(url).host; } catch (_) { return url; } };
const hhmm = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dur = (ms) => { const h = Math.round(ms / 3600000); return h < 1 ? `${Math.max(1, Math.round(ms / 60000))} min` : h < 48 ? `${h} h` : `${Math.round(h / 24)} days`; };

export function formatMessage({ changed, down, up }) {
  const parts = [];
  if (down.length) parts.push(`🔴 Not reachable — ${down.length}\n` + down.map(x => `${x.name} (${host(x.url)})\n  since ${hhmm(x.since)} · ${x.error}`).join('\n'));
  if (up.length) parts.push(`🟢 Back up — ${up.length}\n` + up.map(x => `${x.name} (${host(x.url)}) — was down ${dur(x.downFor)}`).join('\n'));
  if (changed.length) parts.push(`🔄 Version changes — ${changed.length}\n` + changed.slice(0, 40).map(x => `${x.name} (${host(x.url)})\n` + x.changes.map(c => `  ${LABEL[c.part] || c.part} ${c.from} → ${c.to}`).join('\n')).join('\n') + (changed.length > 40 ? `\n…and ${changed.length - 40} more` : ''));
  return parts.length ? `Zahir ERP client sites\n\n${parts.join('\n\n')}` : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  if (!safeEqual(getSecret(req), expected)) return res.status(401).json({ error: 'Unauthorized' });

  const started = Date.now();
  const budget = Math.max(5000, Number(process.env.SITES_CRON_BUDGET_MS) || 50000);
  const staleMs = Math.max(1, Number(process.env.SITES_CRON_STALE_HOURS) || 12) * 3600000;
  const round = Math.max(1, Number(req.query?.round) || 1);

  let db;
  try { db = adminDb(); } catch (err) { return res.status(500).json({ error: err.message }); }

  // every site of every workspace
  const snap = await db.collectionGroup('sites').get();
  const sites = snap.docs.map(doc => ({ ref: doc.ref, ws: doc.ref.parent.parent?.id || '', ...doc.data() }))
    .filter(s => s.url);
  const now0 = Date.now();
  const failing = sites.filter(s => (s.failCount || 0) > 0 || s.downNotifiedAt);
  const stale = sites.filter(s => !failing.includes(s) && now0 - (s.checkedAt || 0) > staleMs)
    .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0));
  const queue = [...failing.filter(s => now0 - (s.checkedAt || 0) > 10 * 60000), ...stale];
  const hints = {};
  sites.forEach(s => { if (s.chunkHint) (hints[s.ws] = hints[s.ws] || new Set()).add(String(s.chunkHint)); });

  const changed = [], down = [], up = [], errors = [];
  let checked = 0;
  const worker = async () => {
    while (queue.length && Date.now() - started < budget - 9000) {
      const site = queue.shift();
      try {
        const hint = [...(hints[site.ws] || [])].slice(0, 3).join(',');
        const d = await detectVersion(site.url, { hint });
        const now = Date.now();
        const { patch, changes, event } = buildPatch(site, d, now);
        await site.ref.set(patch, { merge: true });
        checked++;
        if (changes.length) changed.push({ name: site.name, url: site.url, changes });
        if (event === 'down') down.push({ name: site.name, url: site.url, since: patch.downSince, error: d.error });
        if (event === 'up') up.push({ name: site.name, url: site.url, downFor: now - (site.downSince || site.downNotifiedAt || now) });
      } catch (err) {
        errors.push(`${site.name}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length || 1) }, worker));

  const text = formatMessage({ changed, down, up });
  let telegram = { sent: false };
  if (text) { try { telegram = await sendTelegram(text); } catch (err) { telegram = { sent: false, error: err.message }; } }

  // more to do: start the next round (it runs on its own; we don't wait for it)
  let next = false;
  if (queue.length && round < ROUNDS_MAX) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${req.headers.host}/api/cron-sites?round=${round + 1}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try { await fetch(url, { headers: { Authorization: `Bearer ${expected}` }, signal: ctrl.signal }); } catch (_) { /* started, not awaited */ }
    clearTimeout(t);
    next = true;
  }

  return res.status(200).json({
    ok: true, round, sites: sites.length, checked, left: queue.length, nextRound: next,
    changed: changed.length, down: down.map(x => x.name), up: up.map(x => x.name),
    telegram, errors: errors.slice(0, 10), ms: Date.now() - started
  });
}
