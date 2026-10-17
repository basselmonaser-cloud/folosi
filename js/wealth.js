// فلوسي 4.0 — ثروتي: الذهب، الأسهم والصناديق، الاستثمارات الأخرى، صافي الثروة، الأداء، الزكاة.
// منطق صافٍ قابل للاختبار في Node. القواعد:
//  • الرصيد النقدي لا يُخزن: الشراء من حساب = حركة واحدة مرتبطة (link) خارج تقارير الدخل/المصروف.
//  • الأصل يُقيَّم مرة واحدة: إما بسعر سوقي له مصدر وتاريخ، أو بتقييم يدوي موثق بتاريخه، أو يُعرض «غير متاح».
//  • لا أسعار مختلقة، ولا يُجمع مبلغان بعملتين مختلفتين دون سعر صرف.
import { uid, round, requireAmount, parseAmount, convert, today, isCurrency, isDate, balance, remainingOf, H } from './core.js';

const { fail, text, optDate, account, optionalAmount, touch, makeTotaler } = H;
export const OZ = 31.1034768; // غرام في الأونصة التروي
const W = (data) => {
  data.wealth ||= {};
  const w = data.wealth;
  w.gold ||= { lots: [], sales: [] }; w.gold.lots ||= []; w.gold.sales ||= [];
  for (const k of ['portfolios', 'securities', 'trades', 'investments', 'liabilities']) w[k] ||= [];
  return w;
};
const dateOr = (v) => (v ? optDate(v) : today());
const cmpDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.created || 0) - (b.created || 0);

// حركة نقدية مرتبطة بأصل. counts=false: تبادل أصل بنقد (لا دخل ولا مصروف).
function linkedTx(data, { accountId, type, amount, currency, category, note, date, link, counts = false, orig }) {
  const acc = account(data, accountId);
  const t = { id: uid(), created: Date.now(), type, amount, currency: acc.currency, accountId: acc.id, category, note: text(note, 300), date, link };
  if (!counts) t.excludeFromReports = true;
  if (orig && orig.currency !== acc.currency) Object.assign(t, { origAmount: orig.amount, origCurrency: orig.currency, rate: amount / orig.amount });
  data.transactions.push(t);
  return t;
}
// المبلغ بعملة الحساب: نفس المبلغ إن تطابقت العملة، وإلا يجب إدخال المبلغ الفعلي بعملة الحساب
function inAccountCurrency(data, accountId, amount, currency, entered, label) {
  const acc = account(data, accountId);
  if (acc.currency === currency) return amount;
  return requireAmount(entered, acc.currency, `${label} بعملة ${acc.currency}`);
}

// ======================= الذهب =======================
// فلسفة 4.0: الذهب يُسجَّل ككمية مملوكة (جرام + عيار)، وليس كقيمة مالية تُحسب تلقائيًا.
//  • لا يُقيَّم الذهب ولا يدخل صافي الثروة إلا بتقييم يحفظه المستخدم بنفسه من «حاسبة الذهب» ويعتمده صراحة.
//  • سعر الشراء يبقى بعملته الأصلية دائمًا (2,000,000 ر.ي تبقى ر.ي مهما تغيرت عملة العرض).
//  • العملة لا تُفترض أبدًا: يجب اختيارها صراحة عند وجود سعر شراء.
export const GOLD_KINDS = { bar: 'سبيكة', lira: 'ليرة', coin: 'عملة ذهبية', jewelry: 'مشغولات', custom: 'نوع آخر' };
export const KARATS = [24, 22, 21, 18];
// حالات الحيازة: فقط owned و owned-elsewhere ملكية حاضرة
export const OWNERSHIP = { owned: 'أملكه وهو عندي', 'owned-elsewhere': 'أملكه ومحفوظ عند شخص آخر', trust: 'أمانة عندي ولا أملكه', claim: 'مطالبة لي ولم أستلمه بعد' };
export const isOwnedGold = (l) => !l.ownership || l.ownership === 'owned' || l.ownership === 'owned-elsewhere';
export const GOLD_MARKETS = { SA: { label: 'السعودية', currency: 'SAR' }, 'YE-SANAA': { label: 'اليمن — صنعاء', currency: 'YER' }, 'YE-ADEN': { label: 'اليمن — عدن', currency: 'YER' }, custom: { label: 'سوق آخر', currency: '' } };
export function purityOf(input) {
  if (input.karat === 'custom' || input.purity !== undefined && input.purity !== '' && !KARATS.includes(Number(input.karat))) {
    let p = parseAmount(input.purity);
    // يقبل: نسبة (0.875) أو عيار (8–24) أو بالألف (333–999.9)
    if (p > 1 && p <= 24) p = p >= 8 ? p / 24 : NaN; else if (p > 24) p = p >= 333 && p <= 1000 ? p / 1000 : NaN;
    if (!(p >= 0.3 && p <= 1)) fail('أدخل نقاء الذهب: عيار (8–24) أو نسبة (مثل 0.875) أو بالألف (مثل 875)');
    return round(p, 'QTY');
  }
  const k = Number(input.karat);
  if (!KARATS.includes(k)) fail('اختر العيار');
  return k / 24;
}
const karatLabel = (l) => (KARATS.includes(Number(l.karat)) ? `عيار ${l.karat}` : `نقاء ${+(l.purity * 1000).toFixed(1)}‰`);
export { karatLabel };
const karatKey = (l) => (KARATS.includes(Number(l.karat)) ? String(l.karat) : 'p' + Math.round(l.purity * 1000));
export const goldKarats = (data) => [...new Set(W(data).gold.lots.filter((l) => l.remaining > 0).map(karatKey))];
const ownText = (input) => (OWNERSHIP[input.ownership] ? input.ownership : 'owned');
// العملة إلزامية متى وُجد مبلغ — لا نفترض عملة العرض
function explicitCurrency(input, label = 'عملة الشراء') {
  if (!isCurrency(input.currency)) fail(`اختر ${label} صراحة (مثل ر.ي أو ر.س) — لا يفترض فلوسي العملة`);
  return input.currency;
}

