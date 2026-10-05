/**
 * Redmine fetch, cache & error mapping
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { apiFetch } from '../api.js';

/* ============================================================
   REDMINE HELPERS
   ============================================================ */
function applyStatusParam(params, statusVal){
  if(!statusVal || statusVal === '*') return;
  if(String(statusVal).startsWith('name:')){
    params.set('status_name', String(statusVal).slice(5));
  } else {
    params.set('status_id', statusVal);
  }
}

/* ============================================================
   REDMINE CACHE + ERROR HANDLING
   ============================================================ */
const RedmineCache = {
  TTL_MS: 2 * 60 * 1000, // 2 minutes: lists and sidebar counts stay close to Redmine (was 20 min)
  _mem: new Map(),

  key(url){ return String(url); },

  get(url){
    const k = this.key(url);
    const hit = this._mem.get(k);
    const ttl = (hit && hit.ttl) || this.TTL_MS;
    if(hit && Date.now() - hit.ts < ttl) return hit.data;
    try {
      const raw = sessionStorage.getItem('rm-cache:' + k);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      const t = parsed.ttl || this.TTL_MS;
      if(Date.now() - parsed.ts < t){
        this._mem.set(k, parsed);
        return parsed.data;
      }
    } catch(_){}
    return null;
  },

  set(url, data, ttlMs){
    const entry = { ts: Date.now(), data, ttl: ttlMs || this.TTL_MS };
    this._mem.set(this.key(url), entry);
    try {
      sessionStorage.setItem('rm-cache:' + this.key(url), JSON.stringify(entry));
    } catch(_){}
  },

  clear(){
    this._mem.clear();
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('rm-cache:'))
        .forEach(k => sessionStorage.removeItem(k));
    } catch(_){}
  }
};

function friendlyRedmineError(status, data){
  const detail = (data && (data.detail || data.error || data.hint)) || '';
  // App-level access errors (our own API guard), not Redmine's
  const appCode = data && data.code ? String(data.code) : '';
  if(appCode.startsWith('APP_')){
    const titles = {
      APP_AUTH_REQUIRED: 'Sign-in required',
      APP_AUTH_INVALID: 'Session expired',
      APP_GUEST_FORBIDDEN: 'Not available in guest mode',
      APP_FORBIDDEN: 'Account not allowed',
      APP_AUTH_NOT_CONFIGURED: 'Server access list not configured'
    };
    return {
      title: titles[appCode] || 'Access denied',
      message: [data.error, data.hint].filter(Boolean).join(' — ')
    };
  }
  if(status === 401){
    return {
      title: 'Invalid API key (401)',
      message: 'Redmine rejected the API key. Regenerate it under My Account → API access key, update REDMINE_API_KEY on Vercel, then redeploy.'
    };
  }
  if(status === 403){
    return {
      title: 'Access denied (403)',
      message: 'This API key does not have permission for this project/issue. Check the user role in Redmine.'
    };
  }
  if(status === 404){
    return {
      title: 'Not found (404)',
      message: detail || 'Status or resource not found in Redmine. Make sure the status name "Ready for Testing" exists under Issue statuses.'
    };
  }
  if(status === 500 && /REDMINE_API_KEY not configured/i.test(detail + (data?.error||''))){
    return {
      title: 'API key not configured',
      message: 'Set the REDMINE_API_KEY environment variable in Vercel Project Settings, then redeploy.'
    };
  }
  if(status >= 500){
    return {
      title: 'Server error',
      message: detail || 'Redmine/proxy is having issues. Please try again shortly.'
    };
  }
  if(!navigator.onLine){
    return {
      title: 'Offline',
      message: 'No internet connection.'
    };
  }
  return {
    title: 'Failed to load from Redmine',
    message: detail || ('HTTP ' + status)
  };
}

async function fetchRedmine(pathAndQuery, { force = false } = {}){
  const url = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;

  if(!force){
    const cached = RedmineCache.get(url);
    if(cached) return { data: cached, fromCache: true, status: 200 };
  }

  let r;
  try {
    r = await apiFetch(url);
  } catch(err){
    const friendly = friendlyRedmineError(0, { detail: err.message });
    const e = new Error(friendly.message);
    e.friendly = friendly;
    e.status = 0;
    throw e;
  }

  let data = {};
  try { data = await r.json(); } catch(_){ data = {}; }

  if(!r.ok){
    const friendly = friendlyRedmineError(r.status, data);
    const e = new Error(friendly.message);
    e.friendly = friendly;
    e.status = r.status;
    e.data = data;
    throw e;
  }

  RedmineCache.set(url, data);
  return { data, fromCache: false, status: r.status };
}

export {
  applyStatusParam,
  fetchRedmine
};
