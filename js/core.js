// فلوسي — منطق البيانات (بدون واجهة). كل الدوال هنا قابلة للاختبار في Node.
export const SCHEMA = 4;
export const APP_VERSION = '3.1.0';

export const STORAGE_KEYS = Object.freeze({
  data: 'folosi_v2',            // المفتاح الأصلي — لا يتغير حفاظًا على بيانات المستخدمين
  legacy: 'folosi_v1',          // الإصدار الأول
  vault: 'folosi_v2_vault',     // نسخة مشفرة عند تفعيل القفل
  wiped: 'folosi_wiped_at',
  notice: 'folosi_v2_migration_notice',
  shortcuts: 'folosi_ui_shortcuts_v1',
  theme: 'folosi_ui_theme_v1',
  rates: 'folosi_fx_rates_v1',
  drive: 'folosi_drive_v1',
  lockState: 'folosi_lock_attempts_v1',
});

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}
const fail = (m) => { throw new ValidationError(m); };

// ---------- أدوات عامة ----------
export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ||
    Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

const pad = (n) => String(n).padStart(2, '0');
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dateStr();
export const monthOf = (s) => String(s || '').slice(0, 7);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00'));

export function addPeriod(date, freq) {
  const d = new Date(date + 'T12:00:00');
  const day = d.getDate();
  if (freq === 'daily') d.setDate(day + 1);
  else if (freq === 'weekly') d.setDate(day + 7);
  else {
    const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'semiannual' ? 6 : 12;
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last)); // 31 يناير ← 28/29 فبراير بدل القفز إلى مارس
  }
  return dateStr(d);
}

const DECIMALS = { KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 0, JPY: 0, KRW: 0 };
export const decimals = (cur) => DECIMALS[cur] ?? 2;
export function round(n, cur = 'SAR') {
  const f = 10 ** decimals(cur);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}
const sum = (arr, f, cur) => round(arr.reduce((a, x) => a + Number(f(x) || 0), 0), cur);