export function addGoldLot(data, input) {
  const w = W(data);
  const grams = requireAmount(input.grams, 'QTY', 'الوزن الصافي للذهب بالجرام');
  const gross = input.grossGrams === '' || input.grossGrams === undefined ? grams : requireAmount(input.grossGrams, 'QTY', 'الوزن الإجمالي');
  if (gross + 1e-9 < grams) fail('الوزن الإجمالي لا يمكن أن يكون أقل من وزن الذهب الصافي');
  const pieces = input.pieces === '' || input.pieces === undefined ? 1 : Math.round(requireAmount(input.pieces, 'QTY', 'عدد القطع'));
  const purity = purityOf(input);
  const acquisition = input.acquisition === 'owned' ? 'owned' : 'purchase';
  const costKnown = acquisition === 'purchase' || input.costKnown === true || input.costKnown === 'yes';
  const currency = costKnown ? explicitCurrency(input) : (isCurrency(input.currency) ? input.currency : null);
  const cost = costKnown ? requireAmount(input.cost, currency, 'سعر الشراء') : 0;
  const making = costKnown ? optionalAmount(input.making, currency, 'المصنعية') : 0;
  const fees = costKnown ? optionalAmount(input.fees, currency, 'الرسوم') : 0;
  const ownership = ownText(input);
  if (acquisition === 'purchase' && input.accountId && ownership === 'trust') fail('ذهب الأمانة لا يُشترى من حساباتك — سجّله كأمانة دون حساب');
  const lot = { id: uid(), created: Date.now(), name: text(input.name, 90) || fail('اكتب اسم القطعة'), kind: GOLD_KINDS[input.kind] ? input.kind : 'jewelry',
    kindLabel: input.kind === 'custom' ? text(input.kindLabel, 40) : '', karat: KARATS.includes(Number(input.karat)) ? Number(input.karat) : 'custom', purity,
    grams, grossGrams: gross, pieces, remaining: grams, date: dateOr(input.date), acquisition, costKnown, cost, making, fees, currency,
    costBasis: costKnown ? round(cost + making + fees, currency) : null, ownership, holder: text(input.holder, 90), location: text(input.location, 90),
    seller: text(input.seller, 90), note: text(input.note, 300), moves: [], archived: false, attachments: [], accountId: null, txId: null };
  if (acquisition === 'purchase' && input.accountId) {
    // شراء جديد ينفذ الآن: خصم واحد من الحساب. الذهب المملوك سابقًا لا يمس أي حساب أبدًا.
    const paid = inAccountCurrency(data, input.accountId, lot.costBasis, currency, input.paid, 'المبلغ المدفوع');
    const t = linkedTx(data, { accountId: input.accountId, type: 'expense', amount: paid, category: 'شراء ذهب', note: `${lot.name} — ${grams}غ ${karatLabel(lot)}`, date: lot.date,
      link: { kind: 'gold', id: lot.id }, orig: { amount: lot.costBasis, currency } });
    lot.accountId = t.accountId; lot.txId = t.id;
  }
  w.gold.lots.push(lot);
  return lot;
}
export function updateGoldLot(data, id, input) {
  const lot = W(data).gold.lots.find((x) => x.id === id) || fail('القطعة غير موجودة');
  const sold = data.wealth.gold.sales.some((s) => s.lotId === id);
  const name = text(input.name, 90) || fail('اكتب اسم القطعة');
  // تحقق كامل قبل أي تغيير
  let grams = lot.grams, purity = lot.purity, karat = lot.karat;
  if (input.grams !== undefined && Number(parseAmount(input.grams)) !== lot.grams) { if (sold) fail('لا يمكن تغيير الوزن بعد بيع جزء من القطعة — ألغِ البيع أولًا'); grams = requireAmount(input.grams, 'QTY', 'الوزن'); }
  if ((input.karat !== undefined && String(input.karat) !== String(lot.karat)) || (input.karat === 'custom' && input.purity !== undefined && Number(parseAmount(input.purity)) !== lot.purity)) { if (sold) fail('لا يمكن تغيير العيار بعد البيع'); purity = purityOf(input); karat = KARATS.includes(Number(input.karat)) ? Number(input.karat) : 'custom'; }
  const gross = input.grossGrams === undefined ? Math.max(lot.grossGrams || grams, grams) : input.grossGrams === '' ? grams : requireAmount(input.grossGrams, 'QTY', 'الوزن الإجمالي');
  if (gross + 1e-9 < grams) fail('الوزن الإجمالي لا يمكن أن يكون أقل من وزن الذهب الصافي');
  let cost = null;
  if (lot.acquisition === 'owned' && !lot.txId && input.costKnown !== undefined) {
    const known = input.costKnown === true || input.costKnown === 'yes';
    const cur = known ? explicitCurrency(input) : lot.currency;
    cost = known ? { known, currency: cur, cost: requireAmount(input.cost, cur, 'التكلفة'), making: optionalAmount(input.making, cur, 'المصنعية'), fees: optionalAmount(input.fees, cur, 'الرسوم') } : { known: false, currency: cur, cost: 0, making: 0, fees: 0 };
  }
  Object.assign(lot, { name, grams, purity, karat, grossGrams: gross });
  if (!sold && input.grams !== undefined) lot.remaining = grams;
  if (GOLD_KINDS[input.kind]) { lot.kind = input.kind; lot.kindLabel = input.kind === 'custom' ? text(input.kindLabel, 40) : ''; }
  if (input.pieces !== undefined && input.pieces !== '') lot.pieces = Math.round(requireAmount(input.pieces, 'QTY', 'عدد القطع'));
  if (OWNERSHIP[input.ownership]) lot.ownership = input.ownership;
  for (const k of ['seller', 'note', 'holder']) if (input[k] !== undefined) lot[k] = text(input[k], k === 'note' ? 300 : 90);
  if (cost) { Object.assign(lot, { costKnown: cost.known, currency: cost.currency, cost: cost.cost, making: cost.making, fees: cost.fees, costBasis: cost.known ? round(cost.cost + cost.making + cost.fees, cost.currency) : null }); for (const s of data.wealth.gold.sales.filter((x) => x.lotId === id)) recalcSale(lot, s); }
  return touch(lot);
}
// تصحيح عملة سعر الشراء (إعادة تسمية دون تحويل) — لحالة إدخال 2,000,000 بعملة خاطئة. يُطلب صراحة ويُسجل.
export function relabelGoldCurrency(data, id, currency) {
  const lot = W(data).gold.lots.find((x) => x.id === id) || fail('القطعة غير موجودة');
  if (!isCurrency(currency)) fail('اختر العملة الصحيحة');
  if (lot.txId) fail('هذه القطعة مشتراة من حساب؛ عملة الشراء مرتبطة بحركة الحساب ولا تُغيَّر هنا');
  if (lot.currency === currency) fail('العملة مطابقة أصلًا');
  const from = lot.currency; lot.currency = currency;
  for (const s of data.wealth.gold.sales.filter((x) => x.lotId === id)) { if (!s.txId) s.currency = currency; recalcSale(lot, s); }
  (lot.fixes ||= []).push({ at: new Date().toISOString(), type: 'currency', from, to: currency });
  return touch(lot);
}
// نقل الذهب بين أماكن الحفظ مع حفظ السجل
export function moveGold(data, id, input) {
  const lot = W(data).gold.lots.find((x) => x.id === id) || fail('القطعة غير موجودة');
  const to = text(input.to, 90) || fail('اكتب المكان الجديد');
  if (to === lot.location) fail('المكان الجديد مطابق للحالي');
  (lot.moves ||= []).push({ id: uid(), date: dateOr(input.date), from: lot.location || '', to, note: text(input.note, 160) });
  lot.location = to;
  if (input.holder !== undefined) lot.holder = text(input.holder, 90);
  return touch(lot);
}
export function setGoldArchived(data, id, archived) {
  const lot = W(data).gold.lots.find((x) => x.id === id) || fail('القطعة غير موجودة');
  if (archived && lot.remaining > 1e-9) fail('لا تُؤرشف إلا القطعة المباعة بالكامل');
  lot.archived = !!archived;
  return touch(lot);
}
function recalcSale(lot, s) {
  // الربح يُحسب فقط إذا كانت عملة البيع = عملة الشراء (لا تحويل ضمني بسعر اليوم)
  s.costPart = lot.costBasis === null || s.currency !== lot.currency ? null : round(lot.costBasis * (s.grams / lot.grams), lot.currency);
  s.realized = s.costPart === null ? null : round(s.net - s.costPart, lot.currency);
}
// بيع كامل القطعة أو جزء منها. المتحصل بعملته الصريحة؛ إن اختلفت عن عملة الحساب يُدخل المبلغ الفعلي المستلم.
export function sellGold(data, lotId, input) {
  const w = W(data), lot = w.gold.lots.find((x) => x.id === lotId) || fail('القطعة غير موجودة');
  if (!isOwnedGold(lot)) fail('لا يمكن بيع ذهب لا تملكه (أمانة أو مطالبة غير مستلمة)');
  const grams = requireAmount(input.grams, 'QTY', 'الوزن المباع');
  if (grams - lot.remaining > 1e-9) fail(`الوزن أكبر من المتبقي (${lot.remaining}غ)`);
  const currency = isCurrency(input.currency) ? input.currency : lot.currency || fail('اختر عملة مبلغ البيع');
  const proceeds = requireAmount(input.proceeds, currency, 'مبلغ البيع');
  const fees = optionalAmount(input.fees, currency, 'رسوم البيع');
  if (fees - proceeds > 1e-9) fail('الرسوم أكبر من مبلغ البيع');
  const date = dateOr(input.date);
  const s = { id: uid(), created: Date.now(), lotId, grams, proceeds, fees, net: round(proceeds - fees, currency), currency, date, note: text(input.note, 200), accountId: null, txId: null };
  recalcSale(lot, s);
  let got = 0;
  if (input.accountId) got = inAccountCurrency(data, input.accountId, s.net, currency, input.received, 'المبلغ المستلم');
  if (input.accountId) {
    const t = linkedTx(data, { accountId: input.accountId, type: 'income', amount: got, category: 'بيع ذهب', note: `${lot.name} — ${grams}غ`, date, link: { kind: 'gold-sale', id: s.id }, orig: { amount: s.net, currency } });
    s.accountId = t.accountId; s.txId = t.id;
  }
  lot.remaining = round(lot.remaining - grams, 'QTY');
  if (lot.remaining < 1e-9) lot.remaining = 0;
  w.gold.sales.push(s);
  return s;
}
// إلغاء بيع: يعود الوزن للقطعة وتُحذف حركة المتحصل المرتبطة
export function cancelGoldSale(data, saleId) {
  const w = W(data), s = w.gold.sales.find((x) => x.id === saleId) || fail('عملية البيع غير موجودة');
  const lot = w.gold.lots.find((x) => x.id === s.lotId);
  if (lot) { lot.remaining = round(lot.remaining + s.grams, 'QTY'); lot.archived = false; }
  if (s.txId) data.transactions = data.transactions.filter((t) => t.id !== s.txId);
  w.gold.sales = w.gold.sales.filter((x) => x.id !== saleId);
}
export function goldDeleteEffects(data, id) {
  const w = W(data), sales = w.gold.sales.filter((s) => s.lotId === id);
  const ids = new Set([w.gold.lots.find((l) => l.id === id)?.txId, ...sales.map((s) => s.txId)].filter(Boolean));
  return { linked: ids.size, sales: sales.length, ids };
}
// حذف قطعة: إن ارتبطت بحركات يجب تحديد مصيرها صراحة (keep = تبقى كحركات عادية، reverse = تُحذف وتعود الأرصدة)
export function deleteGoldLot(data, id, opts = {}) {
  const w = W(data); if (!w.gold.lots.some((l) => l.id === id)) fail('القطعة غير موجودة');
  const { ids } = goldDeleteEffects(data, id);
  if (ids.size && !['keep', 'reverse'].includes(opts.mode)) fail('حدد مصير الحركات المرتبطة قبل الحذف');
  if (opts.mode === 'reverse') data.transactions = data.transactions.filter((t) => !ids.has(t.id));
  else for (const t of data.transactions) if (ids.has(t.id)) { delete t.link; t.note = [t.note, '(ذهب محذوف)'].filter(Boolean).join(' '); }
  w.gold.lots = w.gold.lots.filter((l) => l.id !== id);
  w.gold.sales = w.gold.sales.filter((s) => s.lotId !== id);
}
// سعر الجرام النظري من السعر العالمي (يُستخدم فقط عند طلب «اقتراح سعر من الإنترنت»)
export function gramPrice(market, currency, rates, purity = 1) {
  const g = market?.gold;
  if (!(g?.usdPerOz > 0)) return null;
  const v = convert((g.usdPerOz / OZ) * purity, 'USD', currency, rates);
  return v === null ? null : v;
}
// ---------- ملخص الكميات (بلا أي تقييم) ----------
export function goldHoldings(data) {
  const lots = W(data).gold.lots;
  const sum = (arr) => arr.reduce((s, l) => s + l.remaining, 0);
  const owned = lots.filter((l) => isOwnedGold(l) && l.remaining > 0), trust = lots.filter((l) => l.ownership === 'trust' && l.remaining > 0), claim = lots.filter((l) => l.ownership === 'claim' && l.remaining > 0);
  const byKarat = {}, byLocation = {};
  for (const l of owned) { const k = karatLabel(l); byKarat[k] = round((byKarat[k] || 0) + l.remaining, 'QTY'); const loc = l.location || 'غير محدد'; byLocation[loc] = round((byLocation[loc] || 0) + l.remaining, 'QTY'); }
  const costs = {}; // تكلفة المتبقي بعملاتها الأصلية — لا جمع لعملات مختلفة
  let unknownCost = 0;
  for (const l of owned) { if (l.costBasis === null) { unknownCost++; continue; } costs[l.currency] = round((costs[l.currency] || 0) + l.costBasis * (l.remaining / l.grams), l.currency); }
  const realizedByCur = {};
  for (const s of W(data).gold.sales) if (s.realized !== null) realizedByCur[s.currency] = round((realizedByCur[s.currency] || 0) + s.realized, s.currency);
  return { grams: round(sum(owned), 'QTY'), pureGrams: round(owned.reduce((s, l) => s + l.remaining * l.purity, 0), 'QTY'), pieces: owned.reduce((s, l) => s + (l.pieces || 1), 0), lots: owned.length,
    byKarat, byLocation, costs, unknownCost, realizedByCur, trust: { grams: round(sum(trust), 'QTY'), lots: trust.length }, claim: { grams: round(sum(claim), 'QTY'), lots: claim.length } };
}
// ---------- حاسبة الذهب (لا تغيّر أي بيانات) ----------
// prices: { '21': 350, '24': 400 } سعر الجرام بعملة واحدة. basis: 'karat' = السعر لنفس العيار، '24' = سعر جرام 24 ويُحسب المحتوى الخالص.
export function goldCalc(items, { prices = {}, basis = 'karat', currency, fees = 0, discountPct = 0 } = {}) {
  if (!isCurrency(currency)) fail('اختر عملة السعر');
  const p24 = parseAmount(prices['24']);
  const lines = items.map((it) => {
    const key = KARATS.includes(Number(it.karat)) ? String(it.karat) : 'p' + Math.round(it.purity * 1000);
    let ppg = null, how = '';
    if (basis === '24') { if (p24 > 0) { ppg = p24 * it.purity; how = `سعر 24 × ${+(it.purity * 100).toFixed(2)}% (محتوى الذهب الخالص — تقدير نظري)`; } }
    else { const p = parseAmount(prices[key]); if (p > 0) { ppg = p; how = 'سعر الجرام لنفس العيار'; } }
    return { ...it, key, pricePerGram: ppg === null ? null : round(ppg, 'QTY'), value: ppg === null ? null : round(it.grams * ppg, currency), how };
  });
  const priced = lines.filter((l) => l.value !== null), gross = priced.reduce((s, l) => s + l.value, 0);
  const disc = optionalAmount(discountPct, 'QTY', 'نسبة الخصم'); if (disc >= 100) fail('الخصم يجب أن يكون أقل من 100%');
  const fee = optionalAmount(fees, currency, 'الرسوم');
  const net = round(Math.max(0, gross * (1 - disc / 100) - fee), currency);
  return { currency, basis, lines, gross: round(gross, currency), discount: round(gross * disc / 100, currency), fees: fee, net, missing: lines.filter((l) => l.value === null).map((l) => l.key) };
}
export const lotItems = (lots) => lots.filter((l) => l.remaining > 0).map((l) => ({ lotId: l.id, name: l.name, grams: l.remaining, karat: l.karat, purity: l.purity }));
// حفظ تقييم اختياري بتاريخ — لا يغيّر أي قطعة أو رصيد. approved=true فقط بطلب صريح ليظهر في ثروتي والزكاة.
export function saveGoldValuation(data, input) {
  const w = W(data); w.gold.valuations ||= [];
  const currency = explicitCurrency(input, 'عملة السعر');
  const prices = {};
  for (const [k, v] of Object.entries(input.prices || {})) { const n = parseAmount(v); if (n > 0) prices[k] = round(n, 'QTY'); }
  if (!Object.keys(prices).length) fail('أدخل سعر جرام واحد على الأقل');
  const market = GOLD_MARKETS[input.market] ? input.market : 'custom';
  const v = { id: uid(), created: Date.now(), date: dateOr(input.date), market, marketLabel: market === 'custom' ? text(input.marketLabel, 60) || 'سوق مخصص' : GOLD_MARKETS[market].label,
    currency, basis: input.basis === '24' ? '24' : 'karat', side: input.side === 'buy' ? 'buy' : 'sell', prices, discountPct: optionalAmount(input.discountPct, 'QTY', 'الخصم'),
    source: input.source === 'online' ? 'online' : 'manual', note: text(input.note, 160), approved: false };
  if (input.approve) { for (const x of w.gold.valuations) x.approved = false; v.approved = true; }
  w.gold.valuations.push(v);
  return v;
}
export function setValuationApproved(data, id, approved) {
  const w = W(data); const v = (w.gold.valuations || []).find((x) => x.id === id) || fail('التقييم غير موجود');
  for (const x of w.gold.valuations) x.approved = false;
  v.approved = !!approved;
  return v;
}
export function deleteGoldValuation(data, id) { const w = W(data); w.gold.valuations = (w.gold.valuations || []).filter((x) => x.id !== id); }
export const approvedValuation = (data) => (W(data).gold.valuations || []).find((v) => v.approved) || null;
// قيمة الذهب المملوك حاليًا بأسعار التقييم المعتمد (إن وُجد) — وإلا null («غير مقيم»)
export function goldSummary(data, rates, display = data.settings.displayCurrency) {
  const h = goldHoldings(data), v = approvedValuation(data);
  const owned = W(data).gold.lots.filter((l) => isOwnedGold(l) && l.remaining > 0);
  if (!v || !owned.length) return { ...h, valued: false, valuation: v, value: null, valueDisplay: 0, missing: [] };
  const c = goldCalc(lotItems(owned), { prices: v.prices, basis: v.basis, currency: v.currency, discountPct: v.discountPct });
  const conv = convert(c.net, v.currency, display, rates);
  return { ...h, valued: c.missing.length === 0, partial: c.missing.length > 0, valuation: v, value: c.net, valueCurrency: v.currency, calc: c,
    valueDisplay: conv === null ? 0 : round(conv, display), missing: conv === null ? [v.currency] : [] };
}

