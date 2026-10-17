// فلوسي — الحفظ المحلي. نسختان متزامنتان: IndexedDB (الأساس) + localStorage (نسخة مرآة)
// نفس قاعدة البيانات والمفاتيح المستخدمة منذ الإصدار 2.0 حتى لا تضيع بيانات أحد.
import { STORAGE_KEYS as K, upgrade, migrateV1, isStructurallyValid, SCHEMA, APP_VERSION } from './core.js';
import * as B from './backup.js';
import { sealVault, openWithSession, sealBytes, openBytes, b64, unb64 } from './security.js';

const DB_NAME = 'folosi-store', STORE = 'snapshots';
let db = null;

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
export const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };

export function openDB() {
  return new Promise((resolve) => {
    if (!globalThis.indexedDB) return resolve(null);
    let r;
    try { r = indexedDB.open(DB_NAME, 1); } catch { return resolve(null); }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => { db = r.result; db.onversionchange = () => db.close(); resolve(db); };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}
function tx(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('no-idb'));
    let t, out;
    try { t = db.transaction(STORE, mode); out = fn(t.objectStore(STORE)); } catch (e) { return reject(e); }
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
export const idbGet = (key) => tx('readonly', (s) => s.get(key)).catch(() => null);
export const idbPut = (key, val) => tx('readwrite', (s) => s.put(val, key));
export const idbDel = (key) => tx('readwrite', (s) => s.delete(key)).catch(() => {});
const idbClear = () => tx('readwrite', (s) => s.clear());

const newer = (a, b) => (String(a?.updatedAt || '') >= String(b?.updatedAt || '') ? a : b);

// ---------- حالة القفل ----------
// علامة مستقلة عن الخزنة: إن كانت مفعّلة لا يُفتح التطبيق أبدًا دون خزنة صالحة ومصادقة.
const LOCK_FLAG = 'folosi_lock_v1';
export async function lockFlag() {
  if (lsGet(LOCK_FLAG) === 'on') return true;
  const m = await idbGet('meta:lock');
  return m?.on === true;
}
async function setLockFlag(on) {
  if (on) lsSet(LOCK_FLAG, 'on'); else lsDel(LOCK_FLAG);
  await idbPut('meta:lock', { on: !!on, at: new Date().toISOString() }).catch(() => {});
}
const validVault = (v) => v?.app === 'folosi' && typeof v.ct === 'string' && typeof v.iv === 'string' && v.keys?.pin;

// تحميل أولي. الحالات: locked | plain | new | error — ولا يُنشأ ملف جديد أبدًا إن وُجد ما يدل على بيانات سابقة.
export async function loadInitial() {
  const dbOk = !!(await openDB());
  const rawLsVault = lsGet(K.vault);
  const lsVault = parse(rawLsVault), idbVault = dbOk ? await idbGet('vault') : null;
  const vaults = [lsVault, idbVault].filter(validVault);
  const flag = await lockFlag();
  if (vaults.length) {
    if (!flag) await setLockFlag(true); // مستخدمو 3.0.1: تُسجل العلامة لأول مرة
    return { status: 'locked', vault: vaults.reduce(newer) }; // وجود خزنة = قفل دائمًا، مهما كانت النسخ الأخرى
  }
  if (flag || rawLsVault || (dbOk && idbVault)) // القفل مفعّل لكن الخزنة مفقودة أو تالفة: لا فتح تلقائي
    return { status: 'error', reason: 'vault-missing', dbOk };
  const lsPlain = parse(lsGet(K.data)), idbPlain = dbOk ? await idbGet('latest') : null;
  const plains = [lsPlain, idbPlain].filter(isStructurallyValid);
  const plain = plains.length ? plains.reduce(newer) : null;
  if (plain) {
    const from = Number(plain.schema) || 2;
    if (from < SCHEMA && dbOk && !(await idbGet('backup-before-v3'))) {
      // نسخة أمان من بيانات الإصدار السابق قبل أي ترحيل — لا تُستبدل أبدًا
      await idbPut('backup-before-v3', { savedAt: new Date().toISOString(), data: plain }).catch(() => {});
    }
    return { status: 'plain', data: upgrade(plain), raw: plain, migratedFrom: from < SCHEMA ? from : null, dbOk };
  }
  const legacy = migrateV1(parse(lsGet(K.legacy)));
  if (legacy) return { status: 'plain', data: upgrade(legacy), migratedFrom: 1, dbOk };
  if (lsGet(K.data) !== null || (!dbOk && lsGet('folosi_has_data'))) return { status: 'error', reason: dbOk ? 'data-unreadable' : 'storage-unavailable', dbOk };
  return { status: 'new', dbOk };
}

export class LockedElsewhereError extends Error { constructor() { super('locked-elsewhere'); this.name = 'LockedElsewhereError'; } }

// حفظ: يعيد {ok, idb, ls}. في وضع القفل تُحفظ نسخة مشفرة فقط.
// لا يُحذف مخزن الوضع الآخر إلا عند انتقال مقصود (تفعيل/إيقاف القفل) — حتى لا تُلغي نافذة قديمة القفل.
// قناة واحدة للإرسال والاستقبال: الرسالة تصل للنوافذ الأخرى فقط، لا لنفس النافذة
export const channel = (() => { try { return new BroadcastChannel('folosi'); } catch { return null; } })();
let chain = Promise.resolve();
export function persist(data, session, opts = {}) {
  const job = chain.then(() => write(data, session, opts));
  chain = job.catch(() => {});
  return job;
}
async function write(data, session, { transition = false } = {}) {
  if (!session && !transition && (await lockFlag())) throw new LockedElsewhereError(); // تم تفعيل القفل من نافذة أخرى
  const payload = session ? await sealVault(session, data) : data;
  const lsKey = session ? K.vault : K.data, idbKey = session ? 'vault' : 'latest';
  let idbOk = false;
  const lsOk = lsSet(lsKey, JSON.stringify(payload)); // متزامن أولًا: يبقى حتى لو أُغلق التطبيق فورًا
  try { await idbPut(idbKey, payload); idbOk = true; } catch {}
  if (session && !lsOk) lsDel(lsKey); // نسخة مرآة مشفرة قديمة لا تبقى إن تعذر تحديثها
  if (idbOk || lsOk) {
    lsSet('folosi_has_data', '1');
    if (session) { lsDel(K.data); await idbDel('latest'); } // في وضع القفل: لا تبقى نسخة غير مشفرة أبدًا
    if (transition) {
      if (session) await setLockFlag(true);
      else { lsDel(K.vault); await idbDel('vault'); await setLockFlag(false); }
      try { channel?.postMessage({ type: 'lock-changed' }); } catch {}
    }
  }
  return { ok: idbOk || lsOk, idb: idbOk, ls: lsOk };
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist(); return true; } catch { return false; }
}
export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export const getMeta = (k) => idbGet('meta:' + k);
export const setMeta = (k, v) => idbPut('meta:' + k, v).catch(() => {});

// حذف كل البيانات المالية على هذا الجهاز (لا يمس Google Drive)
export async function wipeAll() {
  await chain.catch(() => {});
  try { await idbClear(); } catch {}
  const keep = new Set([K.theme, K.shortcuts]);
  try {
    const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) if (k && k.startsWith('folosi') && !keep.has(k)) localStorage.removeItem(k);
  } catch {}
  lsSet(K.wiped, new Date().toISOString());
}