// يقبل الأرقام العربية الهندية والفواصل: «١٬٢٥٠٫٥» ← 1250.5
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  let s = String(input ?? '').trim();
  if (!s) return NaN;
  s = s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
       .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
       .replace(/[٬،\s]/g, '').replace(/٫/g, '.');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(/,/g, '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
export const MAX_AMOUNT = 1e12;
export function requireAmount(v, cur, label = 'المبلغ') {
  const n = parseAmount(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${label} يجب أن يكون رقمًا أكبر من صفر`);
  if (n > MAX_AMOUNT) fail(`${label} كبير جدًا`);
  return round(n, cur);
}
function optionalAmount(v, cur, label) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseAmount(v);
  if (!Number.isFinite(n) || n < 0) fail(`${label} غير صالح`);
  if (n > MAX_AMOUNT) fail(`${label} كبير جدًا`);
  return round(n, cur);
}
function signedAmount(v, cur, label) {
  if (v === '' || v === null || v === undefined) return 0;
  let s = String(v).trim(), neg = false;
  if (/^[-−]/.test(s)) { neg = true; s = s.slice(1); }
  const n = parseAmount(s);
  if (!Number.isFinite(n) || n > MAX_AMOUNT) fail(`${label} غير صالح`);
  return round(neg ? -n : n, cur);
}
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const optDate = (v) => (v ? (isDate(v) ? v : fail('التاريخ غير صالح')) : '');

// ---------- العملات ----------
export const COMMON_CURRENCIES = ['SAR', 'USD', 'YER', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'JOD', 'EUR', 'GBP', 'TRY', 'IQD', 'MAD', 'SDG'];
const REGION_CURRENCY = { SA: 'SAR', YE: 'YER', AE: 'AED', KW: 'KWD', QA: 'QAR', BH: 'BHD', OM: 'OMR', EG: 'EGP', JO: 'JOD', US: 'USD', GB: 'GBP', TR: 'TRY', IQ: 'IQD', MA: 'MAD', SD: 'SDG', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR' };
export function suggestCurrency(locales = []) {
  for (const l of locales) {
    const m = /[-_]([A-Z]{2})\b/.exec(String(l));
    if (m && REGION_CURRENCY[m[1]]) return REGION_CURRENCY[m[1]];
  }
  return 'SAR';
}
export const isCurrency = (c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);

// rates: { perUSD: {SAR:3.75,...}, source, fetchedAt, manual: { YER: {ref:'SAR', value:140, at} } }
export function unitsPerUSD(code, rates) {
  if (code === 'USD') return 1;
  const man = rates?.manual?.[code];
  if (man && Number(man.value) > 0) {
    if (man.ref === 'USD') return Number(man.value);
    const refPer = man.ref === code ? null : unitsPerUSD(man.ref, { ...rates, manual: { ...rates.manual, [code]: undefined } });
    return refPer ? Number(man.value) * refPer : null;
  }
  const r = rates?.perUSD?.[code];
  return Number(r) > 0 ? Number(r) : null;
}
export function rateSource(code, rates) {
  if (code === 'USD') return 'ثابت';
  if (rates?.manual?.[code]?.value > 0) return 'manual';
  return rates?.perUSD?.[code] > 0 ? 'online' : null;
}
// يعيد null عند عدم توفر سعر — لا نخترع أسعارًا
export function convert(amount, from, to, rates) {
  const a = Number(amount) || 0;
  if (from === to) return a;
  const f = unitsPerUSD(from, rates), t = unitsPerUSD(to, rates);
  if (!f || !t) return null;
  return (a / f) * t;
}
// يجمع مبالغ بعملات مختلفة في عملة العرض ويعيد العملات التي ليس لها سعر
function makeTotaler(display, rates) {
  let total = 0; const missing = new Set();
  return {
    add(amount, cur) {
      const v = convert(amount, cur, display, rates);
      if (v === null) missing.add(cur); else total += v;
    },
    result() { return { total: round(total, display), missing: [...missing] }; },
  };
}

// ---------- التصنيفات ----------
export const DEFAULT_CATEGORIES = Object.freeze({
  income: ['راتب', 'فريلانس', 'مشروع تصوير', 'مونتاج', 'جرافيكس', 'تحصيل مستحقات', 'هدية', 'دخل آخر'],
  expense: ['احتياجات يومية', 'مقاضي', 'مطاعم وتوصيل', 'إيجار وسكن', 'فواتير', 'كهرباء', 'ماء',
    'اتصالات وإنترنت', 'مواصلات', 'تسوق', 'تحويلات للأهل', 'صحة', 'تعليم', 'معدات وشغل', 'ترفيه', 'سداد ديون', 'أخرى'],
});
export const ACCOUNT_TYPES = { cash: 'كاش', bank: 'بنك', wallet: 'محفظة', card: 'بطاقة', other: 'آخر' };
export function guessAccountType(name) {
  const n = String(name || '').toLowerCase();
  if (/كاش|نقد|نقدي|cash/.test(n)) return 'cash';
  if (/stc|برق|barq|محفظ|wallet|urpay|يور ?باي|apple ?pay|mada pay|tabby|تابي/.test(n)) return 'wallet';
  if (/بطاق|card|visa|فيزا|ماستر/.test(n)) return 'card';
  if (/بنك|مصرف|bank|الراجحي|الإنماء|الأهلي|الرياض|البلاد|الجزيرة|(^|\s)ساب($|\s)|الفرنسي|d360|snb|alinma|rajhi/.test(n)) return 'bank';
  return null;
}
export const ACCOUNT_PRESETS = [
  { name: 'كاش', type: 'cash' }, { name: 'الراجحي', type: 'bank' }, { name: 'الإنماء', type: 'bank' },
  { name: 'الأهلي', type: 'bank' }, { name: 'D360', type: 'bank' }, { name: 'STC Bank', type: 'wallet' }, { name: 'برق', type: 'wallet' },
];

// ---------- إنشاء وترحيل ----------
export function blank(displayCurrency = 'SAR') {
  return {
    schema: SCHEMA, accounts: [], transactions: [], transfers: [], obligations: [], projects: [],
    goals: [], recurring: [], categories: { income: [...DEFAULT_CATEGORIES.income], expense: [...DEFAULT_CATEGORIES.expense] },
    settings: { displayCurrency }, updatedAt: null,
  };
}

// من الإصدار الأول (folosi_v1) — نفس منطق الإصدار 2.x
export function migrateV1(old) {
  if (!old || !Array.isArray(old.transactions)) return null;
  const d = { schema: 2, accounts: [{ id: 'legacy', name: 'رصيد النسخة السابقة (غير موزع)', opening: Number(old.opening) || 0 }],
    transactions: old.transactions.map((t) => ({ ...t, accountId: 'legacy' })), transfers: [],
    obligations: Array.isArray(old.obligations) ? old.obligations : [], projects: [], goals: [],
    recurring: Array.isArray(old.recurring) ? old.recurring.map((r) => ({ ...r, category: r.category || r.name })) : [], updatedAt: null };
  return d;
}

export function isStructurallyValid(d) {
  return !!d && typeof d === 'object' && ['accounts', 'transactions', 'transfers', 'obligations', 'projects', 'goals', 'recurring']
    .every((k) => Array.isArray(d[k]));
}

// ترقية أي بيانات بنية 2 إلى بنية 3 دون فقد أي حقل. الدالة لا تعدل المدخل.
export function upgrade(input) {
  if (!isStructurallyValid(input)) throw new ValidationError('بنية البيانات غير معروفة');
  const d = structuredCloneSafe(input);
  const from = Number(d.schema) || 2;
  d.settings = { displayCurrency: 'SAR', ...(d.settings || {}) };
  if (!isCurrency(d.settings.displayCurrency)) d.settings.displayCurrency = 'SAR';
  const base = from < 3 ? 'SAR' : d.settings.displayCurrency; // كل بيانات 2.x كانت بالريال السعودي
  for (const a of d.accounts) {
    a.id ??= uid();
    a.name = text(a.name, 80) || 'حساب';
    a.opening = Number(a.opening) || 0;
    a.currency = isCurrency(a.currency) ? a.currency : base;
    a.type ??= a.id === 'legacy' ? 'other' : /كاش|نقد|cash/i.test(a.name) ? 'cash' : 'bank';
    a.archived = !!a.archived;
  }
  const accCur = (id) => d.accounts.find((a) => a.id === id)?.currency || base;
  for (const t of d.transactions) {
    t.id ??= uid();
    t.type = t.type === 'income' ? 'income' : 'expense';
    t.amount = Number(t.amount) || 0;
    t.currency = isCurrency(t.currency) ? t.currency : accCur(t.accountId);
    t.date = isDate(t.date) ? t.date : (t.created ? dateStr(new Date(t.created)) : today());
    t.category = text(t.category, 60) || (t.type === 'income' ? 'دخل آخر' : 'أخرى');
    t.note = text(t.note, 300);
  }
  for (const t of d.transfers) {
    t.id ??= uid();
    t.fromAmount = Number(t.fromAmount ?? t.amount) || 0;
    t.toAmount = Number(t.toAmount ?? t.amount) || 0;
    t.amount = t.fromAmount; // حقل متوافق مع 2.x
    t.rate = t.fromAmount ? t.toAmount / t.fromAmount : 1;
    t.date = isDate(t.date) ? t.date : today();
  }
  const linkedTx = (sourceId) => d.transactions.filter((t) => t.sourceId === sourceId || t.link?.id === sourceId);
  const buildPayments = (item, kind) => {
    if (Array.isArray(item.payments)) return;
    item.payments = [];
    for (const t of linkedTx(item.id)) {
      const pid = uid();
      item.payments.push({ id: pid, amount: t.amount, received: t.amount, date: t.date, accountId: t.accountId, txId: t.id });
      t.link = { kind, id: item.id, paymentId: pid };
    }
    const paidRecorded = Number(item.paid) || 0;
    const fromTx = item.payments.reduce((a, p) => a + p.amount, 0);
    if (paidRecorded - fromTx > 0.0001) // مبالغ مسجلة دون عملية مرتبطة (لا تؤثر على الأرصدة)
      item.payments.push({ id: uid(), amount: round(paidRecorded - fromTx, item.currency), received: 0, date: '', accountId: null, txId: null, legacy: true });
  };
  for (const p of d.projects) {
    p.id ??= uid();
    p.currency = isCurrency(p.currency) ? p.currency : base;
    p.amount = Number(p.amount) || 0;
    p.archived = !!p.archived;
    buildPayments(p, 'project');
    p.paid = paidOf(p);
  }
  for (const o of d.obligations) {
    o.id ??= uid();
    o.type = o.type === 'debt' ? 'debt' : 'receivable';
    o.currency = isCurrency(o.currency) ? o.currency : base;
    o.amount = Number(o.amount) || 0;
    if (o.countInReports === undefined) o.countInReports = true; // سلوك 2.x: التحصيل دخل والسداد مصروف
    o.archived = !!o.archived;
    o.origin ??= 'legacy'; // ديون ما قبل 3.1 تبقى على سلوكها السابق تمامًا (لا تغيير تلقائي)
    buildPayments(o, 'obligation');
    o.paid = paidOf(o);
  }
  for (const g of d.goals) {
    g.id ??= uid();
    g.currency = isCurrency(g.currency) ? g.currency : base;
    g.target = Number(g.target) || 0;
    g.saved = Number(g.saved) || 0;
    g.history ??= [];
  }
  for (const r of d.recurring) {
    r.id ??= uid();
    r.type = r.type === 'income' ? 'income' : 'expense';
    r.currency = isCurrency(r.currency) ? r.currency : base;
    r.category = text(r.category || r.name, 60);
    r.accountId ??= null;
    r.next = isDate(r.next) ? r.next : today();
  }
  // التصنيفات: الافتراضية + أي تصنيف مستخدم سابقًا
  const cats = d.categories && Array.isArray(d.categories.income) && Array.isArray(d.categories.expense)
    ? d.categories : { income: [...DEFAULT_CATEGORIES.income], expense: [...DEFAULT_CATEGORIES.expense] };
  for (const t of d.transactions) if (t.category && !cats[t.type].includes(t.category)) cats[t.type].push(t.category);
  if (!cats.income.includes('تحصيل مستحقات')) cats.income.push('تحصيل مستحقات');
  if (!cats.expense.includes('سداد ديون')) cats.expense.push('سداد ديون');
  d.categories = cats;
  d.schema = SCHEMA;
  return d;
}
function structuredCloneSafe(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

// فحص صارم لملف مستورد قبل استبدال البيانات
export function validateImport(d) {
  const errors = [];
  if (!isStructurallyValid(d)) return ['الملف لا يحتوي بنية بيانات فلوسي'];
  d.transactions.forEach((t, i) => {
    if (!['income', 'expense'].includes(t?.type)) errors.push(`عملية ${i + 1}: نوع غير صالح`);
    if (!(Number(t?.amount) > 0)) errors.push(`عملية ${i + 1}: مبلغ غير صالح`);
  });
  d.accounts.forEach((a, i) => {
    if (typeof a?.name !== 'string') errors.push(`حساب ${i + 1}: بدون اسم`);
    if (!Number.isFinite(Number(a?.opening ?? 0))) errors.push(`حساب ${i + 1}: رصيد غير صالح`);
  });
  d.transfers.forEach((t, i) => { if (!(Number(t?.fromAmount ?? t?.amount) > 0)) errors.push(`تحويل ${i + 1}: مبلغ غير صالح`); });
  return errors.slice(0, 10);
}

// ---------- الحسابات والأرصدة ----------
export const paidOf = (item) => round((item.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0), item.currency);
export const remainingOf = (item) => round(Math.max(0, Number(item.amount) - paidOf(item)), item.currency);

export function balance(data, accountOrId) {
  const a = typeof accountOrId === 'string' ? data.accounts.find((x) => x.id === accountOrId) : accountOrId;
  if (!a) return 0;
  let n = Number(a.opening) || 0;
  for (const t of data.transactions) if (t.accountId === a.id) n += (t.type === 'income' ? 1 : -1) * Number(t.amount);
  for (const t of data.transfers) {
    if (t.from === a.id) n -= Number(t.fromAmount ?? t.amount);
    if (t.to === a.id) n += Number(t.toAmount ?? t.amount);
  }
  return round(n, a.currency);
}
export function totalBalance(data, rates, display = data.settings.displayCurrency) {
  const t = makeTotaler(display, rates);
  for (const a of data.accounts) t.add(balance(data, a), a.currency);
  return t.result();
}
export const reportable = (t) => !t.excludeFromReports;
// تفصيل الأرصدة حسب نوع الحساب. كل حساب يبقى بعملته الأصلية، والمجاميع تُحوَّل إلى عملة العرض فقط
// عند توفر سعر؛ الحساب الذي لا سعر لعملته لا يُجمع أبدًا كأنه بعملة العرض.
export const BALANCE_GROUPS = [
  { key: 'cash', label: 'النقد (الكاش)', types: ['cash'] },
  { key: 'bank', label: 'الحسابات البنكية', types: ['bank'] },
  { key: 'wallet', label: 'المحافظ الإلكترونية', types: ['wallet'] },
  { key: 'other', label: 'بطاقات وحسابات أخرى', types: ['card', 'other'] },
];
export function balancesByType(data, rates, display = data.settings.displayCurrency) {
  const all = makeTotaler(display, rates);
  const groups = BALANCE_GROUPS.map((g) => {
    const t = makeTotaler(display, rates);
    const accounts = data.accounts.filter((a) => g.types.includes(a.type) || (g.key === 'other' && !ACCOUNT_TYPES[a.type])).map((a) => {
      const bal = balance(data, a), conv = convert(bal, a.currency, display, rates);
      t.add(bal, a.currency); all.add(bal, a.currency);
      return { id: a.id, name: a.name, type: a.type, currency: a.currency, archived: a.archived, balance: bal, converted: conv === null ? null : round(conv, display) };
    });
    // مجموع كل عملة بأصلها (بدون تحويل) للعرض الشفاف
    const byCurrency = {};
    for (const a of accounts) byCurrency[a.currency] = round((byCurrency[a.currency] || 0) + a.balance, a.currency);
    return { ...g, ...t.result(), accounts, byCurrency };
  });
  return { ...all.result(), groups, display };
}

// محول العملات: يعيد النتيجة والسعر المستخدم ومصدره، أو ok:false إن لم يتوفر سعر (لا أسعار مختلقة)
export function convertDetail(amount, from, to, rates) {
  const a = parseAmount(amount);
  if (!Number.isFinite(a) || a < 0) return { ok: false, reason: 'amount' };
  const rate = convert(1, from, to, rates);
  if (rate === null) {
    const missing = [from, to].filter((c) => c !== 'USD' && unitsPerUSD(c, rates) === null);
    return { ok: false, reason: 'rate', missing };
  }
  const src = (c) => (c === 'USD' ? null : rateSource(c, rates));
  return { ok: true, amount: a, result: round(a * rate, to), rate, inverse: rate ? 1 / rate : null,
    manual: [src(from), src(to)].includes('manual'), sources: { from: src(from), to: src(to) } };
}
// أسعار الريال اليمني حسب السوق (صنعاء/عدن) — تُطبَّق كسعر يدوي، أو يُعاد للسعر الآلي
export function withYerMarket(rates, market) {
  const r = { ...rates, manual: { ...(rates.manual || {}) }, yer: { ...(rates.yer || {}) } };
  r.yer.active = market;
  const m = r.yer[market];
  if (market === 'auto' || !m || !(Number(m.value) > 0)) { delete r.manual.YER; if (market !== 'auto') r.yer.active = 'auto'; }
  else r.manual.YER = { ref: m.ref || 'SAR', value: Number(m.value), at: m.at || new Date().toISOString(), label: market };
  return r;
}


export function periodSummary(data, { from, to }, rates, display = data.settings.displayCurrency) {
  const inc = makeTotaler(display, rates), exp = makeTotaler(display, rates);
  const byCat = { income: {}, expense: {} }; const missing = new Set();
  for (const t of data.transactions) {
    if (!reportable(t) || t.date < from || t.date > to) continue;
    (t.type === 'income' ? inc : exp).add(t.amount, t.currency);
    const v = convert(t.amount, t.currency, display, rates);
    if (v === null) { missing.add(t.currency); continue; }
    byCat[t.type][t.category] = (byCat[t.type][t.category] || 0) + v;
  }
  const i = inc.result(), e = exp.result();
  for (const c of [...i.missing, ...e.missing]) missing.add(c);
  const cats = (o) => Object.entries(o).map(([name, value]) => ({ name, value: round(value, display) })).sort((a, b) => b.value - a.value);
  return { income: i.total, expense: e.total, net: round(i.total - e.total, display), byCategory: { income: cats(byCat.income), expense: cats(byCat.expense) }, missing: [...missing] };
}
export const monthRange = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: `${m}-${pad(new Date(y, mo, 0).getDate())}` };
};
export const yearRange = (y) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
export function yearSeries(data, year, rates, display = data.settings.displayCurrency) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${pad(i + 1)}`;
    const s = periodSummary(data, monthRange(m), rates, display);
    return { month: m, income: s.income, expense: s.expense, net: s.net, missing: s.missing };
  });
}
export function obligationTotals(data, rates, display = data.settings.displayCurrency) {
  const recv = makeTotaler(display, rates), debt = makeTotaler(display, rates);
  for (const o of data.obligations) if (!o.archived) (o.type === 'debt' ? debt : recv).add(remainingOf(o), o.currency);
  for (const p of data.projects) recv.add(remainingOf(p), p.currency);
  return { receivable: recv.result(), debt: debt.result() };
}
// توقع السيولة خلال عدد أيام
export function liquidity(data, rates, days = 30, display = data.settings.displayCurrency, now = today()) {
  const end = dateStr(new Date(Date.parse(now + 'T12:00:00') + days * 864e5));
  const inT = makeTotaler(display, rates), outT = makeTotaler(display, rates); const items = [];
  const due = (d) => !d || d <= end;
  for (const p of data.projects) { const r = remainingOf(p); if (r > 0 && p.due && due(p.due)) { inT.add(r, p.currency); items.push({ kind: 'in', label: `${p.client} — ${p.name}`, amount: r, currency: p.currency, date: p.due }); } }
  for (const o of data.obligations) {
    const r = remainingOf(o); if (!(r > 0) || !o.due || !due(o.due)) continue;
    (o.type === 'debt' ? outT : inT).add(r, o.currency);
    items.push({ kind: o.type === 'debt' ? 'out' : 'in', label: o.party, amount: r, currency: o.currency, date: o.due });
  }
  for (const r of data.recurring) {
    let n = r.next, guard = 0;
    while (n <= end && guard++ < 400) {
      (r.type === 'income' ? inT : outT).add(r.amount, r.currency);
      items.push({ kind: r.type === 'income' ? 'in' : 'out', label: r.name, amount: r.amount, currency: r.currency, date: n });
      n = addPeriod(n, r.frequency);
    }
  }
  const cash = totalBalance(data, rates, display), i = inT.result(), o = outT.result();
  return { cash: cash.total, incoming: i.total, outgoing: o.total, projected: round(cash.total + i.total - o.total, display),
    missing: [...new Set([...cash.missing, ...i.missing, ...o.missing])], items: items.sort((a, b) => a.date.localeCompare(b.date)), until: end };
}

