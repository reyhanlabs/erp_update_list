/**
 * Zahir ERP version detector (v4.56.0)
 *
 * GET /api/erp-version?url=https://apt.zahirerp.com/auth[&debug=1]
 *
 * The login page shows the version (bottom-left) without signing in, but it
 * is drawn by JavaScript, so the HTML alone doesn't contain it. This looks in,
 * in order of trust:
 *   1. JSON endpoints referenced by the app or commonly used (version.json, …)
 *   2. app-version constants inside the page's own JavaScript bundles
 *   3. version-like text in the HTML
 * and returns the best match plus the other candidates (for checking/tuning).
 *
 * Only https URLs on allowed hosts are fetched (default *.zahirerp.com;
 * add more with ERP_VERSION_HOSTS="example.co.id,erp.client.com").
 * Same sign-in guard as the Redmine endpoints.
 */
import { requireUser } from './_lib/auth.js';

const BUDGET_MS = 8500;
const MAX_FILE = 6 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;
const MAX_FILES = 16;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const VER = String.raw`v?(\d{1,4}\.\d{1,3}(?:\.\d{1,5}){0,2}(?:[-+][0-9A-Za-z.\-]{1,24})?)`;
const LIB_NEAR = /\b(vue|react|angular|axios|core-js|lodash|moment|dayjs|chart|bootstrap|jquery|element|antd|ant-design|quasar|vuetify|sentry|firebase|webpack|babel|tslib|zone\.js|rxjs|swiper|sweetalert|popper|tinymce|quill|pdf|xlsx|socket|echarts|apexcharts|highcharts|leaflet|i18n|pinia|vuex|router|primevue|naive|tailwind|fontawesome|crypto|uuid|nprogress|workbox|hammer)\b/i;

function allowedSuffixes() {
  const extra = String(process.env.ERP_VERSION_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return ['zahirerp.com', ...extra];
}
function hostAllowed(host) {
  const h = String(host || '').toLowerCase();
  if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h === 'localhost') return false;
  return allowedSuffixes().some(s => h === s || h.endsWith('.' + s));
}

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  u.protocol = 'https:';
  u.hash = '';
  if (!hostAllowed(u.hostname)) return { blocked: u.hostname };
  return u;
}

async function fetchText(url, deadline, { maxBytes = MAX_FILE } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!hostAllowed(current.hostname) || current.protocol !== 'https:') throw new Error('redirect to a host that is not allowed');
    const left = deadline - Date.now();
    if (left < 300) throw new Error('time budget used up');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(left, 6000));
    let r;
    try {
      r = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: '*/*' } });
    } finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), current);
      continue;
    }
    const len = Number(r.headers.get('content-length') || 0);
    if (len && len > maxBytes) throw new Error('file too large');
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text: text.slice(0, maxBytes), finalUrl: current.toString() };
  }
  throw new Error('too many redirects');
}

function snippet(text, idx, len) {
  const a = Math.max(0, idx - 60), b = Math.min(text.length, idx + len + 60);
  return text.slice(a, b).replace(/\s+/g, ' ').slice(0, 180);
}

/* version-looking values in a JS/HTML text, scored */
function scanText(text, source, isVendor) {
  const out = [];
  const push = (value, score, idx, len) => {
    const ctx = snippet(text, idx, len);
    let s = score;
    if (isVendor) s -= 40;
    if (LIB_NEAR.test(text.slice(Math.max(0, idx - 120), idx + len + 40))) s -= 35;
    if (/^0\.\d/.test(value)) s -= 15;
    out.push({ value, score: s, source, context: ctx });
  };
  const rules = [
    // app/build version constants (Vue CLI, Vite, CRA, Angular environments, custom)
    [new RegExp(String.raw`(?:VUE_APP_VERSION|VITE_APP_VERSION|REACT_APP_VERSION|NG_APP_VERSION|APP_VERSION|app_?[Vv]ersion|appVersion|buildVersion|BUILD_VERSION|releaseVersion|RELEASE_VERSION|webVersion|clientVersion|frontendVersion|feVersion|FE_VERSION|erpVersion|ERP_VERSION|versionApp|version_app|versi_?[Aa]plikasi)["']?\s*[:=]\s*["'\x60]` + VER + `["'\x60]`, 'g'), 100],
    // text shown to users: "Version 4.25.1" / "Versi 4.25.1" / "Ver. 4.25"
    [new RegExp(String.raw`(?:Version|Versi|VERSION|VERSI|Ver\.)\s*:?\s*` + VER + String.raw`(?![\d.])`, 'g'), 75],
    // generic  version:"x.y.z"
    [new RegExp(String.raw`["']?version["']?\s*[:=]\s*["'\x60]` + VER + `["'\x60]`, 'g'), 45]
  ];
  for (const [re, score] of rules) {
    let m;
    while ((m = re.exec(text)) && out.length < 400) push(m[1], score, m.index, m[0].length);
  }
  return out;
}

