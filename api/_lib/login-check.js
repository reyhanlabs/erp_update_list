/**
 * Login + open-data check for Dev / Prod test servers (v4.68.0)
 *
 * Does what the Zahir ERP web app does when someone signs in and opens a data:
 *   1. login      GET  /api/v2/me                        Authorization: Basic email:password, client: <web client>
 *   2. open data  POST /api/v2/migration                 Authorization: Bearer <token>, slug: <company>
 *   3. read data  GET  /api/v2/company_setting?is_skip_pagination=true   (same headers)
 * and reports which step failed, the HTTP status and the server's own message.
 *
 * Accounts live ONLY in the Vercel env var LOGIN_CHECKS (never in Firestore or the
 * browser), bound to a host, so a password is only ever sent to its own server:
 *   LOGIN_CHECKS = [{"host":"erp.zahir.dev","email":"monitor@…","password":"…",
 *                    "client":"<value of the 'client' header>","slug":"<company slug>"}, …]
 */
const STEP_TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (compatible; ZahirERPUpdateManager-LoginCheck/1.0)';

/* Reads LOGIN_CHECKS and says what is wrong with it (never the values). */
export function loginConfig(){
  let raw = String(process.env.LOGIN_CHECKS || '').trim();
  if(!raw) return { set: false, accounts: [], problems: ['LOGIN_CHECKS is not set in Vercel (or the app was not redeployed after adding it)'] };
  if(/^'.*'$/s.test(raw) || /^".*"$/s.test(raw) && !/^"\s*[[{]/.test(raw)) raw = raw.slice(1, -1).trim();   // pasted with quotes around it
  let list;
  try { list = JSON.parse(raw); }
  catch(err){ return { set: true, accounts: [], problems: [`LOGIN_CHECKS is not valid JSON (${String(err.message).replace(/ in JSON.*$/, '')}) — check quotes, commas and brackets`] }; }
  if(!Array.isArray(list)) list = [list];
  const problems = [], accounts = [];
  list.forEach((a, n) => {
    const miss = ['host', 'email', 'password', 'client'].filter(k => !a || !String(a[k] || '').trim());
    if(miss.length){ problems.push(`entry ${n + 1}${a && a.host ? ` (${a.host})` : ''} is missing: ${miss.join(', ')}`); return; }
    if(!a.slug) problems.push(`entry ${n + 1} (${a.host}) has no slug: only the login is checked, not opening a data`);
    accounts.push({ ...a, host: String(a.host).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') });
  });
  return { set: true, accounts, problems };
}
export function loginAccounts(){ return loginConfig().accounts; }
export function loginHosts(){ return loginAccounts().map(a => a.host); }
const hostOf = (url) => { try { return new URL(url).host.toLowerCase(); } catch(_) { return ''; } };
export function accountFor(url){ const h = hostOf(url); return loginAccounts().find(a => a.host === h) || null; }

/* the server's own words: message / error / errors[…] / detail, or the start of the body */
function serverMessage(text){
  const t = String(text || '').trim();
  if(!t) return '';
  try {
    const d = JSON.parse(t);
    const pick = (o) => o && (o.message || o.error_description || o.error?.message || (typeof o.error === 'string' ? o.error : '') || o.detail || o.title
      || (Array.isArray(o.errors) ? o.errors.map(e => e.message || e.detail || e).join('; ') : (o.errors && typeof o.errors === 'object' ? Object.values(o.errors).flat().join('; ') : '')));
    const m = pick(d) || pick(d.data) || '';
    if(m) return String(m).slice(0, 300);
  } catch(_) { /* not JSON */ }
  if(/^\s*</.test(t)){
    const title = t.match(/<title>([^<]{1,160})<\/title>/i);
    return title ? `HTML page: ${title[1].trim()}` : 'HTML page instead of JSON (proxy / maintenance page?)';
  }
  return t.replace(/\s+/g, ' ').slice(0, 300);
}

function netError(err){
  const code = (err && err.cause && (err.cause.code || err.cause.name)) || (err && (err.code || err.name)) || '';
  const map = {
    AbortError: 'no answer within 15 s', TimeoutError: 'no answer within 15 s',
    ENOTFOUND: 'address not found (DNS)', ECONNREFUSED: 'the server refused the connection',
    ECONNRESET: 'the server cut the connection', ETIMEDOUT: 'no answer in time',
    UND_ERR_CONNECT_TIMEOUT: 'no answer in time', EHOSTUNREACH: 'server unreachable'
  };
  return map[code] ? `${map[code]} [${code}]` : (err && err.message) || String(err);
}

async function call(url, opts){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), STEP_TIMEOUT);
  const started = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'content-language': 'id', ...(opts.headers || {}) } });
    const text = await r.text();
    return { status: r.status, ok: r.ok, text, ms: Date.now() - started };
  } catch(err){
    return { status: 0, ok: false, text: '', error: netError(err), ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

const reasonFor = (step, r) => {
  if(r.error) return r.error;
  const msg = serverMessage(r.text);
  const base = {
    401: step === 'login' ? 'login rejected: wrong e-mail/password, or the account is locked/inactive' : 'session not accepted (token rejected)',
    403: step === 'login' ? 'login forbidden for this account' : 'no access to this data (company) for this account',
    404: step === 'login' ? 'login endpoint not found (wrong address?)' : 'data (company slug) not found',
    419: 'session expired', 422: 'request rejected (validation)', 429: 'too many requests (rate limited)',
    500: 'server error', 502: 'bad gateway (backend down?)', 503: 'service unavailable (maintenance / backend down)', 504: 'gateway timeout (backend too slow)'
  }[r.status] || `HTTP ${r.status}`;
  return msg ? `${base} — ${msg}` : base;
};

/**
 * Runs the 3 steps for the site's address.
 * Returns { ok, step, message, status, ms, steps:[{step,status,ms,ok}], user, company, db } — never throws.
 */
export async function checkLogin(siteUrl, account){
  const acc = account || accountFor(siteUrl);
  if(!acc) return { ok: false, configured: false, step: 'config', message: 'No monitoring account for this server (LOGIN_CHECKS)' };
  let origin;
  try { origin = new URL(siteUrl).origin; } catch(_) { return { ok: false, step: 'config', message: 'Invalid address' }; }
  const steps = [];
  const done = (extra) => ({ configured: true, email: acc.email, slug: acc.slug || '', steps, ms: steps.reduce((n, s) => n + s.ms, 0), ...extra });

  // 1) login
  const basic = Buffer.from(`${acc.email}:${acc.password}`).toString('base64');
  const r1 = await call(`${origin}/api/v2/me`, { method: 'GET', headers: { authorization: `Basic ${basic}`, client: acc.client } });
  steps.push({ step: 'login', status: r1.status, ms: r1.ms, ok: r1.ok });
  let me = null;
  try { me = JSON.parse(r1.text); } catch(_) {}
  if(!r1.ok || !me || !me.access_token){
    return done({ ok: false, step: 'login', status: r1.status, message: r1.ok ? `login answered without a token — ${serverMessage(r1.text) || 'unexpected answer'}` : reasonFor('login', r1) });
  }
  const user = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.email || acc.email;
  if(!acc.slug) return done({ ok: true, step: 'login', status: r1.status, message: 'Login OK (no data configured to open)', user });

  // 2) open data (what the app calls when a company is chosen)
  const auth = { authorization: `Bearer ${me.access_token}`, slug: acc.slug };
  const r2 = await call(`${origin}/api/v2/migration`, { method: 'POST', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' } });
  steps.push({ step: 'open', status: r2.status, ms: r2.ms, ok: r2.ok });
  if(!r2.ok) return done({ ok: false, step: 'open', status: r2.status, message: `opening the data failed — ${reasonFor('open', r2)}`, user });
  let db = null, company = acc.slug;
  try { const d = JSON.parse(r2.text); db = d.version || null; company = d.company?.slug || company; } catch(_) {}

  // 3) read data: company settings come from the data's own database
  const r3 = await call(`${origin}/api/v2/company_setting?is_skip_pagination=true`, { method: 'GET', headers: auth });
  steps.push({ step: 'read', status: r3.status, ms: r3.ms, ok: r3.ok });
  if(!r3.ok) return done({ ok: false, step: 'read', status: r3.status, message: `data opened but could not be read — ${reasonFor('read', r3)}`, user, company, db });

  const pending = db && db.current != null && db.last != null && Number(db.current) < Number(db.last);
  return done({ ok: true, step: 'read', status: r3.status, user, company, db,
    message: `Login and open data OK${pending ? ` · database migration pending (${db.current} of ${db.last})` : ''}` });
}

/* fields stored on the site (same names in the app and the cron) */
export function loginPatch(site, result, now){
  const patch = { login: { ok: !!result.ok, step: result.step || '', message: String(result.message || '').slice(0, 500), status: result.status || 0,
    ms: result.ms || 0, at: now, email: result.email || '', slug: result.slug || '', db: result.db || null, steps: result.steps || [] } };
  let event = null;
  if(result.ok){
    patch.loginFailCount = 0; patch.loginDownSince = null;
    if(site.loginNotifiedAt){ patch.loginNotifiedAt = null; event = 'up'; }
  } else {
    patch.loginFailCount = (site.loginFailCount || 0) + 1;
    patch.loginDownSince = site.loginDownSince || now;
    if(patch.loginFailCount >= 2 && !site.loginNotifiedAt){ patch.loginNotifiedAt = now; event = 'down'; }
  }
  return { patch, event };
}