// ---------- العمليات ----------
const account = (data, id) => data.accounts.find((a) => a.id === id) || fail('اختر حسابًا صحيحًا');
const touch = (o) => { o.updated = Date.now(); return o; };

function txFields(data, input) {
  const type = input.type === 'income' ? 'income' : input.type === 'expense' ? 'expense' : fail('اختر نوع العملية');
  const acc = account(data, input.accountId);
  const origCurrency = isCurrency(input.currency) ? input.currency : acc.currency;
  const origAmount = requireAmount(input.amount, origCurrency);
  let amount = origAmount, rate = 1;
  if (origCurrency !== acc.currency) {
    rate = Number(input.rate);
    if (!(rate > 0)) fail(`أدخل سعر التحويل من ${origCurrency} إلى ${acc.currency}`);
    amount = round(origAmount * rate, acc.currency);
    if (!(amount > 0)) fail('المبلغ بعد التحويل صغير جدًا');
  }
  const date = input.date ? optDate(input.date) : today();
  const category = text(input.category, 60) || (type === 'income' ? 'دخل آخر' : 'أخرى');
  const f = { type, amount, currency: acc.currency, accountId: acc.id, category, note: text(input.note, 300), date };
  if (origCurrency !== acc.currency) Object.assign(f, { origAmount, origCurrency, rate });
  return f;
}
export function findDuplicate(data, input, now = Date.now(), windowMs = 120000) {
  const n = parseAmount(input.amount);
  return data.transactions.find((t) => t.type === input.type && t.accountId === input.accountId &&
    Math.abs((t.origAmount ?? t.amount) - n) < 1e-9 && t.category === input.category && t.date === (input.date || today()) &&
    now - (t.created || 0) < windowMs) || null;
}
export function addTransaction(data, input) {
  const t = { id: uid(), created: Date.now(), ...txFields(data, input) };
  data.transactions.push(t);
  return t;
}
export function updateTransaction(data, id, input) {
  const t = data.transactions.find((x) => x.id === id) || fail('العملية غير موجودة');
  if (t.link) fail('هذه العملية مرتبطة بدفعة؛ عدّلها من صفحة العميل أو الدين');
  const f = txFields(data, input);
  for (const k of ['origAmount', 'origCurrency', 'rate']) delete t[k];
  Object.assign(t, f); touch(t);
  return t;
}
// حذف عملية مع الحفاظ على تناسق الدفعات المرتبطة
export function deleteTransaction(data, id) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return false;
  if (t.link) {
    const coll = t.link.kind === 'project' ? data.projects : data.obligations;
    const item = coll.find((x) => x.id === t.link.id);
    if (item) {
      if (item.archived && t.link.paymentId) fail('هذه الحركة مرتبطة بسجل مؤرشف — ألغِ أرشفته أولًا');
      if (t.link.paymentId) { item.payments = item.payments.filter((p) => p.id !== t.link.paymentId); item.paid = paidOf(item); }
      if (item.initialTxId === t.id) delete item.initialTxId;
    }
  }
  for (const r of data.recurring) if (r.lastTxId === t.id) delete r.lastTxId;
  data.transactions = data.transactions.filter((x) => x.id !== id);
  return true;
}