// المخازن الجانبية (نسخة ما قبل الترحيل، نسخة ما قبل الاستعادة، بيانات الإصدار الأول) تتبع حالة القفل:
// مشفرة عند تفعيل القفل، ومفتوحة عند إيقافه — دون حذف أي محتوى.
export async function syncSideStores(fromSession, toSession) {
  const seal = async (data) => (toSession ? { vault: await sealVault(toSession, data) } : { data }); // المحتوى كما هو حرفيًا (بصمات النسخ تبقى صالحة)
  const plainOf = async (rec) => (rec?.vault ? (fromSession ? openWithSession(rec.vault, fromSession) : null) : rec?.data ?? null);
  const snaps = (await listSnapshots()).map((m) => m.key);
  for (const key of [...UPGRADE_KEYS, HISTORY, AUDIT, 'meta:pre-restore', 'legacy-v1', ...snaps]) {
    const rec = await idbGet(key); if (!rec) continue;
    if (!!rec.vault === !!toSession && (!rec.vault || !fromSession || fromSession.raw === toSession?.raw)) continue; // الحالة صحيحة أصلًا
    let data; try { data = await plainOf(rec); } catch { continue; }
    if (!data) continue;
    await idbPut(key, { ...rec, data: undefined, vault: undefined, ...(await seal(data)) });
  }
  if (snaps.length) { const list = await listSnapshots(); await writeIndex(list.map((m) => ({ ...m, sealed: !!toSession }))); }
  // المرفقات تتبع حالة القفل أيضًا
  for (const id of await listAttachmentIds()) {
    const rec = await idbGet('att:' + id); if (!rec || !!rec.sealed === !!toSession) continue;
    try { const bytes = rec.sealed ? (fromSession ? await openBytes(fromSession, rec.box) : null) : unb64(rec.b64); if (!bytes) continue; await idbPut('att:' + id, await attRecord(bytes, rec.type, toSession)); } catch {}
  }
  const legacy = lsGet(K.legacy);
  if (legacy && toSession) {
    try { await idbPut('legacy-v1', { savedAt: new Date().toISOString(), ...(await seal(JSON.parse(legacy))) }); lsDel(K.legacy); } catch {}
  }
}

