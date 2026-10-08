// فلوسي — نسخ احتياطي اختياري إلى Google Drive الخاص بالمستخدم.
// الصلاحية الوحيدة: drive.file (يرى التطبيق الملفات التي أنشأها هو فقط). رمز الوصول يبقى في الذاكرة فقط ولا يُحفظ.
import { GOOGLE_CLIENT_ID } from './config.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'Folosi Backups';
const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
let token = null, expiresAt = 0, client = null, gisPromise = null;

export const configured = () => typeof GOOGLE_CLIENT_ID === 'string' && /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID);
export const hasToken = () => !!token && Date.now() < expiresAt - 60000;

export function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => resolve(); s.onerror = () => { gisPromise = null; reject(new Error('gis-load')); };
    document.head.append(s);
  });
  return gisPromise;
}
// يجب استدعاؤها مباشرة من ضغطة المستخدم (نافذة Google المنبثقة)
export function connect({ hint, consent } = {}) {
  return new Promise((resolve, reject) => {
    if (!configured()) return reject(new Error('not-configured'));
    if (!globalThis.google?.accounts?.oauth2) return reject(new Error('gis-not-ready'));
    client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPE, prompt: consent ? 'consent' : '', ...(hint ? { login_hint: hint } : {}),
      callback: (r) => {
        if (r.error) return reject(new Error(r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new Error('scope-denied'));
        token = r.access_token; expiresAt = Date.now() + (Number(r.expires_in) || 3600) * 1000; resolve();
      },
      error_callback: (e) => reject(new Error(e?.type || 'popup')),
    });
    client.requestAccessToken();
  });
}
export function disconnect() {
  const t = token; token = null; expiresAt = 0;
  try { if (t && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {}); } catch {}
}

async function api(url, opts = {}) {
  if (!hasToken()) { const e = new Error('no-token'); e.code = 'auth'; throw e; }
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (res.status === 401) { token = null; const e = new Error('expired'); e.code = 'auth'; throw e; }
  if (res.status === 403) { const e = new Error('forbidden'); e.code = 'forbidden'; throw e; }
  if (!res.ok) { const e = new Error('http-' + res.status); e.code = 'http'; throw e; }
  return res;
}
export async function whoAmI() {
  const j = await (await api(`${API}/about?fields=user(emailAddress,displayName)`)).json();
  return j.user || {};
}
export async function ensureFolder(knownId) {
  if (knownId) {
    try { const f = await (await api(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`)).json(); if (f.id && !f.trashed) return f.id; } catch (e) { if (e.code === 'auth') throw e; }
  }
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await api(`${API}/files?q=${q}&fields=files(id)&spaces=drive`)).json();
  if (found.files?.[0]) return found.files[0].id;
  const created = await (await api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).json();
  return created.id;
}
export async function upload(folderId, name, obj) {
  const boundary = 'folosi' + Math.random().toString(36).slice(2);
  const meta = { name, parents: [folderId], mimeType: 'application/json', appProperties: { folosi: 'backup', format: '1' } };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
  return (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,size`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
}
export async function list(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const j = await (await api(`${API}/files?q=${q}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime,size,appProperties)`)).json();
  return (j.files || []).filter((f) => f.appProperties?.folosi === 'backup');
}
export async function download(id) { return (await api(`${API}/files/${encodeURIComponent(id)}?alt=media`)).json(); }
// يحتفظ بأحدث «keep» نسخة وينقل الأقدم إلى سلة المهملات في Drive (يمكن استرجاعها منها 30 يومًا)
export async function prune(folderId, keep = 30) {
  const files = await list(folderId);
  for (const f of files.slice(keep))
    await api(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}
export const backupName = (d = new Date()) => `folosi-backup-${d.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
// للاختبارات فقط
export const _setTokenForTests = (t, ms = 3600e3) => { token = t; expiresAt = Date.now() + ms; };
