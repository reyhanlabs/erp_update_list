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
 * Any public https site can be checked (clients often run Zahir ERP on their
 * own domain). Guard rails: https on the default port only, no IP literals or
 * local names, every host (incl. redirects) must resolve to public addresses,
 * and only files on the page's own host are read. GET only, no credentials.
 * Same sign-in guard as the Redmine endpoints.
 */
import { requireUser } from './_lib/auth.js';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';

const BUDGET_MS = 8500;
const MAX_FILE = 12 * 1024 * 1024;
const MAX_TOTAL = 48 * 1024 * 1024;
const MAX_FILES = 16;
const MAX_CHUNKS = 150;      // webpack lazy chunks read while looking for the bundled package.json
const CHUNK_PARALLEL = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// Accepts "4.25.1", "v4.25.1" and Zahir ERP's "V2.26.07.221600" (4 parts, build stamp up to 8 digits).
const VER = String.raw`[vV]?(\d{1,4}\.\d{1,3}(?:\.\d{1,8}){0,3}(?:[-+][0-9A-Za-z.\-]{1,24})?)`;
const LIB_NEAR = /\b(vue|react|angular|axios|core-js|lodash|moment|dayjs|chart|bootstrap|jquery|element|antd|ant-design|quasar|vuetify|sentry|firebase|webpack|babel|tslib|zone\.js|rxjs|swiper|sweetalert|popper|tinymce|quill|pdf|xlsx|socket|echarts|apexcharts|highcharts|leaflet|i18n|pinia|vuex|router|primevue|naive|tailwind|fontawesome|crypto|uuid|nprogress|workbox|hammer)\b/i;

/* Syntactic check: a real-looking public DNS name on the default https port. */
function hostAllowed(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253 || h.includes(':') || h.includes('[')) return false;     // IPv6 literal
  if (/^\d+(\.\d+){0,3}$/.test(h) || /^0x/i.test(h)) return false;                  // IPv4 literal / numeric forms
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || !/\.[a-z][a-z0-9-]{1,62}$/.test(h)) return false;
  if (/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example)$/.test(h)) return false;
  return true;
}

/* Every address the name resolves to must be public (no private, loopback,
   link-local/metadata, CGNAT, multicast or reserved ranges). */
function ipPrivate(ip) {
  const v = String(ip).toLowerCase();
  if (v.includes(':')) {
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipPrivate(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff|2001:db8|64:ff9b|100:)/.test(v);
  }
  const [a, b] = v.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}
const dnsCache = new Map();
async function assertPublicHost(host) {
  if (!dnsCache.has(host)) {
    dnsCache.set(host, lookup(host, { all: true, verbatim: true }).then(list => {
      if (!list.length) throw new Error('host does not resolve');
      if (list.some(x => ipPrivate(x.address))) throw new Error('host resolves to a private address');
      return true;
    }));
    setTimeout(() => dnsCache.delete(host), 5 * 60 * 1000).unref?.();
  }
  try { await dnsCache.get(host); }
  catch (err) { dnsCache.delete(host); throw new Error(`${host}: ${err.code === 'ENOTFOUND' ? 'address not found' : err.message}`); }
}
function portOk(u) { return !u.port || u.port === '443'; }

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  u.protocol = 'https:';
  u.hash = '';
  if (!hostAllowed(u.hostname) || !portOk(u)) return { blocked: u.host };
  return u;
}

/* Many self-hosted Zahir ERP servers send an incomplete certificate chain (no
   intermediate). Browsers repair that by themselves, Node does not, so fetch()
   fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE. For those hosts only, we read the
   public login files again without chain verification: the request is still a
   plain GET without credentials, the result is only a version label, and the
   check is reported as "certificate not verified". */
const TLS_CHAIN_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_UNTRUSTED', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const looseTls = new Set();       // hosts read without chain verification (this invocation)

function netCode(err) {
  return (err && (err.cause && (err.cause.code || err.cause.name))) || (err && (err.code || err.name)) || '';
}
function explainNetError(err) {
  const code = netCode(err);
  if (TLS_CHAIN_CODES.has(code)) return `certificate problem (${code})`;
  const map = {
    ENOTFOUND: 'address not found (DNS)', EAI_AGAIN: 'address lookup failed (DNS)',
    ECONNREFUSED: 'the server refused the connection', ECONNRESET: 'the server cut the connection',
    ETIMEDOUT: 'no answer in time (the server may only accept visitors from Indonesia/its own network)',
    UND_ERR_CONNECT_TIMEOUT: 'no answer in time (the server may only accept visitors from Indonesia/its own network)',
    AbortError: 'no answer in time', EHOSTUNREACH: 'server unreachable', ENETUNREACH: 'server unreachable',
    EPROTO: 'TLS handshake failed (old or unusual HTTPS setup)', ERR_SSL_WRONG_VERSION_NUMBER: 'the port does not speak HTTPS'
  };
  if (map[code]) return `${map[code]} [${code}]`;
  return code ? `${err.message} [${code}]` : (err && err.message) || String(err);
}

/* Plain https GET with node:https, TLS chain not verified; the connection is
   pinned to an address that passed the public-address check. */