// ---------- نسخة أمان قبل ترحيل 3.1 ----------
// تُنشأ مرة واحدة من البيانات كما كانت قبل الترقية، ولا تُستبدل أبدًا. مشفرة إن كان القفل مفعّلًا.
// مفتاح لكل ترقية بنية — لا تُستبدل نسخة ترقية سابقة أبدًا
export const BACKUP_31 = 'backup-before-3.1';
export const UPGRADE_KEY = 'backup-before-4.0';
export const UPGRADE_KEYS = ['backup-before-v3', BACKUP_31, UPGRADE_KEY];
export const UPGRADE_LABELS = { 'backup-before-v3': 'قبل الإصدار 3.0', [BACKUP_31]: 'قبل الإصدار 3.1', [UPGRADE_KEY]: 'قبل الإصدار 4.0' };
export async function backupBeforeUpgrade(raw, session) {
  if (!raw || (Number(raw.schema) || 2) >= SCHEMA) return { ok: true, skipped: true };
  const existing = await idbGet(UPGRADE_KEY);
  if (existing) return { ok: true, existed: true };
  const rec = { savedAt: new Date().toISOString(), fromSchema: Number(raw.schema) || 2,
    ...(session ? { vault: await sealVault(session, { ...raw, updatedAt: raw.updatedAt || new Date().toISOString() }) } : { data: raw }) };
  try { await idbPut(UPGRADE_KEY, rec); } catch { return { ok: false }; }
  const back = await idbGet(UPGRADE_KEY); // تحقق أن النسخة كُتبت وتُقرأ فعلًا قبل السماح بالحفظ فوقها
  if (!back) return { ok: false };
  try { const d = back.vault ? await openWithSession(back.vault, session) : back.data; if (!isStructurallyValid(d)) return { ok: false }; } catch { return { ok: false }; }
  return { ok: true };
}
export async function readUpgradeBackup(session, key = UPGRADE_KEY) {
  const rec = await idbGet(key); if (!rec) return null;
  let data = null;
  try { data = rec.vault ? (session ? await openWithSession(rec.vault, session) : null) : rec.data; } catch { return { key, savedAt: rec.savedAt, corrupt: true }; }
  return data ? { key, savedAt: rec.savedAt, fromSchema: rec.fromSchema ?? data.schema, data } : null;
}
export async function listUpgradeBackups(session) {
  const out = [];
  for (const k of UPGRADE_KEYS) { const b = await readUpgradeBackup(session, k).catch(() => null); if (b) out.push(b); }
  return out;
}

// ---------- سجل التراجع (آخر 5 عمليات) ----------
// يحتوي لقطات كاملة من بياناتك، لذلك يُشفَّر بنفس مفتاح الخزنة عند تفعيل القفل ولا يُحفظ أبدًا كنص مقروء في وضع القفل.
// لا يُنسخ إلى localStorage ولا إلى Google Drive ولا يدخل في ملفات النسخ الاحتياطي.
const HISTORY = 'history', AUDIT = 'audit';
// مخزن جانبي يتبع حالة القفل: مشفر بمفتاح الخزنة عند القفل، ولا يُقبل نص مقروء في وضع القفل
async function saveSealed(key, obj, session) {
  const rec = session ? { vault: await sealVault(session, { ...obj, updatedAt: new Date().toISOString() }) } : { data: obj };
  try { await idbPut(key, { savedAt: new Date().toISOString(), ...rec }); return true; } catch { return false; }
}
async function loadSealed(key, session) {
  const rec = await idbGet(key); if (!rec) return null;
  try { return rec.vault ? (session ? await openWithSession(rec.vault, session) : null) : (session ? null : rec.data); } catch { return null; }
}
export const saveHistory = (h, session) => saveSealed(HISTORY, h, session);
export async function loadHistory(session) {
  const h = await loadSealed(HISTORY, session);
  return h && Array.isArray(h.undo) && Array.isArray(h.redo) ? { v: 1, undo: h.undo, redo: h.redo } : null;
}
export const clearHistory = () => idbDel(HISTORY);
// سجل التعديلات (منفصل عن التراجع)
export const saveAudit = (a, session) => saveSealed(AUDIT, a, session);
export async function loadAudit(session) { const a = await loadSealed(AUDIT, session); return a && Array.isArray(a.entries) ? { v: 1, entries: a.entries } : null; }