// ---------- الحسابات ----------
export function addAccount(data, input) {
  const name = text(input.name, 80) || fail('اكتب اسم الحساب');
  if (data.accounts.some((a) => !a.archived && a.name === name)) fail('يوجد حساب بنفس الاسم');
  const currency = isCurrency(input.currency) ? input.currency : data.settings.displayCurrency;
  const a = { id: uid(), name, type: ACCOUNT_TYPES[input.type] ? input.type : 'bank', currency,
    opening: signedAmount(input.opening, currency, 'الرصيد'), archived: false, created: Date.now() };
  data.accounts.push(a);
  return a;
}
export const accountInUse = (data, id) =>
  data.transactions.some((t) => t.accountId === id) || data.transfers.some((t) => t.from === id || t.to === id) ||
  data.recurring.some((r) => r.accountId === id);
export function updateAccount(data, id, input) {
  const a = data.accounts.find((x) => x.id === id) || fail('الحساب غير موجود');
  const name = text(input.name, 80) || fail('اكتب اسم الحساب');
  if (data.accounts.some((x) => x.id !== id && !x.archived && x.name === name)) fail('يوجد حساب بنفس الاسم');
  if (input.currency && input.currency !== a.currency) {
    if (accountInUse(data, id)) fail('لا يمكن تغيير عملة حساب عليه عمليات');
    a.currency = isCurrency(input.currency) ? input.currency : fail('عملة غير صالحة');
  }
  a.name = name;
  if (ACCOUNT_TYPES[input.type]) a.type = input.type;
  if (input.opening !== undefined) a.opening = signedAmount(input.opening, a.currency, 'الرصيد الافتتاحي');
  if (input.archived !== undefined) a.archived = !!input.archived;
  return touch(a);
}
// معاينة أثر تعديل الرصيد الافتتاحي قبل الحفظ
export function previewOpening(data, id, newOpening) {
  const a = data.accounts.find((x) => x.id === id) || fail('الحساب غير موجود');
  const next = signedAmount(newOpening, a.currency, 'الرصيد الافتتاحي');
  const current = balance(data, a);
  return { current, next: round(current - (Number(a.opening) || 0) + next, a.currency), delta: round(next - (Number(a.opening) || 0), a.currency) };
}
// تسوية الرصيد مع كشف البنك: حركة تسوية واضحة بالفرق (لا تُحتسب دخلًا أو مصروفًا) بدل تعديل الأرقام
export function reconcileAccount(data, id, input) {
  const a = account(data, id);
  const statement = signedAmount(input.statement, a.currency, 'رصيد الكشف');
  const diff = round(statement - balance(data, a), a.currency);
  if (Math.abs(diff) < 10 ** -decimals(a.currency) / 2) fail('الرصيد مطابق لكشف البنك — لا حاجة لتسوية');
  const t = { id: uid(), created: Date.now(), type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), currency: a.currency, accountId: a.id,
    category: 'تسوية رصيد', note: text(input.note, 200) || `تسوية مع الكشف: ${statement}`, date: input.date ? optDate(input.date) : today(), excludeFromReports: true, kind: 'adjustment' };
  data.transactions.push(t);
  return t;
}
// كل ما يرتبط بحساب (لعرضه قبل أي إجراء على الحساب)
export function accountUsage(data, id) {
  return { transactions: data.transactions.filter((t) => t.accountId === id).length, transfers: data.transfers.filter((t) => t.from === id || t.to === id).length,
    recurring: data.recurring.filter((r) => r.accountId === id).length,
    payments: [...data.projects, ...data.obligations].reduce((n, i) => n + (i.payments || []).filter((p) => p.accountId === id).length, 0) };
}
// حذف حساب: بدون حركات = حذف عادي. عليه حركات = دمج كل حركاته في حساب آخر بنفس العملة (لا يُفقد شيء)، أو الأرشفة.
export function deleteAccount(data, id, opts = {}) {
  const a = data.accounts.find((x) => x.id === id) || fail('الحساب غير موجود');
  if (!accountInUse(data, id) && !accountUsage(data, id).payments) { data.accounts = data.accounts.filter((x) => x.id !== id); return { deleted: true }; }
  if (opts.mode !== 'merge') fail('لا يمكن حذف حساب عليه حركات دون تحديد مصيرها: أرشفه، أو انقل حركاته إلى حساب آخر');
  const target = data.accounts.find((x) => x.id === opts.targetId) || fail('اختر الحساب الذي تنتقل إليه الحركات');
  if (target.id === id) fail('اختر حسابًا مختلفًا');
  if (target.currency !== a.currency) fail('يجب أن يكون الحساب الجديد بنفس العملة');
  const before = balance(data, a) + balance(data, target);
  target.opening = round((Number(target.opening) || 0) + (Number(a.opening) || 0), target.currency);
  for (const t of data.transactions) if (t.accountId === id) t.accountId = target.id;
  let removedSelf = 0;
  for (const t of data.transfers) { if (t.from === id) t.from = target.id; if (t.to === id) t.to = target.id; }
  data.transfers = data.transfers.filter((t) => (t.from === t.to ? (removedSelf++, false) : true)); // تحويل بين الحسابين صار داخليًا: أثره صفر
  for (const r of data.recurring) if (r.accountId === id) r.accountId = target.id;
  for (const i of [...data.projects, ...data.obligations]) for (const p of i.payments || []) if (p.accountId === id) p.accountId = target.id;
  data.accounts = data.accounts.filter((x) => x.id !== id);
  const after = balance(data, target);
  if (Math.abs(after - before) > 1e-6) fail('تعذر الدمج دون تغيير الرصيد — لم يتغير شيء');
  return { merged: true, removedSelf };
}