function httpsGetLoose(url, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET', rejectUnauthorized: false, timeout: timeoutMs,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity' },
      lookup: (host, opts, cb) => {
        lookup(host, { all: true, verbatim: true }).then(list => {
          const bad = !list.length || list.some(x => ipPrivate(x.address));
          if (bad) return cb(new Error('host resolves to a private address'));
          if (opts && opts.all) return cb(null, list);
          cb(null, list[0].address, list[0].family);
        }, cb);
      }
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('file too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

async function fetchText(url, deadline, { maxBytes = MAX_FILE } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!hostAllowed(current.hostname) || !portOk(current) || current.protocol !== 'https:') throw new Error(`not allowed: ${current.host}`);
    await assertPublicHost(current.hostname);
    const left = deadline - Date.now();
    if (left < 300) throw new Error('time budget used up');
    const wait = Math.min(left, 6000);

    let status, type, location, body;
    if (!looseTls.has(current.hostname)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), wait);
      try {
        const r = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: '*/*' } });
        status = r.status; type = r.headers.get('content-type') || ''; location = r.headers.get('location');
        if (!(status >= 300 && status < 400 && location)) {
          const len = Number(r.headers.get('content-length') || 0);
          if (len && len > maxBytes) throw new Error('file too large');
          body = await r.text();
        }
      } catch (err) {
        if (!TLS_CHAIN_CODES.has(netCode(err))) throw new Error(explainNetError(err));
        looseTls.add(current.hostname);
      } finally { clearTimeout(timer); }
    }
    if (looseTls.has(current.hostname) && status === undefined) {
      try {
        const r = await httpsGetLoose(current, Math.min(deadline - Date.now(), 6000), maxBytes);
        status = r.status; type = String(r.headers['content-type'] || ''); location = r.headers.location; body = r.text;
      } catch (err) { throw new Error(explainNetError(err)); }
    }
    if (status >= 300 && status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    return { status, type, text: String(body || '').slice(0, maxBytes), finalUrl: current.toString(), looseTls: looseTls.has(current.hostname) };
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
    // Zahir ERP build string, e.g. "V2.26.07.221600" (major.yy.mm.ddhhmm) in any quoted literal
    [new RegExp(String.raw`["'\x60]V(\d{1,2}\.\d{2}\.\d{2}\.\d{4,8})["'\x60]`, 'g'), 92],
    // generic  version:"x.y.z"
    [new RegExp(String.raw`["']?version["']?\s*[:=]\s*["'\x60]` + VER + `["'\x60]`, 'g'), 45]
  ];
  for (const [re, score] of rules) {
    let m;
    while ((m = re.exec(text)) && out.length < 400) push(m[1], score, m.index, m[0].length);
  }
  out.push(...scanPackageJson(text, source));
  return out;
}

/* The app's own package.json bundled by webpack 5 with mangled keys, e.g.
   e.exports=JSON.parse('{"UU":"zahironline","rE":"2.26.10.081600"}')   (Zahir ERP) */