// ======================= الأسهم والصناديق =======================
export const EXCHANGES = {
  XSAU: { name: 'تداول السعودية (السوق الرئيسية)', country: 'SA', currency: 'SAR' },
  NOMU: { name: 'نمو — السوق الموازية', country: 'SA', currency: 'SAR' },
  XNAS: { name: 'ناسداك', country: 'US', currency: 'USD' },
  XNYS: { name: 'بورصة نيويورك', country: 'US', currency: 'USD' },
  ARCX: { name: 'NYSE Arca (صناديق ETF)', country: 'US', currency: 'USD' },
  XDFM: { name: 'سوق دبي المالي', country: 'AE', currency: 'AED' },
  XADS: { name: 'سوق أبوظبي', country: 'AE', currency: 'AED' },
  XKUW: { name: 'بورصة الكويت', country: 'KW', currency: 'KWD' },
  XCAI: { name: 'البورصة المصرية', country: 'EG', currency: 'EGP' },
  XLON: { name: 'بورصة لندن', country: 'GB', currency: 'GBP' },
  OTHER: { name: 'سوق آخر', country: '', currency: '' },
};
export const SECURITY_KINDS = { stock: 'سهم', etf: 'صندوق مؤشرات ETF', fund: 'صندوق استثماري', reit: 'صندوق عقاري متداول (ريت)', bond: 'صكوك/سندات', other: 'أخرى' };
const FUNDS = ['etf', 'fund', 'reit'];
export function addPortfolio(data, input) {
  const w = W(data);
  const p = { id: uid(), created: Date.now(), name: text(input.name, 80) || fail('اكتب اسم المحفظة'), broker: text(input.broker, 80), note: text(input.note, 200), archived: false };
  w.portfolios.push(p);
  return p;
}
export function updatePortfolio(data, id, input) {
  const p = W(data).portfolios.find((x) => x.id === id) || fail('المحفظة غير موجودة');
  p.name = text(input.name, 80) || fail('اكتب اسم المحفظة'); p.broker = text(input.broker, 80); p.note = text(input.note, 200);
  if (input.archived !== undefined) p.archived = !!input.archived;
  return touch(p);
}
// الورقة المالية تُعرَّف بالرمز + السوق معًا (2222 في تداول ≠ 2222 في سوق آخر)
export function addSecurity(data, input) {
  const w = W(data);
  const symbol = text(input.symbol, 20).toUpperCase() || fail('اكتب رمز التداول');
  const exchange = EXCHANGES[input.exchange] ? input.exchange : 'OTHER';
  const market = exchange === 'OTHER' ? text(input.market, 60) || fail('اكتب اسم السوق') : '';
  const dup = w.securities.find((s) => s.symbol === symbol && s.exchange === exchange && (exchange !== 'OTHER' || s.market === market));
  if (dup) return dup;
  // عملة السوق المعروف هي المعتمدة؛ للسوق «الآخر» يجب اختيار العملة
  const currency = exchange === 'OTHER' ? (isCurrency(input.currency) ? input.currency : fail('اختر عملة الورقة المالية')) : EXCHANGES[exchange].currency;
  const s = { id: uid(), created: Date.now(), name: text(input.name, 90) || symbol, symbol, exchange, market, country: text(input.country, 30) || EXCHANGES[exchange].country,
    currency, kind: SECURITY_KINDS[input.kind] ? input.kind : 'stock', providerSymbol: text(input.providerSymbol, 30), manualPrice: null };
  w.securities.push(s);
  return s;
}
export function updateSecurity(data, id, input) {
  const s = W(data).securities.find((x) => x.id === id) || fail('الورقة المالية غير موجودة');
  s.name = text(input.name, 90) || s.symbol;
  if (SECURITY_KINDS[input.kind]) s.kind = input.kind;
  if (input.providerSymbol !== undefined) s.providerSymbol = text(input.providerSymbol, 30);
  return touch(s);
}
// سعر يدوي موثق بتاريخ (للأسهم التي لا يتوفر لها سعر إلكتروني)
export function setManualPrice(data, id, input) {
  const s = W(data).securities.find((x) => x.id === id) || fail('الورقة المالية غير موجودة');
  if (input.price === '' || input.price === null) { s.manualPrice = null; return s; }
  s.manualPrice = { price: requireAmount(input.price, 'QTY', 'السعر'), date: dateOr(input.date), note: text(input.note, 120) };
  return touch(s);
}
// إعادة بناء الحيازات من سجل العمليات بالترتيب (متوسط التكلفة المرجح). يرفض أي بيع يتجاوز الكمية في تاريخه.
export function replayHoldings(data, { strict = true, upTo } = {}) {
  const w = W(data), pos = new Map(), events = [...w.trades].filter((t) => !upTo || t.date <= upTo).sort(cmpDate);
  const key = (p, s) => p + '|' + s;
  const get = (p, s) => { const k = key(p, s); if (!pos.has(k)) pos.set(k, { portfolioId: p, securityId: s, qty: 0, cost: 0, realized: 0, dividends: 0, fees: 0, buys: 0, sells: 0 }); return pos.get(k); };
  const problems = [];
  for (const t of events) {
    const h = get(t.portfolioId, t.securityId);
    if (t.type === 'buy') { h.qty += t.qty; h.cost += t.qty * t.price + (t.fees || 0); h.fees += t.fees || 0; h.buys += t.qty * t.price + (t.fees || 0); }
    else if (t.type === 'sell') {
      if (t.qty - h.qty > 1e-9) { problems.push({ trade: t, have: h.qty }); if (strict) fail(`لا يمكن بيع ${t.qty} — الكمية المملوكة في ${t.date} هي ${+h.qty.toFixed(6)} فقط`); }
      const avg = h.qty > 0 ? h.cost / h.qty : 0, costOut = avg * Math.min(t.qty, h.qty);
      h.realized += t.qty * t.price - (t.fees || 0) - costOut; h.cost -= costOut; h.qty -= t.qty; h.fees += t.fees || 0; h.sells += t.qty * t.price - (t.fees || 0);
      if (Math.abs(h.qty) < 1e-9) { h.qty = 0; h.cost = 0; }
    } else if (t.type === 'split') { if (!(t.ratio > 0)) fail('نسبة التقسيم غير صالحة'); h.qty *= t.ratio; }
    else if (t.type === 'dividend') { h.dividends += t.amount; }
    else if (t.type === 'transfer') {
      if (t.qty - h.qty > 1e-9) { problems.push({ trade: t, have: h.qty }); if (strict) fail(`لا يمكن تحويل ${t.qty} — المملوك ${+h.qty.toFixed(6)}`); }
      const part = h.qty > 0 ? h.cost * (t.qty / h.qty) : 0;
      h.qty -= t.qty; h.cost -= part;
      const to = get(t.toPortfolioId, t.securityId); to.qty += t.qty; to.cost += part;
    }
  }
  return { holdings: [...pos.values()], problems };
}
function tradeFields(data, input) {
  const w = W(data);
  const type = ['buy', 'sell', 'dividend', 'split', 'transfer'].includes(input.type) ? input.type : fail('نوع العملية غير صالح');
  const portfolio = w.portfolios.find((p) => p.id === input.portfolioId) || fail('اختر المحفظة');
  const sec = w.securities.find((s) => s.id === input.securityId) || fail('اختر الورقة المالية');
  const t = { type, portfolioId: portfolio.id, securityId: sec.id, date: dateOr(input.date), note: text(input.note, 200), currency: sec.currency };
  if (type === 'buy' || type === 'sell') {
    t.qty = requireAmount(input.qty, 'QTY', 'عدد الأسهم'); t.price = requireAmount(input.price, 'QTY', 'سعر السهم'); t.fees = optionalAmount(input.fees, sec.currency, 'العمولة');
    t.gross = round(t.qty * t.price, sec.currency);
  } else if (type === 'dividend') t.amount = requireAmount(input.amount, sec.currency, 'مبلغ التوزيع');
  else if (type === 'split') { t.ratio = parseAmount(input.ratio); if (!(t.ratio > 0) || t.ratio === 1) fail('أدخل نسبة التقسيم (مثل 2 لتقسيم سهم إلى سهمين، أو 0.5 للدمج)'); }
  else if (type === 'transfer') {
    t.qty = requireAmount(input.qty, 'QTY', 'الكمية');
    const to = w.portfolios.find((p) => p.id === input.toPortfolioId) || fail('اختر المحفظة المستلمة');
    if (to.id === portfolio.id) fail('اختر محفظة مختلفة'); t.toPortfolioId = to.id;
  }
  return { t, sec };
}
// تسجيل عملية استثمار. مع حساب: حركة نقدية واحدة مرتبطة (الشراء/البيع خارج تقارير الدخل والمصروف؛ التوزيعات دخل حقيقي).
export function addTrade(data, input) {
  const w = W(data);
  const { t, sec } = tradeFields(data, input);
  Object.assign(t, { id: uid(), created: Date.now(), accountId: null, txId: null });
  // كل التحقق قبل أي تغيير (العملية ذرية: تنجح كلها أو لا يتغير شيء)
  let amt = 0, cash = 0;
  const withCash = input.accountId && ['buy', 'sell', 'dividend'].includes(t.type);
  if (withCash) {
    amt = t.type === 'buy' ? round(t.gross + t.fees, sec.currency) : t.type === 'sell' ? round(t.gross - t.fees, sec.currency) : t.amount;
    if (amt <= 0) fail('صافي المبلغ يجب أن يكون أكبر من صفر');
    cash = inAccountCurrency(data, input.accountId, amt, sec.currency, input.cash, t.type === 'buy' ? 'المبلغ المدفوع' : 'المبلغ المستلم');
  }
  w.trades.push(t);
  try { replayHoldings(data); } catch (e) { w.trades.pop(); throw e; } // البيع لا يتجاوز الكمية في أي تاريخ
  if (withCash) {
    const tx = linkedTx(data, { accountId: input.accountId, type: t.type === 'buy' ? 'expense' : 'income', amount: cash,
      category: t.type === 'buy' ? 'شراء أسهم' : t.type === 'sell' ? 'بيع أسهم' : 'توزيعات أرباح', note: `${sec.symbol} ${sec.name}${t.qty ? ' × ' + t.qty : ''}`, date: t.date,
      link: { kind: 'trade', id: t.id }, counts: t.type === 'dividend', orig: { amount: amt, currency: sec.currency } });
    t.accountId = tx.accountId; t.txId = tx.id;
  }
  return t;
}
// حذف/إلغاء عملية: يُرفض إن كانت عمليات لاحقة تعتمد عليها (مثل حذف شراء بيعت أسهمه لاحقًا)
export function deleteTrade(data, id) {
  const w = W(data), t = w.trades.find((x) => x.id === id) || fail('العملية غير موجودة');
  const keep = w.trades;
  w.trades = keep.filter((x) => x.id !== id);
  try { replayHoldings(data); } catch (e) { w.trades = keep; fail('لا يمكن حذف هذه العملية لأن عمليات بيع أو تحويل لاحقة تعتمد عليها — احذف تلك أولًا'); }
  if (t.txId) data.transactions = data.transactions.filter((x) => x.id !== t.txId);
}
export function quoteOf(data, sec) {
  const q = data.market?.quotes?.[sec.id], m = sec.manualPrice;
  const live = q && q.price > 0 ? { price: q.price, date: q.asOf || q.fetchedAt?.slice(0, 10), source: q.source, kind: 'market', delayed: q.delayed !== false, fetchedAt: q.fetchedAt } : null;
  const manual = m && m.price > 0 ? { price: m.price, date: m.date, source: 'تقييم يدوي', kind: 'manual' } : null;
  if (live && manual) return manual.date > (live.date || '') ? manual : live;
  return live || manual || null;
}
export function securitiesSummary(data, rates, display = data.settings.displayCurrency) {
  const w = W(data), { holdings, problems } = replayHoldings(data, { strict: false });
  const T = () => makeTotaler(display, rates);
  const tot = { stocks: T(), funds: T(), cost: T(), realized: T(), dividends: T(), fees: T(), unpriced: [] };
  const rows = holdings.map((h) => {
    const sec = w.securities.find((s) => s.id === h.securityId), pf = w.portfolios.find((p) => p.id === h.portfolioId);
    const q = sec ? quoteOf(data, sec) : null;
    const value = q && h.qty > 0 ? h.qty * q.price : h.qty > 0 ? null : 0;
    if (sec) {
      if (h.qty > 0) { if (value === null) tot.unpriced.push(sec); else (FUNDS.includes(sec.kind) ? tot.funds : tot.stocks).add(value, sec.currency); if (value !== null) tot.cost.add(h.cost, sec.currency); }
      tot.realized.add(h.realized, sec.currency); tot.dividends.add(h.dividends, sec.currency); tot.fees.add(h.fees, sec.currency);
    }
    return { ...h, security: sec, portfolio: pf, quote: q, avg: h.qty > 0 ? h.cost / h.qty : 0, value: value === null ? null : round(value, sec?.currency), unrealized: value === null || h.qty <= 0 ? null : round(value - h.cost, sec?.currency) };
  });
  const r = (x) => x.result();
  const st = r(tot.stocks), fu = r(tot.funds), co = r(tot.cost);
  return { rows, problems, stocksValue: st.total, fundsValue: fu.total, costOfPriced: co.total, unrealized: round(st.total + fu.total - co.total, display),
    realized: r(tot.realized).total, dividends: r(tot.dividends).total, fees: r(tot.fees).total, unpriced: tot.unpriced,
    missing: [...new Set([...st.missing, ...fu.missing, ...co.missing])], display };
}