// ---------- التحويلات ----------
export function addTransfer(data, input) {
  const from = account(data, input.from), to = account(data, input.to);
  if (from.id === to.id) fail('لا يمكن التحويل إلى نفس الحساب');
  const fromAmount = requireAmount(input.amount, from.currency);
  let toAmount = fromAmount, rate = 1;
  if (from.currency !== to.currency) {
    if (input.toAmount !== undefined && input.toAmount !== '') {
      toAmount = requireAmount(input.toAmount, to.currency, 'المبلغ المستلم');
      rate = toAmount / fromAmount;
    } else {
      rate = Number(input.rate);
      if (!(rate > 0)) fail(`أدخل سعر التحويل: 1 ${from.currency} = ؟ ${to.currency}`);
      toAmount = round(fromAmount * rate, to.currency);
    }
  }
  const t = { id: uid(), created: Date.now(), from: from.id, to: to.id, amount: fromAmount, fromAmount, toAmount,
    fromCurrency: from.currency, toCurrency: to.currency, rate, date: input.date ? optDate(input.date) : today(), note: text(input.note, 200) };
  data.transfers.push(t);
  return t;
}
export function deleteTransfer(data, id) { data.transfers = data.transfers.filter((t) => t.id !== id); }

// ---------- العملاء والمشاريع ----------
export function addProject(data, input) {
  const currency = isCurrency(input.currency) ? input.currency : data.settings.displayCurrency;
  const p = { id: uid(), created: Date.now(), client: text(input.client, 90) || fail('اكتب اسم العميل'),
    phone: text(input.phone, 35), name: text(input.name, 110) || fail('اكتب اسم المشروع'),
    amount: requireAmount(input.amount, currency, 'قيمة الاتفاق'), currency, due: optDate(input.due), note: text(input.note, 300), payments: [], paid: 0 };
  data.projects.push(p);
  const initial = optionalAmount(input.initialPaid, currency, 'المبلغ المدفوع');
  if (initial > 0) addPayment(data, 'project', p.id, { amount: initial, accountId: input.initialAccountId, date: input.initialDate, received: input.initialReceived });
  return p;
}
export function updateProject(data, id, input) {
  const p = data.projects.find((x) => x.id === id) || fail('المشروع غير موجود');
  p.client = text(input.client, 90) || fail('اكتب اسم العميل');
  p.name = text(input.name, 110) || fail('اكتب اسم المشروع');
  p.phone = text(input.phone, 35); p.note = text(input.note, 300); p.due = optDate(input.due);
  const amount = requireAmount(input.amount, p.currency, 'قيمة الاتفاق');
  if (amount + 1e-9 < paidOf(p)) fail('قيمة الاتفاق أقل من المدفوع');
  p.amount = amount;
  return touch(p);
}
// أصل الدين يحدد أثر السداد على التقارير، والرصيد يتغير مرة واحدة فقط في كل الحالات:
//  دين عليّ:  received = استلمت المال في حساب (يدخل الحساب الآن، والسداد حركة رصيد فقط)
//             credit   = شراء/خدمة بالآجل (السداد يُحتسب مصروفًا مرة واحدة)
//             old      = دين سابق قبل فلوسي (السداد حركة رصيد فقط — لا ازدواج)
//  دين لي:    lent     = أعطيت المال من حساب (يخرج الآن، والتحصيل حركة رصيد فقط)
//             earned   = عمل/بيع لم يُدفع (التحصيل يُحتسب دخلًا مرة واحدة)
//             old      = مستحق سابق قبل فلوسي (التحصيل حركة رصيد فقط)
//  legacy = ديون ما قبل 3.1، تبقى على إعدادها السابق
export const DEBT_ORIGINS = {
  debt: { received: 'استلمت المبلغ في أحد حساباتي (قرض)', credit: 'شراء أو خدمة بالآجل', old: 'دين سابق قبل استخدام فلوسي' },
  receivable: { lent: 'أعطيت المبلغ من أحد حساباتي (سلفة)', earned: 'عمل أو بيع لم يُدفع بعد', old: 'مستحق سابق قبل استخدام فلوسي' },
};
const ORIGIN_COUNTS = { received: false, credit: true, old: false, lent: false, earned: true };
export const originCounts = (o) => (o.origin && o.origin in ORIGIN_COUNTS ? ORIGIN_COUNTS[o.origin] : !!o.countInReports);
export function obligationStatus(o) { return o.archived ? 'archived' : remainingOf(o) <= 0 ? 'settled' : 'active'; }
export const STATUS_LABELS = { active: 'نشط', settled: 'مسدد', archived: 'مؤرشف' };

