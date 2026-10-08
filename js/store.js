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

// تحميل أولي: يعيد {status:'plain'|'locked'|'new', data?, vault?, migratedFrom?}
export async function loadInitial() {
  await openDB();
  const lsVault = parse(lsGet(K.vault)), idbVault = await idbGet('vault');
  const vaults = [lsVault, idbVault].filter((v) => v?.app === 'folosi' && v.ct);
  const lsPlain = parse(lsGet(K.data)), idbPlain = await idbGet('latest');
  const plains = [lsPlain, idbPlain].filter(isStructurallyValid);
  const vault = vaults.length ? vaults.reduce(newer) : null;
  const plain = plains.length ? plains.reduce(newer) : null;
  if (vault && (!plain || String(vault.updatedAt) >= String(plain.updatedAt || ''))) return { status: 'locked', vault };
  if (plain) {
    const from = Number(plain.schema) || 2;
    if (from < SCHEMA && !(await idbGet('backup-before-v3'))) {
      // نسخة أمان من بيانات الإصدار السابق قبل أي ترحيل — لا تُستبدل أبدًا
      await idbPut('backup-before-v3', { savedAt: new Date().toISOString(), data: plain }).catch(() => {});
    }
    return { status: 'plain', data: upgrade(plain), migratedFrom: from < SCHEMA ? from : null };
  }
  const legacy = migrateV1(parse(lsGet(K.legacy)));
  if (legacy) return { status: 'plain', data: upgrade(legacy), migratedFrom: 1 };
  return { status: 'new' };
}

// حفظ: يعيد {ok, idb, ls}. في وضع القفل تُحفظ نسخة مشفرة فقط.
let chain = Promise.resolve();
export function persist(data, session) {
  const job = chain.then(() => write(data, session));
  chain = job.catch(() => {});
  return job;
}
async function write(data, session) {
  let payload, lsKey, idbKey, removeLs, removeIdb;
  if (session) {
    payload = await sealVault(session, data);
    lsKey = K.vault; idbKey = 'vault'; removeLs = K.data; removeIdb = 'latest';
  } else {
    payload = data; lsKey = K.data; idbKey = 'latest'; removeLs = K.vault; removeIdb = 'vault';
  }
  let idbOk = false;
  const lsOk = lsSet(lsKey, JSON.stringify(payload)); // متزامن أولًا: يبقى حتى لو أُغلق التطبيق فورًا
  try { await idbPut(idbKey, payload); idbOk = true; } catch {}
  if (idbOk || lsOk) {
    if (idbOk) await idbDel(removeIdb);
    if (lsOk || session) lsDel(removeLs); // لا تبقى نسخة غير مشفرة عند تفعيل القفل
    if (!lsOk) lsDel(lsKey); // نسخة مرآة قديمة قد تكون أحدث خطأً — نزيلها
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