/* JSON body with a version-like key */
function scanJson(text, source) {
  let data;
  try { data = JSON.parse(text); } catch (_) { return []; }
  const out = [];
  const walk = (o, path, depth) => {
    if (!o || typeof o !== 'object' || depth > 4) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /version|versi|build|release/i.test(k) && new RegExp('^' + VER + '$').test(v.trim())) {
        out.push({ value: v.trim().replace(/^v/i, ''), score: /^(app_?)?version$|^versi$/i.test(k) ? 98 : 85, source: `${source} (${path}${k})`, context: `${k}: ${v}` });
      } else if (typeof v === 'object') walk(v, `${path}${k}.`, depth + 1);
    }
  };
  walk(data, '', 0);
  return out;
}

function sameSiteUrl(ref, base) {
  try {
    const u = new URL(ref, base);
    return hostAllowed(u.hostname) && u.protocol === 'https:' ? u.toString() : null;
  } catch (_) { return null; }
}

export async function detectVersion(rawUrl) {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const target = normalizeUrl(rawUrl);
  if (!target) return { error: 'Invalid URL' };
  if (target.blocked) return { error: `Host not allowed: ${target.blocked}`, hint: 'Only *.zahirerp.com by default. Add other hosts with the ERP_VERSION_HOSTS environment variable.' };

  const candidates = [];
  const fetched = [];
  let totalBytes = 0;
  const log = (url, note) => fetched.push(note ? `${url} (${note})` : url);

  // 1) the login page itself
  let page;
  try { page = await fetchText(target.toString(), deadline); }
  catch (err) { return { error: `Could not open the page: ${err.message}`, url: target.toString() }; }
  if (page.status >= 400) return { error: `The page answered HTTP ${page.status}`, url: target.toString() };
  log(page.finalUrl, `HTTP ${page.status}`);
  const html = page.text;
  totalBytes += html.length;
  candidates.push(...scanText(html.replace(/<script[\s\S]*?<\/script>/gi, ' '), 'page HTML', false));
  // inline scripts (window.__CONFIG__ = {...})
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].forEach(m => candidates.push(...scanText(m[1], 'inline script', false)));

  // 2) script / modulepreload files of the app
  const scriptRefs = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) scriptRefs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["'](?:modulepreload|preload)["'][^>]+href=["']([^"']+\.js[^"']*)["']/gi)) scriptRefs.add(m[1]);
  const queue = [...scriptRefs].map(r => sameSiteUrl(r, page.finalUrl)).filter(Boolean);
  const seen = new Set(queue);
  const endpointRefs = new Set(['/version.json', '/assets/version.json', '/config.json', '/assets/config.json', '/env.json', '/app-config.json', '/build.json', '/meta.json', '/static/version.json']);

  const takeScript = async (url) => {
    if (fetched.length >= MAX_FILES || totalBytes > MAX_TOTAL || Date.now() > deadline - 400) return;
    try {
      const r = await fetchText(url, deadline);
      if (r.status >= 400 || /text\/html/i.test(r.type)) { log(url, `skipped, HTTP ${r.status}`); return; }
      totalBytes += r.text.length;
      log(url);
      const vendor = /vendor|polyfill|chunk-vendors|node_modules|framework|runtime|commons?[.-]/i.test(url);
      candidates.push(...scanText(r.text, url.replace(/^https:\/\/[^/]+/, ''), vendor));
      // lazily loaded chunks named in this file (Vite / Rollup / plain webpack paths)
      for (const m of r.text.matchAll(/["'\x60]((?:\.{1,2}\/[\w.\-\/]+?|(?:\/)?(?:assets|js|static\/js|_next\/static\/chunks|build|dist)\/[\w.\-\/]+?)\.js)["'\x60]/g)) {
        const u = sameSiteUrl(m[1], url);
        if (u && !seen.has(u) && /auth|login|signin|sign-in|app|main|index|layout|footer|version|about|setting/i.test(m[1])) { seen.add(u); queue.push(u); }
      }
      // version endpoints the app itself calls
      for (const m of r.text.matchAll(/["'\x60]((?:https:\/\/[\w.\-]+)?\/[\w\-\/.]*?(?:version|versi|build-info|buildinfo|app-info|appinfo)[\w\-\/.]*)["'\x60]/gi)) {
        if (m[1].length < 120 && !/\.(js|css|png|svg)$/i.test(m[1])) endpointRefs.add(m[1]);
      }
    } catch (err) { log(url, `failed: ${err.message}`); }
  };
  while (queue.length && fetched.length < MAX_FILES && Date.now() < deadline - 400) {
    const batch = queue.splice(0, 4);
    await Promise.all(batch.map(takeScript));
  }

  // 3) JSON endpoints (only real JSON counts; the app answers HTML for unknown paths)
  const endpoints = [...endpointRefs].map(r => sameSiteUrl(r, page.finalUrl)).filter(Boolean).slice(0, 10);
  await Promise.all(endpoints.map(async (url) => {
    if (Date.now() > deadline - 300) return;
    try {
      const r = await fetchText(url, deadline, { maxBytes: 256 * 1024 });
      if (r.status >= 400) return;
      const body = r.text.trim();
      if (/json/i.test(r.type) || /^[{[]/.test(body)) {
        const found = scanJson(body, url.replace(/^https:\/\/[^/]+/, ''));
        if (found.length) { log(url, 'json'); candidates.push(...found); }
      } else if (/^v?\d+\.\d+(\.\d+)*\s*$/.test(body) && body.length < 40) {
        log(url, 'text');
        candidates.push({ value: body.replace(/^v/i, ''), score: 90, source: url.replace(/^https:\/\/[^/]+/, ''), context: body });
      }
    } catch (_) { /* ignore */ }
  }));

  // merge same values: best score wins, more hits break ties
  const byValue = new Map();
  candidates.forEach(c => {
    const v = c.value.replace(/^v/i, '');
    const prev = byValue.get(v);
    if (!prev) byValue.set(v, { ...c, value: v, hits: 1 });
    else { prev.hits++; if (c.score > prev.score) Object.assign(prev, { score: c.score, source: c.source, context: c.context }); }
  });
  const ranked = [...byValue.values()].sort((a, b) => b.score - a.score || b.hits - a.hits);
  const best = ranked[0] && ranked[0].score >= 50 ? ranked[0] : null;
  return {
    url: target.toString(),
    version: best ? best.value : null,
    confidence: !best ? 'none' : best.score >= 90 ? 'high' : best.score >= 70 ? 'medium' : 'low',
    source: best ? best.source : null,
    candidates: ranked.slice(0, 10).map(c => ({ value: c.value, score: c.score, hits: c.hits, source: c.source, context: c.context })),
    files: fetched,
    ms: Date.now() - started
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  try {
    const out = await detectVersion(req.query.url);
    if (out.error) return res.status(out.error.startsWith('Host not allowed') || out.error === 'Invalid URL' ? 400 : 502).json(out);
    if (!req.query.debug) delete out.files;
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'Version check failed', detail: String(err.message || err) });
  }
}