export function addObligation(data, input) {
  const currency = isCurrency(input.currency) ? input.currency : data.settings.displayCurrency;
  const type = input.type === 'debt' ? 'debt' : 'receivable';
  let origin = input.origin;
  if (!origin) origin = input.movementAccountId ? (type === 'debt' ? 'received' : 'lent') : (type === 'debt' ? 'credit' : 'earned'); // توافق مع 3.0
  if (!(origin in DEBT_ORIGINS[type])) fail('اختر أصل الدين');
  const o = { id: uid(), created: Date.now(), type, origin, party: text(input.party, 100) || fail('اكتب اسم الشخص أو الجهة'),
    amount: requireAmount(input.amount, currency), currency, phone: text(input.phone, 35), due: optDate(input.due),
    repeat: ['weekly', 'monthly', 'yearly'].includes(input.repeat) ? input.repeat : 'none', note: text(input.note, 300), payments: [], paid: 0,
    countInReports: ORIGIN_COUNTS[origin], archived: false };
  if (origin === 'received' || origin === 'lent') {
    const acc = account(data, input.movementAccountId || fail(origin === 'received' ? 'اختر الحساب الذي استلمت فيه المبلغ' : 'اختر الحساب الذي خرج منه المبلغ'));
    const amt = acc.currency === currency ? o.amount : (Number(input.movementRate) > 0 ? round(o.amount * Number(input.movementRate), acc.currency) : fail(`أدخل سعر التحويل من ${currency} إلى ${acc.currency}`));
    const t = { id: uid(), created: Date.now(), type: type === 'receivable' ? 'expense' : 'income', amount: amt, currency: acc.currency,
      accountId: acc.id, category: type === 'receivable' ? 'سلفة لشخص' : 'قرض مستلم', note: o.party, date: input.date ? optDate(input.date) : today(), excludeFromReports: true,
      link: { kind: 'obligation', id: o.id } };
    data.transactions.push(t);
    o.initialTxId = t.id;
  }
  data.obligations.push(o);
  return o;
}
export function updateObligation(data, id, input) {
  const o = data.obligations.find((x) => x.id === id) || fail('الدين غير موجود');
  if (o.archived) fail('هذا الدين مؤرشف — ألغِ الأرشفة أولًا');
  o.party = text(input.party, 100) || fail('اكتب اسم الشخص أو الجهة');
  o.phone = text(input.phone, 35); o.note = text(input.note, 300); o.due = optDate(input.due);
  if (input.repeat) o.repeat = ['weekly', 'monthly', 'yearly'].includes(input.repeat) ? input.repeat : 'none';
  const amount = requireAmount(input.amount, o.currency);
  if (amount + 1e-9 < paidOf(o)) fail('المبلغ أقل من المسدد');
  o.amount = amount;
  return touch(o);
}
function itemOf(data, kind, id) {
  return (kind === 'project' ? data.projects : data.obligations).find((x) => x.id === id) || fail('السجل غير موجود');
}
function paymentTxFields(data, kind, item, input, excludeId) {
  const amount = requireAmount(input.amount, item.currency, 'قيمة الدفعة');
  const others = round((item.payments || []).filter((p) => p.id !== excludeId).reduce((a, p) => a + Number(p.amount || 0), 0), item.currency);
  const rem = round(Math.max(0, item.amount - others), item.currency);
  if (amount - rem > 1e-9) fail(`الدفعة أكبر من المتبقي (${rem})`);
  const acc = account(data, input.accountId);
  const received = acc.currency !== item.currency ? requireAmount(input.received, acc.currency, `المبلغ ${kind === 'obligation' && item.type === 'debt' ? 'المدفوع' : 'المستلم'} بعملة ${acc.currency}`) : amount;
  const date = input.date ? optDate(input.date) : today();
  return { amount, received, date, acc };
}
// منع تسجيل نفس الدفعة مرتين (ضغطتان سريعتان أو إعادة إرسال)
export function findDuplicatePayment(data, kind, id, input, now = Date.now(), windowMs = 60000) {
  const item = itemOf(data, kind, id), n = parseAmount(input.amount);
  return (item.payments || []).find((p) => Math.abs(p.amount - n) < 1e-9 && p.accountId === input.accountId && p.date === (input.date || today()) && now - (p.created || 0) < windowMs) || null;
}
// دفعة لمشروع أو دين: تُسجل مرة واحدة كحركة واحدة مرتبطة — الرصيد يتغير مرة واحدة، والمتبقي ينخفض بالمقدار نفسه
export function addPayment(data, kind, id, input) {
  const item = itemOf(data, kind, id);
  if (item.archived) fail('هذا السجل مؤرشف — ألغِ الأرشفة أولًا');
  const { amount, received, date, acc } = paymentTxFields(data, kind, item, input);
  const p = { id: uid(), created: Date.now(), amount, received, date, accountId: acc.id };
  const isIn = kind === 'project' || item.type === 'receivable';
  const t = { id: uid(), created: Date.now(), type: isIn ? 'income' : 'expense', amount: received, currency: acc.currency, accountId: acc.id,
    category: isIn ? 'تحصيل مستحقات' : 'سداد ديون', note: kind === 'project' ? `${item.client} — ${item.name}` : item.party, date,
    link: { kind, id: item.id, paymentId: p.id } };
  if (kind === 'obligation' && !originCounts(item)) t.excludeFromReports = true;
  if (acc.currency !== item.currency) Object.assign(t, { origAmount: amount, origCurrency: item.currency, rate: received / amount });
  p.txId = t.id;
  item.payments.push(p); item.paid = paidOf(item);
  data.transactions.push(t);
  return p;
}
// تعديل دفعة سابقة: تُحدَّث الدفعة وحركتها المرتبطة معًا فيبقى الرصيد والمتبقي متطابقين
export function updatePayment(data, kind, id, paymentId, input) {
  const item = itemOf(data, kind, id);
  if (item.archived) fail('السجل مؤرشف — ألغِ الأرشفة أولًا');
  const p = item.payments.find((x) => x.id === paymentId) || fail('الدفعة غير موجودة');
  if (p.legacy) fail('هذه دفعة من إصدار سابق دون حركة مرتبطة — لا يمكن تعديلها');
  const { amount, received, date, acc } = paymentTxFields(data, kind, item, input, paymentId);
  Object.assign(p, { amount, received, date, accountId: acc.id });
  const t = data.transactions.find((x) => x.id === p.txId);
  if (t) {
    Object.assign(t, { amount: received, currency: acc.currency, accountId: acc.id, date });
    for (const k of ['origAmount', 'origCurrency', 'rate']) delete t[k];
    if (acc.currency !== item.currency) Object.assign(t, { origAmount: amount, origCurrency: item.currency, rate: received / amount });
    touch(t);
  }
  item.paid = paidOf(item);
  return p;
}
// إلغاء دفعة: تُحذف الدفعة وحركتها المرتبطة معًا (يعود المبلغ للحساب وللمتبقي)
export function deletePayment(data, kind, id, paymentId) {
  const item = itemOf(data, kind, id);
  if (item.archived) fail('السجل مؤرشف — ألغِ الأرشفة أولًا');
  const p = item.payments.find((x) => x.id === paymentId);
  if (!p) return;
  if (p.txId) data.transactions = data.transactions.filter((t) => t.id !== p.txId);
  item.payments = item.payments.filter((x) => x.id !== paymentId);
  item.paid = paidOf(item);
}
export function setArchived(data, kind, id, archived) {
  const item = itemOf(data, kind, id);
  if (archived && remainingOf(item) > 0) fail('لا يمكن أرشفة سجل لم يُسدد بالكامل — سجّل السداد أو اختر الحذف');
  item.archived = !!archived; item.archivedAt = archived ? new Date().toISOString() : undefined;
  return touch(item);
}
const linkedTxIds = (item) => { const ids = new Set(item.payments.map((p) => p.txId).filter(Boolean)); if (item.initialTxId) ids.add(item.initialTxId); return ids; };
// أثر الحذف على كل حساب (يُعرض قبل التأكيد)
export function itemDeleteEffects(data, kind, id) {
  const item = itemOf(data, kind, id), ids = linkedTxIds(item), byAcc = {};
  for (const t of data.transactions) if (ids.has(t.id)) byAcc[t.accountId] = round((byAcc[t.accountId] || 0) - (t.type === 'income' ? 1 : -1) * t.amount, t.currency);
  return { linked: ids.size, reverse: Object.entries(byAcc).map(([accountId, delta]) => ({ accountId, delta })) };
}
// حذف مشروع/دين — يجب تحديد مصير الحركات صراحة:
//   keep    = حذف السجل فقط والإبقاء على الحركات كحركات عادية (الأرصدة لا تتغير)
//   reverse = حذف السجل مع حركاته (تعود الأرصدة كما كانت قبل الدفعات) — يتطلب تأكيدًا واضحًا
export function deleteItem(data, kind, id, opts = {}) {
  const item = itemOf(data, kind, id), ids = linkedTxIds(item);
  if (ids.size && !['keep', 'reverse'].includes(opts.mode)) fail('حدد مصير الحركات المرتبطة قبل الحذف');
  if (opts.mode === 'reverse') data.transactions = data.transactions.filter((t) => !ids.has(t.id));
  else for (const t of data.transactions) if (ids.has(t.id)) { delete t.link; t.note = [t.note, kind === 'project' ? '(مشروع محذوف)' : '(دين محذوف)'].filter(Boolean).join(' '); }
  if (kind === 'project') data.projects = data.projects.filter((x) => x.id !== id);
  else data.obligations = data.obligations.filter((x) => x.id !== id);
}