// ======================= الاستثمارات الأخرى =======================
export const INVEST_KINDS = { fund: 'صندوق استثماري', etf: 'صندوق مؤشرات ETF', private: 'مشروع خاص', partnership: 'شراكة', realestate: 'عقار استثماري', custom: 'استثمار مخصص' };
export const INVEST_EVENTS = { contribution: 'مساهمة / رأس مال', withdrawal: 'سحب من رأس المال', distribution: 'أرباح موزعة', valuation: 'تقييم', fee: 'رسوم' };
export function addInvestment(data, input) {
  const w = W(data);
  const currency = isCurrency(input.currency) ? input.currency : data.settings.displayCurrency;
  const inv = { id: uid(), created: Date.now(), name: text(input.name, 90) || fail('اكتب اسم الاستثمار'), kind: INVEST_KINDS[input.kind] ? input.kind : 'custom',
    platform: text(input.platform, 90), ownership: input.ownership === '' || input.ownership === undefined ? null : (() => { const n = parseAmount(input.ownership); if (!(n > 0 && n <= 100)) fail('نسبة الملكية بين 0 و100'); return n; })(),
    currency, start: dateOr(input.start), note: text(input.note, 300), archived: false, events: [], attachments: [] };
  w.investments.push(inv);
  const txBefore = data.transactions.length;
  try {
    if (input.capital) addInvestmentEvent(data, inv.id, { type: 'contribution', amount: input.capital, date: inv.start, accountId: input.accountId, cash: input.cash, note: 'رأس المال' });
    if (input.value) addInvestmentEvent(data, inv.id, { type: 'valuation', amount: input.value, date: input.valueDate || today(), note: input.valueNote || 'تقييم أولي' });
  } catch (e) { w.investments.pop(); data.transactions.length = txBefore; throw e; }
  return inv;
}
export function updateInvestment(data, id, input) {
  const inv = W(data).investments.find((x) => x.id === id) || fail('الاستثمار غير موجود');
  inv.name = text(input.name, 90) || fail('اكتب اسم الاستثمار');
  if (INVEST_KINDS[input.kind]) inv.kind = input.kind;
  inv.platform = text(input.platform, 90); inv.note = text(input.note, 300);
  if (input.ownership !== undefined) inv.ownership = input.ownership === '' ? null : parseAmount(input.ownership);
  if (input.archived !== undefined) inv.archived = !!input.archived;
  return touch(inv);
}
export function addInvestmentEvent(data, id, input) {
  const inv = W(data).investments.find((x) => x.id === id) || fail('الاستثمار غير موجود');
  const type = INVEST_EVENTS[input.type] ? input.type : fail('نوع الحركة غير صالح');
  const e = { id: uid(), created: Date.now(), type, amount: requireAmount(input.amount, inv.currency, type === 'valuation' ? 'القيمة' : 'المبلغ'), date: dateOr(input.date), note: text(input.note, 200), accountId: null, txId: null };
  if (type === 'withdrawal' && e.amount - netCapital(inv) > 1e-9) fail(`السحب أكبر من رأس المال القائم (${netCapital(inv)}) — سجّل الزيادة كأرباح موزعة`);
  if (type !== 'valuation' && input.accountId) {
    const out = type === 'contribution' || type === 'fee';
    const cash = inAccountCurrency(data, input.accountId, e.amount, inv.currency, input.cash, out ? 'المبلغ المدفوع' : 'المبلغ المستلم');
    const t = linkedTx(data, { accountId: input.accountId, type: out ? 'expense' : 'income', amount: cash,
      category: { contribution: 'استثمار', withdrawal: 'استرداد استثمار', distribution: 'أرباح استثمار', fee: 'رسوم استثمار' }[type], note: inv.name, date: e.date,
      link: { kind: 'investment', id: inv.id, eventId: e.id }, counts: type === 'distribution', orig: { amount: e.amount, currency: inv.currency } });
    e.accountId = t.accountId; e.txId = t.id;
  }
  inv.events.push(e);
  return e;
}
export function deleteInvestmentEvent(data, id, eventId) {
  const inv = W(data).investments.find((x) => x.id === id) || fail('الاستثمار غير موجود');
  const e = inv.events.find((x) => x.id === eventId) || fail('الحركة غير موجودة');
  const rest = inv.events.filter((x) => x.id !== eventId);
  if (netCapital({ events: rest }) < -1e-9) fail('لا يمكن حذف هذه المساهمة لأن سحوبات لاحقة تعتمد عليها');
  inv.events = rest;
  if (e.txId) data.transactions = data.transactions.filter((t) => t.id !== e.txId);
}
export function deleteInvestment(data, id, opts = {}) {
  const w = W(data), inv = w.investments.find((x) => x.id === id) || fail('الاستثمار غير موجود');
  const ids = new Set(inv.events.map((e) => e.txId).filter(Boolean));
  if (ids.size && !['keep', 'reverse'].includes(opts.mode)) fail('حدد مصير الحركات المرتبطة قبل الحذف');
  if (opts.mode === 'reverse') data.transactions = data.transactions.filter((t) => !ids.has(t.id));
  else for (const t of data.transactions) if (ids.has(t.id)) { delete t.link; t.note = [t.note, '(استثمار محذوف)'].filter(Boolean).join(' '); }
  w.investments = w.investments.filter((x) => x.id !== id);
}
const sum = (inv, type) => inv.events.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
export const netCapital = (inv) => sum(inv, 'contribution') - sum(inv, 'withdrawal');
export function investmentStats(inv) {
  const vals = inv.events.filter((e) => e.type === 'valuation').sort(cmpDate), last = vals[vals.length - 1] || null;
  const contributed = sum(inv, 'contribution'), withdrawn = sum(inv, 'withdrawal'), distributed = sum(inv, 'distribution'), fees = sum(inv, 'fee');
  const capital = contributed - withdrawn;
  // دون تقييم: نعرض رأس المال القائم كقيمة دفترية «تقديرية» ولا ندّعي أنه سعر سوقي
  const value = last ? last.amount : capital;
  return { contributed: round(contributed, inv.currency), withdrawn: round(withdrawn, inv.currency), distributed: round(distributed, inv.currency), fees: round(fees, inv.currency),
    capital: round(capital, inv.currency), value: round(value, inv.currency), valuation: last, estimated: !last,
    unrealized: round(value - capital, inv.currency), realized: round(distributed - fees, inv.currency), totalReturn: round(value + withdrawn + distributed - contributed - fees, inv.currency) };
}
export function investmentsSummary(data, rates, display = data.settings.displayCurrency) {
  const T = () => makeTotaler(display, rates), funds = T(), other = T(), capital = T(), realized = T(), fees = T();
  const rows = W(data).investments.map((inv) => {
    const st = investmentStats(inv);
    if (!inv.archived) { (FUNDS.includes(inv.kind) ? funds : other).add(st.value, inv.currency); capital.add(st.capital, inv.currency); }
    realized.add(st.distributed, inv.currency); fees.add(st.fees, inv.currency);
    return { inv, ...st };
  });
  const f = funds.result(), o = other.result(), c = capital.result();
  return { rows, fundsValue: f.total, otherValue: o.total, unrealized: round(f.total + o.total - c.total, display), realized: realized.result().total, fees: fees.result().total,
    estimated: rows.filter((r) => r.estimated && !r.inv.archived).length, missing: [...new Set([...f.missing, ...o.missing, ...c.missing])] };
}

