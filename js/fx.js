// فلوسي — أسعار الصرف. لا نخترع أسعارًا: عند الفشل نستخدم آخر سعر محفوظ مع تاريخه، أو السعر اليدوي.
import { STORAGE_KEYS as K } from './core.js';
import { lsGet, lsSet } from './store.js';

export const SOURCES = [
  { id: 'er-api', name: 'ExchangeRate-API (open.er-api.com)', url: 'https://open.er-api.com/v6/latest/USD',
    parse: (j) => (j?.result === 'success' && j.rates ? { perUSD: j.rates, publishedAt: j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString() : null } : null) },
  { id: 'fawaz', name: 'Free Currency API (jsDelivr)', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    parse: (j) => {
      if (!j?.usd) return null;
      const perUSD = {}; for (const [k, v] of Object.entries(j.usd)) if (/^[a-z]{3}$/.test(k) && v > 0) perUSD[k.toUpperCase()] = v;
      return { perUSD, publishedAt: j.date ? new Date(j.date + 'T00:00:00Z').toISOString() : null };
    } },
];
export const SOURCE_LINKS = { 'er-api': 'https://www.exchangerate-api.com', fawaz: 'https://github.com/fawazahmed0/exchange-api' };

export function loadRates() {
  try { const r = JSON.parse(lsGet(K.rates) || 'null'); if (r && typeof r === 'object') return { perUSD: {}, manual: {}, ...r }; } catch {}
  return { perUSD: {}, manual: {}, source: null, fetchedAt: null, publishedAt: null };
}
export const saveRates = (r) => lsSet(K.rates, JSON.stringify(r));

const sane = (perUSD) => perUSD && perUSD.SAR > 3 && perUSD.SAR < 4.5 && perUSD.EUR > 0.3 && perUSD.EUR < 3;

export async function refreshRates(current, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (globalThis.navigator && navigator.onLine === false) return { ok: false, reason: 'offline', rates: current };
  let lastErr = 'failed';
  for (const s of SOURCES) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(s.url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) { lastErr = 'http-' + res.status; continue; }
      const p = s.parse(await res.json());
      if (!p || !sane(p.perUSD)) { lastErr = 'invalid'; continue; }
      const rates = { ...current, perUSD: p.perUSD, source: s.id, sourceName: s.name, publishedAt: p.publishedAt, fetchedAt: new Date().toISOString() };
      saveRates(rates);
      return { ok: true, rates };
    } catch (e) { lastErr = e.name === 'AbortError' ? 'timeout' : 'network'; } finally { clearTimeout(timer); }
  }
  return { ok: false, reason: lastErr, rates: current };
}
export const isStale = (rates, hours = 24) => !rates.fetchedAt || Date.now() - Date.parse(rates.fetchedAt) > hours * 36e5;
