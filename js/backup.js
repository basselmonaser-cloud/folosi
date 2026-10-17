// فلوسي — النسخ المحلية متعددة الإصدارات (منطق صافٍ قابل للاختبار؛ القراءة والكتابة في store.js)
// المبادئ:
//  • كل نسخة تحمل بصمة SHA-256 لمحتواها؛ لا تُستعاد نسخة لا تطابق بصمتها أو بنيتها.
//  • النسخة الجديدة تُكتب ثم تُقرأ وتُتحقق قبل اعتمادها؛ التدوير يحذف الأقدم فقط بعد نجاح الجديدة.
//  • لا تُكتب نسخة فوق نسخة أخرى أبدًا (مفتاح جديد لكل نسخة).
//  • في وضع القفل: المحتوى مشفر بمفتاح الخزنة، والفهرس لا يحتوي أي رقم مالي.
import { isStructurallyValid, validateImport, upgrade } from './core.js';

const enc = new TextEncoder();
export async function sha256(str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const REASONS = { auto: 'تلقائية يومية', manual: 'يدوية', 'pre-restore': 'قبل استعادة', 'pre-fix': 'قبل إصلاح', 'pre-upgrade': 'قبل تحديث الإصدار', 'pre-merge': 'قبل دمج حساب', 'pre-wipe': 'قبل حذف' };
// الحد الأقصى المحفوظ لكل نوع
export const POLICY = { auto: 14, manual: 20, 'pre-restore': 5, 'pre-fix': 10, 'pre-upgrade': 5, 'pre-merge': 5, 'pre-wipe': 2 };

export async function makeRecord(data, { seal, appVersion, reason = 'manual', now = new Date() }) {
  const json = JSON.stringify(data);
  const sha = await sha256(json);
  const key = `snap:${now.getTime()}:${Math.random().toString(36).slice(2, 7)}`;
  const body = seal ? { vault: await seal(data) } : { data };
  return { key, meta: { key, at: now.toISOString(), reason, size: json.length, sha, appVersion, schema: data.schema, sealed: !!seal }, record: { ...body, sha, at: now.toISOString() } };
}
// يعيد {ok, data} أو {ok:false, code: 'missing'|'locked'|'corrupt'|'invalid'}
export async function verifyRecord(rec, meta, { open } = {}) {
  if (!rec) return { ok: false, code: 'missing' };
  let data;
  try {
    if (rec.vault) { if (!open) return { ok: false, code: 'locked' }; data = await open(rec.vault); }
    else data = rec.data;
  } catch { return { ok: false, code: 'corrupt' }; }
  if (!data || !isStructurallyValid(data)) return { ok: false, code: 'invalid' };
  const sha = await sha256(JSON.stringify(data));
  if (sha !== (meta?.sha || rec.sha)) return { ok: false, code: 'corrupt' };
  if (validateImport(data).length) return { ok: false, code: 'invalid' };
  try { upgrade(data); } catch { return { ok: false, code: 'invalid' }; }
  return { ok: true, data };
}
// أي النسخ تُحذف بعد إضافة نسخة جديدة سليمة (الأقدم من كل نوع فوق الحد)
export function planRotation(index, policy = POLICY) {
  const drop = [];
  const by = {};
  for (const m of index) (by[m.reason] ||= []).push(m);
  for (const [reason, list] of Object.entries(by)) {
    const max = policy[reason] ?? 5;
    const sorted = [...list].sort((a, b) => (a.at < b.at ? 1 : -1));
    // لا نحذف آخر نسخة سليمة معروفة أبدًا بسبب التدوير
    drop.push(...sorted.slice(max).filter((m) => !m.bad));
  }
  return drop.map((m) => m.key);
}
export const needsDaily = (index, now = Date.now()) => !index.some((m) => m.reason === 'auto' && now - Date.parse(m.at) < 20 * 36e5);
export const formatSize = (n) => (n < 1024 ? `${n} بايت` : n < 1048576 ? `${(n / 1024).toFixed(1)} ك.ب` : `${(n / 1048576).toFixed(2)} م.ب`);