// ======================= صافي الثروة =======================
export function netWorth(data, rates, display = data.settings.displayCurrency) {
  const T = () => makeTotaler(display, rates);
  const liq = T(), recv = T(), liab = T();
  for (const a of data.accounts) liq.add(balance(data, a), a.currency);
  for (const o of data.obligations) if (!o.archived) (o.type === 'debt' ? liab : recv).add(remainingOf(o), o.currency);
  for (const p of data.projects) if (!p.archived) recv.add(remainingOf(p), p.currency);
  const gold = goldSummary(data, rates, display), sec = securitiesSummary(data, rates, display), inv = investmentsSummary(data, rates, display);
  const L = liq.result(), R = recv.result(), D = liab.result();
  const parts = { liquidity: L.total, gold: gold.valueDisplay, stocks: sec.stocksValue, funds: round(sec.fundsValue + inv.fundsValue, display), other: inv.otherValue, receivables: R.total, liabilities: D.total };
  const assets = parts.liquidity + parts.gold + parts.stocks + parts.funds + parts.other + parts.receivables;
  const notes = [];
  if (gold.grams > 0 && !gold.valuation) notes.push(`الذهب (${+gold.grams.toFixed(3)} غ) غير مقيَّم ولا يدخل في هذا الرقم — قيّمه بنفسك من «حاسبة الذهب» إن أردت.`);
  else if (gold.grams > 0) notes.push(`الذهب محسوب بتقييمك المعتمد بتاريخ ${gold.valuation.date} (${gold.valuation.marketLabel}، ${gold.valuation.currency})${gold.partial ? ' — بعض العيارات بلا سعر في التقييم' : ''}.`);
  if (sec.unpriced.length) notes.push(`${sec.unpriced.length} ورقة مالية بلا سعر (غير محسوبة): ${sec.unpriced.map((s) => s.symbol).join('، ')}.`);
  if (inv.estimated) notes.push(`${inv.estimated} استثمار بلا تقييم — محسوب بقيمة رأس المال (تقديري).`);
  const missing = [...new Set([...L.missing, ...R.missing, ...D.missing, ...gold.missing, ...sec.missing, ...inv.missing])];
  if (missing.length) notes.push(`لا يوجد سعر صرف لـ ${missing.join('، ')} — المبالغ بها غير محسوبة.`);
  return { display, parts, assets: round(assets, display), net: round(assets - parts.liabilities, display),
    realized: round(sec.realized + sec.dividends + inv.realized + goldRealizedDisplay(gold, display, rates), display), unrealized: round(sec.unrealized + inv.unrealized, display),
    partial: (gold.grams > 0 && !gold.valuation) || sec.unpriced.length > 0 || missing.length > 0, gold, securities: sec, investments: inv, notes, missing };
}
function goldRealizedDisplay(gold, display, rates) { const t = makeTotaler(display, rates); for (const [c, v] of Object.entries(gold.realizedByCur || {})) t.add(v, c); return t.result().total; }
// لقطة يومية لصافي الثروة (واحدة لكل يوم، آخر 10 سنوات)
export function recordNetWorth(data, nw, date = today()) {
  const h = (data.netWorthHistory ||= []);
  const entry = { date, value: nw.net, currency: nw.display, parts: nw.parts };
  const last = h[h.length - 1];
  if (last && last.date === date) h[h.length - 1] = entry; else h.push(entry);
  if (h.length > 3650) h.splice(0, h.length - 3650);
  return entry;
}

