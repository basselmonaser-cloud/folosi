// فلوسي — واجهات الرئيسية القابلة للاختيار (عرض فقط).
// لا تغيّر أي منطق: تقرأ نفس الدوال (الأرصدة، التقارير، الثروة) وتعرض كل عملة منفصلة دون جمع عملات مختلفة.
import * as Wm from './wealth.js';

export const HOME_STYLES = {
  classic: { name: 'الحالية', desc: 'الواجهة الأصلية مع الاختصارات والرصيد الإجمالي.' },
  a: { name: 'أ — هادئ', desc: 'بأسلوب iOS: السيولة لكل عملة، إجراءات سريعة، الشهر، القادم، وآخر العمليات.' },
  b: { name: 'ب — المحفظة (داكن)', desc: 'حساباتك كبطاقات متراكبة، بألوان داكنة وذهبية.' },
  c: { name: 'ج — الملخص أولًا', desc: 'مؤشرات مختصرة، تنبيه الاستحقاق، وأين ذهب المال.' },
};

export function register(ctx) {
  const { S, $, esc, nf, sym, commit, closeSheet, sheet, C, icon, dateLabel, curName } = ctx;
  const N = (v, c) => `${v < 0 ? '−' : ''}${nf(c).format(Math.abs(v))}`;
  const amt = (v, c, sign = false) => `<span class="num">${sign && v > 0 ? '+' : ''}${N(v, c)}</span> <span class="hs-sym">${esc(sym(c))}</span>`;
  const style = () => (HOME_STYLES[S.data?.settings.homeStyle] ? S.data.settings.homeStyle : 'classic');

  // ---------- البيانات (قراءة فقط) ----------
  function model() {
    const d = S.data, disp = d.settings.displayCurrency, mm = C.monthRange(C.today().slice(0, 7));
    const accs = d.accounts.filter((a) => !a.archived).map((a) => ({ a, bal: C.balance(d, a) }));
    const byCur = {};
    for (const x of accs) (byCur[x.a.currency] ||= { currency: x.a.currency, total: 0, n: 0 }), (byCur[x.a.currency].total += x.bal), byCur[x.a.currency].n++;
    const curs = Object.values(byCur).sort((x, y) => (x.currency === disp ? -1 : y.currency === disp ? 1 : y.n - x.n));
    const sum = C.periodSummary(d, mm, S.rates);
    const month = sum.byCurrency.find((x) => x.currency === disp) || { currency: disp, income: 0, expense: 0, net: 0 };
    const otherMonth = sum.byCurrency.filter((x) => x.currency !== disp);
    const up = C.upcomingSchedule(d, 30, S.rates).items.slice(0, 4);
    const expCats = {};
    for (const t of d.transactions) if (t.type === 'expense' && t.currency === disp && t.date >= mm.from && t.date <= mm.to && !t.excludeFromReports && !t.link) expCats[t.category] = (expCats[t.category] || 0) + t.amount;
    const cats = Object.entries(expCats).sort((x, y) => y[1] - x[1]).slice(0, 3);
    const recent = [...d.transactions].sort((x, y) => y.date.localeCompare(x.date) || (y.created || 0) - (x.created || 0)).slice(0, 5);
    const hasWealth = d.wealth && (d.wealth.gold.lots.length || d.wealth.trades.length || d.wealth.investments.length);
    const nw = hasWealth ? Wm.netWorth(d, S.rates) : null, gold = hasWealth ? Wm.goldHoldings(d) : null;
    const ob = { debt: {}, recv: {} };
    for (const o of d.obligations) if (!o.archived) { const r = C.remainingOf(o); if (r > 0) { const m = o.type === 'debt' ? ob.debt : ob.recv; m[o.currency] = (m[o.currency] || 0) + r; } }
    for (const p of d.projects) if (!p.archived) { const r = C.remainingOf(p); if (r > 0) ob.recv[p.currency] = (ob.recv[p.currency] || 0) + r; }
    return { d, disp, accs, curs, month, otherMonth, up, cats, recent, nw, gold, ob };
  }
  const accName = (id) => S.data.accounts.find((a) => a.id === id)?.name || '؟';
  const days = (date) => Math.round((Date.parse(date + 'T12:00:00') - Date.parse(C.today() + 'T12:00:00')) / 864e5);
  const whenLabel = (date) => { const n = days(date); return n < 0 ? `متأخر ${-n} يوم` : n === 0 ? 'اليوم' : n === 1 ? 'غدًا' : `بعد ${n} يوم`; };
  const multi = (m) => Object.entries(m).map(([c, v]) => amt(v, c)).join(' · ') || amt(0, S.data.settings.displayCurrency);
  const switcher = `<div class="hs-switch"><button class="link-btn hs-switch-btn" data-action="home-style">${icon('i-gear')}<span>تغيير الواجهة</span></button></div>`;
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const txRow = (t) => `<li class="hs-row"><div class="hs-row-body"><span class="hs-row-t">${esc(t.category)}</span><span class="hs-row-s">${esc(accName(t.accountId))} · ${esc(dateLabel(t.date))}</span></div><span class="hs-row-v ${t.type === 'income' ? 'hs-in' : ''}">${amt(t.type === 'income' ? t.amount : -t.amount, t.currency, true)}</span></li>`;
  const upRow = (i) => `<li class="hs-row"><span class="hs-badge ${i.overdue || days(i.date) <= 3 ? 'hs-warn' : ''}">${Math.max(0, days(i.date))}ي</span><div class="hs-row-body"><span class="hs-row-t">${esc(i.label)}</span><span class="hs-row-s">${esc(i.sub)} · ${esc(whenLabel(i.date))}${i.kind === 'recurring' ? ' · لا يُخصم قبل تأكيدك' : ''}</span></div><span class="hs-row-v">${amt(i.dir === 'in' ? i.amount : -i.amount, i.currency, true)}</span></li>`;
  const goldLine = (m) => (m.gold && m.gold.grams > 0 ? (m.nw.gold.valuation ? `يشمل ذهبًا مقيّمًا بتاريخ ${esc(m.nw.gold.valuation.date)}` : `+ ذهب ${+m.gold.grams.toFixed(3)} غ غير مقيّم`) : '');
  const nwCard = (m, cls = '') => (m.nw ? `<button class="hs-card hs-link ${cls}" data-nav-to="wealth"><div class="hs-row-body"><span class="hs-label">${m.nw.partial ? 'ثروتي · صافي جزئي' : 'ثروتي · صافي الثروة'}</span><span class="hs-v">${amt(m.nw.net, m.disp)}</span>${goldLine(m) ? `<span class="hs-label">${goldLine(m)}</span>` : ''}</div><span aria-hidden="true" class="hs-chev">‹</span></button>` : '');
  const empty = `<div class="empty">لا توجد عمليات بعد.<br><button class="btn primary" style="margin-top:12px" data-action="quick-add">أضف أول عملية</button></div>`;
  const quick = (k, label, ic, primary) => `<button class="hs-q" data-shortcut="${k}"><span class="hs-q-i ${primary ? 'hs-q-p' : ''}">${icon(ic)}</span><span>${label}</span></button>`;

  // ---------- أ: هادئ ----------
  function homeA(m) {
    const main = m.curs.find((c) => c.currency === m.disp) || m.curs[0];
    const others = m.curs.filter((c) => c !== main);
    return `<div class="hs hs-a"><div class="hs-top"><h1 class="hs-title">الرئيسية</h1>${switcher}</div>
      <button class="hs-hero" data-nav-to="detail/balances" aria-label="تفاصيل الأرصدة">
        <span class="hs-label">${main ? `السيولة المتاحة — ${esc(curName(main.currency))}` : 'لا توجد حسابات بعد'}</span>
        ${main ? `<span class="hs-big">${amt(main.total, main.currency)}</span>` : ''}
        ${others.length ? `<span class="hs-pills">${others.map((c) => `<span class="hs-pill">${amt(c.total, c.currency)}</span>`).join('')}<span class="hs-pill hs-pill-note">لا تُجمع العملات</span></span>` : ''}
      </button>
      <nav class="hs-quick" aria-label="إجراءات سريعة">${quick('expense', 'مصروف', 'i-arrow-out', true)}${quick('income', 'دخل', 'i-arrow-in')}${quick('transfer', 'تحويل', 'i-swap')}${quick('obligations', 'الديون', 'i-hand')}</nav>
      <section class="hs-card"><div class="hs-head"><h2>${esc(ctx.monthLabel(C.today().slice(0, 7)))}</h2><button class="link-btn" data-nav-to="reports">التقرير</button></div>
        <div class="hs-two"><div><span class="hs-label">الدخل</span><span class="hs-v">${amt(m.month.income, m.disp, true)}</span></div><div><span class="hs-label">المصروف</span><span class="hs-v">${amt(-m.month.expense, m.disp)}</span></div></div>
        <div class="hs-bar" role="img" aria-label="أُنفق ${pct(m.month.expense, m.month.income)}٪ من الدخل"><span style="width:${pct(m.month.expense, m.month.income)}%"></span></div>
        <span class="hs-label">${m.month.income > 0 ? `أنفقت ${pct(m.month.expense, m.month.income)}٪ من دخل الشهر · الصافي ${amt(m.month.net, m.disp, true)}` : 'لا دخل مسجل هذا الشهر'}</span>
        ${m.otherMonth.length ? `<span class="hs-label">عملات أخرى: ${m.otherMonth.map((x) => `${esc(sym(x.currency))} دخل ${N(x.income, x.currency)} · مصروف ${N(x.expense, x.currency)}`).join(' — ')}</span>` : ''}</section>
      ${m.up.length ? `<section><h2 class="hs-h">قريبًا</h2><ul class="hs-card hs-list">${m.up.map(upRow).join('')}</ul></section>` : ''}
      ${nwCard(m)}
      <section><div class="hs-head hs-h"><h2>آخر العمليات</h2><button class="link-btn" data-nav-to="history">الكل</button></div>${m.recent.length ? `<ul class="hs-card hs-list">${m.recent.map(txRow).join('')}</ul>` : empty}</section></div>`;
  }
  // ---------- ب: المحفظة (داكن) ----------
  function homeB(m) {
    const cards = [...m.accs].sort((x, y) => (y.a.currency === m.disp) - (x.a.currency === m.disp) || Math.abs(y.bal) - Math.abs(x.bal)).slice(0, 4);
    const front = cards[0], back = cards.slice(1).reverse();
    return `<div class="hs hs-b"><div class="hs-top"><h1 class="hs-title">حساباتي</h1>${switcher}</div>
      ${front ? `<section class="hs-stack" style="height:${200 + back.length * 52}px" aria-label="بطاقات الحسابات">
        ${back.map((x, i) => `<button class="hs-wcard hs-wback" style="top:${i * 52}px" data-nav-to="accounts"><span>${esc(x.a.name)} · ${esc(sym(x.a.currency))}</span><b>${amt(x.bal, x.a.currency)}</b></button>`).join('')}
        <button class="hs-wcard hs-wfront" style="top:${back.length * 52}px" data-nav-to="detail/balances"><span class="hs-wtop"><b>${esc(front.a.name)}</b><span>${esc(curName(front.a.currency))}</span></span><span class="hs-wbal"><span class="hs-label">الرصيد</span><span class="hs-big">${amt(front.bal, front.a.currency)}</span></span></button>
      </section>` : '<div class="empty">أضف حسابًا لتظهر البطاقات</div>'}
      <section class="hs-grid2">${m.curs.map((c) => `<div class="hs-card"><span class="hs-label">${esc(curName(c.currency))}</span><span class="hs-v">${amt(c.total, c.currency)}</span><span class="hs-label">${c.n === 1 ? 'حساب واحد' : c.n === 2 ? 'حسابان' : `${c.n} حسابات`}${c.currency !== m.disp ? ' · لا يُحوَّل' : ''}</span></div>`).join('')}</section>
      <nav class="hs-pillbtns" aria-label="إجراءات سريعة"><button class="hs-pb hs-pb-p" data-shortcut="expense">مصروف</button><button class="hs-pb" data-shortcut="income">دخل</button><button class="hs-pb" data-shortcut="transfer">تحويل</button></nav>
      <section class="hs-card"><h2>${esc(ctx.monthLabel(C.today().slice(0, 7)))} — ${esc(curName(m.disp))}</h2>
        <div class="hs-kv"><span>الدخل</span><span>${amt(m.month.income, m.disp, true)}</span></div><div class="hs-bar hs-bar-in"><span style="width:100%"></span></div>
        <div class="hs-kv"><span>المصروف</span><span>${amt(-m.month.expense, m.disp)}</span></div><div class="hs-bar"><span style="width:${pct(m.month.expense, m.month.income || m.month.expense)}%"></span></div></section>
      ${m.nw ? `<section class="hs-grid2"><button class="hs-card hs-link" data-nav-to="gold"><span class="hs-label">الذهب</span><span class="hs-v"><span class="num">${+m.gold.grams.toFixed(3)}</span> غ</span><span class="hs-label">${m.nw.gold.valuation ? 'مقيّم' : 'غير مقيّم'}</span></button><button class="hs-card hs-link" data-nav-to="wealth"><span class="hs-label">${m.nw.partial ? 'صافي جزئي' : 'صافي الثروة'}</span><span class="hs-v">${amt(m.nw.net, m.disp)}</span><span class="hs-label">${m.nw.partial ? 'بلا الأصول غير المقيّمة' : 'ثروتي'}</span></button></section>` : ''}
      ${m.up.length ? `<ul class="hs-card hs-list">${m.up.map(upRow).join('')}</ul>` : ''}
      <section><div class="hs-head hs-h"><h2>آخر العمليات</h2><button class="link-btn" data-nav-to="history">الكل</button></div>${m.recent.length ? `<ul class="hs-card hs-list">${m.recent.map(txRow).join('')}</ul>` : empty}</section></div>`;
  }
  // ---------- ج: الملخص أولًا ----------
  function homeC(m) {
    const main = m.curs.find((c) => c.currency === m.disp) || m.curs[0];
    const others = m.curs.filter((c) => c !== main);
    const alert = m.up.find((i) => i.dir === 'out' && days(i.date) <= 15);
    const catTotal = m.cats.reduce((s, x) => s + x[1], 0) || 1;
    return `<div class="hs hs-c"><div class="hs-top"><h1 class="hs-title">ملخصي</h1>${switcher}</div>
      ${alert ? `<button class="hs-alert" data-nav-to="${alert.kind === 'obligation' ? 'debts' : 'recurring'}"><span>${esc(alert.label)} ${alert.overdue ? 'متأخر' : esc(whenLabel(alert.date))}</span><b>${amt(alert.amount, alert.currency)}</b></button>` : ''}
      <section class="hs-grid2">
        <button class="hs-card hs-link" data-nav-to="detail/balances"><span class="hs-label">السيولة</span><span class="hs-v">${main ? amt(main.total, main.currency) : '—'}</span><span class="hs-label">${others.map((c) => `و${N(c.total, c.currency)} ${esc(sym(c.currency))}`).join(' ') || 'كل الحسابات'}</span></button>
        <button class="hs-card hs-link" data-nav-to="reports"><span class="hs-label">صافي الشهر</span><span class="hs-v">${amt(m.month.net, m.disp, true)}</span><span class="hs-label">دخل ${N(m.month.income, m.disp)} · مصروف ${N(m.month.expense, m.disp)}</span></button>
        <button class="hs-card hs-link" data-nav-to="detail/debt"><span class="hs-label">ديون عليّ</span><span class="hs-v">${multi(m.ob.debt)}</span></button>
        <button class="hs-card hs-link" data-nav-to="detail/receivable"><span class="hs-label">مستحق لي</span><span class="hs-v">${multi(m.ob.recv)}</span></button>
      </section>
      <section class="hs-card"><div class="hs-head"><h2>أين ذهب المال</h2><span class="hs-label">${amt(m.month.expense, m.disp)}</span></div>
        ${m.cats.length ? m.cats.map(([n, v]) => `<div class="hs-kv"><span>${esc(n)}</span><span>${amt(v, m.disp)}</span></div><div class="hs-bar"><span style="width:${Math.round((v / catTotal) * 100)}%"></span></div>`).join('') : '<span class="hs-label">لا مصروف هذا الشهر</span>'}
        ${m.otherMonth.filter((x) => x.expense > 0).map((x) => `<span class="hs-label">مصروف ${esc(curName(x.currency))} منفصل: ${N(x.expense, x.currency)} ${esc(sym(x.currency))}</span>`).join('')}</section>
      ${nwCard(m)}
      <section><div class="hs-head hs-h"><h2>آخر العمليات</h2><button class="link-btn" data-nav-to="history">الكل</button></div>${m.recent.length ? `<ul class="hs-card hs-list">${m.recent.slice(0, 4).map(txRow).join('')}</ul>` : empty}</section></div>`;
  }

  ctx.homeStyle = style;
  ctx.homeSwitcher = switcher;
  ctx.renderHomeStyle = () => { const st = style(); if (st === 'classic') return false; $('v-home').innerHTML = { a: homeA, b: homeB, c: homeC }[st](model()); return true; };
  function chooser() {
    const cur = style();
    sheet('واجهة الرئيسية', `<p class="muted">اختر شكل الصفحة الرئيسية. يمكنك التغيير في أي وقت؛ لا يتغير شيء في بياناتك أو أرصدتك.</p>
      <div class="hs-choices">${Object.entries(HOME_STYLES).map(([k, v]) => `<button class="origin-opt hs-choice" data-hs="${k}" aria-pressed="${k === cur}"><b>${esc(v.name)}</b><small>${esc(v.desc)}</small></button>`).join('')}</div>`);
    document.querySelectorAll('#sheet [data-hs]').forEach((b) => (b.onclick = async () => { await commit((d) => { d.settings.homeStyle = b.dataset.hs; }, null, { history: false }); closeSheet(); ctx.render(); }));
  }
  return { actions: { 'home-style': chooser } };
}
