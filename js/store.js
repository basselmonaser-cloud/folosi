// فلوسي — الحفظ المحلي. نسختان متزامنتان: IndexedDB (الأساس) + localStorage (نسخة مرآة)
// نفس قاعدة البيانات والمفاتيح المستخدمة منذ الإصدار 2.0 حتى لا تضيع بيانات أحد.
import { STORAGE_KEYS as K, upgrade, migrateV1, isStructurallyValid, SCHEMA } from './core.js';
import { sealVault, openWithSession } from './security.js';

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
    return { status: 'plain', data: upgrade(plain), migratedFrom: from < SCHEMA ? from : null, dbOk };
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
  const seal = async (data) => (toSession ? { vault: await sealVault(toSession, { ...data, updatedAt: data.updatedAt || new Date().toISOString() }) } : { data });
  const plainOf = async (rec) => (rec?.vault ? (fromSession ? openWithSession(rec.vault, fromSession) : null) : rec?.data ?? null);
  for (const key of ['backup-before-v3', 'meta:pre-restore', 'legacy-v1']) {
    const rec = await idbGet(key); if (!rec) continue;
    if (!!rec.vault === !!toSession && (!rec.vault || !fromSession || fromSession.raw === toSession?.raw)) continue; // الحالة صحيحة أصلًا
    let data; try { data = await plainOf(rec); } catch { continue; }
    if (!data) continue;
    await idbPut(key, { ...rec, data: undefined, vault: undefined, ...(await seal(data)) });
  }
  const legacy = lsGet(K.legacy);
  if (legacy && toSession) {
    try { await idbPut('legacy-v1', { savedAt: new Date().toISOString(), ...(await seal(JSON.parse(legacy))) }); lsDel(K.legacy); } catch {}
  }
}