// ======================= أداء الاستثمار =======================
export function performance(data, rates, display = data.settings.displayCurrency) {
  const nw = netWorth(data, rates, display), w = W(data);
  const T = () => makeTotaler(display, rates);
  const invested = T(), byBroker = {}, byCurrency = {}, byType = {};
  const add = (map, k, field, v, cur) => { (map[k] ||= { value: T(), cost: T(), realized: T() })[field].add(v, cur); };
  for (const r of nw.securities.rows) {
    if (!r.security) continue;
    const broker = r.portfolio?.broker || r.portfolio?.name || 'بدون وسيط', cur = r.security.currency, type = FUNDS.includes(r.security.kind) ? 'funds' : 'stocks';
    invested.add(r.buys, cur);
    for (const [m, k] of [[byBroker, broker], [byCurrency, cur], [byType, type]]) { if (r.value !== null) { add(m, k, 'value', r.value, cur); add(m, k, 'cost', r.cost, cur); } add(m, k, 'realized', r.realized + r.dividends, cur); }
  }
  for (const l of w.gold.lots) if (l.costBasis !== null && l.acquisition === 'purchase' && isOwnedGold(l)) invested.add(l.costBasis, l.currency);
  const g = nw.gold;
  (byType.gold ||= { value: T(), cost: T(), realized: T() });
  if (g.valuation) { byType.gold.value.add(g.valueDisplay, display); for (const [c, v] of Object.entries(g.costs)) byType.gold.cost.add(v, c); } // فقط عند وجود تقييم معتمد
  for (const [c, v] of Object.entries(g.realizedByCur)) byType.gold.realized.add(v, c);
  for (const r of nw.investments.rows) {
    const t = FUNDS.includes(r.inv.kind) ? 'funds' : 'other';
    invested.add(r.contributed + r.fees, r.inv.currency);
    (byType[t] ||= { value: T(), cost: T(), realized: T() });
    if (!r.inv.archived) { byType[t].value.add(r.value, r.inv.currency); byType[t].cost.add(r.capital, r.inv.currency); }
    byType[t].realized.add(r.realized, r.inv.currency);
    add(byCurrency, r.inv.currency, 'value', r.value, r.inv.currency); add(byCurrency, r.inv.currency, 'cost', r.capital, r.inv.currency);
  }
  const fin = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { value: v.value.result().total, cost: v.cost.result().total, realized: v.realized.result().total, gain: round(v.value.result().total - v.cost.result().total, display) }]));
  return { invested: invested.result().total, marketValue: round(nw.parts.gold + nw.parts.stocks + nw.parts.funds + nw.parts.other, display),
    realized: nw.realized, unrealized: nw.unrealized, dividends: nw.securities.dividends, fees: round(nw.securities.fees + nw.investments.fees, display),
    byType: fin(byType), byBroker: fin(byBroker), byCurrency: fin(byCurrency), notes: nw.notes };
}
// التدفقات النقدية للاستثمار (أموال جديدة داخلة/خارجة) في فترة — للتمييز بين ارتفاع القيمة وإضافة أموال
export function investmentFlows(data, { from, to }, rates, display = data.settings.displayCurrency) {
  const inT = makeTotaler(display, rates), outT = makeTotaler(display, rates);
  for (const t of data.transactions) {
    if (!t.link || !['gold', 'gold-sale', 'trade', 'investment'].includes(t.link.kind) || t.date < from || t.date > to) continue;
    if (t.category === 'توزيعات أرباح' || t.category === 'أرباح استثمار') continue; // عائد وليس رأس مال
    (t.type === 'expense' ? inT : outT).add(t.amount, t.currency);
  }
  return { newMoney: inT.result().total, withdrawn: outT.result().total };
}

