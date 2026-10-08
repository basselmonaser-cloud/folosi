// فلوسي 3 — الواجهة
import * as C from './core.js';
import * as Store from './store.js';
import * as Sec from './security.js';
import * as FX from './fx.js';
import * as Drive from './drive.js';
import { BETA } from './config.js';

const K = C.STORAGE_KEYS;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const S = { data: null, session: null, rates: FX.loadRates(), view: 'home', param: '', saveOk: null, lastSave: null, migratedFrom: null,
  hist: { type: 'all', account: 'all', month: '', q: '' }, debtTab: 'receivable', rep: { mode: 'month', month: C.today().slice(0, 7), year: C.today().slice(0, 4) },
  drive: readJSON(K.drive) || {}, driveKey: null, drivePending: false, reg: null, updateReady: null, passkeyOK: false, lastActivity: Date.now(), hiddenAt: 0 };
function readJSON(k) { try { return JSON.parse(Store.lsGet(k) || 'null'); } catch { return null; } }
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

// ---------- تنسيق ----------
const SYM = { SAR: 'ر.س', USD: '$', YER: 'ر.ي', AED: 'د.إ', KWD: 'د.ك', QAR: 'ر.ق', BHD: 'د.ب', OMR: 'ر.ع', EGP: 'ج.م', JOD: 'د.أ', EUR: '€', GBP: '£', TRY: '₺', IQD: 'د.ع', MAD: 'د.م', SDG: 'ج.س' };
const nfCache = {};
const nf = (cur) => (nfCache[cur] ||= new Intl.NumberFormat('en-US', { minimumFractionDigits: C.decimals(cur), maximumFractionDigits: C.decimals(cur) }));
const sym = (cur) => SYM[cur] || cur;
function money(n, cur, { sign = false } = {}) {
  const v = Number(n) || 0;
  const s = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  return `<span class="num">${s}${nf(cur).format(Math.abs(v))}</span> <span class="sym">${esc(sym(cur))}</span>`;
}
const plain = (n, cur) => `${nf(cur).format(Number(n) || 0)} ${sym(cur)}`;
let curNames; try { curNames = new Intl.DisplayNames(['ar'], { type: 'currency' }); } catch {}
const curName = (c) => { try { return curNames?.of(c) || c; } catch { return c; } };
const disp = () => S.data.settings.displayCurrency;
const acc = (id) => S.data.accounts.find((a) => a.id === id);
const dateLabel = (d) => {
  if (!d) return '';
  const t = C.today(), y = C.dateStr(new Date(Date.now() - 864e5));
  if (d === t) return 'اليوم'; if (d === y) return 'أمس';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'long', year: d.slice(0, 4) === t.slice(0, 4) ? undefined : 'numeric' }); } catch { return d; }
};
const monthLabel = (m) => { try { return new Date(m + '-15T12:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }); } catch { return m; } };
const dt = (iso) => { try { return new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };
const countLabel = (n) => (n === 1 ? 'حساب واحد' : n === 2 ? 'حسابان' : n <= 10 ? `${n} حسابات` : `${n} حسابًا`);
const icon = (id, cls = '') => `<svg class="i ${cls}"><use href="#${id}"/></svg>`;
const errText = (e) => (e instanceof C.ValidationError ? e.message : e?.userMessage || 'حدث خطأ غير متوقع. لم يتم حفظ التغيير.');
function missingNote(missing) {
  if (!missing?.length) return '';
  return `<div class="notice">لا يتوفر سعر صرف لـ ${missing.map((c) => `<b>${esc(c)}</b>`).join('، ')} — المبالغ بهذه العملة غير محسوبة في الإجمالي. <button class="link-btn" data-action="manual-rate" data-cur="${esc(missing[0])}">أدخل سعرًا يدويًا</button></div>`;
}

// ---------- تنبيهات ----------
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('toast'); t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), isErr ? 5000 : 2600);
}

// ---------- نوافذ ----------
function closeSheet() { if (S.sheetLocked) return; const d = $('sheet'); if (d.open) d.close(); $('sheetBody').innerHTML = ''; }
function sheet(title, inner, { submit = 'حفظ', onSubmit, onReady, onChange, danger = false } = {}) {
  const body = $('sheetBody');
  body.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="x" data-close aria-label="إغلاق">×</button></div>` +
    (onSubmit ? `<form id="sf" novalidate autocomplete="off">${inner}<div class="err-msg" id="sfErr" role="alert"></div><button class="btn ${danger ? 'danger' : 'primary'} block" style="margin-top:14px" type="submit">${esc(submit)}</button></form>` : inner);
  const dlg = $('sheet'); if (!dlg.open) dlg.showModal();
  dlg.oncancel = (e) => { if (S.sheetLocked) e.preventDefault(); };
  body.scrollTop = 0;
  const form = $('sf');
  if (form) {
    const fire = () => onChange?.(form);
    form.addEventListener('input', fire); form.addEventListener('change', fire);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); if (btn.disabled) return;
      const label = btn.textContent; btn.disabled = true; $('sfErr').textContent = '';
      try {
        const v = Object.fromEntries(new FormData(form));
        const r = await onSubmit(v, form, btn);
        if (r !== false && form.isConnected) closeSheet();
      } catch (err) { if (!(err instanceof C.ValidationError)) console.warn('[folosi]', err?.name || err); $('sfErr').textContent = errText(err); }
      finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
    };
  }
  onReady?.(body, form);
  if (form) onChange?.(form);
}
function modal(html) { $('modalBody').innerHTML = html; const d = $('modal'); if (!d.open) d.showModal(); return d; }
function confirmBox({ title, text, ok = 'تأكيد', cancel = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    const d = modal(`<h2>${esc(title)}</h2><p class="muted" style="line-height:1.8">${esc(text)}</p><div class="actions end"><button class="btn" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`);
    const done = (v) => { d.close(); resolve(v); };
    $('modalBody').querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => done(b.dataset.r === '1')));
    d.oncancel = (e) => { e.preventDefault(); done(false); };
  });
}
const pick = (name, value, label, extraCls = '') => `<button type="button" class="${extraCls}" data-pick="${esc(name)}" data-value="${esc(value)}">${label}</button>`;
function setPick(form, name, value) {
  if (!form.elements[name]) return;
  form.elements[name].value = value;
  form.querySelectorAll(`[data-pick="${CSS.escape(name)}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-pick]');
  if (p && p.form) { setPick(p.form, p.dataset.pick, p.dataset.value); p.form.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (e.target.closest('[data-close]')) closeSheet();
  if (e.target === $('sheet')) closeSheet();
});

function currencyOptions(selected, { only, short } = {}) {
  let all = [];
  try { all = Intl.supportedValuesOf?.('currency') || []; } catch {}
  const common = only || C.COMMON_CURRENCIES;
  const o = (c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${short ? `${c} ${esc(sym(c) === c ? '' : sym(c))}` : `${esc(curName(c))} (${c})`}</option>`;
  return `<optgroup label="شائعة">${common.map(o).join('')}</optgroup>` + (only ? '' : `<optgroup label="عملات أخرى">${all.filter((c) => !common.includes(c)).map(o).join('')}</optgroup>`);
}
const accountOptions = (selected, { exclude, all } = {}) => S.data.accounts.filter((a) => (all || !a.archived) && a.id !== exclude)
  .map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)} — ${a.currency} (${plain(C.balance(S.data, a), a.currency)})</option>`).join('');
function rateHint(from, to) {
  const r = C.convert(1, from, to, S.rates);
  if (r === null) return { rate: '', hint: `لا يوجد سعر محفوظ لـ ${from} مقابل ${to} — أدخل السعر يدويًا.` };
  const src = [C.rateSource(from, S.rates), C.rateSource(to, S.rates)].includes('manual') ? 'سعر يدوي' : S.rates.sourceName ? `${S.rates.sourceName} · ${dt(S.rates.fetchedAt)}` : '';
  return { rate: String(+r.toFixed(6)), hint: `السعر المقترح: 1 ${from} = ${+r.toFixed(6)} ${to}${src ? ' · ' + src : ''}` };
}

// ---------- الحفظ ----------
async function save() {
  try {
    const r = await Store.persist(S.data, S.session);
    S.saveOk = r.ok; S.lastSave = new Date(); S.saveWarn = r.ok && (!r.idb || !r.ls);
  } catch { S.saveOk = false; }
  renderStatus(); renderBanners();
  if (!S.persistAsked) { S.persistAsked = true; Store.requestPersistence(); }
  return S.saveOk;
}
// كل تعديل يمر من هنا: إن فشل التحقق تعود البيانات كما كانت تمامًا
async function commit(fn, msg) {
  const snapshot = JSON.stringify(S.data);
  let result;
  try { result = fn(S.data); } catch (e) { S.data = JSON.parse(snapshot); throw e; }
  S.data.updatedAt = new Date().toISOString();
  render();
  const ok = await save();
  if (ok) scheduleDrive();
  if (msg) ok ? toast(msg) : toast('تعذر الحفظ على هذا الجهاز!', true);
  return result;
}
function renderStatus() {
  const el = $('saveStatus');
  if (S.saveOk === false) { el.textContent = 'لم يُحفظ!'; el.className = 'status err'; return; }
  el.className = 'status';
  el.textContent = S.session ? '🔒 محفوظ ومشفر' : 'محفوظ على الجهاز';
  el.title = S.lastSave ? 'آخر حفظ: ' + S.lastSave.toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn') : '';
}

// ---------- التنقل ----------
const VIEWS = ['home', 'history', 'accounts', 'clients', 'debts', 'goals', 'recurring', 'reports', 'more', 'settings', 'detail'];
const NAV_OF = { home: 'home', history: 'history', reports: 'reports', detail: 'home' };
function go(view, param = '') { location.hash = '#/' + view + (param ? '/' + param : ''); }
function readHash() {
  const [, v = 'home', p = ''] = location.hash.split('/');
  S.view = VIEWS.includes(v) ? v : 'home'; S.param = decodeURIComponent(p);
}
window.addEventListener('hashchange', () => { readHash(); closeSheet(); render(); window.scrollTo(0, 0); });
function render() {
  if (!S.data) return;
  for (const v of VIEWS) $('v-' + v).classList.toggle('active', v === S.view);
  const nav = NAV_OF[S.view] || 'more';
  document.querySelectorAll('[data-nav]').forEach((b) => (b.dataset.nav === nav ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  ({ home: renderHome, history: renderHistory, accounts: renderAccounts, clients: renderClients, debts: renderDebts, goals: renderGoals,
    recurring: renderRecurring, reports: renderReports, more: renderMore, settings: renderSettings, detail: renderDetail })[S.view]();
  renderStatus(); renderBanners();
}
const head = (title, back = 'more', extra = '') => `<div class="view-head"><button class="back" data-nav-to="${back}" aria-label="رجوع">${icon('i-back')}</button><h2>${esc(title)}</h2>${extra}</div>`;

// ---------- البانرات ----------
function renderBanners() {
  const b = [];
  if (BETA) b.push('<div class="notice"><b>نسخة تجريبية للاختبار فقط.</b> منفصلة تمامًا عن تطبيقك الحقيقي — لا تُدخل بياناتك المالية الحقيقية هنا.</div>');
  if (S.saveOk === false) b.push(`<div class="notice err"><b>لم يتم حفظ آخر تعديل على هذا الجهاز.</b> قد تكون مساحة التخزين ممتلئة أو أن المتصفح في وضع التصفح الخاص. لا تغلق التطبيق قبل تنزيل نسخة احتياطية.<div class="actions"><button class="btn small" data-action="retry-save">إعادة المحاولة</button><button class="btn small" data-action="export-json">تنزيل نسخة</button></div></div>`);
  else if (S.saveWarn) b.push(`<div class="notice">تم الحفظ في مخزن واحد فقط من مخزني الجهاز. يُنصح بتنزيل نسخة احتياطية.</div>`);
  if (S.updateReady) b.push(`<div class="notice info"><b>يتوفر تحديث جديد لفلوسي.</b> بياناتك لن تتأثر.<div class="actions"><button class="btn primary small" data-action="apply-update">تحديث الآن</button></div></div>`);
  if (S.migratedFrom && !Store.lsGet('folosi_v3_migrated_notice')) b.push(`<div class="notice info">تم تحديث فلوسي إلى الإصدار ${C.APP_VERSION} ونقل بياناتك كما هي، مع حفظ نسخة أمان من بياناتك السابقة على الجهاز.${S.migratedFrom === 1 ? ' رصيد الإصدار الأول موجود في حساب «رصيد النسخة السابقة (غير موزع)».' : ''}<div class="actions"><button class="btn small" data-action="dismiss-migration">حسنًا</button></div></div>`);
  if (S.recoveredNeedsPin) b.push(`<div class="notice">فتحت التطبيق بمفتاح الاسترداد. عيّن رمزًا جديدًا الآن.<div class="actions"><button class="btn small primary" data-action="change-secret">تعيين رمز جديد</button></div></div>`);
  if (S.drivePending && Drive.configured() && S.view === 'home') b.push(`<div class="notice info">النسخ التلقائي إلى Google Drive متوقف حتى تجدد الاتصال (الجلسة تنتهي بعد ساعة أو عند إغلاق التطبيق).<div class="actions"><button class="btn small primary" data-action="drive-backup">تجديد ونسخ الآن</button></div></div>`);
  $('banners').innerHTML = b.join('');
}

// ---------- الرئيسية ----------
const SHORTCUTS = {
  accounts: ['i-wallet', 'الحسابات', () => go('accounts')], transfer: ['i-swap', 'تحويل', () => openTransfer()],
  clients: ['i-users', 'العملاء', () => go('clients')], obligations: ['i-hand', 'الديون', () => go('debts')],
  goals: ['i-target', 'الادخار', () => go('goals')], recurring: ['i-bill', 'الفواتير', () => go('recurring')],
  reports: ['i-chart', 'التقارير', () => go('reports')], history: ['i-list', 'السجل', () => go('history')],
  income: ['i-arrow-in', 'دخل', () => openTx({ type: 'income' })], expense: ['i-arrow-out', 'مصروف', () => openTx({ type: 'expense' })],
  settings: ['i-gear', 'الإعدادات', () => go('settings')],
};
function shortcutList() {
  let s = readJSON(K.shortcuts);
  if (!Array.isArray(s)) s = ['accounts', 'transfer', 'clients', 'obligations'];
  return [...new Set(s.filter((k) => SHORTCUTS[k]))];
}
function renderHome() {
  const d = S.data, cur = disp();
  const tot = C.totalBalance(d, S.rates), mm = C.monthRange(C.today().slice(0, 7));
  const sum = C.periodSummary(d, mm, S.rates), ob = C.obligationTotals(d, S.rates);
  const curs = new Set(d.accounts.map((a) => a.currency));
  const sc = shortcutList();
  const due = dueSoon();
  $('v-home').innerHTML = `
    <div class="row-head"><small>اختصاراتك</small><button class="link-btn" data-action="edit-shortcuts">تخصيص</button></div>
    <div class="shortcuts">${sc.map((k) => `<button class="shortcut" data-shortcut="${k}"><span class="ico">${icon(SHORTCUTS[k][0])}</span><span>${SHORTCUTS[k][1]}</span></button>`).join('') || '<small class="muted">لا توجد اختصارات — اضغط تخصيص</small>'}</div>
    <div class="card hero">
      <small>الرصيد الإجمالي</small>
      <div class="big"><span class="num">${tot.total < 0 ? '-' : ''}${nf(cur).format(Math.abs(tot.total))}</span><span class="cur">${esc(sym(cur))}</span></div>
      <small>${countLabel(d.accounts.filter((a) => !a.archived).length)}${curs.size > 1 ? ` · ${curs.size} عملات محوّلة إلى ${esc(curName(cur))} بالسعر الحالي` : ''}</small>
    </div>
    ${missingNote(tot.missing)}
    <div class="stats">
      <button class="stat" data-nav-to="detail/income"><small>دخل الشهر</small><div class="v good">${money(sum.income, cur)}</div></button>
      <button class="stat" data-nav-to="detail/expense"><small>مصروف الشهر</small><div class="v bad">${money(sum.expense, cur)}</div></button>
      <button class="stat" data-nav-to="detail/receivable"><small>مستحقات لي</small><div class="v">${money(ob.receivable.total, cur)}</div></button>
      <button class="stat" data-nav-to="detail/debt"><small>ديون عليّ</small><div class="v">${money(ob.debt.total, cur)}</div></button>
    </div>
    ${due.length ? `<div class="card"><div class="card-head"><h3>يحتاج انتباهك</h3></div><ul class="list">${due.join('')}</ul></div>` : ''}
    <div class="card"><div class="card-head"><h3>آخر العمليات</h3><button class="link-btn" data-nav-to="history">عرض الكل</button></div>
      ${entriesList(allEntries().slice(0, 6), { groups: false }) || `<div class="empty">لا توجد عمليات بعد.<br><button class="btn primary" style="margin-top:12px" data-action="quick-add">أضف أول عملية</button></div>`}
    </div>`;
}
function dueSoon() {
  const d = S.data, t = C.today(), soon = C.dateStr(new Date(Date.now() + 7 * 864e5)), out = [];
  for (const r of d.recurring) if (r.next <= soon) out.push(`<li class="item"><span class="ico ${r.type === 'income' ? 'in' : 'out'}">${icon('i-bill')}</span><div class="body"><div class="title">${esc(r.name)}</div><div class="sub">${r.next < t ? '<span class="tag bad">متأخر</span> ' : ''}${esc(dateLabel(r.next))}</div></div><div class="amt">${money(r.amount, r.currency)}<button class="btn small" style="margin-top:4px" data-action="post-rec" data-id="${esc(r.id)}">تسجيل</button></div></li>`);
  for (const o of d.obligations) { const rem = C.remainingOf(o); if (rem > 0 && o.due && o.due <= soon) out.push(`<li><button class="item" data-action="open-ob" data-id="${esc(o.id)}"><span class="ico">${icon('i-hand')}</span><div class="body"><div class="title">${esc(o.party)} · ${o.type === 'debt' ? 'عليّ' : 'لي'}</div><div class="sub">${o.due < t ? '<span class="tag bad">متأخر</span> ' : ''}${esc(dateLabel(o.due))}</div></div><div class="amt">${money(rem, o.currency)}</div></button></li>`); }
  for (const p of d.projects) { const rem = C.remainingOf(p); if (rem > 0 && p.due && p.due <= soon) out.push(`<li><button class="item" data-action="open-project" data-id="${esc(p.id)}"><span class="ico">${icon('i-users')}</span><div class="body"><div class="title">${esc(p.client)} — ${esc(p.name)}</div><div class="sub">${p.due < t ? '<span class="tag bad">متأخر</span> ' : ''}تحصيل ${esc(dateLabel(p.due))}</div></div><div class="amt">${money(rem, p.currency)}</div></button></li>`); }
  return out.slice(0, 6);
}

// ---------- قائمة العمليات ----------
function allEntries() {
  const d = S.data;
  const tx = d.transactions.map((t) => ({ kind: 'tx', t, date: t.date, created: t.created || 0 }));
  const tr = d.transfers.map((t) => ({ kind: 'tr', t, date: t.date, created: t.created || 0 }));
  return [...tx, ...tr].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
}
function entryRow(e) {
  if (e.kind === 'tr') {
    const t = e.t, f = acc(t.from), to = acc(t.to);
    return `<li><button class="item" data-action="open-transfer" data-id="${esc(t.id)}"><span class="ico tr">${icon('i-swap')}</span><div class="body"><div class="title">تحويل: ${esc(f?.name || '؟')} ← ${esc(to?.name || '؟')}</div><div class="sub">${esc(t.note || dateLabel(t.date))}</div></div><div class="amt">${money(t.fromAmount ?? t.amount, f?.currency || disp())}${t.fromCurrency && t.toCurrency && t.fromCurrency !== t.toCurrency ? `<small>${plain(t.toAmount, t.toCurrency)}</small>` : ''}</div></button></li>`;
  }
  const t = e.t, a = acc(t.accountId), inc = t.type === 'income';
  const tags = [t.link ? '<span class="tag">مرتبطة</span>' : '', t.excludeFromReports ? '<span class="tag">خارج التقارير</span>' : ''].join(' ');
  return `<li><button class="item" data-action="open-tx" data-id="${esc(t.id)}"><span class="ico ${inc ? 'in' : 'out'}">${icon(inc ? 'i-arrow-in' : 'i-arrow-out')}</span><div class="body"><div class="title">${esc(t.category)} ${tags}</div><div class="sub">${esc(a?.name || 'حساب محذوف')}${t.note ? ' · ' + esc(t.note) : ''}</div></div><div class="amt ${inc ? 'good' : 'bad'}">${money(inc ? t.amount : -t.amount, t.currency, { sign: true })}${t.origCurrency ? `<small>${plain(t.origAmount, t.origCurrency)}</small>` : ''}</div></button></li>`;
}
function entriesList(entries, { groups = true } = {}) {
  if (!entries.length) return '';
  if (!groups) return `<ul class="list">${entries.map(entryRow).join('')}</ul>`;
  let html = '', last = null;
  for (const e of entries) { if (e.date !== last) { if (last !== null) html += '</ul>'; html += `<div class="day">${esc(dateLabel(e.date))}</div><ul class="list">`; last = e.date; } html += entryRow(e); }
  return html + '</ul>';
}
function renderHistory() {
  const f = S.hist, q = f.q.trim().toLowerCase();
  let list = allEntries().filter((e) => {
    if (f.type === 'transfer' && e.kind !== 'tr') return false;
    if ((f.type === 'income' || f.type === 'expense') && (e.kind !== 'tx' || e.t.type !== f.type)) return false;
    if (f.month && !e.date.startsWith(f.month)) return false;
    if (f.account !== 'all' && (e.kind === 'tx' ? e.t.accountId !== f.account : e.t.from !== f.account && e.t.to !== f.account)) return false;
    if (q) { const a = e.kind === 'tx' ? `${e.t.category} ${e.t.note} ${acc(e.t.accountId)?.name} ${e.t.amount}` : `تحويل ${e.t.note} ${acc(e.t.from)?.name} ${acc(e.t.to)?.name} ${e.t.amount}`; if (!a.toLowerCase().includes(q)) return false; }
    return true;
  });
  const cur = disp(); let inc = 0, exp = 0; const miss = new Set();
  for (const e of list) if (e.kind === 'tx' && C.reportable(e.t)) { const v = C.convert(e.t.amount, e.t.currency, cur, S.rates); if (v === null) miss.add(e.t.currency); else e.t.type === 'income' ? (inc += v) : (exp += v); }
  const total = list.length; list = list.slice(0, S.histLimit || 300);
  $('v-history').innerHTML = `${head('سجل العمليات', 'home')}
    <div class="card"><div class="filters">
      <select id="hType" aria-label="النوع"><option value="all">كل الأنواع</option><option value="income">دخل</option><option value="expense">مصروف</option><option value="transfer">تحويلات</option></select>
      <select id="hAcc" aria-label="الحساب"><option value="all">كل الحسابات</option>${S.data.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
      <input id="hMonth" type="month" aria-label="الشهر" value="${esc(f.month)}">
      <input id="hQ" type="search" placeholder="بحث…" value="${esc(f.q)}" aria-label="بحث">
    </div>
    <div class="kpis" style="margin-top:10px"><div><small>دخل</small><b class="good">${money(inc, cur)}</b></div><div><small>مصروف</small><b class="bad">${money(exp, cur)}</b></div><div><small>عدد</small><b>${total}</b></div></div>
    ${miss.size ? missingNote([...miss]) : ''}</div>
    <div class="card">${entriesList(list) || '<div class="empty">لا توجد نتائج</div>'}${total > list.length ? `<button class="btn block" data-action="more-history">عرض المزيد (${total - list.length})</button>` : ''}</div>`;
  $('hType').value = f.type; $('hAcc').value = f.account;
  const upd = () => { S.hist = { type: $('hType').value, account: $('hAcc').value, month: $('hMonth').value, q: $('hQ').value }; const pos = $('hQ').selectionStart; const focused = document.activeElement?.id; renderHistory(); if (focused) { $(focused).focus(); if (focused === 'hQ') $('hQ').setSelectionRange(pos, pos); } };
  ['hType', 'hAcc', 'hMonth'].forEach((id) => ($(id).onchange = upd)); $('hQ').oninput = upd;
}

// ---------- تفاصيل البطاقات ----------
function renderDetail() {
  const kind = S.param, cur = disp(), m = C.today().slice(0, 7), r = C.monthRange(m);
  if (kind === 'income' || kind === 'expense') {
    const s = C.periodSummary(S.data, r, S.rates);
    const list = allEntries().filter((e) => e.kind === 'tx' && e.t.type === kind && e.date >= r.from && e.date <= r.to && C.reportable(e.t));
    const cats = s.byCategory[kind], max = cats[0]?.value || 1;
    $('v-detail').innerHTML = `${head(kind === 'income' ? 'دخل الشهر' : 'مصروف الشهر', 'home')}
      <div class="card"><small>${esc(monthLabel(m))}</small><div style="font-size:26px;font-weight:700" class="${kind === 'income' ? 'good' : 'bad'}">${money(s[kind], cur)}</div>
      <div class="bars">${cats.map((c) => `<div class="row"><span>${esc(c.name)}</span><b>${money(c.value, cur)}</b><div class="progress ${kind === 'income' ? 'good' : ''}"><span style="width:${(c.value / max) * 100}%"></span></div></div>`).join('')}</div>${missingNote(s.missing)}</div>
      <div class="card"><h3>العمليات (${list.length})</h3>${entriesList(list) || '<div class="empty">لا توجد عمليات هذا الشهر</div>'}</div>`;
  } else if (kind === 'receivable' || kind === 'debt') {
    const obs = S.data.obligations.filter((o) => o.type === kind && C.remainingOf(o) > 0);
    const prj = kind === 'receivable' ? S.data.projects.filter((p) => C.remainingOf(p) > 0) : [];
    const t = C.obligationTotals(S.data, S.rates)[kind];
    $('v-detail').innerHTML = `${head(kind === 'receivable' ? 'مستحقات لي' : 'ديون عليّ', 'home')}
      <div class="card"><small>الإجمالي المتبقي</small><div style="font-size:26px;font-weight:700">${money(t.total, cur)}</div>${missingNote(t.missing)}</div>
      ${prj.length ? `<div class="card"><h3>العملاء والمشاريع</h3><ul class="list">${prj.map(projectRow).join('')}</ul></div>` : ''}
      <div class="card"><h3>${kind === 'receivable' ? 'ديون لي على الآخرين' : 'ديون عليّ للآخرين'}</h3>${obs.length ? `<ul class="list">${obs.map(obRow).join('')}</ul>` : '<div class="empty">لا يوجد</div>'}
      <button class="btn block" data-action="add-ob" data-type="${kind}">إضافة ${kind === 'receivable' ? 'مستحق' : 'دين'}</button></div>`;
  } else go('home');
}

// ---------- نموذج العملية ----------
function openTx(preset = {}, editId = null) {
  const d = S.data;
  const active = d.accounts.filter((a) => !a.archived);
  if (!active.length) { toast('أضف حسابًا أولًا'); return openAccount(); }
  const t = editId ? d.transactions.find((x) => x.id === editId) : null;
  const type = t?.type || preset.type || 'expense';
  const lastAcc = Store.lsGet('folosi_last_account');
  const accountId = t?.accountId || preset.accountId || (active.some((a) => a.id === lastAcc) ? lastAcc : active[0].id);
  const accCur = acc(accountId)?.currency;
  sheet(t ? 'تعديل العملية' : 'عملية جديدة', `
    <div class="seg" role="group" aria-label="نوع العملية">${pick('type', 'expense', 'مصروف', 'out')}${pick('type', 'income', 'دخل', 'in')}</div>
    <input type="hidden" name="type" value="${type}">
    <label for="fAmount">المبلغ (مطلوب)</label>
    <div class="grid2" style="grid-template-columns:2fr 1fr"><input id="fAmount" name="amount" class="amount-input" inputmode="decimal" enterkeyhint="done" placeholder="0" required value="${t ? esc(t.origAmount ?? t.amount) : ''}">
      <select name="currency" aria-label="العملة">${currencyOptions(t?.origCurrency || accCur, { only: [...new Set([accCur, ...d.accounts.map((a) => a.currency), ...C.COMMON_CURRENCIES])], short: true })}</select></div>
    <label>الحساب</label><select name="accountId">${accountOptions(accountId)}</select>
    <div id="rateBox" hidden><label for="fRate" id="rateLabel">سعر التحويل</label><input id="fRate" name="rate" inputmode="decimal"><div class="hint" id="rateHint"></div></div>
    <label>التصنيف</label><input type="hidden" name="category" value="${esc(t?.category || '')}"><div class="chips" id="catChips"></div>
    <input name="newCategory" id="newCat" placeholder="اسم التصنيف الجديد" maxlength="40" hidden style="margin-top:8px">
    <div class="grid2"><div><label for="fDate">التاريخ</label><input id="fDate" type="date" name="date" value="${esc(t?.date || C.today())}"></div>
      <div><label for="fNote">ملاحظة (اختياري)</label><input id="fNote" name="note" maxlength="300" value="${esc(t?.note || '')}"></div></div>`, {
    submit: t ? 'حفظ التعديل' : 'حفظ العملية',
    onReady: (body, form) => { setPick(form, 'type', type); setTimeout(() => !t && $('fAmount')?.focus(), 250); },
    onChange: (form) => {
      const ty = form.elements.type.value, a = acc(form.elements.accountId.value), c = form.elements.currency.value;
      const cats = [...d.categories[ty]]; if (t && t.type === ty && !cats.includes(t.category)) cats.unshift(t.category);
      let cat = form.elements.category.value;
      if (!cats.includes(cat) && cat !== '__new') cat = cats[0];
      const chips = $('catChips');
      if (chips.dataset.ty !== ty || chips.dataset.cat !== cat) {
        chips.innerHTML = cats.map((x) => pick('category', x, esc(x), 'chip')).join('') + pick('category', '__new', '+ تصنيف جديد', 'chip');
        chips.dataset.ty = ty; setPick(form, 'category', cat); chips.dataset.cat = cat;
      }
      $('newCat').hidden = cat !== '__new';
      const diff = a && c !== a.currency; $('rateBox').hidden = !diff;
      if (diff) {
        $('rateLabel').textContent = `سعر التحويل: 1 ${c} = ؟ ${a.currency}`;
        if (form.dataset.ratePair !== c + a.currency) { const h = rateHint(c, a.currency); form.elements.rate.value = t?.origCurrency === c && t.rate ? t.rate : h.rate; $('rateHint').dataset.base = h.hint; form.dataset.ratePair = c + a.currency; }
        const n = C.parseAmount(form.elements.amount.value), r = Number(C.parseAmount(form.elements.rate.value));
        $('rateHint').textContent = ($('rateHint').dataset.base || '') + (n > 0 && r > 0 ? ` — سيُسجل: ${plain(n * r, a.currency)}` : '');
      }
    },
    onSubmit: async (v) => {
      let category = v.category;
      if (category === '__new') { category = (v.newCategory || '').trim(); if (!category) throw new C.ValidationError('اكتب اسم التصنيف الجديد'); }
      const input = { type: v.type, amount: v.amount, currency: v.currency, rate: C.parseAmount(v.rate), accountId: v.accountId, category, note: v.note, date: v.date };
      if (!t) {
        const dup = C.findDuplicate(d, input);
        if (dup && !(await confirmBox({ title: 'عملية مشابهة', text: `سجلت قبل قليل عملية بنفس المبلغ والتصنيف والحساب. هل تريد تسجيلها مرة أخرى؟`, ok: 'تسجيل مرة أخرى' }))) return false;
      }
      await commit((data) => { if (v.category === '__new') C.addCategory(data, v.type, category); return t ? C.updateTransaction(data, t.id, input) : C.addTransaction(data, input); }, t ? 'تم حفظ التعديل' : 'تم حفظ العملية');
      Store.lsSet('folosi_last_account', v.accountId);
    },
  });
}
function openTxDetail(id) {
  const t = S.data.transactions.find((x) => x.id === id); if (!t) return;
  const a = acc(t.accountId), inc = t.type === 'income';
  const linkInfo = t.link ? (t.link.kind === 'project' ? 'دفعة مرتبطة بمشروع عميل' : t.link.paymentId ? 'دفعة مرتبطة بدين' : 'حركة إنشاء دين/سلفة') : '';
  sheet(inc ? 'دخل' : 'مصروف', `
    <div style="font-size:30px;font-weight:700;margin:8px 0" class="${inc ? 'good' : 'bad'}">${money(inc ? t.amount : -t.amount, t.currency, { sign: true })}</div>
    <ul class="list">
      <li class="item"><div class="body"><div class="sub">التصنيف</div><div class="title">${esc(t.category)}</div></div></li>
      <li class="item"><div class="body"><div class="sub">الحساب</div><div class="title">${esc(a?.name || '—')}</div></div></li>
      <li class="item"><div class="body"><div class="sub">التاريخ</div><div class="title">${esc(dateLabel(t.date))} (${esc(t.date)})</div></div></li>
      ${t.origCurrency ? `<li class="item"><div class="body"><div class="sub">المبلغ الأصلي</div><div class="title">${plain(t.origAmount, t.origCurrency)} · السعر ${+Number(t.rate).toFixed(6)}</div></div></li>` : ''}
      ${t.note ? `<li class="item"><div class="body"><div class="sub">ملاحظة</div><div class="title">${esc(t.note)}</div></div></li>` : ''}
      ${linkInfo ? `<li class="item"><div class="body"><div class="sub">ارتباط</div><div class="title">${linkInfo}${t.excludeFromReports ? ' · لا تُحتسب دخلًا أو مصروفًا' : ''}</div></div></li>` : ''}
    </ul>
    <div class="actions">${t.link ? '' : `<button class="btn primary" data-action="edit-tx" data-id="${esc(t.id)}">تعديل</button>`}<button class="btn ghost-danger" data-action="del-tx" data-id="${esc(t.id)}">حذف</button></div>`);
}
async function deleteTx(id) {
  const t = S.data.transactions.find((x) => x.id === id); if (!t) return;
  const text = t.link ? 'هذه العملية مرتبطة بدفعة عميل أو دين. حذفها سيحذف الدفعة أيضًا ويعيد المبلغ إلى المتبقي، وتتحدث الأرصدة.' : 'سيتم حذف العملية وتحديث رصيد الحساب والتقارير.';
  if (!(await confirmBox({ title: 'حذف العملية؟', text, ok: 'حذف', danger: true }))) return;
  closeSheet(); await commit((d) => C.deleteTransaction(d, id), 'تم الحذف');
}

// ---------- الحسابات والتحويل ----------
function renderAccounts() {
  const d = S.data, tot = C.totalBalance(d, S.rates);
  const row = (a) => `<li><button class="item" data-action="open-account" data-id="${esc(a.id)}"><span class="ico">${icon(a.type === 'cash' ? 'i-wallet' : a.type === 'wallet' ? 'i-wallet' : 'i-bill')}</span><div class="body"><div class="title">${esc(a.name)} ${a.archived ? '<span class="tag">مؤرشف</span>' : ''}</div><div class="sub">${esc(C.ACCOUNT_TYPES[a.type] || '')} · ${esc(a.currency)}</div></div><div class="amt">${money(C.balance(d, a), a.currency)}</div></button></li>`;
  $('v-accounts').innerHTML = `${head('الحسابات')}
    <div class="card hero"><small>إجمالي الحسابات</small><div class="big"><span class="num">${nf(disp()).format(tot.total)}</span><span class="cur">${esc(sym(disp()))}</span></div></div>
    ${missingNote(tot.missing)}
    <div class="actions"><button class="btn primary" data-action="add-account">إضافة حساب</button><button class="btn" data-action="transfer" ${d.accounts.filter((a) => !a.archived).length < 2 ? 'disabled' : ''}>تحويل بين الحسابات</button></div>
    <div class="card">${d.accounts.length ? `<ul class="list">${d.accounts.filter((a) => !a.archived).map(row).join('')}${d.accounts.filter((a) => a.archived).map(row).join('')}</ul>` : '<div class="empty">لا توجد حسابات</div>'}</div>
    <p class="muted" style="font-size:13px">الأرصدة تُسجل يدويًا؛ فلوسي لا يتصل بالبنوك. التحويل بين حساباتك لا يُحتسب دخلًا أو مصروفًا.</p>`;
}
function openAccount(id) {
  const a = id ? acc(id) : null, inUse = a ? C.accountInUse(S.data, a.id) : false;
  const presets = C.ACCOUNT_PRESETS.filter((p) => !S.data.accounts.some((x) => x.name === p.name));
  sheet(a ? 'تعديل الحساب' : 'إضافة حساب', `
    ${!a && presets.length ? `<label>اختيار سريع</label><div class="chips">${presets.map((p) => `<button type="button" class="chip" data-preset="${esc(p.name)}" data-ptype="${p.type}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <label for="aName">اسم الحساب (بنك، محفظة، كاش…)</label><input id="aName" name="name" required maxlength="80" value="${esc(a?.name || '')}">
    <div class="grid2"><div><label>النوع</label><select name="type">${Object.entries(C.ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}"${(a?.type || 'bank') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>العملة</label><select name="currency" ${inUse ? 'disabled' : ''}>${currencyOptions(a?.currency || disp())}</select></div></div>
    <label for="aOpen">${a ? 'الرصيد الافتتاحي' : 'الرصيد الحالي'}</label><input id="aOpen" name="opening" inputmode="decimal" value="${esc(a ? a.opening : '0')}">
    <div class="hint">${a ? `الرصيد الحالي ${plain(C.balance(S.data, a), a.currency)} = الافتتاحي + العمليات والتحويلات.` : 'اكتب الرصيد الموجود فعليًا في الحساب الآن. للسالب اكتب علامة - قبل الرقم.'}${inUse ? ' لا يمكن تغيير عملة حساب عليه عمليات.' : ''}</div>
    ${a ? `<div class="actions"><button type="button" class="btn small" data-action="archive-account" data-id="${esc(a.id)}">${a.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</button>${inUse ? '' : `<button type="button" class="btn small ghost-danger" data-action="del-account" data-id="${esc(a.id)}">حذف الحساب</button>`}<button type="button" class="btn small" data-action="account-history" data-id="${esc(a.id)}">عمليات الحساب</button></div>` : ''}`, {
    submit: a ? 'حفظ' : 'إضافة الحساب',
    onReady: (body, form) => body.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => { form.elements.name.value = b.dataset.preset; form.elements.type.value = b.dataset.ptype; })),
    onSubmit: (v) => commit((d) => (a ? C.updateAccount(d, a.id, { ...v, currency: inUse ? undefined : v.currency }) : C.addAccount(d, v)), a ? 'تم حفظ الحساب' : 'تمت إضافة الحساب'),
  });
}
function openTransfer() {
  const active = S.data.accounts.filter((a) => !a.archived);
  if (active.length < 2) { toast('أضف حسابًا ثانيًا لتتمكن من التحويل'); return openAccount(); }
  sheet('تحويل بين حساباتي', `
    <label>من حساب</label><select name="from">${accountOptions(active[0].id)}</select>
    <label>إلى حساب</label><select name="to"></select>
    <label for="tAmount" id="tAmountLabel">المبلغ</label><input id="tAmount" name="amount" class="amount-input" inputmode="decimal" placeholder="0" required>
    <div id="tFx" hidden><label id="tRateLabel" for="tRate">سعر التحويل</label><input id="tRate" name="rate" inputmode="decimal"><div class="hint" id="tRateHint"></div>
      <label for="tTo" id="tToLabel">المبلغ المستلم</label><input id="tTo" name="toAmount" inputmode="decimal"><div class="hint">عدّل السعر أو المبلغ المستلم ليطابق ما وصل فعلًا.</div></div>
    <div class="hint" id="tHint"></div>
    <div class="grid2"><div><label>التاريخ</label><input type="date" name="date" value="${C.today()}"></div><div><label>ملاحظة</label><input name="note" maxlength="200"></div></div>`, {
    submit: 'تسجيل التحويل',
    onChange: (form, ev) => {
      const fromId = form.elements.from.value, to = form.elements.to;
      if (to.dataset.from !== fromId) { const prev = to.value; to.innerHTML = accountOptions(null, { exclude: fromId }); if ([...to.options].some((o) => o.value === prev)) to.value = prev; to.dataset.from = fromId; }
      const f = acc(fromId), t = acc(to.value); if (!f || !t) return;
      $('tAmountLabel').textContent = `المبلغ (${f.currency})`;
      const diff = f.currency !== t.currency; $('tFx').hidden = !diff;
      const n = C.parseAmount(form.elements.amount.value);
      if (diff) {
        $('tRateLabel').textContent = `سعر التحويل: 1 ${f.currency} = ؟ ${t.currency}`; $('tToLabel').textContent = `المبلغ المستلم (${t.currency})`;
        if (form.dataset.pair !== f.id + t.id) { const h = rateHint(f.currency, t.currency); form.elements.rate.value = h.rate; $('tRateHint').textContent = h.hint; form.dataset.pair = f.id + t.id; form.dataset.lastEdit = 'rate'; }
        const active = document.activeElement?.name;
        if (active === 'toAmount') form.dataset.lastEdit = 'to'; else if (active === 'rate' || active === 'amount') form.dataset.lastEdit = 'rate';
        const r = C.parseAmount(form.elements.rate.value), ta = C.parseAmount(form.elements.toAmount.value);
        if (form.dataset.lastEdit === 'rate' && n > 0 && r > 0) form.elements.toAmount.value = C.round(n * r, t.currency);
        else if (form.dataset.lastEdit === 'to' && n > 0 && ta > 0) form.elements.rate.value = +(ta / n).toFixed(6);
      }
      const bal = C.balance(S.data, f);
      $('tHint').innerHTML = `الرصيد المتاح في ${esc(f.name)}: ${money(bal, f.currency)}${n > bal ? ' — <b class="bad">المبلغ أكبر من الرصيد</b>' : ''}`;
    },
    onSubmit: async (v) => {
      const f = acc(v.from), n = C.parseAmount(v.amount);
      if (f && n > C.balance(S.data, f) && !(await confirmBox({ title: 'المبلغ أكبر من الرصيد', text: `رصيد ${f.name} سيصبح سالبًا. هل تريد المتابعة؟ (مناسب للبطاقات الائتمانية أو إذا كان الرصيد المسجل غير محدّث)`, ok: 'متابعة' }))) return false;
      const fx = f && acc(v.to) && f.currency !== acc(v.to).currency;
      await commit((d) => C.addTransfer(d, { from: v.from, to: v.to, amount: v.amount, rate: fx ? C.parseAmount(v.rate) : 1, toAmount: fx ? v.toAmount : undefined, date: v.date, note: v.note }), 'تم تسجيل التحويل');
    },
  });
}
function openTransferDetail(id) {
  const t = S.data.transfers.find((x) => x.id === id); if (!t) return;
  const f = acc(t.from), to = acc(t.to);
  sheet('تحويل', `<ul class="list">
    <li class="item"><div class="body"><div class="sub">من</div><div class="title">${esc(f?.name || '—')}</div></div><div class="amt bad">${money(-(t.fromAmount ?? t.amount), f?.currency || disp())}</div></li>
    <li class="item"><div class="body"><div class="sub">إلى</div><div class="title">${esc(to?.name || '—')}</div></div><div class="amt good">${money(t.toAmount ?? t.amount, to?.currency || disp(), { sign: true })}</div></li>
    ${t.rate && t.rate !== 1 ? `<li class="item"><div class="body"><div class="sub">السعر</div><div class="title">1 ${esc(t.fromCurrency)} = ${+Number(t.rate).toFixed(6)} ${esc(t.toCurrency)}</div></div></li>` : ''}
    <li class="item"><div class="body"><div class="sub">التاريخ</div><div class="title">${esc(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</div></div></li></ul>
    <div class="actions"><button class="btn ghost-danger" data-action="del-transfer" data-id="${esc(t.id)}">حذف التحويل</button></div>`);
}

// ---------- العملاء ----------
function dueTag(due, rem) { if (!due || !(rem > 0)) return ''; const t = C.today(); return due < t ? '<span class="tag bad">متأخر</span>' : due <= C.dateStr(new Date(Date.now() + 7 * 864e5)) ? '<span class="tag warn">قريب</span>' : ''; }
function projectRow(p) {
  const rem = C.remainingOf(p), pct = p.amount ? Math.min(100, (C.paidOf(p) / p.amount) * 100) : 0;
  return `<li><button class="item" data-action="open-project" data-id="${esc(p.id)}"><span class="ico">${icon('i-users')}</span><div class="body"><div class="title">${esc(p.client)} — ${esc(p.name)} ${dueTag(p.due, rem)}${rem <= 0 ? ' <span class="tag">مكتمل</span>' : ''}</div>
    <div class="progress good"><span style="width:${pct}%"></span></div><div class="sub">المستلم ${plain(C.paidOf(p), p.currency)} من ${plain(p.amount, p.currency)}${p.due ? ' · التحصيل ' + esc(p.due) : ''}</div></div><div class="amt">${money(rem, p.currency)}<small>متبقٍ</small></div></button></li>`;
}
function renderClients() {
  const ps = [...S.data.projects].sort((a, b) => (C.remainingOf(b) > 0) - (C.remainingOf(a) > 0) || String(a.due || '9').localeCompare(String(b.due || '9')));
  const recv = C.obligationTotals({ ...S.data, obligations: [] }, S.rates).receivable;
  $('v-clients').innerHTML = `${head('العملاء والمشاريع')}
    <div class="card"><small>مستحقات العملاء المتبقية</small><div style="font-size:26px;font-weight:700">${money(recv.total, disp())}</div>${missingNote(recv.missing)}</div>
    <button class="btn primary block" data-action="add-project">إضافة عميل / مشروع</button>
    <div class="card">${ps.length ? `<ul class="list">${ps.map(projectRow).join('')}</ul>` : '<div class="empty">لا توجد مشاريع بعد</div>'}</div>
    <p class="muted" style="font-size:13px">قيمة الاتفاق لا تُحتسب دخلًا. كل دفعة تستلمها تُسجل مرة واحدة كدخل في الحساب الذي استلمها.</p>`;
}
function openProjectForm(id) {
  const p = id ? S.data.projects.find((x) => x.id === id) : null;
  const active = S.data.accounts.filter((a) => !a.archived);
  sheet(p ? 'تعديل المشروع' : 'عميل / مشروع جديد', `
    <label for="pc">اسم العميل</label><input id="pc" name="client" required maxlength="90" value="${esc(p?.client || '')}">
    <label for="pp">رقم التواصل (اختياري)</label><input id="pp" name="phone" type="tel" inputmode="tel" maxlength="35" value="${esc(p?.phone || '')}" dir="ltr">
    <label for="pn">اسم المشروع</label><input id="pn" name="name" required maxlength="110" placeholder="مونتاج إعلان، جلسة تصوير…" value="${esc(p?.name || '')}">
    <div class="grid2" style="grid-template-columns:2fr 1fr"><div><label for="pa">قيمة الاتفاق</label><input id="pa" name="amount" inputmode="decimal" required value="${esc(p?.amount || '')}"></div>
      <div><label>العملة</label><select name="currency" ${p ? 'disabled' : ''}>${currencyOptions(p?.currency || disp())}</select></div></div>
    <label for="pd">موعد التحصيل (اختياري)</label><input id="pd" type="date" name="due" value="${esc(p?.due || '')}">
    ${p ? '' : `<label for="pi">المبلغ المدفوع الآن (اختياري)</label><input id="pi" name="initialPaid" inputmode="decimal" placeholder="0">
      <div id="piBox" hidden><label>الحساب الذي استقبل الدفعة</label><select name="initialAccountId">${accountOptions(active[0]?.id)}</select>
      <div id="piFx" hidden><label id="piFxL">المبلغ المستلم بعملة الحساب</label><input name="initialReceived" inputmode="decimal"></div></div>`}
    <label for="pno">ملاحظات (اختياري)</label><input id="pno" name="note" maxlength="300" value="${esc(p?.note || '')}">`, {
    submit: p ? 'حفظ' : 'إضافة المشروع',
    onChange: (form) => {
      if (p) return;
      const paid = C.parseAmount(form.elements.initialPaid.value) > 0; $('piBox').hidden = !paid;
      const a = acc(form.elements.initialAccountId?.value), diff = paid && a && a.currency !== form.elements.currency.value;
      $('piFx').hidden = !diff; if (diff) $('piFxL').textContent = `المبلغ المستلم فعليًا بـ ${a.currency}`;
    },
    onSubmit: (v) => commit((d) => (p ? C.updateProject(d, p.id, v) : C.addProject(d, v)), p ? 'تم الحفظ' : 'تمت إضافة المشروع'),
  });
}
function paymentsList(item, kind) {
  if (!item.payments.length) return '<div class="empty">لا توجد دفعات بعد</div>';
  return `<ul class="list">${[...item.payments].reverse().map((p) => `<li class="item"><div class="body"><div class="title">${money(p.amount, item.currency)}${p.received && acc(p.accountId)?.currency !== item.currency ? ` <small>(${plain(p.received, acc(p.accountId)?.currency)})</small>` : ''}</div><div class="sub">${p.legacy ? 'مسجلة في نسخة سابقة دون حساب' : `${esc(p.date)} · ${esc(acc(p.accountId)?.name || '—')}`}</div></div>${p.legacy ? '' : `<button class="btn small ghost-danger" data-action="del-payment" data-kind="${kind}" data-id="${esc(item.id)}" data-pid="${esc(p.id)}">حذف</button>`}</li>`).join('')}</ul>`;
}
const phoneLinks = (phone) => { const n = String(phone || '').replace(/[^\d+]/g, ''); if (n.replace(/\D/g, '').length < 6) return ''; return `<a class="btn small" href="tel:${esc(n)}">اتصال</a><a class="btn small" href="https://wa.me/${esc(n.replace(/^\+/, '').replace(/^00/, ''))}" target="_blank" rel="noopener noreferrer">واتساب</a>`; };
function openProject(id) {
  const p = S.data.projects.find((x) => x.id === id); if (!p) return;
  const rem = C.remainingOf(p);
  sheet(`${p.client} — ${p.name}`, `
    <div class="kpis"><div><small>الاتفاق</small><b>${money(p.amount, p.currency)}</b></div><div><small>المستلم</small><b class="good">${money(C.paidOf(p), p.currency)}</b></div><div><small>المتبقي</small><b>${money(rem, p.currency)}</b></div></div>
    <p class="muted">${p.phone ? `<span dir="ltr">${esc(p.phone)}</span> · ` : ''}${p.due ? 'موعد التحصيل ' + esc(p.due) + ' ' + dueTag(p.due, rem) : 'بدون موعد'}${p.note ? '<br>' + esc(p.note) : ''}</p>
    <div class="actions">${rem > 0 ? `<button class="btn primary" data-action="pay" data-kind="project" data-id="${esc(p.id)}">تسجيل دفعة</button>` : ''}${phoneLinks(p.phone)}<button class="btn" data-action="edit-project" data-id="${esc(p.id)}">تعديل</button></div>
    <h3 style="margin-top:16px">سجل الدفعات</h3>${paymentsList(p, 'project')}
    <div class="actions"><button class="btn small ghost-danger" data-action="del-item" data-kind="project" data-id="${esc(p.id)}">حذف المشروع</button></div>`);
}
function openPayment(kind, id) {
  const item = (kind === 'project' ? S.data.projects : S.data.obligations).find((x) => x.id === id); if (!item) return;
  const rem = C.remainingOf(item), active = S.data.accounts.filter((a) => !a.archived);
  const same = active.find((a) => a.currency === item.currency) || active[0];
  const isIn = kind === 'project' || item.type === 'receivable';
  sheet(isIn ? 'تسجيل دفعة مستلمة' : 'تسجيل سداد', `
    <p class="muted">المتبقي: ${money(rem, item.currency)}</p>
    <label for="payA">قيمة الدفعة (${esc(item.currency)})</label><input id="payA" name="amount" class="amount-input" inputmode="decimal" value="${esc(rem)}" required>
    <label>${isIn ? 'الحساب الذي استقبل المبلغ' : 'الحساب الذي دُفع منه'}</label><select name="accountId">${accountOptions(same?.id)}</select>
    <div id="payFx" hidden><label id="payFxL"></label><input name="received" inputmode="decimal"><div class="hint" id="payFxH"></div></div>
    <label>التاريخ</label><input type="date" name="date" value="${C.today()}">
    <div class="hint">${kind === 'obligation' && !item.countInReports ? 'لن تُحتسب هذه الدفعة دخلًا أو مصروفًا لأن مبلغ الدين سُجّل كحركة على حساب عند إنشائه.' : isIn ? 'ستُسجل كدخل (تحصيل مستحقات) مرة واحدة فقط.' : 'ستُسجل كمصروف (سداد ديون).'}</div>`, {
    submit: 'حفظ الدفعة',
    onChange: (form) => {
      const a = acc(form.elements.accountId.value), diff = a && a.currency !== item.currency; $('payFx').hidden = !diff;
      if (diff) { $('payFxL').textContent = `المبلغ ${isIn ? 'المستلم' : 'المدفوع'} فعليًا بـ ${a.currency}`; const n = C.parseAmount(form.elements.amount.value), r = C.convert(1, item.currency, a.currency, S.rates); if (form.dataset.acc !== a.id) { form.elements.received.value = r && n > 0 ? C.round(n * r, a.currency) : ''; form.dataset.acc = a.id; } $('payFxH').textContent = r ? `بالسعر الحالي ≈ ${plain(n * r, a.currency)}` : 'لا يوجد سعر محفوظ؛ اكتب المبلغ الفعلي.'; }
    },
    onSubmit: async (v) => { await commit((d) => C.addPayment(d, kind, id, v), 'تم تسجيل الدفعة'); kind === 'project' ? openProject(id) : openOb(id); return false; },
  });
}

// ---------- الديون ----------
function obRow(o) {
  const rem = C.remainingOf(o), pct = o.amount ? Math.min(100, (C.paidOf(o) / o.amount) * 100) : 0;
  return `<li><button class="item" data-action="open-ob" data-id="${esc(o.id)}"><span class="ico ${o.type === 'debt' ? 'out' : 'in'}">${icon('i-hand')}</span><div class="body"><div class="title">${esc(o.party)} ${dueTag(o.due, rem)}${rem <= 0 ? ' <span class="tag">مسدد</span>' : ''}</div><div class="progress ${o.type === 'debt' ? '' : 'good'}"><span style="width:${pct}%"></span></div><div class="sub">${o.type === 'debt' ? 'سددت' : 'استلمت'} ${plain(C.paidOf(o), o.currency)} من ${plain(o.amount, o.currency)}${o.due ? ' · ' + esc(o.due) : ''}</div></div><div class="amt">${money(rem, o.currency)}</div></button></li>`;
}
function renderDebts() {
  const tab = S.debtTab, list = S.data.obligations.filter((o) => o.type === tab).sort((a, b) => (C.remainingOf(b) > 0) - (C.remainingOf(a) > 0) || String(a.due || '9').localeCompare(String(b.due || '9')));
  const t = C.obligationTotals({ ...S.data, projects: [] }, S.rates)[tab];
  $('v-debts').innerHTML = `${head('الديون')}
    <div class="seg" style="margin:8px 0"><button data-debt-tab="receivable" aria-pressed="${tab === 'receivable'}">ديون لي</button><button data-debt-tab="debt" aria-pressed="${tab === 'debt'}">ديون عليّ</button></div>
    <div class="card"><small>المتبقي ${tab === 'debt' ? 'عليّ' : 'لي'}</small><div style="font-size:26px;font-weight:700">${money(t.total, disp())}</div>${missingNote(t.missing)}</div>
    <button class="btn primary block" data-action="add-ob" data-type="${tab}">${tab === 'debt' ? 'إضافة دين عليّ' : 'إضافة دين لي'}</button>
    <div class="card">${list.length ? `<ul class="list">${list.map(obRow).join('')}</ul>` : '<div class="empty">لا يوجد</div>'}</div>`;
}
function openObForm(type = 'receivable', id) {
  const o = id ? S.data.obligations.find((x) => x.id === id) : null;
  sheet(o ? 'تعديل' : type === 'debt' ? 'دين عليّ' : 'دين لي', `
    ${o ? '' : `<div class="seg">${pick('type', 'receivable', 'لي عند شخص', 'in')}${pick('type', 'debt', 'عليّ لشخص', 'out')}</div><input type="hidden" name="type" value="${type}">`}
    <label for="op">اسم الشخص أو الجهة</label><input id="op" name="party" required maxlength="100" value="${esc(o?.party || '')}">
    <div class="grid2" style="grid-template-columns:2fr 1fr"><div><label for="oa">المبلغ الكامل</label><input id="oa" name="amount" inputmode="decimal" required value="${esc(o?.amount || '')}"></div><div><label>العملة</label><select name="currency" ${o ? 'disabled' : ''}>${currencyOptions(o?.currency || disp())}</select></div></div>
    <div class="grid2"><div><label>رقم التواصل</label><input name="phone" type="tel" dir="ltr" maxlength="35" value="${esc(o?.phone || '')}"></div><div><label>تاريخ الاستحقاق</label><input type="date" name="due" value="${esc(o?.due || '')}"></div></div>
    ${o ? '' : `<label id="omL">هل خرج المبلغ من أحد حساباتك؟</label><select name="movementAccountId"><option value="">لا — بدون حركة على حساباتي</option>${accountOptions(null)}</select>
      <div class="hint" id="omH"></div><div id="omFx" hidden><label id="omFxL"></label><input name="movementRate" inputmode="decimal"></div>`}
    <label>ملاحظة</label><input name="note" maxlength="300" value="${esc(o?.note || '')}">`, {
    onReady: (b, form) => !o && setPick(form, 'type', type),
    onChange: (form) => {
      if (o) return;
      const ty = form.elements.type.value, a = acc(form.elements.movementAccountId.value);
      $('omL').textContent = ty === 'debt' ? 'هل استلمت المبلغ في أحد حساباتك؟ (قرض)' : 'هل خرج المبلغ من أحد حساباتك؟ (سلفة)';
      $('omH').textContent = a ? (ty === 'debt' ? 'سيزيد رصيد الحساب الآن، والسداد لاحقًا ينقصه — دون احتساب دخل أو مصروف.' : 'سينقص رصيد الحساب الآن، والتحصيل لاحقًا يعيده — دون احتساب دخل أو مصروف.') : (ty === 'debt' ? 'مثل شراء بالآجل: السداد لاحقًا يُحتسب مصروفًا.' : 'مثل عمل لم تُدفع قيمته: التحصيل لاحقًا يُحتسب دخلًا.');
      const diff = a && a.currency !== form.elements.currency.value; $('omFx').hidden = !diff;
      if (diff) { $('omFxL').textContent = `سعر التحويل: 1 ${form.elements.currency.value} = ؟ ${a.currency}`; if (form.dataset.p !== a.id) { form.elements.movementRate.value = rateHint(form.elements.currency.value, a.currency).rate; form.dataset.p = a.id; } }
    },
    onSubmit: (v) => commit((d) => (o ? C.updateObligation(d, o.id, v) : C.addObligation(d, { ...v, movementRate: C.parseAmount(v.movementRate) })), 'تم الحفظ'),
  });
}
function openOb(id) {
  const o = S.data.obligations.find((x) => x.id === id); if (!o) return;
  const rem = C.remainingOf(o);
  sheet(`${o.party} · ${o.type === 'debt' ? 'دين عليّ' : 'دين لي'}`, `
    <div class="kpis"><div><small>المبلغ</small><b>${money(o.amount, o.currency)}</b></div><div><small>${o.type === 'debt' ? 'المسدد' : 'المحصل'}</small><b class="good">${money(C.paidOf(o), o.currency)}</b></div><div><small>المتبقي</small><b>${money(rem, o.currency)}</b></div></div>
    <p class="muted">${o.phone ? `<span dir="ltr">${esc(o.phone)}</span> · ` : ''}${o.due ? 'الاستحقاق ' + esc(o.due) + ' ' + dueTag(o.due, rem) : 'بدون موعد'}${o.note ? '<br>' + esc(o.note) : ''}</p>
    <div class="actions">${rem > 0 ? `<button class="btn primary" data-action="pay" data-kind="obligation" data-id="${esc(o.id)}">${o.type === 'debt' ? 'تسجيل سداد' : 'تسجيل تحصيل'}</button>` : ''}${phoneLinks(o.phone)}<button class="btn" data-action="edit-ob" data-id="${esc(o.id)}">تعديل</button></div>
    <h3 style="margin-top:16px">الدفعات</h3>${paymentsList(o, 'obligation')}
    <div class="actions"><button class="btn small ghost-danger" data-action="del-item" data-kind="obligation" data-id="${esc(o.id)}">حذف</button></div>`);
}

// ---------- الادخار ----------
function renderGoals() {
  const g = S.data.goals;
  $('v-goals').innerHTML = `${head('أهداف الادخار')}<button class="btn primary block" data-action="add-goal">هدف جديد</button>
    <div class="card">${g.length ? `<ul class="list">${g.map((x) => { const pct = x.target ? Math.min(100, (x.saved / x.target) * 100) : 0; return `<li><button class="item" data-action="open-goal" data-id="${esc(x.id)}"><span class="ico">${icon('i-target')}</span><div class="body"><div class="title">${esc(x.name)}${pct >= 100 ? ' <span class="tag">تحقق 🎉</span>' : ''}</div><div class="progress good"><span style="width:${pct}%"></span></div><div class="sub">${plain(x.saved, x.currency)} من ${plain(x.target, x.currency)} · ${Math.round(pct)}%${x.due ? ' · ' + esc(x.due) : ''}</div></div></button></li>`; }).join('')}</ul>` : '<div class="empty">لا توجد أهداف</div>'}</div>
    <p class="muted" style="font-size:13px">الأهداف متابعة للادخار ولا تخصم من أرصدة حساباتك. لنقل المال فعليًا إلى حساب ادخار استخدم «تحويل».</p>`;
}
function openGoalForm(id) {
  const g = id ? S.data.goals.find((x) => x.id === id) : null;
  sheet(g ? 'تعديل الهدف' : 'هدف ادخار جديد', `
    <label>اسم الهدف</label><input name="name" required maxlength="90" placeholder="صندوق الطوارئ، معدات تصوير…" value="${esc(g?.name || '')}">
    <div class="grid2" style="grid-template-columns:2fr 1fr"><div><label>المبلغ المستهدف</label><input name="target" inputmode="decimal" required value="${esc(g?.target || '')}"></div><div><label>العملة</label><select name="currency" ${g ? 'disabled' : ''}>${currencyOptions(g?.currency || disp())}</select></div></div>
    ${g ? '' : '<label>المدخر حاليًا</label><input name="saved" inputmode="decimal" value="0">'}
    <label>تاريخ مستهدف (اختياري)</label><input type="date" name="due" value="${esc(g?.due || '')}">`, {
    onSubmit: (v) => commit((d) => (g ? C.updateGoal(d, g.id, v) : C.addGoal(d, v)), 'تم الحفظ'),
  });
}
function openGoal(id) {
  const g = S.data.goals.find((x) => x.id === id); if (!g) return;
  sheet(g.name, `<div class="kpis"><div><small>المدخر</small><b class="good">${money(g.saved, g.currency)}</b></div><div><small>الهدف</small><b>${money(g.target, g.currency)}</b></div><div><small>المتبقي</small><b>${money(Math.max(0, g.target - g.saved), g.currency)}</b></div></div>
    <form id="sf" novalidate><label>المبلغ</label><input name="amount" inputmode="decimal" required><div class="err-msg" id="sfErr"></div>
    <div class="actions"><button type="button" class="btn primary" data-goal-op="add">إضافة للمدخرات</button><button type="button" class="btn" data-goal-op="withdraw">سحب</button></div></form>
    <h3 style="margin-top:14px">السجل</h3>${g.history.length ? `<ul class="list">${[...g.history].reverse().slice(0, 30).map((h) => `<li class="item"><div class="body"><div class="sub">${esc(h.date)}</div></div><div class="amt ${h.amount < 0 ? 'bad' : 'good'}">${money(h.amount, g.currency, { sign: true })}</div></li>`).join('')}</ul>` : '<div class="empty">لا يوجد</div>'}
    <div class="actions"><button class="btn small" data-action="edit-goal" data-id="${esc(g.id)}">تعديل</button><button class="btn small ghost-danger" data-action="del-goal" data-id="${esc(g.id)}">حذف</button></div>`);
  $('sheetBody').querySelectorAll('[data-goal-op]').forEach((b) => (b.onclick = async () => {
    try { await commit((d) => C.addGoalAmount(d, id, $('sf').elements.amount.value, b.dataset.goalOp === 'withdraw'), 'تم'); openGoal(id); } catch (e) { $('sfErr').textContent = errText(e); }
  }));
  $('sf').onsubmit = (e) => { e.preventDefault(); $('sheetBody').querySelector('[data-goal-op="add"]').click(); };
}

// ---------- المتكرر ----------
function renderRecurring() {
  const list = [...S.data.recurring].sort((a, b) => a.next.localeCompare(b.next)), t = C.today();
  $('v-recurring').innerHTML = `${head('الفواتير والالتزامات المتكررة')}<button class="btn primary block" data-action="add-rec">إضافة بند متكرر</button>
    <div class="card">${list.length ? `<ul class="list">${list.map((r) => `<li class="item"><span class="ico ${r.type === 'income' ? 'in' : 'out'}">${icon('i-repeat')}</span><div class="body"><div class="title">${esc(r.name)} ${r.next < t ? '<span class="tag bad">متأخر</span>' : r.next === t ? '<span class="tag warn">اليوم</span>' : ''}</div><div class="sub">${esc(C.FREQUENCIES[r.frequency] || r.frequency)} · القادم ${esc(r.next)}${r.accountId ? ' · ' + esc(acc(r.accountId)?.name || '') : ''}</div>
      <div class="actions" style="margin-top:6px"><button class="btn small primary" data-action="post-rec" data-id="${esc(r.id)}">تسجيل الآن</button><button class="btn small" data-action="skip-rec" data-id="${esc(r.id)}">تخطي هذه المرة</button><button class="btn small ghost-danger" data-action="del-rec" data-id="${esc(r.id)}">حذف</button></div></div><div class="amt">${money(r.amount, r.currency)}</div></li>`).join('')}</ul>` : '<div class="empty">لا توجد بنود متكررة</div>'}</div>
    <p class="muted" style="font-size:13px">لا يُخصم شيء تلقائيًا: تظهر الفواتير المستحقة في الرئيسية وتؤكد تسجيل كل واحدة.</p>`;
}
function openRecForm() {
  sheet('بند متكرر', `<div class="seg">${pick('type', 'expense', 'مصروف / فاتورة', 'out')}${pick('type', 'income', 'دخل', 'in')}</div><input type="hidden" name="type" value="expense">
    <label>اسم البند</label><input name="name" required maxlength="90" placeholder="إيجار، إنترنت، اشتراك…">
    <label>المبلغ</label><input name="amount" inputmode="decimal" required>
    <label>الحساب</label><select name="accountId">${accountOptions(S.data.accounts.find((a) => !a.archived)?.id)}</select>
    <label>التصنيف</label><select name="category"></select>
    <div class="grid2"><div><label>أول موعد</label><input type="date" name="next" value="${C.today()}" required></div><div><label>التكرار</label><select name="frequency">${Object.entries(C.FREQUENCIES).map(([k, v]) => `<option value="${k}"${k === 'monthly' ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>`, {
    onReady: (b, f) => setPick(f, 'type', 'expense'),
    onChange: (f) => { const ty = f.elements.type.value; if (f.dataset.ty !== ty) { f.elements.category.innerHTML = S.data.categories[ty].map((c) => `<option>${esc(c)}</option>`).join(''); if (ty === 'expense') f.elements.category.value = 'فواتير'; f.dataset.ty = ty; } },
    onSubmit: (v) => commit((d) => C.addRecurring(d, v), 'تمت الإضافة'),
  });
}
function openPostRec(id) {
  const r = S.data.recurring.find((x) => x.id === id); if (!r) return;
  const accountId = r.accountId || S.data.accounts.find((a) => !a.archived && a.currency === r.currency)?.id;
  sheet(`تسجيل: ${r.name}`, `<p class="muted">موعد ${esc(r.next)} · ${esc(C.FREQUENCIES[r.frequency])}</p>
    <label>المبلغ (${esc(r.currency)})</label><input name="amount" class="amount-input" inputmode="decimal" value="${esc(r.amount)}">
    <label>الحساب</label><select name="accountId">${accountOptions(accountId)}</select>
    <div id="prFx" hidden><label id="prFxL"></label><input name="rate" inputmode="decimal"></div>`, {
    submit: 'تسجيل العملية',
    onChange: (f) => { const a = acc(f.elements.accountId.value), diff = a && a.currency !== r.currency; $('prFx').hidden = !diff; if (diff && f.dataset.a !== a.id) { $('prFxL').textContent = `سعر التحويل: 1 ${r.currency} = ؟ ${a.currency}`; f.elements.rate.value = rateHint(r.currency, a.currency).rate; f.dataset.a = a.id; } },
    onSubmit: (v) => commit((d) => C.postRecurring(d, id, { accountId: v.accountId, amount: v.amount, rate: C.parseAmount(v.rate) }), 'تم تسجيل العملية'),
  });
}

// ---------- التقارير ----------
function barChart(series, cur) {
  const W = 340, H = 170, pad = 22, max = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  const bw = (W - pad) / series.length;
  const bars = series.map((s, i) => {
    const x = pad + i * bw, hi = ((H - 30) * s.income) / max, he = ((H - 30) * s.expense) / max;
    return `<rect class="gi" x="${x + bw * 0.12}" y="${H - 18 - hi}" width="${bw * 0.36}" height="${hi}" rx="2"><title>${esc(monthLabel(s.month))} دخل ${plain(s.income, cur)}</title></rect>
      <rect class="ge" x="${x + bw * 0.5}" y="${H - 18 - he}" width="${bw * 0.36}" height="${he}" rx="2"><title>${esc(monthLabel(s.month))} مصروف ${plain(s.expense, cur)}</title></rect>
      <text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${Number(s.month.slice(5))}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="الدخل والمصروف لكل شهر" style="direction:ltr"><line class="axis" x1="${pad}" x2="${W}" y1="${H - 18}" y2="${H - 18}"/><text x="2" y="12">${esc(nf(cur).format(max).replace(/\.\d+$/, ''))}</text>${bars}</svg>
    <div class="legend"><span><i style="background:var(--good)"></i>دخل</span><span><i style="background:var(--bad)"></i>مصروف</span></div>`;
}
function catBars(cats, cur, cls) {
  if (!cats.length) return '<div class="empty">لا يوجد</div>';
  const total = cats.reduce((a, c) => a + c.value, 0) || 1;
  return `<div class="bars">${cats.map((c) => `<div class="row"><span>${esc(c.name)} <small>${Math.round((c.value / total) * 100)}%</small></span><b>${money(c.value, cur)}</b><div class="progress ${cls}"><span style="width:${(c.value / cats[0].value) * 100}%"></span></div></div>`).join('')}</div>`;
}
function renderReports() {
  const r = S.rep, cur = disp(), d = S.data;
  const range = r.mode === 'month' ? C.monthRange(r.month) : C.yearRange(r.year);
  const s = C.periodSummary(d, range, S.rates);
  const years = [...new Set([C.today().slice(0, 4), ...d.transactions.map((t) => t.date.slice(0, 4))])].sort().reverse();
  const liq = C.liquidity(d, S.rates, 30);
  const multi = new Set([...d.accounts.map((a) => a.currency), ...d.transactions.map((t) => t.currency)]).size > 1;
  $('v-reports').innerHTML = `${head('التقارير', 'home')}
    <div class="seg"><button data-rep-mode="month" aria-pressed="${r.mode === 'month'}">شهري</button><button data-rep-mode="year" aria-pressed="${r.mode === 'year'}">سنوي</button></div>
    <div style="margin-top:10px">${r.mode === 'month' ? `<input type="month" id="repMonth" value="${esc(r.month)}" aria-label="الشهر">` : `<select id="repYear" aria-label="السنة">${years.map((y) => `<option${y === r.year ? ' selected' : ''}>${y}</option>`).join('')}</select>`}</div>
    <div class="card"><div class="kpis"><div><small>الدخل</small><b class="good">${money(s.income, cur)}</b></div><div><small>المصروف</small><b class="bad">${money(s.expense, cur)}</b></div><div><small>الصافي</small><b class="${s.net >= 0 ? 'good' : 'bad'}">${money(s.net, cur)}</b></div></div>
      ${r.mode === 'year' ? `<div style="margin-top:14px">${barChart(C.yearSeries(d, r.year, S.rates), cur)}</div>` : ''}
      ${missingNote(s.missing)}${multi ? `<p class="hint">المبالغ بعملات أخرى محوّلة إلى ${esc(curName(cur))} بسعر الصرف الحالي (وليس سعر تاريخ العملية). ${S.rates.fetchedAt ? `آخر تحديث للأسعار: ${esc(dt(S.rates.fetchedAt))}` : ''}</p>` : ''}</div>
    <div class="card"><h3>المصروف حسب التصنيف</h3>${catBars(s.byCategory.expense, cur, '')}</div>
    <div class="card"><h3>الدخل حسب التصنيف</h3>${catBars(s.byCategory.income, cur, 'good')}</div>
    <div class="card"><h3>السيولة المتوقعة خلال 30 يومًا</h3>
      <div class="kpis" style="margin-top:8px"><div><small>الرصيد الآن</small><b>${money(liq.cash, cur)}</b></div><div><small>داخل متوقع</small><b class="good">${money(liq.incoming, cur)}</b></div><div><small>خارج متوقع</small><b class="bad">${money(liq.outgoing, cur)}</b></div></div>
      <p>الرصيد المتوقع في ${esc(liq.until)}: <b class="${liq.projected >= 0 ? 'good' : 'bad'}">${money(liq.projected, cur)}</b></p>
      ${liq.items.length ? `<ul class="list">${liq.items.slice(0, 12).map((i) => `<li class="item"><div class="body"><div class="title">${esc(i.label)}</div><div class="sub">${esc(i.date)}</div></div><div class="amt ${i.kind === 'in' ? 'good' : 'bad'}">${money(i.kind === 'in' ? i.amount : -i.amount, i.currency, { sign: true })}</div></li>`).join('')}</ul>` : '<p class="muted">لا توجد مستحقات أو فواتير بتواريخ خلال الفترة.</p>'}
      <p class="hint">يعتمد على تواريخ التحصيل والاستحقاق والفواتير المتكررة التي أدخلتها.</p></div>
    <div class="card"><h3>مراجعة مالية خارجية (اختياري)</h3><p class="muted">ينشئ ملخصًا رقميًا بدون أسماء عملاء أو حسابات لتنسخه بنفسك إلى ChatGPT أو غيره. لا يُرسل شيء تلقائيًا.</p>
      <div class="actions"><button class="btn" data-action="ai-summary">تجهيز ونسخ الملخص</button></div><textarea id="aiText" rows="6" readonly hidden style="margin-top:10px"></textarea></div>`;
  $('repMonth') && ($('repMonth').onchange = (e) => { if (e.target.value) { S.rep.month = e.target.value; renderReports(); } });
  $('repYear') && ($('repYear').onchange = (e) => { S.rep.year = e.target.value; renderReports(); });
}

// ---------- المزيد ----------
function renderMore() {
  const items = [['accounts', 'i-wallet', 'الحسابات'], ['clients', 'i-users', 'العملاء والمشاريع'], ['debts', 'i-hand', 'الديون'], ['goals', 'i-target', 'الادخار'], ['recurring', 'i-bill', 'الفواتير المتكررة'], ['history', 'i-list', 'سجل العمليات'], ['reports', 'i-chart', 'التقارير'], ['settings', 'i-gear', 'الإعدادات']];
  $('v-more').innerHTML = `<div class="view-head"><h2>المزيد</h2></div><div class="more-grid">${items.map(([v, i, l]) => `<button class="shortcut" data-nav-to="${v}"><span class="ico">${icon(i)}</span><span>${l}</span></button>`).join('')}
    <button class="shortcut" data-action="transfer"><span class="ico">${icon('i-swap')}</span><span>تحويل بين الحسابات</span></button></div>`;
}

// ---------- الإعدادات ----------
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function renderSettings() {
  const d = S.data, cur = disp(), theme = Store.lsGet(K.theme) || 'system';
  const used = [...new Set([...d.accounts.map((a) => a.currency), ...d.projects.map((p) => p.currency), ...d.obligations.map((o) => o.currency), ...d.goals.map((g) => g.currency)])].filter((c) => c !== cur);
  const rateRows = used.map((c) => { const r = C.convert(1, c, cur, S.rates), src = C.rateSource(c, S.rates) === 'manual' || C.rateSource(cur, S.rates) === 'manual' ? 'يدوي' : r ? 'آلي' : 'غير متوفر';
    return `<li class="item"><div class="body"><div class="title">1 ${c} = ${r ? +r.toFixed(6) : '—'} ${cur}</div><div class="sub">${esc(curName(c))} · <span class="tag ${src === 'غير متوفر' ? 'bad' : ''}">${src}</span></div></div><button class="btn small" data-action="manual-rate" data-cur="${c}">سعر يدوي</button></li>`; }).join('');
  const lock = S.session, keys = lock?.keys || {};
  const autoLock = d.settings.autoLock ?? 5;
  const dr = S.drive;
  $('v-settings').innerHTML = `${head('الإعدادات')}
    <div class="card"><h3>المظهر</h3><label for="themeSel">طريقة العرض</label><select id="themeSel"><option value="system">تلقائي — حسب الجهاز</option><option value="light">فاتح</option><option value="dark">داكن</option></select>
      <div class="actions"><button class="btn small" data-action="edit-shortcuts">تخصيص الاختصارات</button><button class="btn small" data-action="categories">إدارة التصنيفات</button></div></div>

    <div class="card"><h3>العملة وأسعار الصرف</h3><label for="curSel">عملة العرض الأساسية</label><select id="curSel">${currencyOptions(cur)}</select>
      <p class="hint">تُعرض الإجماليات والتقارير بهذه العملة. كل عملية تحتفظ بمبلغها وعملتها الأصليين.</p>
      <p class="muted" style="font-size:14px">${S.rates.fetchedAt ? `المصدر: <a href="${esc(FX.SOURCE_LINKS[S.rates.source] || '#')}" target="_blank" rel="noopener noreferrer">${esc(S.rates.sourceName)}</a><br>نشر السعر: ${esc(S.rates.publishedAt ? dt(S.rates.publishedAt) : '—')} · آخر جلب: ${esc(dt(S.rates.fetchedAt))}` : 'لم تُجلب أسعار صرف بعد.'}</p>
      <div class="actions"><button class="btn small" data-action="refresh-rates">تحديث الأسعار الآن</button><button class="btn small" data-action="manual-rate" data-cur="${cur === 'YER' ? 'SAR' : 'YER'}">إدخال سعر يدوي</button></div>
      ${rateRows ? `<ul class="list" style="margin-top:8px">${rateRows}</ul>` : ''}
      <div class="notice" style="font-size:13px">سعر الريال اليمني يختلف كثيرًا بين الأسواق (صنعاء/عدن)، والمصادر الآلية قد تعرض سعرًا رسميًا لا يطابق السوق. يُنصح بإدخال السعر اليدوي الذي تتعامل به.</div></div>

    <div class="card"><h3>القفل وحماية البيانات</h3>
      ${lock ? `<p class="good" style="font-weight:500">مفعّل · بياناتك على هذا الجهاز مشفرة (AES-256)</p>
        <label for="autoLock">القفل التلقائي بعد عدم الاستخدام</label><select id="autoLock">${[[1, 'دقيقة'], [5, '5 دقائق'], [15, '15 دقيقة'], [60, 'ساعة']].map(([v, l]) => `<option value="${v}"${autoLock === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <div class="actions"><button class="btn small" data-action="lock-now">قفل الآن</button><button class="btn small" data-action="change-secret">تغيير ${keys.pin?.kind === 'password' ? 'كلمة المرور' : 'الرمز'}</button><button class="btn small" data-action="new-recovery">مفتاح استرداد جديد</button>
        ${keys.passkey ? `<button class="btn small" data-action="passkey-off">إيقاف Face ID</button>` : S.passkeyOK ? `<button class="btn small" data-action="passkey-on">تفعيل Face ID (تجريبي)</button>` : ''}
        <button class="btn small ghost-danger" data-action="lock-off">إيقاف القفل</button></div>
        <p class="hint">${!keys.passkey && !S.passkeyOK ? 'Face ID غير متاح في هذا المتصفح/الجهاز (يتطلب iOS 18 أو أحدث مع مفاتيح المرور). ' : 'Face ID ميزة تجريبية إضافية: '}الرمز ومفتاح الاسترداد يبقيان دائمًا طريقة الفتح الأساسية — احتفظ بهما.</p>`
      : `<p class="muted">القفل غير مفعّل. عند التفعيل تُشفَّر بياناتك على الجهاز ولا تُفتح إلا برمزك${S.passkeyOK ? ' أو بـ Face ID' : ''}.</p><button class="btn primary" data-action="lock-on">تفعيل القفل والتشفير</button>`}
      <details style="margin-top:10px"><summary class="muted" style="font-size:14px">ما الفرق بين القفل والتشفير؟</summary><p class="muted" style="font-size:14px;line-height:1.8">شاشة القفل وحدها (التحقق من هويتك) تمنع من يمسك جوالك المفتوح من رؤية الأرقام، لكنها لا تحمي الملفات نفسها. التشفير يحوّل البيانات المحفوظة إلى نص غير مقروء بدون المفتاح. في فلوسي يُشتق المفتاح من رمزك عبر PBKDF2 (600 ألف تكرار) أو من Face ID عبر مفتاح مرور (Passkey/PRF)، ولا يُحفظ الرمز نفسه.<br>• الرمز من 6 أرقام يحمي من المتطفل العادي، لكن من ينسخ ملفات المتصفح بأدوات متخصصة قد يجربه حاسوبيًا؛ كلمة مرور طويلة أقوى بكثير.<br>• نسيت الرمز؟ استخدم مفتاح الاسترداد. بدونه ودون نسخة احتياطية لا يمكن استعادة البيانات — لا أحد يملك مفتاحًا خلفيًا.</p></details></div>

    <div class="card"><h3>النسخ الاحتياطي</h3>
      <p class="muted" style="font-size:14px">بياناتك محفوظة تلقائيًا على هذا الجهاز، لكن التخزين المحلي وحده لا يضمن عدم الفقد (ضياع الجوال، حذف التطبيق، مسح بيانات Safari). احتفظ بنسخة خارجية.</p>
      <div class="actions"><button class="btn primary small" data-action="export-enc">نسخة مشفرة (موصى به)</button><button class="btn small" data-action="export-json">نسخة JSON غير مشفرة</button><button class="btn small" data-action="export-csv">تصدير CSV</button></div>
      <div class="actions"><label class="btn small" for="importFile" style="margin:0;color:var(--ink)">استعادة من ملف…</label></div><input id="importFile" type="file" accept=".json,application/json" class="sr-only">
      ${S.hasPreRestore ? '<div class="actions"><button class="btn small" data-action="undo-restore">التراجع عن آخر استعادة</button></div>' : ''}
      <p class="hint">${Store.lsGet('folosi_last_export') ? 'آخر نسخة ملف: ' + esc(dt(Store.lsGet('folosi_last_export'))) : 'لم تُنزّل نسخة ملف بعد.'}</p></div>

    ${Drive.configured() ? `<div class="card"><h3>Google Drive (اختياري)</h3>
      ${dr.email ? `<p>مربوط بحساب: <b dir="ltr">${esc(dr.email)}</b> ${Drive.hasToken() ? '<span class="tag">متصل الآن</span>' : '<span class="tag warn">الجلسة منتهية</span>'}</p>
        <p class="muted" style="font-size:14px">آخر نسخة ناجحة: ${dr.lastBackupAt ? esc(dt(dr.lastBackupAt)) : 'لا يوجد'}${dr.lastError ? `<br><span class="bad">آخر خطأ: ${esc(dr.lastError)}</span>` : ''}</p>
        <label class="check"><input type="checkbox" id="driveAuto" ${dr.auto ? 'checked' : ''}> نسخ تلقائي عند التعديل والتطبيق مفتوح ومتصل</label>
        <div class="actions"><button class="btn primary small" data-action="drive-backup">نسخ الآن</button><button class="btn small" data-action="drive-restore">استعادة من Drive</button><button class="btn small ghost-danger" data-action="drive-disconnect">فصل Google Drive</button></div>`
      : `<p class="muted" style="font-size:14px">ربط اختياري لحفظ نسخ مشفرة في مجلد «${Drive.FOLDER_NAME}» داخل Drive الخاص بك. فلوسي يرى فقط الملفات التي ينشئها هو، ولا يستطيع قراءة بقية ملفاتك.</p><button class="btn primary" data-action="drive-connect">ربط Google Drive</button>`}
      <p class="hint">الفصل لا يحذف بياناتك المحلية ولا النسخ الموجودة على Drive. يُحتفظ بآخر 30 نسخة، والأقدم تُنقل إلى سلة Drive.</p></div>` : ''}

    <div class="card"><h3>التخزين والتحديثات</h3><p class="muted" style="font-size:14px" id="storageInfo">…</p>
      <p class="muted" style="font-size:14px">الإصدار ${C.APP_VERSION}</p><div class="actions"><button class="btn small" data-action="check-update">البحث عن تحديث</button></div>
      ${isIOS() && !standalone() ? `<div class="notice info" style="font-size:14px"><b>للتثبيت على الآيفون:</b> افتح الرابط في Safari ← زر المشاركة ← «إضافة إلى الشاشة الرئيسية». التطبيق المثبت يحتفظ ببياناته بشكل أفضل من تبويب Safari العادي.</div>` : ''}</div>

    <div class="card"><h3>المساعدة والخصوصية</h3><p class="muted" style="font-size:14px">فلوسي لا يرسل بياناتك المالية لأي خادم، ولا يحتوي إعلانات أو أدوات تتبع.</p>
      <div class="actions"><a class="btn small" href="./privacy.html">سياسة الخصوصية</a><a class="btn small" href="https://github.com/basselmonaser-cloud/folosi/issues" target="_blank" rel="noopener noreferrer">الإبلاغ عن مشكلة</a><button class="btn small" data-action="copy-diag">نسخ معلومات الجهاز للدعم</button></div></div>

    <div class="card" style="border-color:var(--bad)"><h3 class="bad">حذف جميع بياناتي</h3><p class="muted" style="font-size:14px">يحذف كل البيانات المالية من هذا الجهاز. لا يحذف النسخ الموجودة على Google Drive أو الملفات التي نزّلتها.</p><button class="btn danger" data-action="wipe">حذف جميع بياناتي</button></div>`;
  $('themeSel').value = theme;
  $('themeSel').onchange = (e) => applyTheme(e.target.value);
  $('curSel').onchange = (e) => commit((dd) => { dd.settings.displayCurrency = e.target.value; }, 'تم تغيير عملة العرض');
  $('autoLock') && ($('autoLock').onchange = (e) => commit((dd) => { dd.settings.autoLock = Number(e.target.value); }, 'تم'));
  $('importFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  $('driveAuto') && ($('driveAuto').onchange = (e) => { S.drive.auto = e.target.checked; saveDriveSettings(); toast(e.target.checked ? 'تم تفعيل النسخ التلقائي' : 'تم إيقاف النسخ التلقائي'); if (e.target.checked) scheduleDrive(true); });
  if (Drive.configured()) Drive.loadGis().catch(() => {});
  Store.storageEstimate().then(async (est) => {
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    const el = $('storageInfo'); if (!el) return;
    el.innerHTML = `${S.lastSave ? 'آخر حفظ: ' + esc(S.lastSave.toLocaleString('ar-SA-u-ca-gregory-nu-latn')) + '<br>' : ''}${est?.usage ? `المساحة المستخدمة تقريبًا: ${(est.usage / 1048576).toFixed(1)} م.ب<br>` : ''}${persisted ? 'التخزين محمي من الحذف التلقائي ✓' : 'المتصفح قد يحذف البيانات عند امتلاء الجهاز؛ ثبّت التطبيق واحتفظ بنسخ احتياطية.'}`;
  });
}
function applyTheme(v) {
  Store.lsSet(K.theme, v);
  if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
  updateThemeColor();
}
function updateThemeColor() { $('themeColor').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f3f6fa'; }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeColor);

function openShortcuts() {
  let sel = shortcutList();
  const draw = () => {
    const order = [...sel, ...Object.keys(SHORTCUTS).filter((k) => !sel.includes(k))];
    $('scList').innerHTML = order.map((k) => { const i = sel.indexOf(k); return `<li class="item"><label class="check" style="flex:1;margin:0"><input type="checkbox" data-sc="${k}" ${i >= 0 ? 'checked' : ''}> ${SHORTCUTS[k][1]}</label><button type="button" class="btn small" data-up="${k}" ${i <= 0 ? 'disabled' : ''} aria-label="تحريك للأعلى">↑</button><button type="button" class="btn small" data-down="${k}" ${i < 0 || i === sel.length - 1 ? 'disabled' : ''} aria-label="تحريك للأسفل">↓</button></li>`; }).join('');
  };
  sheet('تخصيص الاختصارات', `<p class="muted">اختر ما يظهر أعلى الرصيد ورتّبه.</p><ul class="list" id="scList"></ul><button class="btn primary block" data-close>تم</button>`);
  draw();
  $('scList').onclick = (e) => {
    const up = e.target.closest('[data-up]')?.dataset.up, down = e.target.closest('[data-down]')?.dataset.down, k = up || down;
    if (k) { const i = sel.indexOf(k), j = i + (up ? -1 : 1); [sel[i], sel[j]] = [sel[j], sel[i]]; }
    else return;
    Store.lsSet(K.shortcuts, JSON.stringify(sel)); draw(); if (S.view === 'home') renderHome();
  };
  $('scList').onchange = (e) => { const k = e.target.dataset.sc; if (!k) return; sel = e.target.checked ? [...sel, k] : sel.filter((x) => x !== k); Store.lsSet(K.shortcuts, JSON.stringify(sel)); draw(); if (S.view === 'home') renderHome(); };
}
function openCategories(type = 'expense') {
  const cats = S.data.categories[type];
  sheet('التصنيفات', `<div class="seg">${pick('ctype', 'expense', 'المصروف')}${pick('ctype', 'income', 'الدخل')}</div><input type="hidden" name="ctype" value="${type}">
    <div class="chips" style="margin-top:12px">${cats.map((c) => `<span class="chip">${esc(c)} <button type="button" class="link-btn" data-del-cat="${esc(c)}" aria-label="حذف ${esc(c)}">×</button></span>`).join('')}</div>
    <label>تصنيف جديد</label><input name="name" maxlength="40" required><p class="hint">حذف تصنيف لا يغيّر العمليات المسجلة به سابقًا.</p>`, {
    submit: 'إضافة', onReady: (b, f) => { setPick(f, 'ctype', type); b.querySelectorAll('[data-del-cat]').forEach((x) => (x.onclick = async () => { await commit((d) => C.removeCategory(d, type, x.dataset.delCat)); openCategories(type); })); },
    onChange: (f) => { if (f.elements.ctype.value !== type) openCategories(f.elements.ctype.value); },
    onSubmit: async (v) => { await commit((d) => C.addCategory(d, type, v.name), 'تمت الإضافة'); openCategories(type); return false; },
  });
}
function openManualRate(code) {
  const cur = disp(), m = S.rates.manual?.[code];
  sheet('سعر صرف يدوي', `<label>العملة</label><select name="code">${currencyOptions(code)}</select>
    <div class="grid2"><div><label>مقابل</label><select name="ref">${['SAR', 'USD', cur].filter((v, i, a) => a.indexOf(v) === i).map((c) => `<option${(m?.ref || (code === 'SAR' ? 'USD' : 'SAR')) === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
    <div><label id="mrL">القيمة</label><input name="value" inputmode="decimal" value="${esc(m?.value || '')}"></div></div><p class="hint" id="mrH"></p>
    ${m ? '<button type="button" class="btn small ghost-danger" data-action="clear-rate" data-cur="' + esc(code) + '">حذف السعر اليدوي والعودة للسعر الآلي</button>' : ''}`, {
    onChange: (f) => { $('mrL').textContent = `1 ${f.elements.ref.value} = ؟ ${f.elements.code.value}`; const auto = C.convert(1, f.elements.ref.value, f.elements.code.value, { ...S.rates, manual: {} }); $('mrH').textContent = auto ? `السعر الآلي الحالي: ${+auto.toFixed(4)} (${S.rates.sourceName || ''})` : 'لا يوجد سعر آلي لهذه العملة.'; },
    onSubmit: (v) => {
      const val = C.parseAmount(v.value); if (!(val > 0)) throw new C.ValidationError('أدخل سعرًا صحيحًا أكبر من صفر');
      if (v.ref === v.code) throw new C.ValidationError('اختر عملتين مختلفتين');
      S.rates.manual = { ...(S.rates.manual || {}), [v.code]: { ref: v.ref, value: val, at: new Date().toISOString() } };
      FX.saveRates(S.rates); render(); toast('تم حفظ السعر اليدوي');
    },
  });
}

// ---------- النسخ الاحتياطي بالملفات ----------
function download(name, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const exportedNow = () => { Store.lsSet('folosi_last_export', new Date().toISOString()); };
function exportPlain() {
  download(`folosi-${C.today()}.json`, JSON.stringify({ ...S.data, exportedAt: new Date().toISOString(), app: 'folosi', appVersion: C.APP_VERSION }, null, 1), 'application/json'); exportedNow();
}
function askBackupPassword({ title = 'كلمة مرور النسخة', confirm2 = true, hint = '' }) {
  return new Promise((resolve) => {
    let done = false;
    sheet(title, `<p class="muted" style="font-size:14px">${hint || 'ستحتاج هذه الكلمة لاستعادة النسخة على أي جهاز. لا يمكن استرجاعها إن نسيتها.'}</p>
      <label>كلمة المرور (8 أحرف على الأقل)</label><input type="password" name="p1" autocomplete="new-password" required>${confirm2 ? '<label>تأكيد كلمة المرور</label><input type="password" name="p2" autocomplete="new-password" required>' : ''}`, {
      submit: 'متابعة',
      onSubmit: (v) => { if (confirm2) { const e = Sec.checkSecretStrength(v.p1, 'password'); if (e) throw new C.ValidationError(e); if (v.p1 !== v.p2) throw new C.ValidationError('كلمتا المرور غير متطابقتين'); } else if (!v.p1) throw new C.ValidationError('أدخل كلمة المرور'); done = true; resolve(v.p1); },
    });
    $('sheet').addEventListener('close', () => { if (!done) resolve(null); }, { once: true });
  });
}
async function exportEncrypted() {
  const p = await askBackupPassword({ title: 'نسخة احتياطية مشفرة' }); if (!p) return;
  toast('جارٍ التشفير…');
  const file = await Sec.sealBackup(S.data, await Sec.makeBackupKey(p), { appVersion: C.APP_VERSION });
  download(`folosi-backup-${C.today()}.json`, JSON.stringify(file), 'application/json'); exportedNow(); toast('تم تنزيل النسخة المشفرة');
}
async function importFile(f) {
  if (f.size > 25 * 1048576) return toast('الملف كبير جدًا', true);
  let obj; try { obj = JSON.parse(await f.text()); } catch { return toast('الملف ليس نسخة فلوسي صالحة', true); }
  await restoreObject(obj, 'ملف');
}
async function restoreObject(obj, source, cachedKey) {
  let data = obj;
  if (Sec.isEncryptedBackup(obj)) {
    for (;;) {
      let pass = null;
      if (!cachedKey || cachedKey.salt !== obj.kdf.salt) { pass = await askBackupPassword({ title: 'فتح النسخة المشفرة', confirm2: false, hint: `نسخة بتاريخ ${dt(obj.createdAt)}. أدخل كلمة مرورها.` }); if (pass === null) return; }
      try { data = await Sec.openBackup(obj, pass, cachedKey); break; }
      catch (e) { if (e.code === 'corrupt') return toast('الملف تالف أو معدّل — لم تتم الاستعادة', true); cachedKey = null; toast('كلمة المرور غير صحيحة', true); }
    }
  }
  const errs = C.validateImport(data);
  if (errs.length) return toast('الملف غير صالح: ' + errs[0], true);
  let up; try { up = C.upgrade(data); } catch { return toast('الملف غير متوافق', true); }
  const ok = await confirmBox({ title: 'استبدال البيانات الحالية؟', text: `من ${source}: ${up.accounts.length} حسابات، ${up.transactions.length} عملية، ${up.projects.length} مشاريع، ${up.obligations.length} ديون. سيتم استبدال بيانات هذا الجهاز الحالية (${S.data.transactions.length} عملية) — مع الاحتفاظ بنسخة منها للتراجع.`, ok: 'استعادة' });
  if (!ok) return;
  const snap = S.session ? { vault: await Sec.sealVault(S.session, S.data) } : { data: S.data };
  await Store.setMeta('pre-restore', { at: new Date().toISOString(), ...snap }); S.hasPreRestore = true;
  S.data = up; S.data.updatedAt = new Date().toISOString();
  if (await save()) scheduleDrive(); closeSheet(); render(); toast('تمت الاستعادة بنجاح');
}
async function undoRestore() {
  const m = await Store.getMeta('pre-restore'); if (!m) return;
  if (!(await confirmBox({ title: 'التراجع عن الاستعادة؟', text: `ستعود البيانات كما كانت قبل الاستعادة (${dt(m.at)}).`, ok: 'تراجع' }))) return;
  let data = m.data;
  if (m.vault) { try { data = await Sec.openWithSession(m.vault, S.session); } catch { return toast('تعذر فتح النسخة السابقة', true); } }
  if (!data) return;
  S.data = C.upgrade(data); S.data.updatedAt = new Date().toISOString(); await save(); await Store.setMeta('pre-restore', null); S.hasPreRestore = false; render(); toast('تم التراجع');
}
function askSecretOnce(title = 'أدخل رمز القفل الحالي') {
  return new Promise((resolve, reject) => {
    let done = false;
    const pk = !!S.session?.keys.passkey;
    sheet(title, `<input type="password" name="s" inputmode="${S.session?.keys.pin?.kind === 'pin' ? 'numeric' : 'text'}" autocomplete="current-password" ${pk ? '' : 'required'}>${pk ? '<button type="button" class="btn block" id="askPk" style="margin-top:10px">التحقق بـ Face ID بدلًا من الرمز</button>' : ''}`, { submit: 'متابعة', onSubmit: (v) => { done = true; resolve(v.s); } });
    if (pk) $('askPk').onclick = () => { done = true; resolve(PASSKEY); closeSheet(); };
    $('sheet').addEventListener('close', () => { if (!done) reject(new Error('cancel')); }, { once: true });
  });
}
const PASSKEY = Symbol('passkey');

// ---------- القفل ----------
// التحقق من صاحب الجهاز قبل الإجراءات الحساسة: بالرمز الحالي أو Face ID (مفيد لمن نسي رمزه)
async function verifyCurrent() {
  const s = await askSecretOnce();
  const v = await Sec.sealVault(S.session, S.data);
  if (s === PASSKEY) await Sec.openVaultWithPasskey(v); else await Sec.openVaultWithSecret(v, s); // يرمي خطأ إن كان خاطئًا
}
function openLockSetup(change = false) {
  sheet(change ? 'تغيير رمز القفل' : 'تفعيل القفل والتشفير', `
    <div class="seg">${pick('kind', 'pin', 'رمز أرقام (6+)')}${pick('kind', 'password', 'كلمة مرور (أقوى)')}</div><input type="hidden" name="kind" value="pin">
    <label id="s1L">الرمز الجديد</label><input type="password" name="s1" inputmode="numeric" autocomplete="new-password" required>
    <label>تأكيد</label><input type="password" name="s2" inputmode="numeric" autocomplete="new-password" required>
    ${change ? '' : '<p class="hint">سنعرض لك بعد ذلك «مفتاح استرداد» لمرة واحدة. احفظه في مكان آمن خارج الجوال؛ هو الطريقة الوحيدة لفتح بياناتك إذا نسيت الرمز.</p>'}`, {
    submit: change ? 'حفظ' : 'تفعيل',
    onReady: (b, f) => setPick(f, 'kind', S.session?.keys.pin?.kind || 'pin'),
    onChange: (f) => { const pin = f.elements.kind.value === 'pin'; $('s1L').textContent = pin ? 'الرمز الجديد (6 إلى 12 رقمًا)' : 'كلمة المرور الجديدة (8 أحرف على الأقل)'; f.elements.s1.inputMode = f.elements.s2.inputMode = pin ? 'numeric' : 'text'; },
    onSubmit: async (v, f, btn) => {
      const err = Sec.checkSecretStrength(v.s1, v.kind); if (err) throw new C.ValidationError(err);
      if (v.s1 !== v.s2) throw new C.ValidationError('الرمزان غير متطابقين');
      btn.textContent = 'جارٍ التشفير…';
      if (change) { await Sec.changeSecret(S.session, v.s1, v.kind); S.recoveredNeedsPin = false; await save(); toast('تم تغيير الرمز'); render(); return; }
      const { session, recovery } = await Sec.createVault(S.data, { secret: v.s1, kind: v.kind });
      S.session = session; await save(); await Store.syncSideStores(null, session); render(); showRecovery(recovery, true); return false;
    },
  });
}
function showRecovery(code, first = false) {
  S.sheetLocked = true; // لا تُغلق النافذة قبل تأكيد حفظ المفتاح
  const tail = code.slice(-4);
  sheet('مفتاح الاسترداد', `<p>اكتب هذا المفتاح على ورقة أو احفظه في مدير كلمات المرور (خارج فلوسي). <b>لن يظهر مرة أخرى.</b> بدونه وبدون نسخة احتياطية لا يمكن فتح بياناتك إذا نسيت الرمز.</p><div class="code" id="recCode">${esc(code)}</div>
    <div class="actions"><button type="button" class="btn small" id="copyRec">نسخ</button></div>
    <label for="recTail">للتأكد أنك حفظته: اكتب آخر 4 أحرف من المفتاح</label><input id="recTail" dir="ltr" autocapitalize="characters" maxlength="4" style="text-align:center;letter-spacing:4px">
    <button class="btn primary block" id="recDone" disabled style="margin-top:12px">تم، حفظت المفتاح</button>`);
  $('sheetBody').querySelector('[data-close]')?.remove();
  $('copyRec').onclick = () => navigator.clipboard?.writeText(code).then(() => toast('تم النسخ — الصقه في مكان آمن خارج الجوال إن أمكن')).catch(() => toast('انسخه يدويًا'));
  $('recTail').oninput = (e) => ($('recDone').disabled = Sec.normalizeRecovery(e.target.value) !== Sec.normalizeRecovery(tail));
  $('recDone').onclick = async () => {
    S.sheetLocked = false; closeSheet(); toast('تم حفظ مفتاح الاسترداد');
    if (first && await confirmBox({ title: 'نسخة احتياطية الآن؟', text: 'يُنصح بتنزيل نسخة احتياطية مشفرة بكلمة مرور منفصلة. تحميك إذا ضاع الجوال أو نسيت الرمز والمفتاح معًا.', ok: 'تنزيل نسخة', cancel: 'لاحقًا' })) exportEncrypted();
  };
}
async function lockNow() { await Store.persist(S.data, S.session).catch(() => {}); location.reload(); }
function idleCheck() {
  if (!S.session || !S.data) return;
  const mins = S.data.settings.autoLock ?? 5;
  if (mins > 0 && Date.now() - S.lastActivity > mins * 60e3) lockNow();
}
['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, () => (S.lastActivity = Date.now()), { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { S.hiddenAt = Date.now(); return; }
  if (S.session && S.hiddenAt && Date.now() - S.hiddenAt > (S.data?.settings.autoLock ?? 5) * 60e3) return lockNow();
  S.reg?.update().catch(() => {});
  if (S.data && FX.isStale(S.rates, 12)) refreshRates(false);
});
setInterval(idleCheck, 15000);

function lockScreen(vault, mode = 'secret') {
  const el = $('lock'), kind = vault.keys.pin?.kind || 'pin', st = readJSON(K.lockState) || { fails: 0, until: 0 };
  $('app').hidden = true; el.hidden = false;
  const wait = Math.max(0, Math.ceil((st.until - Date.now()) / 1000));
  if (mode === 'recovery') {
    el.innerHTML = `<div class="box"><img src="./icons/icon-192.png" alt=""><h2>مفتاح الاسترداد</h2><p class="muted">أدخل المفتاح الذي حفظته عند تفعيل القفل.</p>
      <input id="recIn" dir="ltr" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" style="text-align:center"><div class="err-msg" id="lockErr"></div>
      <button class="btn primary block" id="recGo" style="margin-top:12px">فتح</button><button class="link-btn" id="backSecret" style="margin-top:10px">رجوع</button></div>`;
    $('backSecret').onclick = () => lockScreen(vault);
    $('recGo').onclick = () => tryUnlock(vault, () => Sec.openVaultWithSecret(vault, $('recIn').value, 'recovery'), true);
    return;
  }
  el.innerHTML = `<div class="box"><img src="./icons/icon-192.png" alt=""><h2>فلوسي مقفل</h2><p class="muted">${kind === 'pin' ? 'أدخل رمزك' : 'أدخل كلمة المرور'}</p>
    ${kind === 'pin' ? `<div class="dots" id="dots"></div><div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}<button class="fn" data-k="del">مسح</button><button data-k="0">0</button><button class="fn" data-k="ok">فتح</button></div>`
      : `<input type="password" id="pwIn" autocomplete="current-password" style="text-align:center"><button class="btn primary block" id="pwGo" style="margin-top:12px">فتح</button>`}
    <div class="err-msg" id="lockErr">${wait ? `محاولات كثيرة خاطئة. انتظر ${wait} ثانية.` : ''}</div>
    ${vault.keys.passkey ? `<button class="btn block" id="pkGo" style="margin-top:10px">فتح بـ Face ID</button>` : ''}
    <div class="actions" style="justify-content:center;margin-top:18px"><button class="link-btn" id="forgot">نسيت الرمز؟</button><button class="link-btn" id="wipeLocked" style="color:var(--bad)">حذف البيانات والبدء من جديد</button></div></div>`;
  let entry = '';
  const dots = () => { const d = $('dots'); if (d) d.innerHTML = Array.from({ length: Math.max(6, entry.length) }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join(''); };
  dots();
  const submit = (secret) => tryUnlock(vault, () => Sec.openVaultWithSecret(vault, secret), false, () => { entry = ''; dots(); });
  el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { const k = b.dataset.k; if (k === 'del') entry = entry.slice(0, -1); else if (k === 'ok') { if (entry.length >= 6) submit(entry); } else if (entry.length < 12) entry += k; dots(); }));
  el.onkeydown = (e) => { if (kind !== 'pin') return; if (/^\d$/.test(e.key) && entry.length < 12) entry += e.key; else if (e.key === 'Backspace') entry = entry.slice(0, -1); else if (e.key === 'Enter' && entry.length >= 6) submit(entry); dots(); };
  if (kind === 'pin') el.tabIndex = -1, el.focus();
  $('pwGo') && ($('pwGo').onclick = () => submit($('pwIn').value));
  $('pwIn') && ($('pwIn').onkeydown = (e) => e.key === 'Enter' && submit($('pwIn').value));
  $('pkGo') && ($('pkGo').onclick = () => tryUnlock(vault, () => Sec.openVaultWithPasskey(vault), false, null, true));
  $('forgot').onclick = () => lockScreen(vault, 'recovery');
  $('wipeLocked').onclick = () => confirmWipe();
}
async function tryUnlock(vault, fn, viaRecovery, onFail, viaPasskey) {
  const st = readJSON(K.lockState) || { fails: 0, until: 0 };
  if (!viaPasskey && st.until > Date.now()) { $('lockErr').textContent = `انتظر ${Math.ceil((st.until - Date.now()) / 1000)} ثانية قبل المحاولة.`; return; }
  $('lockErr').textContent = 'جارٍ الفتح…';
  try {
    const { data, session } = await fn();
    Store.lsSet(K.lockState, JSON.stringify({ fails: 0, until: 0 }));
    S.session = session; S.recoveredNeedsPin = viaRecovery;
    $('lock').hidden = true; $('lock').innerHTML = '';
    start(C.upgrade(data));
  } catch (e) {
    if (viaPasskey) { $('lockErr').textContent = e?.name === 'NotAllowedError' ? 'تم إلغاء Face ID' : 'تعذر الفتح بـ Face ID — استخدم الرمز'; return; }
    st.fails++; st.until = Date.now() + Sec.lockoutDelay(st.fails) * 1000; Store.lsSet(K.lockState, JSON.stringify(st));
    $('lockErr').textContent = viaRecovery ? 'مفتاح الاسترداد غير صحيح' : `غير صحيح${Sec.lockoutDelay(st.fails) ? ` — انتظر ${Sec.lockoutDelay(st.fails)} ثانية` : ''}`;
    onFail?.();
  }
}

// ---------- الحذف الكامل ----------
async function confirmWipe() {
  const ok = await confirmBox({ title: 'حذف جميع بياناتي', text: 'هل أنت متأكد من حذف جميع بياناتك؟ سيتم حذف الحسابات والعمليات والعملاء والديون والادخار المحفوظة على هذا الجهاز. لا يمكن استعادتها دون نسخة احتياطية.', ok: 'حذف', cancel: 'إلغاء', danger: true });
  if (!ok) { toast('لم يُحذف شيء'); return; }
  Drive.disconnect();
  await Store.wipeAll();
  S.data = null; S.session = null;
  location.replace(location.pathname + '#/home'); location.reload();
}

// ---------- Google Drive ----------
function saveDriveSettings() { Store.lsSet(K.drive, JSON.stringify(S.drive)); }
async function driveKey(create) {
  if (S.driveKey) return S.driveKey;
  const stored = await Store.getMeta('driveKey'); if (stored?.key) return (S.driveKey = stored);
  if (!create) return null;
  const p = await askBackupPassword({ title: 'كلمة مرور نسخ Drive', hint: 'تُشفَّر النسخ قبل رفعها، ولا يستطيع Google قراءتها. ستحتاج هذه الكلمة للاستعادة على جهاز جديد.' });
  if (!p) return null;
  const k = await Sec.makeBackupKey(p); await Store.setMeta('driveKey', k); S.drive.keySalt = k.salt; saveDriveSettings();
  return (S.driveKey = k);
}
function driveError(e) {
  const m = { 'not-configured': 'الميزة غير مُعدة', 'popup_closed': 'أُغلقت نافذة Google', 'popup_failed_to_open': 'المتصفح منع نافذة Google', 'access_denied': 'لم تتم الموافقة على الصلاحية', 'scope-denied': 'لم تتم الموافقة على صلاحية Drive', forbidden: 'رفض Google الطلب', 'gis-not-ready': 'جارٍ تحميل خدمة Google، حاول بعد لحظات', 'gis-load': 'تعذر تحميل خدمة Google — تحقق من الاتصال' };
  return m[e?.message] || m[e?.code] || (navigator.onLine ? 'تعذر الاتصال بـ Google Drive' : 'لا يوجد اتصال بالإنترنت');
}
async function ensureDriveSession(consent) {
  if (Drive.hasToken()) return;
  await Drive.loadGis();
  await Drive.connect({ hint: S.drive.email, consent });
}
async function driveConnect() {
  try {
    await ensureDriveSession(true);
    const me = await Drive.whoAmI();
    const ok = await confirmBox({ title: 'تأكيد الحساب', text: `سيتم حفظ النسخ في Google Drive الخاص بـ ${me.emailAddress || 'هذا الحساب'}. هل هذا حسابك الصحيح؟`, ok: 'نعم، هذا حسابي' });
    if (!ok) { Drive.disconnect(); return; }
    S.drive = { ...S.drive, email: me.emailAddress, folderId: await Drive.ensureFolder(S.drive.folderId), lastError: null }; saveDriveSettings();
    const files = await Drive.list(S.drive.folderId);
    if (files.length) {
      // توجد نسخ سابقة (جهاز جديد أو إعادة ربط): نتحقق من كلمة المرور على أحدث نسخة ونستخدم نفس الملح
      const latest = await Drive.download(files[0].id);
      if (!Sec.isEncryptedBackup(latest)) throw new Error('bad-file');
      let key = null;
      while (!key) {
        const p = await askBackupPassword({ title: 'كلمة مرور نسخ Drive', confirm2: false, hint: `وُجدت ${files.length} نسخ سابقة في Drive (آخرها ${dt(files[0].createdTime)}). أدخل كلمة المرور التي استخدمتها لها.` });
        if (!p) { render(); return; }
        const k = await Sec.makeBackupKey(p, latest.kdf.salt);
        try { await Sec.openBackup(latest, null, k); key = k; } catch (err) { toast(err.code === 'corrupt' ? 'أحدث نسخة تالفة' : 'كلمة المرور غير صحيحة', true); if (err.code === 'corrupt') return; }
      }
      await Store.setMeta('driveKey', key); S.driveKey = key; S.drive.keySalt = key.salt; saveDriveSettings(); render();
      if (C.isEmpty(S.data)) {
        if (await confirmBox({ title: 'استعادة من Drive؟', text: `بيانات هذا الجهاز فارغة. هل تريد استعادة أحدث نسخة (${dt(files[0].createdTime)})؟`, ok: 'متابعة' })) await restoreObject(latest, 'Google Drive', key);
        return;
      }
      toast('تم الربط. يمكنك النسخ أو الاستعادة الآن.'); return;
    }
    if (!(await driveKey(true))) { toast('لم تُحدد كلمة مرور — لن تُرفع نسخ'); render(); return; }
    render(); await driveBackup(true);
  } catch (e) { toast(driveError(e), true); }
}
let driveBusy = false;
async function driveBackup(interactive) {
  if (driveBusy) return; driveBusy = true;
  try {
    if (interactive) await ensureDriveSession(false); else if (!Drive.hasToken()) { S.drivePending = true; renderBanners(); return; }
    const key = await driveKey(interactive); if (!key) return;
    if (C.isEmpty(S.data) && S.drive.lastCounts?.transactions > 0 && !interactive) return; // لا نرفع نسخة فارغة فوق نسخ سابقة تلقائيًا
    S.drive.folderId = await Drive.ensureFolder(S.drive.folderId);
    const file = await Sec.sealBackup(S.data, key, { appVersion: C.APP_VERSION });
    await Drive.upload(S.drive.folderId, Drive.backupName(), file);
    Object.assign(S.drive, { lastBackupAt: new Date().toISOString(), lastError: null, lastCounts: file.counts, dirty: false }); saveDriveSettings();
    S.drivePending = false;
    Drive.prune(S.drive.folderId, 30).catch(() => {});
    if (interactive) toast('تم النسخ إلى Google Drive');
  } catch (e) {
    S.drive.lastError = driveError(e); saveDriveSettings();
    if (e.code === 'auth') S.drivePending = true;
    if (interactive) toast(S.drive.lastError, true);
  } finally { driveBusy = false; if (S.view === 'settings' || S.view === 'home') render(); }
}
let driveTimer = null;
function scheduleDrive(now) {
  if (!Drive.configured() || !S.drive.auto || !S.drive.email) return;
  S.drive.dirty = true; saveDriveSettings();
  clearTimeout(driveTimer);
  const since = S.drive.lastBackupAt ? Date.now() - Date.parse(S.drive.lastBackupAt) : Infinity;
  const delay = now ? 1000 : Math.max(20000, 10 * 60e3 - since);
  driveTimer = setTimeout(() => driveBackup(false), delay);
}
async function driveRestore() {
  try {
    await ensureDriveSession(false);
    S.drive.folderId = await Drive.ensureFolder(S.drive.folderId); saveDriveSettings();
    const files = await Drive.list(S.drive.folderId);
    sheet('استعادة من Google Drive', files.length ? `<p class="muted">اختر نسخة. سيُطلب منك التأكيد قبل الاستبدال.</p><ul class="list">${files.slice(0, 30).map((f) => `<li><button class="item" data-drive-file="${esc(f.id)}"><span class="ico">${icon('i-cloud')}</span><div class="body"><div class="title">${esc(dt(f.createdTime))}</div><div class="sub">${f.size ? (f.size / 1024).toFixed(1) + ' ك.ب' : ''}</div></div></button></li>`).join('')}</ul>` : '<div class="empty">لا توجد نسخ في مجلد Folosi Backups</div>');
    $('sheetBody').querySelectorAll('[data-drive-file]').forEach((b) => (b.onclick = async () => {
      try { toast('جارٍ التنزيل…'); const obj = await Drive.download(b.dataset.driveFile); if (!Sec.isEncryptedBackup(obj)) return toast('الملف ليس نسخة فلوسي', true); await restoreObject(obj, 'Google Drive', await driveKey(false)); }
      catch (e) { toast(driveError(e), true); }
    }));
  } catch (e) { toast(driveError(e), true); }
}
async function driveDisconnect() {
  if (!(await confirmBox({ title: 'فصل Google Drive؟', text: 'سيتوقف النسخ إلى Drive. بياناتك على الجهاز والنسخ الموجودة في Drive لن تُحذف.', ok: 'فصل' }))) return;
  Drive.disconnect(); S.drive = {}; S.driveKey = null; S.drivePending = false; saveDriveSettings(); await Store.setMeta('driveKey', null); render(); toast('تم الفصل');
}

// ---------- أحداث عامة ----------
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-nav]'); if (nav) return go(nav.dataset.nav);
  const to = e.target.closest('[data-nav-to]'); if (to) { closeSheet(); const [v, p] = to.dataset.navTo.split('/'); return go(v, p); }
  const sc = e.target.closest('[data-shortcut]'); if (sc) return SHORTCUTS[sc.dataset.shortcut]?.[2]();
  const dt_ = e.target.closest('[data-debt-tab]'); if (dt_) { S.debtTab = dt_.dataset.debtTab; return renderDebts(); }
  const rm = e.target.closest('[data-rep-mode]'); if (rm) { S.rep.mode = rm.dataset.repMode; return renderReports(); }
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.dataset.id;
  try {
    switch (b.dataset.action) {
      case 'quick-add': return openTx();
      case 'open-tx': return openTxDetail(id);
      case 'edit-tx': return openTx({}, id);
      case 'del-tx': return deleteTx(id);
      case 'open-transfer': return openTransferDetail(id);
      case 'del-transfer': if (await confirmBox({ title: 'حذف التحويل؟', text: 'سيعود المبلغ إلى الحساب الأصلي.', ok: 'حذف', danger: true })) { closeSheet(); await commit((d) => C.deleteTransfer(d, id), 'تم حذف التحويل'); } return;
      case 'transfer': return openTransfer();
      case 'add-account': return openAccount();
      case 'open-account': return openAccount(id);
      case 'archive-account': { const a = acc(id); await commit((d) => C.updateAccount(d, id, { name: a.name, archived: !a.archived }), a.archived ? 'أُلغيت الأرشفة' : 'تمت الأرشفة'); return closeSheet(); }
      case 'del-account': if (await confirmBox({ title: 'حذف الحساب؟', text: 'الحساب لا يحتوي عمليات وسيحذف نهائيًا.', ok: 'حذف', danger: true })) { await commit((d) => C.deleteAccount(d, id), 'تم حذف الحساب'); closeSheet(); } return;
      case 'account-history': S.hist = { type: 'all', account: id, month: '', q: '' }; closeSheet(); return go('history');
      case 'add-project': return openProjectForm();
      case 'open-project': return openProject(id);
      case 'edit-project': return openProjectForm(id);
      case 'pay': return openPayment(b.dataset.kind, id);
      case 'del-payment': if (await confirmBox({ title: 'حذف الدفعة؟', text: 'ستُحذف العملية المرتبطة بها ويتحدث رصيد الحساب والمتبقي.', ok: 'حذف', danger: true })) { await commit((d) => C.deletePayment(d, b.dataset.kind, id, b.dataset.pid), 'تم حذف الدفعة'); b.dataset.kind === 'project' ? openProject(id) : openOb(id); } return;
      case 'del-item': if (await confirmBox({ title: 'حذف نهائي؟', text: 'سيُحذف السجل مع كل دفعاته والعمليات المرتبطة به، وتعود الأرصدة كما كانت قبلها.', ok: 'حذف', danger: true })) { await commit((d) => C.deleteItem(d, b.dataset.kind, id), 'تم الحذف'); closeSheet(); } return;
      case 'add-ob': return openObForm(b.dataset.type);
      case 'open-ob': return openOb(id);
      case 'edit-ob': return openObForm(null, id);
      case 'add-goal': return openGoalForm();
      case 'open-goal': return openGoal(id);
      case 'edit-goal': return openGoalForm(id);
      case 'del-goal': if (await confirmBox({ title: 'حذف الهدف؟', text: 'سيحذف الهدف وسجله. لا يؤثر على أرصدة الحسابات.', ok: 'حذف', danger: true })) { await commit((d) => { d.goals = d.goals.filter((g) => g.id !== id); }, 'تم الحذف'); closeSheet(); } return;
      case 'add-rec': return openRecForm();
      case 'post-rec': return openPostRec(id);
      case 'skip-rec': return commit((d) => C.skipRecurring(d, id), 'تم التخطي إلى الموعد التالي');
      case 'del-rec': if (await confirmBox({ title: 'حذف البند المتكرر؟', text: 'لن تُحذف العمليات المسجلة منه سابقًا.', ok: 'حذف', danger: true })) await commit((d) => { d.recurring = d.recurring.filter((r) => r.id !== id); }, 'تم الحذف'); return;
      case 'edit-shortcuts': return openShortcuts();
      case 'categories': return openCategories();
      case 'manual-rate': return openManualRate(b.dataset.cur);
      case 'clear-rate': { const m = { ...S.rates.manual }; delete m[b.dataset.cur]; S.rates.manual = m; FX.saveRates(S.rates); closeSheet(); render(); return toast('تم حذف السعر اليدوي'); }
      case 'refresh-rates': return refreshRates(true);
      case 'export-json': if (S.session && !(await confirmBox({ title: 'نسخة غير مشفرة', text: 'هذا الملف يمكن لأي شخص قراءته. يفضل النسخة المشفرة. هل تريد المتابعة؟', ok: 'تنزيل' }))) return; return exportPlain();
      case 'export-enc': return exportEncrypted();
      case 'export-csv': download(`folosi-${C.today()}.csv`, C.toCSV(S.data), 'text/csv;charset=utf-8'); return;
      case 'undo-restore': return undoRestore();
      case 'retry-save': return save();
      case 'apply-update': return applyUpdate();
      case 'check-update': return checkUpdate(true);
      case 'dismiss-migration': Store.lsSet('folosi_v3_migrated_notice', '1'); return renderBanners();
      case 'lock-on': return openLockSetup();
      case 'change-secret': if (!S.recoveredNeedsPin) { try { await verifyCurrent(); } catch (err) { if (err?.message !== 'cancel') toast('الرمز غير صحيح', true); return; } } return openLockSetup(true);
      case 'new-recovery': { try { await verifyCurrent(); } catch (err) { if (err?.message !== 'cancel') toast('الرمز غير صحيح', true); return; } const code = await Sec.regenerateRecovery(S.session); await save(); return showRecovery(code); }
      case 'lock-off': { try { await verifyCurrent(); } catch (err) { if (err?.message !== 'cancel') toast('الرمز غير صحيح', true); return; }
        if (!(await confirmBox({ title: 'إيقاف القفل؟', text: 'ستُحفظ بياناتك على الجهاز دون تشفير.', ok: 'إيقاف', danger: true }))) return;
        const prev = S.session; S.session = null; await save(); await Store.syncSideStores(prev, null); render(); return toast('تم إيقاف القفل'); }
      case 'lock-now': return lockNow();
      case 'passkey-on': try { toast('اتبع تعليمات Face ID…'); await Sec.enablePasskey(S.session); await save(); render(); toast('تم تفعيل Face ID'); } catch (err) { toast(err.code === 'prf' ? 'جهازك أو متصفحك لا يدعم فتح فلوسي المشفر بـ Face ID (يتطلب iOS 18+). لم يُفعّل شيء.' : err?.name === 'NotAllowedError' ? 'تم الإلغاء' : 'تعذر تفعيل Face ID', true); } return;
      case 'passkey-off': delete S.session.keys.passkey; await save(); render(); return toast('تم إيقاف Face ID. يمكنك حذف مفتاح المرور «قفل فلوسي» من تطبيق كلمات المرور.');
      case 'wipe': return confirmWipe();
      case 'drive-connect': return driveConnect();
      case 'drive-backup': return driveBackup(true);
      case 'drive-restore': return driveRestore();
      case 'drive-disconnect': return driveDisconnect();
      case 'more-history': S.histLimit = (S.histLimit || 300) + 300; return renderHistory();
      case 'ai-summary': return aiSummary();
      case 'copy-diag': return navigator.clipboard?.writeText(`فلوسي ${C.APP_VERSION}\n${navigator.userAgent}\nمثبت: ${standalone() ? 'نعم' : 'لا'}\nالتاريخ: ${new Date().toISOString()}`).then(() => toast('تم النسخ — لا يحتوي بيانات مالية')).catch(() => toast('تعذر النسخ'));
    }
  } catch (err) { toast(errText(err), true); }
});
function aiSummary() {
  const m = S.rep.mode === 'month' ? S.rep.month : S.rep.year, range = S.rep.mode === 'month' ? C.monthRange(m) : C.yearRange(m), cur = disp();
  const s = C.periodSummary(S.data, range, S.rates), ob = C.obligationTotals(S.data, S.rates), tot = C.totalBalance(S.data, S.rates);
  const text = `حلل وضعي المالي وقدّم خطة ادخار واقعية. لا تعتبر المستحقات رصيدًا نقديًا.\nالفترة: ${m}\nالعملة: ${cur}\nالرصيد الحالي: ${plain(tot.total, cur)}\nالدخل: ${plain(s.income, cur)}\nالمصروف: ${plain(s.expense, cur)}\nأعلى المصروفات: ${s.byCategory.expense.slice(0, 5).map((c) => `${c.name} ${plain(c.value, cur)}`).join('، ') || 'لا يوجد'}\nالمستحقات لي: ${plain(ob.receivable.total, cur)}\nالديون عليّ: ${plain(ob.debt.total, cur)}\nملاحظة: البيانات مدخلة يدويًا وقد تكون غير مكتملة.`;
  const ta = $('aiText'); ta.hidden = false; ta.value = text;
  navigator.clipboard?.writeText(text).then(() => toast('تم نسخ الملخص')).catch(() => toast('انسخ النص يدويًا'));
}
async function refreshRates(manual) {
  const r = await FX.refreshRates(S.rates);
  S.rates = r.rates;
  if (manual) toast(r.ok ? 'تم تحديث أسعار الصرف' : r.reason === 'offline' ? 'لا يوجد اتصال — نستخدم آخر أسعار محفوظة' : 'تعذر جلب الأسعار — نستخدم آخر أسعار محفوظة', !r.ok);
  if (S.data) render();
}

// ---------- التحديثات ----------
let reloading = false, userUpdate = false;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    S.reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    const watch = (w) => w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { S.updateReady = w; renderBanners(); } });
    if (S.reg.waiting && navigator.serviceWorker.controller) S.updateReady = S.reg.waiting;
    watch(S.reg.installing);
    S.reg.addEventListener('updatefound', () => watch(S.reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (userUpdate && !reloading) { reloading = true; location.reload(); } });
    setInterval(() => S.reg.update().catch(() => {}), 30 * 60e3);
    renderBanners();
  } catch {}
}
async function applyUpdate() {
  const w = S.updateReady || S.reg?.waiting; if (!w) return location.reload();
  await Store.persist(S.data, S.session).catch(() => {});
  userUpdate = true; w.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => { if (!reloading) location.reload(); }, 3000);
}
async function checkUpdate(manual) {
  if (!S.reg) return manual && toast('التحديثات غير مدعومة في هذا المتصفح');
  if (!navigator.onLine) return manual && toast('لا يوجد اتصال بالإنترنت');
  try { await S.reg.update(); } catch {}
  setTimeout(() => manual && toast(S.updateReady || S.reg.waiting ? 'يتوفر تحديث — اضغط «تحديث الآن»' : 'لديك أحدث إصدار'), 1500);
}

// ---------- الاتصال ----------
function netStatus() { $('netStatus').hidden = navigator.onLine; }
addEventListener('online', () => { netStatus(); if (S.data && FX.isStale(S.rates, 12)) refreshRates(false); });
addEventListener('offline', netStatus);

// ---------- التشغيل ----------
function start(data) {
  S.data = data;
  if (!S.data.settings) S.data.settings = { displayCurrency: 'SAR' };
  $('app').hidden = false; $('lock').hidden = true;
  readHash(); render(); updateThemeColor(); netStatus();
  save();
  Store.getMeta('pre-restore').then((m) => { S.hasPreRestore = !!m; });
  if (S.session) Store.syncSideStores(S.session, S.session).catch(() => {});
  if (FX.isStale(S.rates, 12)) refreshRates(false);
  if (IS_LOCAL) window.__folosi = { get data() { return S.data; }, get session() { return !!S.session; }, setRates: (r) => { S.rates = r; render(); } };
}
async function boot() {
  netStatus();
  Sec.passkeyAvailable().then((v) => { S.passkeyOK = v; if (S.view === 'settings' && S.data) renderSettings(); });
  registerSW();
  let r;
  try { r = await Store.loadInitial(); } catch { r = { status: 'error' }; }
  if (r.status === 'locked') return lockScreen(r.vault);
  if (r.status === 'plain') { S.migratedFrom = r.migratedFrom; return start(r.data); }
  if (r.status === 'error') { document.body.insertAdjacentHTML('afterbegin', '<div class="notice err">تعذر قراءة التخزين المحلي. لم يُحذف شيء — أعد فتح التطبيق، وإن تكرر الخطأ تواصل مع الدعم.</div>'); return; }
  const d = C.blank(C.suggestCurrency(navigator.languages || [navigator.language]));
  C.addAccount(d, { name: 'كاش', type: 'cash', currency: d.settings.displayCurrency, opening: 0 });
  start(d);
}
boot();