function scanPackageJson(text, source) {
  const out = [];
  const re = /JSON\.parse\('(\{[^'{}]{5,400}\})'\)/g;
  let m;
  while ((m = re.exec(text)) && out.length < 20) {
    let obj;
    try { obj = JSON.parse(m[1].replace(/\\'/g, "'")); } catch (_) { continue; }
    const vals = Object.values(obj).filter(v => typeof v === 'string');
    if (!vals.length || vals.length > 8) continue;
    const ver = vals.find(v => new RegExp('^' + VER + '$').test(v.trim()));
    if (!ver) continue;
    const name = vals.find(v => v !== ver && /^@?[a-z][\w.\-\/]{1,60}$/i.test(v));
    if (!name) continue;
    const zahir = /zahir|erp/i.test(name);
    if (!zahir && LIB_NEAR.test(name)) continue;
    out.push({ value: ver.trim().replace(/^v/i, ''), score: zahir ? 97 : 80, source: `${source} (package ${name})`, context: m[1].slice(0, 180) });
  }
  return out;
}

/* webpack 5 runtime: chunk id → file name, e.g.
     e+"."+{98513:"fb09bdf1…","npm.react":"14a4599…"}[e]+".chunk.js"
   Named chunks (npm.*) use their name as id, so keys are numbers or quoted strings.
   An optional name map ({123:"npm.react"}[e]||e) is honoured too. */
function webpackChunks(text, baseUrl) {
  const entryRe = /(\d+|"[^"\\]{1,80}"|[A-Za-z_$][\w$]{0,40}):"([^"\\]{1,80})"/g;
  const objectBefore = (endIdx) => {            // the {...} that closes right before endIdx
    if (text[endIdx] !== '}') return null;
    const open = text.lastIndexOf('{', endIdx);
    return open >= 0 ? text.slice(open + 1, endIdx) : null;
  };
  const nameMap = {};
  for (const m of text.matchAll(/\}\[\w+\]\s*\|\|\s*\w+\)/g)) {
    const body = objectBefore(m.index);
    if (body) for (const p of body.matchAll(entryRe)) nameMap[p[1].replace(/"/g, '')] = p[2];
  }
  const out = [], seen = new Set();
  for (const m of text.matchAll(/\}\[\w+\]\s*\+\s*"((?:\.chunk)?\.js)"/g)) {
    const body = objectBefore(m.index);
    if (!body) continue;
    for (const p of body.matchAll(entryRe)) {
      if (!/^[0-9a-f]{5,32}$/.test(p[2])) continue;
      const id = p[1].replace(/"/g, ''), name = nameMap[id] || id;
      const u = sameSiteUrl(`${name}.${p[2]}${m[1]}`, baseUrl);
      if (u && !seen.has(u)) { seen.add(u); out.push({ id, name, url: u, vendor: /^npm\.|vendor/i.test(name) }); }
    }
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
    const b = new URL(base);
    const u = new URL(ref, b);
    return u.protocol === 'https:' && u.hostname === b.hostname && portOk(u) ? u.toString() : null;   // the page's own host only
  } catch (_) { return null; }
}

export async function detectVersion(rawUrl, { hint = '' } = {}) {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const target = normalizeUrl(rawUrl);
  if (!target) return { error: 'Invalid URL' };
  if (target.blocked) return { error: `Address not allowed: ${target.blocked}`, hint: 'Use the public https address of the Zahir ERP site (no IP address, local name or custom port).' };

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

  const chunkMap = new Map();      // webpack chunk id -> { id, name, url, vendor }
  const chunkRefs = [];            // chunk ids the app loads (n.e(98513)), in order of appearance
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
      // webpack 5 lazy chunks (Create React App etc.)
      webpackChunks(r.text, url).forEach(c => { if (!chunkMap.has(c.id)) chunkMap.set(c.id, c); });
      for (const m of r.text.matchAll(/\.e\((\d{1,7})\)/g)) chunkRefs.push(m[1]);
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

  // 2b) webpack lazy chunks: the app's package.json often sits in one of them (Zahir ERP does this).
  //     Skipped when a strong value was already found. Order: last known chunk (hint), chunks
  //     the app code loads, then the rest; vendor (npm.*) chunks never.
  const strong = () => candidates.some(c => c.score >= 90);
  let chunkFiles = 0, chunkHit = null;
  if (chunkMap.size && !strong()) {
    const order = [];
    const add = (id) => { const c = chunkMap.get(String(id)); if (c && !c.vendor && !order.includes(c)) order.push(c); };
    String(hint || '').split(',').forEach(h => add(h.trim()));
    // shared chunks (the package.json one is shared by many routes) are loaded by many
    // Promise.all groups, so the most-referenced chunks come first
    const freq = new Map();
    chunkRefs.forEach((id, n) => { const f = freq.get(id); if (f) f.c++; else freq.set(id, { c: 1, n }); });
    [...freq.entries()].sort((a, b) => b[1].c - a[1].c || a[1].n - b[1].n).forEach(([id]) => add(id));
    [...chunkMap.keys()].forEach(add);
    let i = 0;
    const worker = async () => {
      while (i < order.length && !strong() && Date.now() < deadline - 500 && chunkFiles < MAX_CHUNKS && totalBytes < MAX_TOTAL) {
        const c = order[i++];
        chunkFiles++;
        try {
          const r = await fetchText(c.url, deadline);
          if (r.status >= 400 || /text\/html/i.test(r.type)) continue;
          totalBytes += r.text.length;
          // chunks this chunk loads come next (the login route usually pulls in the package.json chunk)
          const next = [];
          for (const m of r.text.matchAll(/\.e\((\d{1,7})\)/g)) {
            const n = chunkMap.get(m[1]);
            if (n && !n.vendor && order.indexOf(n) >= i && !next.includes(n)) next.push(n);
          }
          next.forEach(n => order.splice(order.indexOf(n), 1));
          order.splice(i, 0, ...next);
          const found = scanPackageJson(r.text, c.url.replace(/^https:\/\/[^/]+/, ''));
          if (found.length) { candidates.push(...found); if (!chunkHit) chunkHit = c.id; log(c.url, 'package.json'); }
        } catch (_) { /* ignore one chunk */ }
      }
    };
    await Promise.all(Array.from({ length: CHUNK_PARALLEL }, worker));
    fetched.push(`webpack chunks: ${chunkMap.size} known, ${chunkFiles} read`);
  } else fetched.push(`webpack chunks: ${chunkMap.size} known${chunkMap.size ? ' (skipped, strong value already found)' : ''}`);

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
    chunkHint: chunkHit || undefined,
    tlsNote: looseTls.has(new URL(page.finalUrl).hostname) ? 'Certificate chain could not be verified (incomplete or self-signed certificate on the client server); version read anyway.' : undefined,
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
    const out = await detectVersion(req.query.url, { hint: String(req.query.hint || '').slice(0, 60) });
    if (out.error) return res.status(out.error.startsWith('Address not allowed') || out.error === 'Invalid URL' ? 400 : 502).json(out);
    if (!req.query.debug) delete out.files;
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'Version check failed', detail: String(err.message || err) });
  }
}