// ---------- الادخار ----------
export function addGoal(data, input) {
  const currency = isCurrency(input.currency) ? input.currency : data.settings.displayCurrency;
  const g = { id: uid(), created: Date.now(), name: text(input.name, 90) || fail('اكتب اسم الهدف'), currency,
    target: requireAmount(input.target, currency, 'المبلغ المستهدف'), saved: optionalAmount(input.saved, currency, 'المدخر'), history: [], due: optDate(input.due) };
  if (g.saved > 0) g.history.push({ id: uid(), amount: g.saved, date: today() });
  data.goals.push(g);
  return g;
}
export function addGoalAmount(data, id, value, withdraw = false) {
  const g = data.goals.find((x) => x.id === id) || fail('الهدف غير موجود');
  const n = requireAmount(value, g.currency);
  if (withdraw && n - g.saved > 1e-9) fail('المبلغ أكبر من المدخر');
  g.saved = round(g.saved + (withdraw ? -n : n), g.currency);
  g.history.push({ id: uid(), amount: withdraw ? -n : n, date: today() });
  return touch(g);
}
export function updateGoal(data, id, input) {
  const g = data.goals.find((x) => x.id === id) || fail('الهدف غير موجود');
  g.name = text(input.name, 90) || fail('اكتب اسم الهدف');
  g.target = requireAmount(input.target, g.currency, 'المبلغ المستهدف');
  g.due = optDate(input.due);
  return touch(g);
}

// ---------- المتكرر ----------
export const FREQUENCIES = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', yearly: 'سنوي' };
export function addRecurring(data, input) {
  const acc = input.accountId ? account(data, input.accountId) : null;
  const currency = acc?.currency || (isCurrency(input.currency) ? input.currency : data.settings.displayCurrency);
  const r = { id: uid(), created: Date.now(), type: input.type === 'income' ? 'income' : 'expense', name: text(input.name, 90) || fail('اكتب اسم البند'),
    category: text(input.category, 60) || text(input.name, 60), amount: requireAmount(input.amount, currency), currency,
    accountId: acc?.id || null, next: isDate(input.next) ? input.next : fail('اختر أول موعد'), frequency: FREQUENCIES[input.frequency] ? input.frequency : 'monthly' };
  data.recurring.push(r);
  return r;
}
export function postRecurring(data, id, input = {}) {
  const r = data.recurring.find((x) => x.id === id) || fail('البند غير موجود');
  const accountId = input.accountId || r.accountId || fail('اختر الحساب');
  const acc = account(data, accountId);
  const amount = input.amount !== undefined && input.amount !== '' ? input.amount : r.amount;
  const t = addTransaction(data, { type: r.type, amount, currency: r.currency, rate: input.rate, accountId: acc.id, category: r.category, note: `${r.name} (متكرر)`, date: r.next });
  t.recurringId = r.id; r.lastTxId = t.id;
  r.next = addPeriod(r.next, r.frequency);
  return t;
}
export function skipRecurring(data, id) {
  const r = data.recurring.find((x) => x.id === id) || fail('البند غير موجود');
  r.next = addPeriod(r.next, r.frequency);
}

// ---------- التصنيفات المخصصة ----------
export function addCategory(data, type, name) {
  const n = text(name, 40) || fail('اكتب اسم التصنيف');
  const list = data.categories[type === 'income' ? 'income' : 'expense'];
  if (!list.includes(n)) list.push(n);
  return n;
}
export function removeCategory(data, type, name) {
  const key = type === 'income' ? 'income' : 'expense';
  data.categories[key] = data.categories[key].filter((c) => c !== name);
}

