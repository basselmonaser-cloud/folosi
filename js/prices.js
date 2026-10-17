// فلوسي 4.0 — أسعار الذهب والأسهم من الإنترنت.
// القواعد: لا سعر مختلق أبدًا؛ عند الفشل يبقى آخر سعر صالح مع تاريخه؛ كل سعر يحمل مصدره ووقت جلبه ووقت نشره.
// لا مفاتيح سرية في الكود: مفتاح Twelve Data (اختياري) يدخله المستخدم ويُحفظ داخل بياناته المشفرة على جهازه.

export const GOLD_SOURCE = { id: 'gold-api', name: 'Gold API', site: 'https://gold-api.com', url: (sym) => `https://api.gold-api.com/price/${sym}` };
export const STOCK_SOURCE = { id: 'twelvedata', name: 'Twelve Data', site: 'https://twelvedata.com' };
const SANE = { XAU: [500, 20000], XAG: [3, 500] };

async function getJSON(url, { fetchImpl = globalThis.fetch, timeoutMs = 9000 } = {}) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    let body = null; try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, body };
  } catch (e) { return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : 'network' }; }
  finally { clearTimeout(timer); }
}
const offline = () => globalThis.navigator && navigator.onLine === false;

// سعر الأونصة بالدولار (سعر فوري spot — ليس سعر شراء أو بيع لدى محل)
export async function fetchMetal(symbol = 'XAU', opts = {}) {
  if (offline()) return { ok: false, reason: 'offline' };
  const r = await getJSON(GOLD_SOURCE.url(symbol), opts);
  if (!r.ok) return { ok: false, reason: r.error || 'http-' + r.status };
  const p = Number(r.body?.price), [lo, hi] = SANE[symbol];
  if (!(p >= lo && p <= hi) || (r.body?.currency && r.body.currency !== 'USD')) return { ok: false, reason: 'invalid' };
  return { ok: true, quote: { usdPerOz: p, updatedAt: r.body.updatedAt || null, fetchedAt: new Date().toISOString(), source: GOLD_SOURCE.id, sourceName: GOLD_SOURCE.name } };
}
// يحدّث market دون حذف أي سعر قديم عند الفشل. يعيد نسخة جديدة من market.
export async function refreshMetals(market = {}, opts = {}) {
  const next = { ...market }, errors = {};
  for (const [sym, key] of [['XAU', 'gold'], ['XAG', 'silver']]) {
    const r = await fetchMetal(sym, opts);
    if (r.ok) { next[key] = r.quote; delete next[key + 'Error']; }
    else { errors[key] = r.reason; next[key + 'Error'] = { at: new Date().toISOString(), reason: r.reason }; }
  }
  return { ok: !errors.gold, market: next, errors };
}
// حالة سعر: none | fresh | stale (أقدم من maxHours منذ الجلب) — سوق الذهب يغلق نهاية الأسبوع فسعر النشر قد يكون أقدم
export function priceStatus(q, { maxHours = 12, now = Date.now() } = {}) {
  if (!q || !(q.usdPerOz > 0 || q.price > 0)) return { state: 'none', label: 'لا يوجد سعر' };
  const age = (now - Date.parse(q.fetchedAt || 0)) / 36e5;
  const pub = q.updatedAt || q.asOf ? (now - Date.parse(q.updatedAt || q.asOf)) / 36e5 : null;
  return { state: age > maxHours ? 'stale' : 'fresh', ageHours: age, publishedAgeHours: pub, label: age > maxHours ? 'قديم — يحتاج تحديثًا' : 'محدّث' };
}

// ---------- الأسهم: Twelve Data (بمفتاح المستخدم) ----------
// MIC: رمز السوق المعياري — لا نعتمد على رمز التداول وحده
const MIC = { XSAU: 'XSAU', XNAS: 'XNAS', XNYS: 'XNYS', ARCX: 'ARCX', XDFM: 'XDFM', XADS: 'XADS', XKUW: 'XKUW', XCAI: 'XCAI', XLON: 'XLON' };
export function quoteURL(sec, apiKey) {
  const sym = sec.providerSymbol || sec.symbol;
  const mic = MIC[sec.exchange];
  const q = new URLSearchParams({ symbol: sym, apikey: apiKey });
  if (mic && !sec.providerSymbol) q.set('mic_code', mic);
  return 'https://api.twelvedata.com/quote?' + q;
}
const TD_ERRORS = { 401: 'المفتاح غير صالح', 403: 'هذا السوق غير متاح في خطتك لدى Twelve Data (يتطلب اشتراكًا)', 404: 'الرمز غير موجود لدى المزود', 429: 'تجاوزت حد الطلبات — حاول بعد دقيقة' };
export async function fetchQuote(sec, apiKey, opts = {}) {
  if (!apiKey) return { ok: false, reason: 'no-key', message: 'أضف مفتاح Twelve Data من الإعدادات أو أدخل السعر يدويًا' };
  if (offline()) return { ok: false, reason: 'offline', message: 'لا يوجد اتصال' };
  const r = await getJSON(quoteURL(sec, apiKey), opts);
  const b = r.body;
  if (!r.ok || !b || b.status === 'error') { const code = b?.code || r.status; return { ok: false, reason: 'http-' + code, message: TD_ERRORS[code] || b?.message?.slice(0, 120) || 'تعذر جلب السعر' }; }
  const price = Number(b.close);
  if (!(price > 0)) return { ok: false, reason: 'invalid', message: 'المزود لم يُرجع سعرًا صالحًا' };
  if (b.currency && sec.currency && b.currency.toUpperCase() !== sec.currency) return { ok: false, reason: 'currency', message: `عملة المزود ${b.currency} لا تطابق عملة الورقة ${sec.currency} — لم يُعتمد السعر` };
  return { ok: true, quote: { price, currency: sec.currency, asOf: String(b.datetime || '').slice(0, 10) || null, fetchedAt: new Date().toISOString(), source: STOCK_SOURCE.name,
    delayed: true, marketOpen: b.is_market_open === true, exchange: b.exchange || null } };
}
// الحد المجاني: 8 طلبات/دقيقة — نحدّث الأقدم أولًا وبحد أقصى max لكل مرة
export async function refreshQuotes(market = {}, securities, apiKey, { max = 8, ...opts } = {}) {
  const next = { ...market, quotes: { ...(market.quotes || {}) }, quoteErrors: { ...(market.quoteErrors || {}) } };
  const order = [...securities].sort((a, b) => String(next.quotes[a.id]?.fetchedAt || '').localeCompare(String(next.quotes[b.id]?.fetchedAt || ''))).slice(0, max);
  let ok = 0;
  for (const sec of order) {
    const r = await fetchQuote(sec, apiKey, opts);
    if (r.ok) { next.quotes[sec.id] = r.quote; delete next.quoteErrors[sec.id]; ok++; }
    else { next.quoteErrors[sec.id] = { at: new Date().toISOString(), message: r.message, reason: r.reason }; if (r.reason === 'http-401' || r.reason === 'no-key' || r.reason === 'offline') break; }
  }
  return { ok, tried: order.length, market: next };
}