// ---------- النسخ المحلية متعددة الإصدارات ----------
const SNAP_INDEX = 'meta:snapshots';
export async function listSnapshots() { const r = await idbGet(SNAP_INDEX); return Array.isArray(r?.list) ? r.list : []; }
const writeIndex = (list) => idbPut(SNAP_INDEX, { list });
const opener = (session) => (session ? (v) => openWithSession(v, session) : null);
let snapChain = Promise.resolve();
export function createSnapshot(data, session, reason = 'manual') {
  const job = snapChain.then(() => doSnapshot(data, session, reason));
  snapChain = job.catch(() => {});
  return job;
}
async function doSnapshot(data, session, reason) {
  if (!data || !isStructurallyValid(data)) return { ok: false, code: 'invalid' };
  let made;
  try { made = await B.makeRecord(data, { seal: session ? (d) => sealVault(session, d) : null, appVersion: APP_VERSION, reason }); } catch { return { ok: false, code: 'seal' }; }
  try { await idbPut(made.key, made.record); } catch { return { ok: false, code: 'write' }; }
  const v = await B.verifyRecord(await idbGet(made.key), made.meta, { open: opener(session) });
  if (!v.ok) { await idbDel(made.key); return { ok: false, code: v.code }; } // لا تُعتمد نسخة غير سليمة، ولا يُحذف شيء قديم
  const list = [...(await listSnapshots()), made.meta];
  const drop = B.planRotation(list);
  try { await writeIndex(list.filter((m) => !drop.includes(m.key))); } catch { return { ok: false, code: 'write' }; }
  for (const k of drop) await idbDel(k);
  return { ok: true, meta: made.meta };
}
export async function readSnapshot(key, session) {
  const list = await listSnapshots(), meta = list.find((m) => m.key === key);
  if (!meta) return { ok: false, code: 'missing' };
  const r = await B.verifyRecord(await idbGet(key), meta, { open: opener(session) });
  if (!r.ok && r.code !== 'locked' && !meta.bad) { meta.bad = true; await writeIndex(list).catch(() => {}); }
  return { ...r, meta };
}
export async function ensureDailySnapshot(data, session) {
  if (!B.needsDaily(await listSnapshots())) return { ok: true, skipped: true };
  return createSnapshot(data, session, 'auto');
}

// ---------- المرفقات (فواتير، إيصالات، كشوف) ----------
// المحتوى في IndexedDB فقط، مشفر بمفتاح الخزنة عند القفل، ولا يُرفع لأي خدمة.
const ATT_INDEX = 'meta:attachments';
export async function listAttachmentIds() { const r = await idbGet(ATT_INDEX); return Array.isArray(r?.ids) ? r.ids : []; }
async function attRecord(bytes, type, session) { return session ? { sealed: true, type, size: bytes.length, box: await sealBytes(session, bytes) } : { sealed: false, type, size: bytes.length, b64: b64(bytes) }; }
export async function putAttachment(id, bytes, type, session) {
  await idbPut('att:' + id, await attRecord(bytes, type, session));
  const ids = await listAttachmentIds(); if (!ids.includes(id)) await idbPut(ATT_INDEX, { ids: [...ids, id] });
  return true;
}
export async function getAttachment(id, session) {
  const rec = await idbGet('att:' + id); if (!rec) return null;
  try { return { type: rec.type, bytes: rec.sealed ? (session ? await openBytes(session, rec.box) : null) : unb64(rec.b64) }; } catch { return null; }
}