// ---------- تصدير ----------
export function toCSV(data) {
  const accName = (id) => data.accounts.find((a) => a.id === id)?.name || '';
  const rows = [['التاريخ', 'النوع', 'الحساب', 'التصنيف', 'المبلغ', 'العملة', 'المبلغ الأصلي', 'العملة الأصلية', 'ملاحظة', 'ضمن التقارير']];
  for (const t of [...data.transactions].sort((a, b) => a.date.localeCompare(b.date)))
    rows.push([t.date, t.type === 'income' ? 'دخل' : 'مصروف', accName(t.accountId), t.category, t.amount, t.currency, t.origAmount ?? '', t.origCurrency ?? '', t.note, t.excludeFromReports ? 'لا' : 'نعم']);
  for (const t of data.transfers) rows.push([t.date, 'تحويل', `${accName(t.from)} ← ${accName(t.to)}`, '', t.fromAmount, t.fromCurrency || '', t.toAmount, t.toCurrency || '', t.note, 'لا']);
  // منع حقن الصيغ في Excel
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
export function isEmpty(data) {
  return !data || (!data.transactions?.length && !data.transfers?.length && !data.projects?.length && !data.obligations?.length && !data.goals?.length && !data.recurring?.length &&
    (data.accounts || []).every((a) => !Number(a.opening)));
}

// ---------- التراجع والإعادة (آخر 5 عمليات) ----------
// كل عملية تحفظ لقطة كاملة لما قبلها، فالتراجع يعيد كل الحسابات والحركات والديون المرتبطة معًا.
// لا يُسمح بالتراجع إلا إذا كانت البيانات الحالية هي نفسها التي نتجت عن العملية (بصمة متطابقة) — وإلا قد تتلف البيانات.
export const HISTORY_LIMIT = 5;
export const emptyHistory = () => ({ v: 1, undo: [], redo: [] });
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// البصمة تتجاهل وقت الحفظ والإعدادات (المظهر، العملة…) حتى لا تمنع التراجع
export const stateHash = (data) => cyrb53(JSON.stringify({ ...data, updatedAt: null, settings: null }));
export function recordHistory(h, label, beforeJSON, after) {
  const undo = [...(h?.undo || []), { id: uid(), at: new Date().toISOString(), label, snapshot: beforeJSON, expect: stateHash(after) }];
  return { v: 1, undo: undo.slice(-HISTORY_LIMIT), redo: [] }; // عملية جديدة تمسح قائمة الإعادة
}
function stepHistory(h, current, from, to) {
  const stack = h?.[from] || [];
  const top = stack[stack.length - 1];
  if (!top) return { ok: false, reason: from === 'undo' ? 'لا توجد عمليات للتراجع عنها' : 'لا توجد عمليات لإعادتها' };
  if (stateHash(current) !== top.expect) return { ok: false, stale: true, reason: 'تغيّرت البيانات بعد هذه العملية (استعادة نسخة، أو تعديل من نافذة أخرى). التراجع الآن قد يتلف البيانات، لذلك أُوقف.' };
  let restored;
  try { restored = JSON.parse(top.snapshot); } catch { return { ok: false, reason: 'سجل التراجع تالف — لم يتغير شيء' }; }
  if (!isStructurallyValid(restored) || validateImport(restored).length) return { ok: false, reason: 'سجل التراجع غير صالح — لم يتغير شيء' };
  restored.settings = current.settings; // لا نعيد المظهر والعملة مع التراجع
  const entry = { id: uid(), at: new Date().toISOString(), label: top.label, snapshot: JSON.stringify(current), expect: stateHash(restored) };
  return { ok: true, data: restored, label: top.label, history: { v: 1, [from]: stack.slice(0, -1), [to]: [...(h[to] || []), entry].slice(-HISTORY_LIMIT) } };
}
export const undoHistory = (h, current) => stepHistory(h, current, 'undo', 'redo');
export const redoHistory = (h, current) => stepHistory(h, current, 'redo', 'undo');
// أثر التراجع/الإعادة على أرصدة الحسابات (يُعرض للتأكيد)
export function balanceDiff(a, b) {
  const out = [];
  const ids = new Set([...a.accounts.map((x) => x.id), ...b.accounts.map((x) => x.id)]);
  for (const id of ids) {
    const x = a.accounts.find((v) => v.id === id), y = b.accounts.find((v) => v.id === id);
    const bx = x ? balance(a, x) : 0, by = y ? balance(b, y) : 0;
    if (Math.abs(bx - by) > 1e-9 || !x !== !y) out.push({ id, name: (y || x).name, currency: (y || x).currency, from: bx, to: by, added: !x, removed: !y });
  }
  return out;
}

// ---------- تشخيص الأرصدة (قراءة فقط — لا يغيّر شيئًا) ----------
export function diagnose(data) {
  const f = [], acc = (id) => data.accounts.find((a) => a.id === id);
  const add = (severity, code, title, detail, fix) => f.push({ id: code + ':' + f.length, severity, code, title, detail, fix });
  const items = [...data.projects.map((i) => ['project', i]), ...data.obligations.map((i) => ['obligation', i])];
  // 1) حركات مرتبطة بسجل أو دفعة غير موجودة
  for (const t of data.transactions) {
    if (!t.link) continue;
    const item = items.find(([k, i]) => k === t.link.kind && i.id === t.link.id)?.[1];
    if (!item) add('warn', 'orphan-link', 'حركة مرتبطة بسجل محذوف', `${t.category} ${t.amount} ${t.currency} بتاريخ ${t.date} — ما زالت تؤثر على رصيد «${acc(t.accountId)?.name || '؟'}».`, { type: 'unlink', txId: t.id });
    else if (t.link.paymentId && !item.payments.some((p) => p.id === t.link.paymentId)) add('warn', 'orphan-payment', 'حركة سداد لا تقابلها دفعة', `${t.amount} ${t.currency} بتاريخ ${t.date} مرتبطة بـ«${item.party || item.name}» لكن الدفعة غير موجودة.`, { type: 'unlink', txId: t.id });
  }
  // 2) دفعات بلا حركة، أو مجموع المسدد غير مطابق
  for (const [kind, i] of items) {
    for (const p of i.payments || []) if (!p.legacy && p.txId && !data.transactions.some((t) => t.id === p.txId))
      add('error', 'payment-no-tx', 'دفعة بلا حركة على الحساب', `دفعة ${p.amount} ${i.currency} في «${i.party || i.name}» لم تُخصم/تُضف لأي حساب.`, { type: 'drop-payment', kind, itemId: i.id, paymentId: p.id });
    if (Math.abs((Number(i.paid) || 0) - paidOf(i)) > 1e-6) add('info', 'paid-mismatch', 'قيمة «المسدد» المخزنة غير محدّثة', `«${i.party || i.name}»: المخزن ${i.paid} والفعلي ${paidOf(i)}.`, { type: 'recalc-paid', kind, itemId: i.id });
  }
  // 3) سداد محتمل مسجل مرتين: مصروف يدوي «سداد ديون» + دفعة دين بنفس المبلغ خلال 7 أيام
  const day = (d) => Date.parse(d + 'T12:00:00') / 864e5;
  for (const t of data.transactions) {
    if (t.link || t.type !== 'expense' || !/سداد/.test(t.category)) continue;
    const twin = data.transactions.find((x) => x.link?.kind === 'obligation' && x.link.paymentId && x.type === 'expense' && x.accountId === t.accountId && Math.abs(x.amount - t.amount) < 1e-9 && Math.abs(day(x.date) - day(t.date)) <= 7);
    if (twin) add('error', 'double-payment', 'سداد قد يكون مسجلًا مرتين', `مصروف يدوي «${t.category}» ${t.amount} ${t.currency} بتاريخ ${t.date}، وسداد دين مرتبط بنفس المبلغ بتاريخ ${twin.date} من نفس الحساب «${acc(t.accountId)?.name}».`, { type: 'delete-tx', txId: t.id });
  }
  // 4) عمليات مكررة بالكامل في نفس اليوم
  const seen = new Map();
  for (const t of data.transactions) {
    if (t.link) continue;
    const k = [t.type, t.accountId, t.amount, t.category, t.date, t.note].join('|');
    if (seen.has(k)) add('warn', 'duplicate-tx', 'عملية مكررة محتملة', `${t.type === 'income' ? 'دخل' : 'مصروف'} ${t.amount} ${t.currency} «${t.category}» بتاريخ ${t.date} في «${acc(t.accountId)?.name}» مسجلة أكثر من مرة.`, { type: 'delete-tx', txId: t.id });
    else seen.set(k, t.id);
  }
  // 5) ديون أضافت مالًا لحساب عند إنشائها — للتأكد أن المال استُلم فعلًا
  for (const o of data.obligations) {
    if (!o.initialTxId) continue;
    const t = data.transactions.find((x) => x.id === o.initialTxId);
    if (t) add('info', 'initial-movement', o.type === 'debt' ? 'دين أضاف مبلغه لحسابك عند إنشائه' : 'مستحق خصم مبلغه من حسابك عند إنشائه', `«${o.party}»: ${t.type === 'income' ? '+' : '−'}${t.amount} ${t.currency} في «${acc(t.accountId)?.name}» بتاريخ ${t.date}. إن لم يحدث هذا فعلًا فالرصيد غير صحيح.`, { type: 'review-initial', txId: t.id, itemId: o.id });
  }
  // 6) مراجع لحسابات غير موجودة
  for (const t of data.transactions) if (!acc(t.accountId)) add('error', 'missing-account', 'حركة على حساب غير موجود', `${t.category} ${t.amount} بتاريخ ${t.date}.`, null);
  for (const t of data.transfers) if (!acc(t.from) || !acc(t.to)) add('error', 'missing-account', 'تحويل يشير إلى حساب غير موجود', `${t.amount} بتاريخ ${t.date}.`, null);
  // 7) أرصدة سالبة في نقد/بنك/محفظة
  for (const a of data.accounts) { const b = balance(data, a); if (b < 0 && a.type !== 'card') add('warn', 'negative', `رصيد سالب: ${a.name}`, `الرصيد المحسوب ${b} ${a.currency}. قارنه بكشف الحساب واستخدم «تسوية مع الكشف» إن لزم.`, { type: 'reconcile', accountId: a.id }); }
  // 8) أسماء حسابات مكررة
  const names = {}; for (const a of data.accounts) if (!a.archived) (names[a.name] ||= []).push(a);
  for (const [n, list] of Object.entries(names)) if (list.length > 1) add('info', 'same-name', `أكثر من حساب نشط باسم «${n}»`, 'قد يسبب اختيار الحساب الخطأ عند التسجيل.', null);
  return f;
}
// تنفيذ إصلاح مقترح — يُستدعى فقط بضغطة من المستخدم، ويُسجل في التراجع
export function applyFix(data, fix) {
  if (!fix) fail('لا يوجد إصلاح تلقائي لهذه الحالة');
  if (fix.type === 'unlink') { const t = data.transactions.find((x) => x.id === fix.txId) || fail('الحركة غير موجودة'); delete t.link; return 'أُلغي الربط وبقيت الحركة كما هي'; }
  if (fix.type === 'delete-tx') { deleteTransaction(data, fix.txId); return 'حُذفت الحركة'; }
  if (fix.type === 'drop-payment') { const i = itemOf(data, fix.kind, fix.itemId); i.payments = i.payments.filter((p) => p.id !== fix.paymentId); i.paid = paidOf(i); return 'حُذفت الدفعة التي لا تقابلها حركة'; }
  if (fix.type === 'recalc-paid') { const i = itemOf(data, fix.kind, fix.itemId); i.paid = paidOf(i); return 'حُدّثت قيمة المسدد'; }
  fail('هذا الإصلاح يحتاج قرارًا منك من الشاشة المناسبة');
}