// ======================= الزكاة (تقديرية) =======================
export const ZAKAT_DEFAULTS = { hawlDate: '', nisabBasis: 'gold', goldNisabGrams: 85, silverNisabGrams: 595, rate: 2.5, jewelry: 'exclude', stocks: 'market', stocksRatio: 25,
  funds: 'market', investments: 'value', receivables: 'strong', debts: 'due', nisabPrice: null, goldPricing: 'valuation' };
// الذهب في الزكاة: لا يُقيَّم تلقائيًا. المصدر إما التقييم المعتمد، أو أسعار يدخلها المستخدم في الحاسبة (manualGold)، وإلا يُعرض «غير مقيم».
// النصاب: سعر جرام (ذهب 24 أو فضة) بعملة العرض يدخله المستخدم، أو سعر جرام 24 من التقييم المعتمد.
export function zakatEstimate(data, opts = {}, rates, display = data.settings.displayCurrency) {
  const o = { ...ZAKAT_DEFAULTS, ...opts }, nw = netWorth(data, rates, display), lines = [];
  const L = (label, amount, included, note) => lines.push({ label, amount: round(amount, display), included: !!included && amount > 0, note });
  L('السيولة في الحسابات (الموجبة)', data.accounts.reduce((s, a) => { const b = balance(data, a); const c = convert(Math.max(0, b), a.currency, display, rates); return s + (c ?? 0); }, 0), true, 'النقد والأرصدة البنكية والمحافظ.');
  const owned = W(data).gold.lots.filter((l) => isOwnedGold(l) && l.remaining > 0);
  const pricing = o.goldPricing === 'manual' && o.manualGold && isCurrency(o.manualGold.currency) ? o.manualGold : o.goldPricing === 'valuation' ? approvedValuation(data) : null;
  const unvalued = [];
  for (const l of owned) {
    const isJewel = l.kind === 'jewelry';
    const c = pricing ? goldCalc(lotItems([l]), { prices: pricing.prices, basis: pricing.basis, currency: pricing.currency }) : null;
    const v = c && c.net > 0 ? convert(c.net, pricing.currency, display, rates) : null;
    if (v === null) { unvalued.push(l); lines.push({ label: `ذهب: ${l.name} (${+l.remaining.toFixed(3)} غ ${karatLabel(l)})`, amount: 0, included: false, unvalued: true, note: 'غير مقيم — أدخل سعر الجرام لهذا العيار ليُحسب.' }); continue; }
    L(`ذهب: ${l.name} (${+l.remaining.toFixed(3)} غ ${karatLabel(l)})`, v, !isJewel || o.jewelry === 'include', `${isJewel ? (o.jewelry === 'include' ? 'مشغولات محسوبة حسب إعدادك. ' : 'مشغولات للاستعمال الشخصي مستثناة حسب إعدادك — المسألة خلافية. ') : ''}بسعرك ${pricing === o.manualGold ? 'المدخل هنا' : `المعتمد بتاريخ ${pricing.date}`} (${pricing.currency}).`);
  }
  const sec = nw.securities;
  for (const r of sec.rows) {
    if (!r.security || r.qty <= 0 || r.value === null) continue;
    const v = convert(r.value, r.security.currency, display, rates); if (v === null) continue;
    const fund = FUNDS.includes(r.security.kind), mode = fund ? o.funds : o.stocks;
    const amount = mode === 'ratio' ? v * (o.stocksRatio / 100) : v;
    L(`${fund ? 'صندوق' : 'سهم'}: ${r.security.symbol}`, amount, mode !== 'exclude', mode === 'market' ? 'بكامل القيمة السوقية (للمضاربة/المتاجرة).' : mode === 'ratio' ? `بنسبة ${o.stocksRatio}% من القيمة (تقدير الأصول الزكوية للاستثمار طويل الأجل).` : 'مستثنى حسب إعدادك (زكاة الشركة تُخرج عنك أو حالة أخرى).');
  }
  for (const r of nw.investments.rows) {
    if (r.inv.archived) continue;
    const v = convert(o.investments === 'profits' ? Math.max(0, r.unrealized) : r.value, r.inv.currency, display, rates); if (v === null) continue;
    L(`استثمار: ${r.inv.name}`, v, o.investments !== 'exclude', o.investments === 'value' ? `بالقيمة ${r.estimated ? '(تقديرية: بلا تقييم)' : 'حسب آخر تقييم'}.` : o.investments === 'profits' ? 'الأرباح فقط (حسب إعدادك).' : 'مستثنى (مثل عقار للسكن أو أصل غير معد للتجارة).');
  }
  if (o.receivables !== 'none') for (const ob of data.obligations) if (!ob.archived && ob.type === 'receivable') { const v = convert(remainingOf(ob), ob.currency, display, rates); if (v) L(`دين لك على ${ob.party}`, v, true, 'دين مرجو السداد يُزكى عند الجمهور؛ استبعده إن كان متعثرًا.'); }
  let base = lines.filter((l) => l.included).reduce((s, l) => s + l.amount, 0);
  let deducted = 0;
  if (o.debts !== 'none') for (const ob of data.obligations) if (!ob.archived && ob.type === 'debt') {
    const due = !ob.due || ob.due <= addDaysStr(today(), 365);
    if (o.debts === 'all' || due) { const v = convert(remainingOf(ob), ob.currency, display, rates); if (v) deducted += v; }
  }
  base = Math.max(0, base - deducted);
  let nisabPerGram = Number(o.nisabPrice) > 0 ? Number(o.nisabPrice) : null, nisabSource = nisabPerGram ? 'manual' : null;
  if (!nisabPerGram && o.nisabBasis === 'gold' && pricing?.prices?.['24'] > 0) { nisabPerGram = convert(pricing.prices['24'], pricing.currency, display, rates); nisabSource = nisabPerGram ? 'valuation' : null; }
  const nisab = nisabPerGram ? nisabPerGram * (o.nisabBasis === 'silver' ? o.silverNisabGrams : o.goldNisabGrams) : null;
  const hawlDone = !o.hawlDate || addDaysStr(o.hawlDate, 354) <= today();
  return { lines, deducted: round(deducted, display), base: round(base, display), nisab: nisab === null ? null : round(nisab, display), nisabBasis: o.nisabBasis,
    reached: nisab !== null && base >= nisab, hawlDone, hawlEnds: o.hawlDate ? addDaysStr(o.hawlDate, 354) : null,
    due: nisab !== null && base >= nisab ? round(base * o.rate / 100, display) : 0, rate: o.rate, display, missing: nw.missing, unvaluedGold: unvalued.length, nisabSource };
}
function addDaysStr(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }

