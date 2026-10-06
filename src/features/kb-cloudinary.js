/**
 * Knowledge Base screenshots on Cloudinary (v4.54.0)
 *
 * Guides used to keep screenshots as base64 inside Firestore
 * (kbimg:ID → workspaces/{ws}/kb/{guide}/images/{ID}), which made the database
 * and backups heavy. New screenshots go to Cloudinary and the guide stores only
 * the image URL. migrateKbImages() moves the old ones over.
 */
import { apiFetch } from '../api.js';

const CLOUD_HOST = /^https:\/\/res\.cloudinary\.com\//i;
let configCache = null;

/** Is Cloudinary set up on the server? (cached for the session) */
export async function cloudinaryConfigured(){
  if(configCache) return configCache;
  try {
    const r = await apiFetch('/api/cloudinary');
    const d = await r.json().catch(() => ({}));
    configCache = { ok: !!(r.ok && d.configured), folder: d.folder || '' };
  } catch(_){ configCache = { ok: false, folder: '' }; }
  return configCache;
}

/** Upload a Blob / File / data URL; returns { url, publicId, bytes } */
export async function uploadToCloudinary(fileOrDataUrl){
  const r = await apiFetch('/api/cloudinary', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sign' })
  });
  const s = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(s.error ? `${s.error}${s.hint ? ' — ' + s.hint : ''}` : `Cloudinary sign failed (${r.status})`);
  const form = new FormData();
  form.append('file', fileOrDataUrl);
  form.append('api_key', s.apiKey);
  form.append('timestamp', String(s.timestamp));
  form.append('folder', s.folder);
  form.append('signature', s.signature);
  const up = await fetch(s.uploadUrl, { method: 'POST', body: form });
  const d = await up.json().catch(() => ({}));
  if(!up.ok || !d.secure_url) throw new Error(d.error?.message || `Cloudinary upload failed (${up.status})`);
  return { url: optimizedUrl(d.secure_url), publicId: d.public_id, bytes: d.bytes || 0 };
}

/** Serve as WebP/AVIF at automatic quality: …/upload/f_auto,q_auto/v123/… */
export function optimizedUrl(secureUrl){
  return String(secureUrl).replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

/** public_id from a Cloudinary delivery URL (transformations and version removed) */
export function publicIdFromUrl(url){
  if(!CLOUD_HOST.test(String(url))) return '';
  const m = String(url).match(/\/image\/upload\/(.+)$/);
  if(!m) return '';
  const parts = m[1].split('/');
  // drop transformation segments ("f_auto,q_auto", "w_800") and the version ("v1712…")
  while(parts.length > 1 && (/^[a-z]{1,3}_[^/]*$/.test(parts[0]) || /,/.test(parts[0]))) parts.shift();
  if(/^v\d+$/.test(parts[0])) parts.shift();
  return parts.join('/').replace(/\.[a-z0-9]+$/i, '');
}

/** Cloudinary image URLs used in a guide's Markdown */
export function cloudUrlsIn(markdown){
  return [...String(markdown || '').matchAll(/!\[[^\]]*\]\((https:\/\/res\.cloudinary\.com\/[^)\s]+)\)/g)].map(m => m[1]);
}

/** Delete images from Cloudinary (best effort; only our folder is allowed server-side) */
export async function destroyCloudImages(publicIds){
  const ids = [...new Set((publicIds || []).filter(Boolean))];
  await Promise.all(ids.map(id => apiFetch('/api/cloudinary', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'destroy', public_id: id })
  }).catch(() => null)));
  return ids.length;
}

/**
 * Move every base64 screenshot of every guide to Cloudinary.
 * kbRef: Firestore collection ref of the workspace KB; articles: [{id, content}].
 * onProgress(done, total). Returns { moved, failed }.
 */
export async function migrateKbImages(kbRef, articles, onProgress){
  const jobs = [];
  articles.forEach(a => {
    [...String(a.content || '').matchAll(/kbimg:([A-Za-z0-9_-]+)/g)].forEach(m => jobs.push({ a, id: m[1] }));
  });
  let done = 0, moved = 0, failed = 0;
  const byArticle = new Map();
  for(const job of jobs){
    try {
      const snap = await kbRef.doc(job.a.id).collection('images').doc(job.id).get();
      const data = snap.exists ? snap.data().data : '';
      if(!data){ failed++; continue; }
      const { url } = await uploadToCloudinary(data);
      if(!byArticle.has(job.a.id)) byArticle.set(job.a.id, { a: job.a, map: new Map() });
      byArticle.get(job.a.id).map.set(job.id, url);
      moved++;
    } catch(err){
      console.warn('migrate image', job.id, err);
      failed++;
    } finally {
      done++;
      onProgress && onProgress(done, jobs.length);
    }
  }
  // rewrite each guide once, then remove the moved base64 docs
  for(const { a, map } of byArticle.values()){
    let content = String(a.content || '');
    map.forEach((url, id) => { content = content.split(`kbimg:${id}`).join(url); });
    await kbRef.doc(a.id).set({ content }, { merge: true });
    await Promise.all([...map.keys()].map(id => kbRef.doc(a.id).collection('images').doc(id).delete().catch(() => null)));
  }
  return { moved, failed, total: jobs.length };
}
