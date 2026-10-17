// فلوسي 4.0 — التنبيهات (داخل التطبيق). تُحسب من البيانات عند الفتح وأثناء الاستخدام فقط:
// تطبيقات الويب على الآيفون لا تستطيع تشغيل فحص في الخلفية والتطبيق مغلق دون خادم إشعارات (Push)، ولا نعد بذلك.
import { dueReminders, balance, today, upcomingSchedule } from './core.js';
import { gramPrice, quoteOf } from './wealth.js';

export const ALERT_KINDS = { due: 'استحقاق دين', installment: 'قسط/فاتورة', lowBalance: 'رصيد منخفض', goldPrice: 'سعر الذهب', stockPrice: 'سعر سهم', staleMarket: 'بيانات سوق قديمة', integrity: 'سلامة البيانات', backup: 'نسخة احتياطية' };
export function computeAlerts(data, { rates, now = today(), nowMs = Date.now(), lastExport = null, integrityIssues = 0, settings = data.settings.alerts || {}, fmt = (a, c) => `${a} ${c}` } = {}) {
  const on = (k) => settings[k] !== false, out = [];
  const add = (kind, key, level, title, detail, nav) => out.push({ id: `${kind}:${key}`, kind, level, title, detail, nav });
  if (on('due')) for (const r of dueReminders(data, now)) add('due', r.id + ':' + r.due, r.overdue ? 'high' : 'mid', r.overdue ? `متأخر: ${r.party}` : `يستحق قريبًا: ${r.party}`, `${r.type === 'debt' ? 'عليّ' : 'لي'} ${fmt(r.remaining, r.currency)} · ${r.due}${r.overdue ? ` (منذ ${-r.days} يوم)` : r.days === 0 ? ' (اليوم)' : ` (بعد ${r.days} يوم)`}`, r.kind === 'project' ? 'clients' : 'debts');
  if (on('installment')) for (const i of upcomingSchedule(data, 3, rates, now).items) if (i.kind === 'recurring') add('installment', i.id + ':' + i.date, i.overdue ? 'high' : 'mid', `${i.overdue ? 'متأخر' : 'قريب'}: ${i.label}`, `${fmt(i.amount, i.currency)} · ${i.date} — لا يُخصم حتى تؤكد تسجيله`, 'recurring');
  if (on('lowBalance')) for (const a of data.accounts) if (!a.archived && a.lowBalance !== undefined && a.lowBalance !== null && a.lowBalance !== '') { const b = balance(data, a); if (b < Number(a.lowBalance)) add('lowBalance', a.id, 'mid', `رصيد منخفض: ${a.name}`, `${fmt(b, a.currency)} — أقل من الحد ${fmt(Number(a.lowBalance), a.currency)}`, 'accounts'); }
  for (const pa of data.priceAlerts || []) {
    if (!pa.active) continue;
    let cur = null, label = '';
    if (pa.asset === 'gold') { if (!data.settings.goldOnline) continue; cur = gramPrice(data.market, pa.currency, rates, (pa.karat || 24) / 24); label = `الذهب عيار ${pa.karat || 24} للجرام`; }
    else { const sec = data.wealth?.securities?.find((s) => s.id === pa.securityId); const q = sec && quoteOf(data, sec); if (q && q.kind === 'market') cur = q.price; label = sec ? `${sec.symbol}` : 'سهم'; }
    if (cur === null) continue;
    const hit = pa.op === 'above' ? cur >= pa.value : cur <= pa.value;
    if (hit && on(pa.asset === 'gold' ? 'goldPrice' : 'stockPrice')) add(pa.asset === 'gold' ? 'goldPrice' : 'stockPrice', pa.id, 'mid', `${label} ${pa.op === 'above' ? 'تجاوز' : 'نزل تحت'} ${pa.value}`, `السعر الحالي ${+cur.toFixed(2)} ${pa.asset === 'gold' ? pa.currency : ''}`, pa.asset === 'gold' ? 'gold' : 'stocks');
  }
  if (on('staleMarket')) {
    // الذهب لا يُقيَّم تلقائيًا، فلا تنبيه «سعر ذهب قديم». ننبه فقط إن كان التقييم المعتمد أقدم من 90 يومًا.
    const v = (data.wealth?.gold?.valuations || []).find((x) => x.approved);
    if (v && nowMs - Date.parse(v.date) > 90 * 864e5) add('staleMarket', 'goldval', 'low', 'تقييم الذهب المعتمد قديم', `بتاريخ ${v.date} — حدّثه من «حاسبة الذهب» أو ألغِ اعتماده`, 'gold-calc');
    const old = Object.values(data.market?.quotes || {}).filter((q) => nowMs - Date.parse(q.fetchedAt) > 3 * 864e5).length;
    if (old) add('staleMarket', 'quotes', 'low', 'أسعار أسهم قديمة', `${old} ورقة لم يُحدَّث سعرها منذ أكثر من 3 أيام`, 'stocks');
  }
  if (on('integrity') && integrityIssues) add('integrity', 'n' + integrityIssues, 'high', 'مشكلة في سلامة البيانات', `${integrityIssues} ملاحظة قد تجعل رصيدًا غير صحيح`, 'integrity');
  if (on('backup') && data.transactions.length >= 5 && (!lastExport || nowMs - Date.parse(lastExport) > 30 * 864e5)) add('backup', 'export', 'low', 'حان وقت نسخة احتياطية خارجية', lastExport ? `آخر نسخة ملف ${lastExport.slice(0, 10)}` : 'لم تُنزّل نسخة ملف بعد', 'settings');
  const order = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