// ======================= سلامة بيانات الثروة =======================
let rates0 = null;
export function diagnoseWealth(data, rates) {
  rates0 = rates || null;
  const w = W(data), f = [], tx = (id) => data.transactions.find((t) => t.id === id);
  const add = (severity, code, title, detail, fix) => f.push({ id: code + ':w' + f.length, severity, code, title, detail, fix });
  for (const l of w.gold.lots) {
    const sold = w.gold.sales.filter((s) => s.lotId === l.id).reduce((s, x) => s + x.grams, 0);
    if (Math.abs(l.grams - sold - l.remaining) > 1e-6 || l.remaining < -1e-9) add('error', 'gold-qty', `كمية ذهب غير متطابقة: ${l.name}`, `الوزن ${l.grams}غ، المباع ${+sold.toFixed(4)}غ، المتبقي المسجل ${l.remaining}غ.`, { type: 'gold-recalc', lotId: l.id, label: 'إعادة حساب المتبقي من المبيعات', explain: 'المتبقي = الوزن − مجموع المبيعات. لا يتغير أي رصيد.' });
    if (l.txId && !tx(l.txId)) add('warn', 'gold-no-tx', `شراء ذهب بلا حركة على الحساب: ${l.name}`, 'سُجل الشراء من حساب لكن الحركة غير موجودة — الرصيد لم يُخصم.', null);
  }
  for (const s of w.gold.sales) { if (!w.gold.lots.some((l) => l.id === s.lotId)) add('warn', 'gold-sale-orphan', 'بيع ذهب لقطعة غير موجودة', `${s.grams}غ بتاريخ ${s.date}.`, null); if (s.txId && !tx(s.txId)) add('warn', 'gold-sale-no-tx', 'بيع ذهب بلا حركة على الحساب', `${s.grams}غ بتاريخ ${s.date}.`, null); }
  const { problems } = replayHoldings(data, { strict: false });
  for (const p of problems) { const sec = w.securities.find((s) => s.id === p.trade.securityId); add('error', 'stock-qty', `بيع يتجاوز الكمية: ${sec?.symbol || '؟'}`, `عملية ${p.trade.type === 'sell' ? 'بيع' : 'تحويل'} ${p.trade.qty} بتاريخ ${p.trade.date} والمملوك وقتها ${+p.have.toFixed(6)}.`, null); }
  for (const t of w.trades) {
    if (!w.securities.some((s) => s.id === t.securityId) || !w.portfolios.some((p) => p.id === t.portfolioId)) add('error', 'trade-ref', 'عملية استثمار تشير إلى ورقة أو محفظة غير موجودة', `بتاريخ ${t.date}.`, null);
    if (t.txId && !tx(t.txId)) add('warn', 'trade-no-tx', 'عملية استثمار بلا حركة على الحساب', `بتاريخ ${t.date}.`, null);
  }
  for (const inv of w.investments) for (const e of inv.events) if (e.txId && !tx(e.txId)) add('warn', 'inv-no-tx', `حركة استثمار بلا حركة على الحساب: ${inv.name}`, `${e.amount} بتاريخ ${e.date}.`, null);
  // حركات مرتبطة بأصل لم يعد موجودًا
  const exists = { gold: (id) => w.gold.lots.some((l) => l.id === id), 'gold-sale': (id) => w.gold.sales.some((s) => s.id === id), trade: (id) => w.trades.some((t) => t.id === id), investment: (id) => w.investments.some((i) => i.id === id) };
  for (const t of data.transactions) if (t.link && exists[t.link.kind] && !exists[t.link.kind](t.link.id)) add('warn', 'asset-orphan', 'حركة مرتبطة بأصل محذوف', `${t.category} ${t.amount} ${t.currency} بتاريخ ${t.date}.`, { type: 'asset-unlink', txId: t.id, label: 'فصل الحركة (تبقى كما هي)', explain: 'تبقى الحركة ورصيدها؛ يُزال ربطها بأصل غير موجود.' });
  // عملة شراء ذهب غير منطقية (مثل 2,000,000 مسجلة بالدولار أو الريال السعودي وهي بالريال اليمني)
  for (const l of w.gold.lots) {
    if (l.costBasis === null || !isCurrency(l.currency)) { if (l.costBasis !== null) add('error', 'gold-no-currency', `سعر شراء بلا عملة: ${l.name}`, 'حدد العملة الصحيحة من صفحة القطعة.', null); continue; }
    const usd = rates0 && convert(l.costBasis / (l.grams * l.purity), l.currency, 'USD', rates0);
    if (usd !== null && usd !== undefined && (usd > 1500 || usd < 2)) add('error', 'gold-currency-suspect', `عملة سعر الشراء قد تكون خاطئة: ${l.name}`, `التكلفة ${l.costBasis} ${l.currency} لـ ${l.grams} غ ${karatLabel(l)} تعني نحو ${Math.round(usd)}$ للجرام الخالص — رقم غير منطقي. ربما أُدخل المبلغ بعملة أخرى (مثل الريال اليمني). لم يُغيَّر شيء.`, { type: 'open-gold', lotId: l.id, label: 'مراجعة القطعة وتصحيح العملة', explain: 'تفتح صفحة القطعة؛ تصحيح العملة يغيّر رمز العملة فقط دون تحويل الرقم، وبعد تأكيدك.' });
  }
  for (const l of w.gold.lots) if (l.ownership === 'trust' && l.txId) add('warn', 'gold-trust-paid', `أمانة مرتبطة بحركة شراء: ${l.name}`, 'ذهب مسجل كأمانة لا تملكها لكنه مرتبط بخصم من حسابك.', null);
  return f;
}
export const FIXERS = {
  'gold-recalc': (data, fix) => { const l = W(data).gold.lots.find((x) => x.id === fix.lotId) || fail('القطعة غير موجودة'); const sold = data.wealth.gold.sales.filter((s) => s.lotId === l.id).reduce((s, x) => s + x.grams, 0); l.remaining = round(Math.max(0, l.grams - sold), 'QTY'); },
  'asset-unlink': (data, fix) => { const t = data.transactions.find((x) => x.id === fix.txId) || fail('الحركة غير موجودة'); delete t.link; },
};

// ======================= سجل الالتزامات والرسوم والضرائب الاستثمارية (توثيقي فقط) =======================
// لا يحرك أي حساب ولا يُعد حسابًا ضريبيًا رسميًا؛ لتوثيق ما دفعته أو يجب دفعه.
export const LIABILITY_KINDS = { fee: 'رسوم', tax: 'ضريبة', zakat: 'زكاة مدفوعة', obligation: 'التزام', other: 'أخرى' };
export function addInvestLiability(data, input) {
  const currency = isCurrency(input.currency) ? input.currency : data.settings.displayCurrency;
  const e = { id: uid(), created: Date.now(), kind: LIABILITY_KINDS[input.kind] ? input.kind : 'other', amount: requireAmount(input.amount, currency), currency,
    date: dateOr(input.date), due: input.due ? optDate(input.due) : '', paid: input.paid === true || input.paid === 'yes', note: text(input.note, 200) || fail('اكتب وصفًا'), relatedId: text(input.relatedId, 60) };
  W(data).liabilities.push(e);
  return e;
}
export function deleteInvestLiability(data, id) { const w = W(data); w.liabilities = w.liabilities.filter((x) => x.id !== id); }
