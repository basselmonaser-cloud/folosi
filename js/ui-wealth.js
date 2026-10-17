// فلوسي 4.0 — واجهة «ثروتي»: صافي الثروة، الذهب، الأسهم والصناديق، الاستثمارات الأخرى، الأسعار.
import * as Wm from './wealth.js';
import * as P from './prices.js';

export function register(ctx) {
  const { S, $, esc, money, plain, toast, sheet, closeSheet, confirmBox, commit, go, head, acc, dt, C, pick, setPick, currencyOptions } = ctx;
  const disp = () => S.data.settings.displayCurrency;
  const nwNow = () => Wm.netWorth(S.data, S.rates);
  const pct = (a, b) => (b ? `${a >= 0 ? '+' : ''}${((a / b) * 100).toFixed(1)}%` : '');
  const gl = (v, cur) => (v === null || v === undefined ? '<span class="muted">—</span>' : `<span class="${v >= 0 ? 'good' : 'bad'}">${money(v, cur, { sign: true })}</span>`);
  const accOpts = (sel, { none = 'بدون — لم تُدفع من حساباتي في فلوسي' } = {}) => `<option value="">${esc(none)}</option>` + S.data.accounts.filter((a) => !a.archived).map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)} — ${a.currency} (${plain(C.balance(S.data, a), a.currency)})</option>`).join('');
  ctx.extraDiagnostics.push((d) => Wm.diagnoseWealth(d));
  Object.assign(ctx.fixers, Wm.FIXERS);

  // ---------- الأسعار ----------
  const heldSecurities = () => { const { holdings } = Wm.replayHoldings(S.data, { strict: false }); const ids = new Set(holdings.filter((h) => h.qty > 0).map((h) => h.securityId)); return S.data.wealth.securities.filter((s) => ids.has(s.id)); };
  async function refreshPrices(manual = false) {
    if (!S.data || S.priceBusy) return;
    if (navigator.onLine === false) { if (manual) toast('لا يوجد اتصال — تُعرض آخر أسعار محفوظة', true); return; }
    S.priceBusy = true; renderIfWealth();
    try {
      let { market, ok, errors } = await P.refreshMetals(S.data.market || {});
      let q = { ok: 0, tried: 0 };
      const key = S.data.settings.twelveDataKey, secs = heldSecurities();
      if (key && secs.length) { const r = await P.refreshQuotes(market, secs, key); market = r.market; q = r; }
      if (!S.data) return;
      S.data.market = market;
      Wm.recordNetWorth(S.data, nwNow());
      S.data.updatedAt = new Date().toISOString();
      await ctx.save();
      if (manual) toast(ok ? `تم تحديث سعر الذهب${q.tried ? ` و${q.ok} من ${q.tried} أسهم` : ''}` : `تعذر تحديث سعر الذهب (${errors.gold === 'offline' ? 'لا اتصال' : errors.gold === 'timeout' ? 'انتهت المهلة' : 'المصدر لم يستجب'}) — بقي آخر سعر محفوظ`, !ok);
    } finally { S.priceBusy = false; renderIfWealth(); }
  }
  const renderIfWealth = () => { if (['wealth', 'gold', 'stocks', 'investments', 'zakat', 'performance'].includes(S.view)) ctx.render(); };
  ctx.onStart = (ctx.onStart || []);
  ctx.onStart.push(() => {
    // لقطة صافي الثروة اليومية (دون إنترنت تُحسب بآخر أسعار محفوظة)
    try { const before = JSON.stringify(S.data.netWorthHistory?.at(-1) || null); Wm.recordNetWorth(S.data, nwNow()); if (JSON.stringify(S.data.netWorthHistory.at(-1)) !== before) ctx.save(); } catch {}
    const st = P.priceStatus(S.data.market?.gold, { maxHours: 1 });
    if (st.state !== 'fresh') refreshPrices(false);
    clearInterval(S.priceTimer);
    S.priceTimer = setInterval(() => { if (document.visibilityState === 'visible' && S.data) refreshPrices(false); }, 15 * 60 * 1000);
  });
  window.addEventListener('online', () => { if (S.data && P.priceStatus(S.data.market?.gold, { maxHours: 1 }).state !== 'fresh') refreshPrices(false); });

  function goldPriceStrip() {
    const g = S.data.market?.gold, st = P.priceStatus(g), cur = disp(), err = S.data.market?.goldError;
    const g24 = Wm.gramPrice(S.data.market, cur, S.rates), g21 = Wm.gramPrice(S.data.market, cur, S.rates, 21 / 24);
    return `<div class="card price-strip"><div class="card-head" style="margin-bottom:6px"><h3 style="margin:0">سعر الذهب</h3>
      <button class="btn small" data-action="refresh-prices" ${S.priceBusy ? 'disabled' : ''}>${S.priceBusy ? 'جارٍ التحديث…' : 'تحديث الآن'}</button></div>
      ${g24 !== null ? `<div class="kpis"><div><small>عيار 24 / غرام</small><b>${money(g24, cur)}</b></div><div><small>عيار 21 / غرام</small><b>${money(g21, cur)}</b></div><div><small>الأونصة</small><b>${money(g.usdPerOz, 'USD')}</b></div></div>
        <p class="hint" style="margin:6px 0 0">سعر فوري عالمي (Spot) من <a href="${P.GOLD_SOURCE.site}" target="_blank" rel="noopener noreferrer">${esc(g.sourceName || P.GOLD_SOURCE.name)}</a> · نُشر ${esc(g.updatedAt ? dt(g.updatedAt) : '—')} · جُلب ${esc(dt(g.fetchedAt))}
        ${st.state === 'stale' ? ' · <span class="tag warn">قديم</span>' : ''}<br>ليس سعر البيع أو الشراء لدى محلات الذهب، ولا يشمل المصنعية. محوّل بسعر صرف ${esc(cur)} الحالي.</p>`
      : `<p class="muted" style="margin:0">لا يوجد سعر ذهب محفوظ بعد${err ? ` (آخر محاولة: ${esc(dt(err.at))} — ${err.reason === 'offline' ? 'لا اتصال' : 'فشل الاتصال بالمصدر'})` : ''}. قيمة الذهب لن تُحسب حتى يتوفر سعر حقيقي.</p>`}
      ${g24 !== null && err && Date.parse(err.at) > Date.parse(g.fetchedAt) ? `<p class="hint bad" style="margin:4px 0 0">فشل آخر تحديث (${esc(dt(err.at))}) — يُعرض آخر سعر صالح.</p>` : ''}</div>`;
  }

  // ---------- رسوم بيانية (SVG بلا مكتبات) ----------
  function allocBars(parts, cur) {
    const L = { liquidity: 'السيولة', gold: 'الذهب', stocks: 'الأسهم', funds: 'الصناديق', other: 'استثمارات أخرى', receivables: 'مستحقات لي' };
    const rows = Object.entries(L).map(([k, l]) => ({ k, l, v: Math.max(0, parts[k] || 0) })).filter((r) => r.v > 0);
    const total = rows.reduce((s, r) => s + r.v, 0);
    if (!total) return '<div class="empty">لا توجد أصول بعد</div>';
    return `<div class="alloc" role="table" aria-label="توزيع الأصول">${rows.sort((a, b) => b.v - a.v).map((r) => `<div class="alloc-row" role="row"><span role="cell">${r.l}</span><span class="alloc-bar" role="cell" aria-hidden="true"><i style="width:${Math.max(1.5, (r.v / total) * 100)}%"></i></span><b role="cell">${((r.v / total) * 100).toFixed(1)}%</b><small role="cell">${plain(r.v, cur)}</small></div>`).join('')}</div>`;
  }
  function trendChart(hist, cur) {
    const pts = hist.filter((h) => h.currency === cur);
    if (pts.length < 2) return '<p class="hint">يظهر الرسم بعد يومين على الأقل من التسجيل — يُحفظ صافي الثروة مرة يوميًا عند فتح التطبيق.</p>';
    const W0 = 340, H0 = 150, pad = { l: 8, r: 8, t: 12, b: 22 };
    const xs = pts.map((p) => Date.parse(p.date)), ys = pts.map((p) => p.value);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), yr = y1 - y0 || Math.abs(y1) || 1;
    const X = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W0 - pad.l - pad.r), Y = (y) => pad.t + (1 - (y - (y0 - yr * 0.08)) / (yr * 1.16)) * (H0 - pad.t - pad.b);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
    const ch = pts[pts.length - 1].value - pts[0].value;
    return `<div class="trend" data-trend='${esc(JSON.stringify(pts.map((p) => [p.date, p.value])))}' data-cur="${esc(cur)}">
      <p class="hint" style="margin:0 0 6px">منذ ${esc(pts[0].date)}: ${gl(ch, cur)} ${pts[0].value ? `(${pct(ch, Math.abs(pts[0].value))})` : ''}</p>
      <svg viewBox="0 0 ${W0} ${H0}" class="trend-svg" role="img" aria-label="تغير صافي الثروة عبر الزمن">
        <line x1="${pad.l}" x2="${W0 - pad.r}" y1="${H0 - pad.b}" y2="${H0 - pad.b}" class="axis"/>
        <path d="${d}" class="line"/>
        <circle class="dot" r="4" cx="${X(xs.at(-1)).toFixed(1)}" cy="${Y(ys.at(-1)).toFixed(1)}"/>
        <text x="${W0 - pad.r}" y="${H0 - 6}" text-anchor="start" class="tick">${esc(pts.at(-1).date)}</text><text x="${pad.l}" y="${H0 - 6}" text-anchor="end" class="tick">${esc(pts[0].date)}</text>
        <line class="cross" y1="${pad.t}" y2="${H0 - pad.b}" x1="-10" x2="-10"/>
      </svg><div class="trend-tip" hidden></div></div>`;
  }
  // تلميح عند اللمس/المرور على الرسم
  document.addEventListener('pointermove', (e) => {
    const svg = e.target.closest?.('.trend-svg'); if (!svg) return;
    const box = svg.closest('.trend'), pts = JSON.parse(box.dataset.trend), r = svg.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, i = Math.max(0, Math.min(pts.length - 1, Math.round(fx * (pts.length - 1))));
    const vb = svg.viewBox.baseVal, x = 8 + (i / (pts.length - 1 || 1)) * (vb.width - 16);
    const cr = svg.querySelector('.cross'); cr.setAttribute('x1', x); cr.setAttribute('x2', x);
    const tip = box.querySelector('.trend-tip'); tip.hidden = false; tip.textContent = `${pts[i][0]}: ${plain(pts[i][1], box.dataset.cur)}`;
  });

  // ---------- ثروتي ----------
  function renderWealth() {
    const n = nwNow(), cur = disp(), p = n.parts;
    const tile = (label, v, nav, cls = '', sub = '') => `<button class="stat" ${nav}><small>${label}</small><div class="v ${cls}">${money(v, cur)}</div>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const g = n.gold;
    $('v-wealth').innerHTML = `<div class="view-head"><h2>ثروتي</h2></div>
      <div class="card hero"><small>صافي الثروة</small><div class="big"><span class="num">${p && n.net < 0 ? '-' : ''}${ctx.nf(cur).format(Math.abs(n.net))}</span><span class="cur">${esc(ctx.sym(cur))}</span></div>
        <div class="hero-groups"><span><small>الأصول</small><b class="num">${ctx.nf(cur).format(n.assets)}</b></span><span><small>الالتزامات</small><b class="num">${ctx.nf(cur).format(p.liabilities)}</b></span></div>
        <small>الأصول والحقوق القابلة للتقييم − الديون عليّ. الأهداف لا تُضاف لأنها جزء من أموالك الموجودة.</small></div>
      ${n.notes.length ? `<div class="notice">${n.notes.map((x) => `<div>• ${esc(x)}</div>`).join('')}</div>` : ''}
      <div class="stats">
        ${tile('السيولة المتاحة', p.liquidity, 'data-nav-to="accounts"')}
        ${tile('الذهب', p.gold, 'data-nav-to="gold"', '', g.grams ? `${+g.grams.toFixed(3)} غ${g.priced ? '' : ' · بلا سعر'}` : '')}
        ${tile('الأسهم', p.stocks, 'data-nav-to="stocks"')}
        ${tile('الصناديق الاستثمارية', p.funds, 'data-nav-to="stocks"')}
        ${tile('استثمارات أخرى', p.other, 'data-nav-to="investments"')}
        ${tile('مستحقات لي', p.receivables, 'data-action="wealth-debts" data-type="receivable"')}
        ${tile('التزامات وديون عليّ', p.liabilities, 'data-action="wealth-debts" data-type="debt"', 'bad')}
      </div>
      <div class="card"><div class="kpis"><div><small>أرباح/خسائر محققة</small><b>${gl(n.realized, cur)}</b></div><div><small>غير محققة</small><b>${gl(n.unrealized, cur)}</b></div></div>
        <p class="hint" style="margin-bottom:0">المحققة: من البيع والتوزيعات. غير المحققة: الفرق بين القيمة الحالية والتكلفة لما تملكه الآن (الذهب مجهول التكلفة لا يدخل).</p></div>
      <div class="card"><h3>توزيع الأصول</h3>${allocBars(p, cur)}</div>
      <div class="card"><h3>تغيّر صافي الثروة</h3>${trendChart(S.data.netWorthHistory || [], cur)}</div>
      ${goldPriceStrip()}
      <div class="more-grid">
        <button class="shortcut" data-nav-to="gold"><span class="ico">${ctx.icon('i-gold')}</span><span>الذهب</span></button>
        <button class="shortcut" data-nav-to="stocks"><span class="ico">${ctx.icon('i-chart')}</span><span>الأسهم والصناديق</span></button>
        <button class="shortcut" data-nav-to="investments"><span class="ico">${ctx.icon('i-target')}</span><span>استثمارات أخرى</span></button>
        <button class="shortcut" data-nav-to="performance"><span class="ico">${ctx.icon('i-chart')}</span><span>الأداء الاستثماري</span></button>
        <button class="shortcut" data-nav-to="zakat"><span class="ico">${ctx.icon('i-hand')}</span><span>حاسبة الزكاة</span></button>
        <button class="shortcut" data-nav-to="reports"><span class="ico">${ctx.icon('i-chart')}</span><span>التقارير</span></button>
      </div>`;
  }

  // ---------- الذهب ----------
  function renderGold() {
    const cur = disp(), g = Wm.goldSummary(S.data, S.data.market, S.rates);
    const lots = [...g.items].sort((a, b) => (b.lot.remaining > 0) - (a.lot.remaining > 0) || (b.lot.date || '').localeCompare(a.lot.date || ''));
    $('v-gold').innerHTML = `${head('الذهب', 'wealth')}
      <div class="card"><div class="kpis"><div><small>إجمالي الوزن</small><b>${+g.grams.toFixed(3)} غ</b></div><div><small>مكافئ الذهب الخالص</small><b>${+g.pureGrams.toFixed(3)} غ</b></div></div>
        ${Object.keys(g.byKarat).length ? `<div class="chip-row" style="margin-top:8px">${Object.entries(g.byKarat).map(([k, v]) => `<span class="tag">${esc(k)}: ${+v.toFixed(3)} غ</span>`).join('')}</div>` : ''}
        <div class="kpis" style="margin-top:10px"><div><small>القيمة السوقية (الذهب الخالص)</small><b>${g.priced ? money(g.marketValue, cur) : '—'}</b></div><div><small>بعد خصم إعادة البيع</small><b>${g.priced ? money(g.resaleValue, cur) : '—'}</b></div></div>
        <div class="kpis" style="margin-top:10px"><div><small>تكلفة المتبقي (المعروفة)</small><b>${money(g.costOfKnown, cur)}</b></div><div><small>غير محقق</small><b>${g.priced ? gl(g.unrealized, cur) : '—'}</b></div><div><small>محقق</small><b>${gl(g.realized, cur)}</b></div></div>
        ${g.valueUnknownCost ? `<p class="hint">ذهب بتكلفة مجهولة قيمته ${plain(g.valueUnknownCost, cur)} — لا يدخل في حساب الربح.</p>` : ''}
        <p class="hint" style="margin-bottom:0">القيمة = الوزن × النقاء × السعر الفوري. سعر بيع المشغولات الفعلي عادة أقل (يُخصم منه)؛ حدد «خصم إعادة البيع» لكل قطعة لتقدير أدق.</p></div>
      <button class="btn primary block" data-action="gold-add">إضافة ذهب</button>
      ${goldPriceStrip()}
      <div class="card">${lots.length ? `<ul class="list">${lots.map((it) => { const l = it.lot; return `<li><button class="item" data-action="gold-open" data-id="${esc(l.id)}"><span class="ico">${ctx.icon('i-gold')}</span><div class="body"><div class="title">${esc(l.name)} ${l.remaining <= 0 ? '<span class="tag">مُباع</span>' : l.remaining < l.grams ? '<span class="tag">بيع جزئي</span>' : ''}</div>
        <div class="sub">${esc(l.kind === 'custom' ? l.kindLabel || Wm.GOLD_KINDS.custom : Wm.GOLD_KINDS[l.kind])} · ${esc(Wm.karatLabel(l))} · ${+l.remaining.toFixed(3)}${l.remaining < l.grams ? ` من ${+l.grams.toFixed(3)}` : ''} غ${l.location ? ' · ' + esc(l.location) : ''}</div></div>
        <div class="amt">${it.resaleValue !== null ? money(it.resaleValue, cur) : '—'}<small>${it.unrealized !== null ? gl(it.unrealized, cur) : l.costBasis === null ? 'تكلفة مجهولة' : ''}</small></div></button></li>`; }).join('')}</ul>` : '<div class="empty">لم تسجل أي ذهب بعد</div>'}</div>`;
  }
  function goldForm(id) {
    const l = id ? S.data.wealth.gold.lots.find((x) => x.id === id) : null;
    const sold = l && S.data.wealth.gold.sales.some((s) => s.lotId === l.id);
    sheet(l ? 'تعديل قطعة ذهب' : 'إضافة ذهب', `
      <label for="gN">اسم القطعة</label><input id="gN" name="name" required maxlength="90" placeholder="سبيكة 10 غ، طقم الزفاف، ليرة…" value="${esc(l?.name || '')}">
      <div class="grid2"><div><label>النوع</label><select name="kind">${Object.entries(Wm.GOLD_KINDS).map(([k, v]) => `<option value="${k}"${(l?.kind || 'jewelry') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>العيار</label><select name="karat" ${sold ? 'disabled' : ''}>${Wm.KARATS.map((k) => `<option value="${k}"${(l?.karat ?? 21) === k ? ' selected' : ''}>عيار ${k}</option>`).join('')}<option value="custom"${l?.karat === 'custom' ? ' selected' : ''}>عيار/نقاء مخصص</option></select></div></div>
      <div id="gKL" hidden><label>اسم النوع</label><input name="kindLabel" maxlength="40" value="${esc(l?.kindLabel || '')}"></div>
      <div id="gPu" hidden><label>النقاء (عيار مثل 14، أو نسبة 0.585، أو بالألف 585)</label><input name="purity" inputmode="decimal" value="${l?.karat === 'custom' ? esc(l.purity) : ''}"></div>
      <label for="gG">الوزن بالجرام</label><input id="gG" name="grams" inputmode="decimal" required value="${esc(l?.grams ?? '')}" ${sold ? 'disabled' : ''}>
      ${l ? '' : `<label>كيف حصلت عليه؟</label><div class="seg">${pick('acquisition', 'purchase', 'شراء')}${pick('acquisition', 'owned', 'أملكه مسبقًا')}</div><input type="hidden" name="acquisition" value="purchase">
        <div id="gOwned" hidden><label>هل تعرف تكلفة اقتنائه؟</label><div class="seg">${pick('costKnown', 'yes', 'نعم')}${pick('costKnown', 'no', 'لا — تكلفة مجهولة')}</div><input type="hidden" name="costKnown" value="no">
          <p class="hint">ذهب موجود أصلًا (هدية، ورث، قديم): يُضاف لثروتك دون أي حركة على حساباتك. إن كانت التكلفة مجهولة لا يُحسب له ربح أو خسارة.</p></div>
        <div id="gCost"><div class="grid2" style="grid-template-columns:2fr 1fr"><div><label>سعر الشراء الإجمالي (دون المصنعية)</label><input name="cost" inputmode="decimal"></div><div><label>العملة</label><select name="currency">${currencyOptions(disp())}</select></div></div>
          <div class="grid2"><div><label>المصنعية</label><input name="making" inputmode="decimal" placeholder="0"></div><div><label>رسوم إضافية</label><input name="fees" inputmode="decimal" placeholder="0"></div></div>
          <div id="gAccBox"><label>دُفع من حساب</label><select name="accountId">${accOpts('')}</select><div id="gPaid" hidden><label id="gPaidL"></label><input name="paid" inputmode="decimal"></div>
          <p class="hint" id="gAccH">اختر الحساب ليُخصم المبلغ منه مرة واحدة (تبادل نقد بذهب — لا يُحتسب مصروفًا ولا يُضاعف ثروتك).</p></div></div>
        <label>تاريخ الشراء/الاقتناء</label><input type="date" name="date" value="${C.today()}">`}
      ${l?.acquisition === 'owned' && !l.txId ? `<label>تكلفة الاقتناء</label><div class="seg">${pick('costKnown', 'yes', 'معروفة')}${pick('costKnown', 'no', 'مجهولة')}</div><input type="hidden" name="costKnown" value="${l.costKnown ? 'yes' : 'no'}">
        <div id="gOwnCost" ${l.costKnown ? '' : 'hidden'}><div class="grid2"><div><label>التكلفة</label><input name="cost" inputmode="decimal" value="${esc(l.cost || '')}"></div><div><label>المصنعية</label><input name="making" inputmode="decimal" value="${esc(l.making || '')}"></div></div></div>` : ''}
      <div class="grid2"><div><label>مكان الحفظ</label><input name="location" maxlength="90" value="${esc(l?.location || '')}"></div><div><label>البائع (اختياري)</label><input name="seller" maxlength="90" value="${esc(l?.seller || '')}"></div></div>
      <label>خصم إعادة البيع المتوقع % (اختياري)</label><input name="resaleDiscount" inputmode="decimal" placeholder="مثال: 5 للمشغولات" value="${esc(l?.resaleDiscount || '')}">
      <label>ملاحظات</label><input name="note" maxlength="300" value="${esc(l?.note || '')}">
      ${ctx.attachField ? ctx.attachField('gold', l?.id) : ''}`, {
      submit: l ? 'حفظ' : 'إضافة',
      onReady: (b, form) => { if (!l) { setPick(form, 'acquisition', 'purchase'); setPick(form, 'costKnown', 'no'); } else if (form.elements.costKnown) setPick(form, 'costKnown', form.elements.costKnown.value); },
      onChange: (form) => {
        $('gKL').hidden = form.elements.kind.value !== 'custom'; $('gPu').hidden = form.elements.karat.value !== 'custom';
        if (l) { if ($('gOwnCost')) $('gOwnCost').hidden = form.elements.costKnown.value !== 'yes'; return; }
        const owned = form.elements.acquisition.value === 'owned';
        $('gOwned').hidden = !owned; $('gCost').hidden = owned && form.elements.costKnown.value !== 'yes'; $('gAccBox').hidden = owned;
        const a = acc(form.elements.accountId.value), diff = a && a.currency !== form.elements.currency.value;
        $('gPaid').hidden = !diff; if (diff) $('gPaidL').textContent = `المبلغ المدفوع فعلًا بـ ${a.currency} (شامل المصنعية والرسوم)`;
      },
      onSubmit: async (v) => {
        if (l) return commit((d) => Wm.updateGoldLot(d, l.id, { ...v, grams: sold ? undefined : v.grams, karat: sold ? undefined : v.karat, purity: sold ? undefined : v.purity }), 'تم الحفظ', { label: `تعديل ذهب «${l.name}»` });
        const owned = v.acquisition === 'owned';
        const lot = await commit((d) => Wm.addGoldLot(d, { ...v, accountId: owned ? '' : v.accountId }), 'تمت إضافة الذهب', { label: `إضافة ذهب «${v.name}» ${v.grams}غ` });
        if (ctx.attachCommit) await ctx.attachCommit('gold', lot.id);
      },
    });
  }
  function goldOpen(id) {
    const cur = disp(), l = S.data.wealth.gold.lots.find((x) => x.id === id); if (!l) return;
    const it = Wm.goldSummary(S.data, S.data.market, S.rates).items.find((x) => x.lot.id === id);
    const sales = S.data.wealth.gold.sales.filter((s) => s.lotId === id).sort((a, b) => b.date.localeCompare(a.date));
    sheet(l.name, `
      <div class="kpis"><div><small>المتبقي</small><b>${+l.remaining.toFixed(3)} غ</b></div><div><small>${esc(Wm.karatLabel(l))}</small><b>${+it.pureGrams.toFixed(3)} غ خالص</b></div><div><small>القيمة</small><b>${it.resaleValue !== null ? money(it.resaleValue, cur) : '—'}</b></div></div>
      <ul class="list" style="margin-top:8px">
        <li class="item"><div class="body"><div class="sub">الاقتناء</div><div class="title">${l.acquisition === 'owned' ? 'مملوك مسبقًا' : 'شراء'} · ${esc(l.date)}${l.accountId ? ' · من ' + esc(acc(l.accountId)?.name || '؟') : ''}</div></div></li>
        <li class="item"><div class="body"><div class="sub">التكلفة الكاملة</div><div class="title">${l.costBasis === null ? 'مجهولة' : `${plain(l.costBasis, l.currency)} (سعر ${plain(l.cost, l.currency)} + مصنعية ${plain(l.making, l.currency)} + رسوم ${plain(l.fees, l.currency)})`}</div></div></li>
        ${it.unrealized !== null ? `<li class="item"><div class="body"><div class="sub">ربح/خسارة غير محققة للمتبقي</div><div class="title">${gl(it.unrealized, cur)}</div></div></li>` : ''}
        ${l.location || l.seller ? `<li class="item"><div class="body"><div class="sub">الحفظ والبائع</div><div class="title">${esc(l.location || '—')}${l.seller ? ' · ' + esc(l.seller) : ''}</div></div></li>` : ''}
        ${l.resaleDiscount ? `<li class="item"><div class="body"><div class="sub">خصم إعادة البيع المتوقع</div><div class="title">${l.resaleDiscount}%</div></div></li>` : ''}
        ${l.note ? `<li class="item"><div class="body"><div class="sub">ملاحظات</div><div class="title">${esc(l.note)}</div></div></li>` : ''}
      </ul>
      ${ctx.attachList ? ctx.attachList('gold', l.id) : ''}
      <div class="actions">${l.remaining > 0 ? `<button class="btn primary" data-action="gold-sell" data-id="${esc(l.id)}">بيع</button>` : ''}<button class="btn" data-action="gold-edit" data-id="${esc(l.id)}">تعديل</button></div>
      <h3 style="margin-top:14px">سجل البيع</h3>${sales.length ? `<ul class="list">${sales.map((s) => `<li class="item"><div class="body"><div class="title">${+s.grams.toFixed(3)} غ بـ ${plain(s.net, s.currency)}</div><div class="sub">${esc(s.date)}${s.accountId ? ' · إلى ' + esc(acc(s.accountId)?.name || '؟') : ''} · ${s.realized === null ? 'ربح غير معروف (تكلفة مجهولة)' : `ربح محقق ${plain(s.realized, s.currency)}`}</div></div><button class="btn small ghost-danger" data-action="gold-cancel-sale" data-id="${esc(s.id)}">إلغاء</button></li>`).join('')}</ul>` : '<div class="empty">لا مبيعات</div>'}
      <div class="actions"><button class="btn small ghost-danger" data-action="gold-delete" data-id="${esc(l.id)}">حذف القطعة…</button></div>`);
  }
  function goldSell(id) {
    const l = S.data.wealth.gold.lots.find((x) => x.id === id); if (!l) return;
    const cur = l.currency;
    sheet(`بيع من «${l.name}»`, `
      <p class="muted">المتبقي ${+l.remaining.toFixed(3)} غ ${esc(Wm.karatLabel(l))}</p>
      <label>الوزن المباع (غ)</label><input name="grams" inputmode="decimal" value="${esc(l.remaining)}" required>
      <label>مبلغ البيع (${esc(cur)})</label><input name="proceeds" class="amount-input" inputmode="decimal" required>
      <label>رسوم البيع (اختياري)</label><input name="fees" inputmode="decimal" placeholder="0">
      <label>استُلم في حساب</label><select name="accountId">${accOpts('', { none: 'بدون — لم يدخل حساباتي في فلوسي' })}</select>
      <div id="gsR" hidden><label id="gsRL"></label><input name="received" inputmode="decimal"></div>
      <label>التاريخ</label><input type="date" name="date" value="${C.today()}"><label>ملاحظة</label><input name="note" maxlength="200">
      <div class="hint" id="gsH"></div>`, {
      submit: 'تسجيل البيع',
      onChange: (form) => {
        const gm = C.parseAmount(form.elements.grams.value), pr = C.parseAmount(form.elements.proceeds.value), fe = C.parseAmount(form.elements.fees.value) || 0;
        const mkt = Wm.gramPrice(S.data.market, cur, S.rates, l.purity);
        const a = acc(form.elements.accountId.value), diff = a && a.currency !== cur;
        $('gsR').hidden = !diff; if (diff) $('gsRL').textContent = `المبلغ المستلم فعلًا بـ ${a.currency}`;
        const parts = [];
        if (mkt !== null && gm > 0) parts.push(`قيمة هذا الوزن بالسعر الفوري ≈ ${plain(mkt * gm, cur)} (سعر المحل عادة أقل).`);
        if (l.costBasis !== null && gm > 0 && pr > 0) { const c = l.costBasis * (gm / l.grams); parts.push(`تكلفة هذا الجزء ${plain(c, cur)} ← ربح محقق ${plain(pr - fe - c, cur)}.`); }
        $('gsH').textContent = parts.join(' ');
      },
      onSubmit: async (v) => { await commit((d) => Wm.sellGold(d, l.id, v), 'تم تسجيل البيع', { label: `بيع ${v.grams}غ من «${l.name}»` }); goldOpen(l.id); return false; },
    });
  }
  async function goldDelete(id) {
    const l = S.data.wealth.gold.lots.find((x) => x.id === id); if (!l) return;
    const eff = Wm.goldDeleteEffects(S.data, id);
    if (!eff.linked) { if (await confirmBox({ title: 'حذف القطعة؟', text: `«${l.name}» ليست مرتبطة بأي حركة على حساباتك، وحذفها يزيلها من ثروتك فقط. يمكنك التراجع.`, ok: 'حذف', danger: true })) { await commit((d) => Wm.deleteGoldLot(d, id), 'تم الحذف', { label: `حذف ذهب «${l.name}»` }); closeSheet(); } return; }
    sheet(`حذف «${l.name}»`, `<div class="notice">لهذه القطعة ${eff.linked} حركة على حساباتك (شراء${eff.sales ? ` و${eff.sales} بيع` : ''}). اختر مصيرها:</div>
      <button class="btn block" id="gdKeep">حذف القطعة فقط — إبقاء الحركات والأرصدة كما هي</button><p class="hint">مناسب إن كانت القطعة سُجلت مرتين بالخطأ والمال خرج فعلًا.</p>
      <button class="btn ghost-danger block" id="gdRev" style="margin-top:10px">حذف القطعة وحركاتها (يعود المال للحساب)</button><p class="hint">فقط إن لم يحدث الشراء/البيع فعلًا.</p>`);
    $('gdKeep').onclick = async () => { await commit((d) => Wm.deleteGoldLot(d, id, { mode: 'keep' }), 'تم الحذف', { label: `حذف ذهب «${l.name}» (مع إبقاء الحركات)` }); closeSheet(); };
    $('gdRev').onclick = async () => { if (!(await confirmBox({ title: 'حذف مع عكس الحركات؟', text: 'ستُحذف حركات الشراء والبيع المرتبطة وتعود الأرصدة كما كانت قبلها.', ok: 'حذف وعكس', danger: true }))) return; await commit((d) => Wm.deleteGoldLot(d, id, { mode: 'reverse' }), 'تم الحذف', { label: `حذف ذهب «${l.name}» مع حركاته`, snapshot: 'pre-fix' }); closeSheet(); };
  }

  // ---------- الأسهم والصناديق ----------
  function renderStocks() {
    const cur = disp(), s = Wm.securitiesSummary(S.data, S.rates), w = S.data.wealth;
    const key = S.data.settings.twelveDataKey, errs = S.data.market?.quoteErrors || {};
    const byPf = {}; for (const r of s.rows) if (r.qty > 0 || r.realized || r.dividends) (byPf[r.portfolioId] ||= []).push(r);
    $('v-stocks').innerHTML = `${head('الأسهم والصناديق', 'wealth')}
      <div class="card"><div class="kpis"><div><small>القيمة السوقية</small><b>${money(s.stocksValue + s.fundsValue, cur)}</b></div><div><small>غير محقق</small><b>${gl(s.unrealized, cur)}</b></div><div><small>محقق</small><b>${gl(s.realized, cur)}</b></div></div>
        <div class="kpis" style="margin-top:8px"><div><small>توزيعات الأرباح</small><b>${money(s.dividends, cur)}</b></div><div><small>العمولات والرسوم</small><b>${money(s.fees, cur)}</b></div></div>
        ${s.unpriced.length ? `<p class="hint bad">بلا سعر (غير محسوبة): ${s.unpriced.map((x) => esc(x.symbol)).join('، ')} — أدخل سعرًا يدويًا أو فعّل مصدر الأسعار.</p>` : ''}</div>
      <div class="actions"><button class="btn primary" data-action="trade-add">عملية جديدة</button><button class="btn" data-action="portfolio-add">محفظة جديدة</button><button class="btn" data-action="stock-source">مصدر الأسعار</button>${key && heldSecurities().length ? `<button class="btn" data-action="refresh-prices" ${S.priceBusy ? 'disabled' : ''}>${S.priceBusy ? 'جارٍ…' : 'تحديث الأسعار'}</button>` : ''}</div>
      <p class="hint">${key ? 'أسعار تلقائية من Twelve Data بمفتاحك — قد تكون متأخرة حسب خطتك والسوق (الخطة المجانية: لا تشمل السوق السعودي).' : 'لا يوجد مصدر أسعار تلقائي للأسهم بعد — تُستخدم الأسعار اليدوية الموثقة بتاريخها.'}</p>
      ${w.portfolios.length ? w.portfolios.map((pf) => `<div class="card"><div class="card-head"><h3 style="margin:0">${esc(pf.name)}${pf.broker ? ` <small>· ${esc(pf.broker)}</small>` : ''}</h3><button class="link-btn" data-action="portfolio-edit" data-id="${esc(pf.id)}">تعديل</button></div>
        ${(byPf[pf.id] || []).length ? `<ul class="list">${byPf[pf.id].map((r) => `<li><button class="item" data-action="holding-open" data-pf="${esc(pf.id)}" data-id="${esc(r.securityId)}"><div class="body"><div class="title">${esc(r.security?.symbol)} <small>${esc(r.security?.name)}</small> ${r.qty <= 0 ? '<span class="tag">مغلق</span>' : ''}</div>
          <div class="sub">${esc(Wm.EXCHANGES[r.security?.exchange]?.name || r.security?.market || '')} · ${+r.qty.toFixed(6)} × ${r.quote ? `${plain(r.quote.price, r.security.currency)} <span class="tag ${r.quote.kind === 'manual' ? '' : 'warn'}">${r.quote.kind === 'manual' ? 'يدوي ' + esc(r.quote.date) : 'سوقي ' + esc(r.quote.date || '')}</span>` : '<span class="tag bad">بلا سعر</span>'}${errs[r.securityId] ? ' <span class="tag bad">فشل التحديث</span>' : ''}</div></div>
          <div class="amt">${r.value !== null ? money(r.value, r.security.currency) : '—'}<small>${r.unrealized !== null ? gl(r.unrealized, r.security.currency) : ''}</small></div></button></li>`).join('')}</ul>` : '<div class="empty">لا حيازات في هذه المحفظة</div>'}</div>`).join('')
      : '<div class="card"><div class="empty">أنشئ محفظة (مثل: الراجحي المالية، دراهم، إنتر أكتيف) ثم سجّل عمليات الشراء.</div></div>'}`;
  }
  function portfolioForm(id) {
    const p = id ? S.data.wealth.portfolios.find((x) => x.id === id) : null;
    sheet(p ? 'تعديل المحفظة' : 'محفظة جديدة', `<label>اسم المحفظة</label><input name="name" required maxlength="80" value="${esc(p?.name || '')}">
      <label>الوسيط أو المنصة</label><input name="broker" maxlength="80" placeholder="الراجحي المالية، دراهم، Interactive Brokers…" value="${esc(p?.broker || '')}">
      <label>ملاحظة</label><input name="note" maxlength="200" value="${esc(p?.note || '')}">`, {
      onSubmit: (v) => commit((d) => (p ? Wm.updatePortfolio(d, p.id, v) : Wm.addPortfolio(d, v)), 'تم الحفظ', { label: p ? `تعديل محفظة «${p.name}»` : `محفظة جديدة «${v.name}»` }),
    });
  }
  const TT = { buy: 'شراء', sell: 'بيع', dividend: 'توزيع أرباح', split: 'تقسيم/دمج', transfer: 'تحويل لمحفظة' };
  function tradeForm(pre = {}) {
    const w = S.data.wealth;
    if (!w.portfolios.length) { toast('أنشئ محفظة أولًا'); return portfolioForm(); }
    sheet('عملية استثمار', `
      <div class="seg seg-wrap">${Object.entries(TT).map(([k, l]) => pick('type', k, l)).join('')}</div><input type="hidden" name="type" value="${pre.type || 'buy'}">
      <label>المحفظة</label><select name="portfolioId">${w.portfolios.filter((p) => !p.archived).map((p) => `<option value="${esc(p.id)}"${p.id === pre.portfolioId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <label>الورقة المالية</label><select name="securityId">${w.securities.map((s) => `<option value="${esc(s.id)}"${s.id === pre.securityId ? ' selected' : ''}>${esc(s.symbol)} — ${esc(s.name)} (${esc(Wm.EXCHANGES[s.exchange]?.name || s.market)})</option>`).join('')}<option value="__new"${w.securities.length ? '' : ' selected'}>+ ورقة جديدة…</option></select>
      <div id="tNew" hidden>
        <div class="grid2"><div><label>رمز التداول</label><input name="symbol" maxlength="20" dir="ltr" placeholder="2222 أو AAPL"></div><div><label>النوع</label><select name="kind">${Object.entries(Wm.SECURITY_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
        <label>اسم الشركة/الصندوق</label><input name="name" maxlength="90">
        <label>السوق</label><select name="exchange">${Object.entries(Wm.EXCHANGES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
        <div id="tMk" hidden><label>اسم السوق</label><input name="market" maxlength="60"><label>العملة</label><select name="currency">${currencyOptions('USD')}</select></div>
        <p class="hint">الرمز وحده لا يكفي: نفس الرمز قد يوجد في أكثر من سوق، لذا يُحفظ مع السوق.</p></div>
      <div id="tQty"><div class="grid2"><div><label id="tQL">عدد الأسهم</label><input name="qty" inputmode="decimal"></div><div id="tPr"><label>السعر للسهم</label><input name="price" inputmode="decimal"></div></div>
        <div id="tFe"><label>العمولة والرسوم</label><input name="fees" inputmode="decimal" placeholder="0"></div></div>
      <div id="tAm" hidden><label>مبلغ التوزيع (صافي)</label><input name="amount" inputmode="decimal"></div>
      <div id="tRa" hidden><label>نسبة التقسيم (2 = كل سهم يصبح سهمين، 0.5 = دمج)</label><input name="ratio" inputmode="decimal"></div>
      <div id="tTo" hidden><label>إلى محفظة</label><select name="toPortfolioId">${w.portfolios.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div id="tAcc"><label id="tAL">الحساب</label><select name="accountId">${accOpts('', { none: 'بدون — عملية تاريخية أو من خارج حساباتي' })}</select>
        <div id="tCash" hidden><label id="tCL"></label><input name="cash" inputmode="decimal"></div></div>
      <label>التاريخ</label><input type="date" name="date" value="${C.today()}"><label>ملاحظة</label><input name="note" maxlength="200">
      <div class="hint" id="tH"></div>`, {
      submit: 'تسجيل العملية',
      onReady: (b, form) => setPick(form, 'type', pre.type || 'buy'),
      onChange: (form) => {
        const ty = form.elements.type.value, isNew = form.elements.securityId.value === '__new';
        $('tNew').hidden = !isNew || ty !== 'buy'; $('tMk').hidden = form.elements.exchange.value !== 'OTHER';
        $('tQty').hidden = !['buy', 'sell', 'transfer'].includes(ty); $('tPr').hidden = $('tFe').hidden = ty === 'transfer';
        $('tAm').hidden = ty !== 'dividend'; $('tRa').hidden = ty !== 'split'; $('tTo').hidden = ty !== 'transfer';
        $('tAcc').hidden = !['buy', 'sell', 'dividend'].includes(ty);
        $('tAL').textContent = ty === 'buy' ? 'دُفع من حساب' : 'استُلم في حساب';
        const sec = isNew ? { currency: form.elements.exchange.value === 'OTHER' ? form.elements.currency.value : Wm.EXCHANGES[form.elements.exchange.value].currency } : w.securities.find((s) => s.id === form.elements.securityId.value);
        const a = acc(form.elements.accountId.value), diff = a && sec && a.currency !== sec.currency;
        $('tCash').hidden = !diff; if (diff) $('tCL').textContent = `المبلغ ${ty === 'buy' ? 'المدفوع' : 'المستلم'} فعلًا بـ ${a.currency}`;
        const q = C.parseAmount(form.elements.qty.value), pr = C.parseAmount(form.elements.price.value), fe = C.parseAmount(form.elements.fees.value) || 0;
        $('tH').textContent = ty === 'buy' && q > 0 && pr > 0 ? `الإجمالي ${plain(q * pr + fe, sec?.currency || 'SAR')} — يُخصم من الحساب مرة واحدة ولا يُحتسب مصروفًا.` : ty === 'sell' && q > 0 && pr > 0 ? `الصافي ${plain(q * pr - fe, sec?.currency || 'SAR')} — الربح المحقق يُحسب بمتوسط التكلفة.` : ty === 'dividend' ? 'التوزيعات تُحتسب دخلًا في التقارير.' : ty === 'split' ? 'التقسيم يغيّر عدد الأسهم ولا يغيّر التكلفة الإجمالية.' : '';
      },
      onSubmit: async (v) => {
        const sec0 = w.securities.find((s) => s.id === v.securityId);
        const label = `${TT[v.type]} ${sec0 ? sec0.symbol : String(v.symbol || '').toUpperCase()}${v.qty && v.type !== 'dividend' && v.type !== 'split' ? ' × ' + v.qty : ''}`;
        await commit((d) => {
          let secId = v.securityId;
          if (secId === '__new') { if (v.type !== 'buy') throw new C.ValidationError('أضف الورقة الجديدة بعملية شراء'); secId = Wm.addSecurity(d, v).id; }
          return Wm.addTrade(d, { ...v, securityId: secId });
        }, 'تم تسجيل العملية', { label });
        if (S.data.settings.twelveDataKey) setTimeout(() => refreshPrices(false), 300);
      },
    });
  }
  function holdingOpen(pfId, secId) {
    const w = S.data.wealth, sec = w.securities.find((s) => s.id === secId), pf = w.portfolios.find((p) => p.id === pfId); if (!sec) return;
    const r = Wm.securitiesSummary(S.data, S.rates).rows.find((x) => x.portfolioId === pfId && x.securityId === secId);
    const trades = w.trades.filter((t) => t.securityId === secId && (t.portfolioId === pfId || t.toPortfolioId === pfId)).sort((a, b) => b.date.localeCompare(a.date));
    const err = S.data.market?.quoteErrors?.[secId], cur = sec.currency;
    sheet(`${sec.symbol} — ${sec.name}`, `
      <p class="muted">${esc(Wm.EXCHANGES[sec.exchange]?.name || sec.market)} · ${esc(Wm.SECURITY_KINDS[sec.kind])} · ${esc(cur)} · ${esc(pf?.name || '')}</p>
      <div class="kpis"><div><small>الكمية</small><b>${+(r?.qty || 0).toFixed(6)}</b></div><div><small>متوسط التكلفة</small><b>${money(r?.avg || 0, cur)}</b></div><div><small>القيمة</small><b>${r?.value !== null && r ? money(r.value, cur) : '—'}</b></div></div>
      <div class="kpis" style="margin-top:8px"><div><small>غير محقق</small><b>${gl(r?.unrealized ?? null, cur)}</b></div><div><small>محقق</small><b>${gl(r?.realized || 0, cur)}</b></div><div><small>توزيعات</small><b>${money(r?.dividends || 0, cur)}</b></div></div>
      <p class="hint">${r?.quote ? `السعر ${plain(r.quote.price, cur)} — ${r.quote.kind === 'manual' ? `تقييم يدوي بتاريخ ${esc(r.quote.date)}` : `من ${esc(r.quote.source)} بتاريخ ${esc(r.quote.date || '')} (قد يكون متأخرًا)`}` : 'لا يوجد سعر لهذه الورقة.'}${err ? `<br><span class="bad">آخر محاولة تحديث: ${esc(err.message)}</span>` : ''}</p>
      <div class="actions"><button class="btn primary" data-action="trade-add" data-type="buy" data-pf="${esc(pfId)}" data-id="${esc(secId)}">شراء</button>${r?.qty > 0 ? `<button class="btn" data-action="trade-add" data-type="sell" data-pf="${esc(pfId)}" data-id="${esc(secId)}">بيع</button><button class="btn" data-action="trade-add" data-type="dividend" data-pf="${esc(pfId)}" data-id="${esc(secId)}">توزيع</button><button class="btn" data-action="trade-add" data-type="split" data-pf="${esc(pfId)}" data-id="${esc(secId)}">تقسيم</button><button class="btn" data-action="trade-add" data-type="transfer" data-pf="${esc(pfId)}" data-id="${esc(secId)}">تحويل</button>` : ''}<button class="btn" data-action="manual-price" data-id="${esc(secId)}">سعر يدوي</button></div>
      <h3 style="margin-top:14px">العمليات</h3><ul class="list">${trades.map((t) => `<li class="item"><div class="body"><div class="title">${TT[t.type]}${t.type === 'transfer' ? (t.portfolioId === pfId ? ' (صادر)' : ' (وارد)') : ''} ${t.qty ? '× ' + t.qty : ''}${t.price ? ' @ ' + plain(t.price, cur) : ''}${t.amount ? ' ' + plain(t.amount, cur) : ''}${t.ratio ? ' نسبة ' + t.ratio : ''}</div><div class="sub">${esc(t.date)}${t.fees ? ' · عمولة ' + plain(t.fees, cur) : ''}${t.accountId ? ' · ' + esc(acc(t.accountId)?.name || '') : ''}</div></div><button class="btn small ghost-danger" data-action="trade-delete" data-id="${esc(t.id)}" data-pf="${esc(pfId)}" data-sec="${esc(secId)}">حذف</button></li>`).join('')}</ul>`);
  }
  function manualPrice(id) {
    const sec = S.data.wealth.securities.find((s) => s.id === id); if (!sec) return;
    sheet(`سعر يدوي — ${sec.symbol}`, `<p class="hint">للأسهم التي لا يتوفر لها سعر إلكتروني. يُعرض دائمًا كـ«تقييم يدوي» مع تاريخه، ولا يُعرض كسعر مباشر.</p>
      <label>السعر للسهم (${esc(sec.currency)})</label><input name="price" inputmode="decimal" value="${esc(sec.manualPrice?.price || '')}">
      <label>تاريخ السعر</label><input type="date" name="date" value="${esc(sec.manualPrice?.date || C.today())}"><label>المصدر/ملاحظة</label><input name="note" maxlength="120" value="${esc(sec.manualPrice?.note || '')}" placeholder="تطبيق الوسيط، موقع تداول…">`, {
      onSubmit: (v) => commit((d) => Wm.setManualPrice(d, id, v), 'تم حفظ السعر', { label: `سعر يدوي ${sec.symbol}` }),
    });
  }
  function stockSource() {
    const key = S.data.settings.twelveDataKey || '';
    sheet('مصدر أسعار الأسهم', `
      <p class="muted" style="font-size:14px;line-height:1.8">فلوسي لا يحتوي مفتاحًا مشتركًا (لا مفاتيح سرية في الكود). يمكنك استخدام حسابك المجاني في <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer">Twelve Data</a> وإدخال مفتاحك هنا؛ يُحفظ داخل بياناتك على هذا الجهاز (مشفرًا عند تفعيل القفل) ولا يُرسل إلا إلى Twelve Data.</p>
      <div class="notice" style="font-size:13px">قيود معروفة (أكتوبر 2026): الخطة المجانية 8 طلبات/دقيقة و800/يوم، وتشمل الأسهم الأمريكية، وترخيصها للاستخدام الداخلي. <b>السوق السعودي (XSAU) يتطلب خطة Pro مدفوعة</b> وبيانات نهاية اليوم — للأسهم السعودية استخدم «سعر يدوي» من تطبيق الوسيط.</div>
      <label>مفتاح Twelve Data (اختياري)</label><input name="key" type="password" autocomplete="off" dir="ltr" value="${esc(key)}" placeholder="اتركه فارغًا لإيقاف التحديث التلقائي">`, {
      onSubmit: async (v) => { await commit((d) => { d.settings.twelveDataKey = String(v.key || '').trim().slice(0, 80); }, v.key ? 'تم حفظ المفتاح' : 'تم إيقاف التحديث التلقائي', { history: false }); if (v.key) refreshPrices(true); },
    });
  }

  // ---------- الاستثمارات الأخرى ----------
  function renderInvestments() {
    const cur = disp(), s = Wm.investmentsSummary(S.data, S.rates);
    $('v-investments').innerHTML = `${head('استثمارات أخرى', 'wealth')}
      <div class="card"><div class="kpis"><div><small>القيمة</small><b>${money(s.fundsValue + s.otherValue, cur)}</b></div><div><small>غير محقق</small><b>${gl(s.unrealized, cur)}</b></div><div><small>أرباح موزعة</small><b>${money(s.realized, cur)}</b></div></div>
        ${s.estimated ? `<p class="hint">${s.estimated} استثمار بلا تقييم — قيمته المعروضة = رأس المال القائم (تقديرية، ليست سعرًا سوقيًا).</p>` : ''}</div>
      <button class="btn primary block" data-action="inv-add">إضافة استثمار</button>
      <div class="card">${s.rows.length ? `<ul class="list">${s.rows.map((r) => `<li><button class="item" data-action="inv-open" data-id="${esc(r.inv.id)}"><div class="body"><div class="title">${esc(r.inv.name)} ${r.inv.archived ? '<span class="tag">مؤرشف</span>' : ''}${r.estimated ? '<span class="tag warn">تقديري</span>' : ''}</div><div class="sub">${esc(Wm.INVEST_KINDS[r.inv.kind])}${r.inv.platform ? ' · ' + esc(r.inv.platform) : ''}${r.inv.ownership ? ` · ملكية ${r.inv.ownership}%` : ''}${r.valuation ? ' · تقييم ' + esc(r.valuation.date) : ''}</div></div><div class="amt">${money(r.value, r.inv.currency)}<small>${gl(r.totalReturn, r.inv.currency)}</small></div></button></li>`).join('')}</ul>` : '<div class="empty">صناديق، مشاريع خاصة، شراكات، عقارات استثمارية…</div>'}</div>`;
  }
  function invForm(id) {
    const inv = id ? S.data.wealth.investments.find((x) => x.id === id) : null;
    sheet(inv ? 'تعديل الاستثمار' : 'استثمار جديد', `
      <label>الاسم</label><input name="name" required maxlength="90" value="${esc(inv?.name || '')}">
      <div class="grid2"><div><label>النوع</label><select name="kind">${Object.entries(Wm.INVEST_KINDS).map(([k, v]) => `<option value="${k}"${inv?.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div><div><label>الجهة أو المنصة</label><input name="platform" maxlength="90" value="${esc(inv?.platform || '')}"></div></div>
      <div class="grid2"><div><label>نسبة الملكية % (اختياري)</label><input name="ownership" inputmode="decimal" value="${esc(inv?.ownership ?? '')}"></div>${inv ? '' : `<div><label>العملة</label><select name="currency">${currencyOptions(disp())}</select></div>`}</div>
      ${inv ? '' : `<div class="grid2"><div><label>رأس المال</label><input name="capital" inputmode="decimal"></div><div><label>تاريخ البداية</label><input type="date" name="start" value="${C.today()}"></div></div>
        <label>دُفع من حساب</label><select name="accountId">${accOpts('', { none: 'بدون — رأس مال سابق أو من خارج حساباتي' })}</select><div id="iCash" hidden><label id="iCL"></label><input name="cash" inputmode="decimal"></div>
        <div class="grid2"><div><label>القيمة الحالية (اختياري)</label><input name="value" inputmode="decimal"></div><div><label>تاريخ التقييم</label><input type="date" name="valueDate" value="${C.today()}"></div></div>
        <p class="hint">إن لم يوجد سعر سوقي: أدخل تقييمًا تحدده أنت مع تاريخه ومصدره (تقرير الصندوق، اتفاق الشركاء…). يُعرض دائمًا كتقييم وليس سعرًا مباشرًا.</p>`}
      <label>ملاحظات</label><input name="note" maxlength="300" value="${esc(inv?.note || '')}">`, {
      onChange: (form) => { if (inv) return; const a = acc(form.elements.accountId.value), diff = a && a.currency !== form.elements.currency.value; $('iCash').hidden = !diff; if (diff) $('iCL').textContent = `المبلغ المدفوع فعلًا بـ ${a.currency}`; },
      onSubmit: (v) => commit((d) => (inv ? Wm.updateInvestment(d, inv.id, v) : Wm.addInvestment(d, v)), 'تم الحفظ', { label: inv ? `تعديل استثمار «${inv.name}»` : `استثمار جديد «${v.name}»` }),
    });
  }
  function invOpen(id) {
    const inv = S.data.wealth.investments.find((x) => x.id === id); if (!inv) return;
    const st = Wm.investmentStats(inv), cur = inv.currency;
    sheet(inv.name, `
      <div class="kpis"><div><small>القيمة ${st.estimated ? '(تقديرية)' : ''}</small><b>${money(st.value, cur)}</b></div><div><small>رأس المال القائم</small><b>${money(st.capital, cur)}</b></div><div><small>العائد الكلي</small><b>${gl(st.totalReturn, cur)}</b></div></div>
      <div class="kpis" style="margin-top:8px"><div><small>المساهمات</small><b>${money(st.contributed, cur)}</b></div><div><small>أرباح موزعة</small><b>${money(st.distributed, cur)}</b></div><div><small>رسوم</small><b>${money(st.fees, cur)}</b></div></div>
      <p class="hint">${st.valuation ? `آخر تقييم ${plain(st.valuation.amount, cur)} بتاريخ ${esc(st.valuation.date)}${st.valuation.note ? ' — ' + esc(st.valuation.note) : ''} (تقييم يحدده المستخدم، ليس سعرًا مباشرًا).` : 'لا يوجد تقييم بعد — القيمة = رأس المال القائم.'}</p>
      ${ctx.attachList ? ctx.attachList('investment', inv.id) : ''}
      <div class="actions"><button class="btn primary" data-action="inv-event" data-id="${esc(inv.id)}">حركة / تقييم</button><button class="btn" data-action="inv-edit" data-id="${esc(inv.id)}">تعديل</button><button class="btn" data-action="inv-archive" data-id="${esc(inv.id)}">${inv.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</button></div>
      <h3 style="margin-top:14px">السجل</h3><ul class="list">${[...inv.events].sort((a, b) => b.date.localeCompare(a.date)).map((e) => `<li class="item"><div class="body"><div class="title">${esc(Wm.INVEST_EVENTS[e.type])} ${plain(e.amount, cur)}</div><div class="sub">${esc(e.date)}${e.accountId ? ' · ' + esc(acc(e.accountId)?.name || '') : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div><button class="btn small ghost-danger" data-action="inv-event-del" data-id="${esc(inv.id)}" data-eid="${esc(e.id)}">حذف</button></li>`).join('') || '<li class="empty">لا حركات</li>'}</ul>
      <div class="actions"><button class="btn small ghost-danger" data-action="inv-delete" data-id="${esc(inv.id)}">حذف الاستثمار…</button></div>`);
  }
  function invEvent(id) {
    const inv = S.data.wealth.investments.find((x) => x.id === id); if (!inv) return;
    sheet(`حركة — ${inv.name}`, `<div class="seg seg-wrap">${Object.entries(Wm.INVEST_EVENTS).map(([k, l]) => pick('type', k, l)).join('')}</div><input type="hidden" name="type" value="valuation">
      <label id="ieL">القيمة (${esc(inv.currency)})</label><input name="amount" class="amount-input" inputmode="decimal" required>
      <div id="ieAcc" hidden><label>الحساب</label><select name="accountId">${accOpts('', { none: 'بدون — خارج حساباتي في فلوسي' })}</select><div id="ieCash" hidden><label id="ieCL"></label><input name="cash" inputmode="decimal"></div></div>
      <label>التاريخ</label><input type="date" name="date" value="${C.today()}"><label>ملاحظة / مصدر التقييم</label><input name="note" maxlength="200">
      <p class="hint" id="ieH"></p>`, {
      onReady: (b, form) => setPick(form, 'type', 'valuation'),
      onChange: (form) => {
        const ty = form.elements.type.value; $('ieAcc').hidden = ty === 'valuation';
        $('ieL').textContent = ty === 'valuation' ? `القيمة الحالية (${inv.currency})` : `المبلغ (${inv.currency})`;
        const a = acc(form.elements.accountId.value), diff = a && a.currency !== inv.currency; $('ieCash').hidden = !diff || ty === 'valuation'; if (diff) $('ieCL').textContent = `المبلغ الفعلي بـ ${a.currency}`;
        $('ieH').textContent = { valuation: 'تقييم موثق بتاريخه — لا يحرك أي حساب.', contribution: 'أموال جديدة تضاف للاستثمار (يُخصم من الحساب، لا يُحتسب مصروفًا).', withdrawal: 'استرداد جزء من رأس المال (يدخل الحساب، لا يُحتسب دخلًا).', distribution: 'أرباح مستلمة — تُحتسب دخلًا.', fee: 'رسوم إدارة أو غيرها.' }[ty];
      },
      onSubmit: async (v) => { await commit((d) => Wm.addInvestmentEvent(d, id, v), 'تم الحفظ', { label: `${Wm.INVEST_EVENTS[v.type]} — «${inv.name}»` }); invOpen(id); return false; },
    });
  }
  async function invDelete(id) {
    const inv = S.data.wealth.investments.find((x) => x.id === id); if (!inv) return;
    const linked = inv.events.filter((e) => e.txId).length;
    if (!linked) { if (await confirmBox({ title: 'حذف الاستثمار؟', text: 'ليس له حركات على حساباتك. يمكنك التراجع.', ok: 'حذف', danger: true })) { await commit((d) => Wm.deleteInvestment(d, id), 'تم الحذف', { label: `حذف استثمار «${inv.name}»` }); closeSheet(); } return; }
    sheet(`حذف «${inv.name}»`, `<div class="notice">له ${linked} حركة على حساباتك.</div><button class="btn primary block" data-action="inv-archive" data-id="${esc(id)}">أرشفة بدل الحذف (موصى به)</button>
      <button class="btn block" id="idKeep" style="margin-top:10px">حذف وإبقاء الحركات والأرصدة</button><button class="btn ghost-danger block" id="idRev" style="margin-top:10px">حذف مع عكس الحركات</button>`);
    $('idKeep').onclick = async () => { await commit((d) => Wm.deleteInvestment(d, id, { mode: 'keep' }), 'تم الحذف', { label: `حذف استثمار «${inv.name}»` }); closeSheet(); };
    $('idRev').onclick = async () => { if (!(await confirmBox({ title: 'عكس الحركات؟', text: 'ستعود الأرصدة كما كانت قبل حركات هذا الاستثمار.', ok: 'حذف وعكس', danger: true }))) return; await commit((d) => Wm.deleteInvestment(d, id, { mode: 'reverse' }), 'تم الحذف', { label: `حذف استثمار «${inv.name}» مع حركاته`, snapshot: 'pre-fix' }); closeSheet(); };
  }

  // ---------- الأداء الاستثماري ----------
  const TYPE_L = { gold: 'الذهب', stocks: 'الأسهم', funds: 'الصناديق', other: 'استثمارات أخرى' };
  function renderPerformance() {
    const cur = disp(), p = Wm.performance(S.data, S.rates);
    const y = C.today().slice(0, 4), fl = Wm.investmentFlows(S.data, C.yearRange(y), S.rates);
    const table = (m, lab) => Object.keys(m).length ? `<ul class="list">${Object.entries(m).map(([k, v]) => `<li class="item"><div class="body"><div class="title">${esc(lab ? lab[k] || k : k)}</div><div class="sub">القيمة ${plain(v.value, cur)} · التكلفة ${plain(v.cost, cur)} · محقق ${plain(v.realized, cur)}</div></div><div class="amt">${gl(v.gain, cur)}<small>${v.cost ? pct(v.gain, v.cost) : ''}</small></div></li>`).join('')}</ul>` : '<div class="empty">لا بيانات</div>';
    $('v-performance').innerHTML = `${head('الأداء الاستثماري', 'wealth')}
      <div class="card"><div class="kpis"><div><small>إجمالي المستثمر</small><b>${money(p.invested, cur)}</b></div><div><small>القيمة الحالية</small><b>${money(p.marketValue, cur)}</b></div></div>
        <div class="kpis" style="margin-top:8px"><div><small>محقق</small><b>${gl(p.realized, cur)}</b></div><div><small>غير محقق</small><b>${gl(p.unrealized, cur)}</b></div><div><small>توزيعات</small><b>${money(p.dividends, cur)}</b></div><div><small>رسوم</small><b>${money(p.fees, cur)}</b></div></div>
        ${p.notes.length ? `<p class="hint">${p.notes.map(esc).join(' ')}</p>` : ''}</div>
      <div class="card"><h3>أموال جديدة مقابل نمو القيمة (${y})</h3><p class="hint" style="margin-top:0">حتى لا يبدو إيداع مال جديد كأنه ربح.</p><div class="kpis"><div><small>أموال جديدة استُثمرت</small><b>${money(fl.newMoney, cur)}</b></div><div><small>أموال سُحبت/بيعت</small><b>${money(fl.withdrawn, cur)}</b></div></div></div>
      <div class="card"><h3>حسب نوع الأصل</h3>${table(p.byType, TYPE_L)}</div>
      <div class="card"><h3>حسب الوسيط</h3>${table(p.byBroker)}</div>
      <div class="card"><h3>حسب العملة</h3>${table(p.byCurrency)}</div>
      <div class="card"><div class="card-head"><h3 style="margin:0">سجل الرسوم والضرائب والالتزامات</h3><button class="link-btn" data-action="liab-add">+ إضافة</button></div>
        ${S.data.wealth.liabilities.length ? `<ul class="list">${[...S.data.wealth.liabilities].sort((a, b) => b.date.localeCompare(a.date)).map((e) => `<li class="item"><div class="body"><div class="title">${esc(e.note)} <span class="tag">${esc(Wm.LIABILITY_KINDS[e.kind])}</span>${e.paid ? '' : ' <span class="tag warn">غير مدفوع</span>'}</div><div class="sub">${esc(e.date)}${e.due ? ' · يستحق ' + esc(e.due) : ''}</div></div><div class="amt">${money(e.amount, e.currency)}</div><button class="btn small ghost-danger" data-action="liab-del" data-id="${esc(e.id)}">حذف</button></li>`).join('')}</ul>` : '<p class="hint">للتوثيق فقط: رسوم حفظ، ضرائب أرباح أجنبية، زكاة مدفوعة… لا يحرك أي حساب ولا يُعد حسابًا ضريبيًا رسميًا.</p>'}</div>`;
  }
  function liabForm() {
    sheet('رسوم / ضريبة / التزام', `<label>النوع</label><select name="kind">${Object.entries(Wm.LIABILITY_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>الوصف</label><input name="note" required maxlength="200" placeholder="ضريبة توزيعات أمريكية 15%…">
      <div class="grid2" style="grid-template-columns:2fr 1fr"><div><label>المبلغ</label><input name="amount" inputmode="decimal" required></div><div><label>العملة</label><select name="currency">${currencyOptions(disp())}</select></div></div>
      <div class="grid2"><div><label>التاريخ</label><input type="date" name="date" value="${C.today()}"></div><div><label>الاستحقاق (اختياري)</label><input type="date" name="due"></div></div>
      <label class="check"><input type="checkbox" name="paid" value="yes" checked> مدفوع</label>
      <p class="hint">توثيقي فقط: لا يخصم من أي حساب. إن دفعته من حساب فسجّله أيضًا كمصروف.</p>`, {
      onSubmit: (v) => commit((d) => Wm.addInvestLiability(d, v), 'تمت الإضافة', { label: `سجل: ${v.note}` }),
    });
  }

  // ---------- الزكاة ----------
  function renderZakat() {
    const o = { ...Wm.ZAKAT_DEFAULTS, ...(S.data.settings.zakat || {}), silverUsdPerOz: S.data.market?.silver?.usdPerOz || null };
    const z = Wm.zakatEstimate(S.data, o, S.rates), cur = disp();
    const sel = (name, opts) => `<select data-zk="${name}">${opts.map(([v, l]) => `<option value="${v}"${String(o[name]) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    $('v-zakat').innerHTML = `${head('حاسبة الزكاة (تقديرية)', 'wealth')}
      <div class="notice"><b>تقدير للمساعدة فقط وليس فتوى.</b> أحكام الزكاة تختلف بحسب نوع الأصل والغرض من امتلاكه والمذهب. راجع الحساب يدويًا واستشر جهة شرعية موثوقة.</div>
      <div class="card"><div class="kpis"><div><small>الوعاء الزكوي</small><b>${money(z.base, cur)}</b></div><div><small>النصاب (${z.nisabBasis === 'gold' ? '85 غ ذهب' : '595 غ فضة'})</small><b>${z.nisab === null ? '—' : money(z.nisab, cur)}</b></div><div><small>الزكاة التقديرية</small><b class="good">${money(z.due, cur)}</b></div></div>
        <p class="hint" style="margin-bottom:0">${z.nisab === null ? 'لا يتوفر سعر الذهب/الفضة لحساب النصاب — حدّث الأسعار.' : z.reached ? `بلغ النصاب. النسبة ${z.rate}%.` : 'لم يبلغ النصاب.'} ${o.hawlDate ? (z.hawlDone ? `اكتمل الحول (بدأ ${esc(o.hawlDate)}).` : `يكتمل الحول في ${esc(z.hawlEnds)} تقريبًا (سنة هجرية ≈ 354 يومًا).`) : 'حدد تاريخ بداية الحول.'}${z.deducted ? ` خُصمت ديون ${plain(z.deducted, cur)}.` : ''}</p></div>
      <div class="card"><h3>الإعدادات</h3>
        <label>بداية الحول</label><input type="date" data-zk="hawlDate" value="${esc(o.hawlDate || '')}">
        <label>أساس النصاب</label>${sel('nisabBasis', [['gold', 'الذهب (85 غ)'], ['silver', 'الفضة (595 غ)']])}
        <label>الذهب المستعمل للزينة (مشغولات)</label>${sel('jewelry', [['exclude', 'لا يُزكى (رأي الجمهور)'], ['include', 'يُزكى (رأي الحنفية)']])}
        <label>الأسهم</label>${sel('stocks', [['market', 'للمتاجرة: كامل القيمة السوقية'], ['ratio', 'للاستثمار الطويل: نسبة الأصول الزكوية'], ['exclude', 'لا أُزكيها (تُخرج الشركة الزكاة)']])}
        <div ${o.stocks === 'ratio' ? '' : 'hidden'}><label>نسبة الأصول الزكوية التقريبية %</label><input data-zk="stocksRatio" inputmode="decimal" value="${esc(o.stocksRatio)}"></div>
        <label>الصناديق</label>${sel('funds', [['market', 'كامل القيمة'], ['ratio', 'نفس نسبة الأسهم'], ['exclude', 'مستثناة']])}
        <label>الاستثمارات الأخرى (مشاريع، عقار…)</label>${sel('investments', [['value', 'بالقيمة (عروض تجارة)'], ['profits', 'الأرباح فقط'], ['exclude', 'مستثناة (أصول غير معدة للبيع)']])}
        <label>الديون التي لك</label>${sel('receivables', [['strong', 'تُزكى (مرجوة السداد)'], ['none', 'لا تُزكى (متعثرة)']])}
        <label>الديون التي عليك</label>${sel('debts', [['due', 'تُخصم المستحقة خلال سنة'], ['all', 'تُخصم كلها'], ['none', 'لا تُخصم']])}</div>
      <div class="card"><h3>تفصيل الحساب</h3><ul class="list">${z.lines.map((l) => `<li class="item"><div class="body"><div class="title">${esc(l.label)} ${l.included ? '' : '<span class="tag">غير محسوب</span>'}</div><div class="sub" style="white-space:normal">${esc(l.note)}</div></div><div class="amt">${money(l.amount, cur)}</div></li>`).join('') || '<li class="empty">لا أصول</li>'}</ul></div>`;
    $('v-zakat').querySelectorAll('[data-zk]').forEach((el) => (el.onchange = () => {
      const z2 = { ...(S.data.settings.zakat || {}) }; z2[el.dataset.zk] = el.type === 'date' ? el.value : el.dataset.zk === 'stocksRatio' ? Math.min(100, Math.max(0, C.parseAmount(el.value) || 0)) : el.value;
      commit((d) => { d.settings.zakat = z2; }, null, { history: false }).then(renderZakat);
    }));
  }

  return {
    views: { wealth: renderWealth, gold: renderGold, stocks: renderStocks, investments: renderInvestments, performance: renderPerformance, zakat: renderZakat },
    nav: { wealth: 'wealth', gold: 'wealth', stocks: 'wealth', investments: 'wealth', performance: 'wealth', zakat: 'wealth' },
    actions: {
      'refresh-prices': () => refreshPrices(true),
      'wealth-debts': (b) => { S.debtTab = b.dataset.type; go('debts'); },
      'gold-add': () => goldForm(), 'gold-open': (b, id) => goldOpen(id), 'gold-edit': (b, id) => goldForm(id), 'gold-sell': (b, id) => goldSell(id), 'gold-delete': (b, id) => goldDelete(id),
      'gold-cancel-sale': async (b, id) => {
        const s = S.data.wealth.gold.sales.find((x) => x.id === id); if (!s) return;
        if (!(await confirmBox({ title: 'إلغاء البيع؟', text: `يعود ${s.grams} غ للقطعة${s.txId ? `، وتُحذف حركة المتحصل (${plain(s.net, s.currency)}) من «${acc(s.accountId)?.name || ''}»` : ''}. يمكنك التراجع.`, ok: 'إلغاء البيع', cancel: 'رجوع', danger: true }))) return;
        await commit((d) => Wm.cancelGoldSale(d, id), 'أُلغي البيع', { label: `إلغاء بيع ${s.grams}غ ذهب` }); goldOpen(s.lotId);
      },
      'portfolio-add': () => portfolioForm(), 'portfolio-edit': (b, id) => portfolioForm(id),
      'trade-add': (b, id) => tradeForm({ type: b.dataset.type, portfolioId: b.dataset.pf, securityId: id }),
      'holding-open': (b, id) => holdingOpen(b.dataset.pf, id),
      'trade-delete': async (b, id) => {
        const t = S.data.wealth.trades.find((x) => x.id === id); if (!t) return;
        if (!(await confirmBox({ title: 'حذف العملية؟', text: `${t.txId ? 'ستُحذف حركتها النقدية المرتبطة ويتحدث رصيد الحساب. ' : ''}تُرفض إن كانت عمليات لاحقة تعتمد عليها. يمكنك التراجع.`, ok: 'حذف', danger: true }))) return;
        await commit((d) => Wm.deleteTrade(d, id), 'تم الحذف', { label: `حذف عملية ${TT[t.type]}` }); holdingOpen(b.dataset.pf, b.dataset.sec);
      },
      'manual-price': (b, id) => manualPrice(id), 'stock-source': () => stockSource(),
      'liab-add': () => liabForm(), 'liab-del': async (b, id) => { if (await confirmBox({ title: 'حذف الإدخال؟', text: 'يمكنك التراجع.', ok: 'حذف', danger: true })) await commit((d) => Wm.deleteInvestLiability(d, id), 'تم الحذف', { label: 'حذف إدخال من سجل الرسوم' }); },
      'inv-add': () => invForm(), 'inv-open': (b, id) => invOpen(id), 'inv-edit': (b, id) => invForm(id), 'inv-event': (b, id) => invEvent(id), 'inv-delete': (b, id) => invDelete(id),
      'inv-archive': async (b, id) => { const inv = S.data.wealth.investments.find((x) => x.id === id); await commit((d) => Wm.updateInvestment(d, id, { ...inv, archived: !inv.archived }), inv.archived ? 'أُلغيت الأرشفة' : 'تمت الأرشفة', { label: `${inv.archived ? 'إلغاء أرشفة' : 'أرشفة'} «${inv.name}»` }); invOpen(id); },
      'inv-event-del': async (b, id) => { if (!(await confirmBox({ title: 'حذف الحركة؟', text: 'تُحذف حركتها النقدية المرتبطة إن وجدت. يمكنك التراجع.', ok: 'حذف', danger: true }))) return; await commit((d) => Wm.deleteInvestmentEvent(d, id, b.dataset.eid), 'تم الحذف', { label: 'حذف حركة استثمار' }); invOpen(id); },
    },
  };
}
