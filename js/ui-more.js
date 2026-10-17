// فلوسي 4.0 — البحث الشامل، التنبيهات، الأهداف، العمليات المجدولة، المرفقات، وبطاقات التقارير.
import * as AL from './alerts.js';

export function register(ctx) {
  const { S, $, esc, money, plain, toast, sheet, closeSheet, confirmBox, commit, go, head, acc, dt, C, Store, pick, setPick, currencyOptions, accountOptions, icon } = ctx;
  const disp = () => S.data.settings.displayCurrency;

  // ---------- المرفقات ----------
  const ATT_KINDS = { gold: 'ذهب', investment: 'استثمار', tx: 'عملية', account: 'حساب', obligation: 'دين', trade: 'عملية استثمار' };
  const MAX = 12 * 1048576;
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type) || file.size < 450000) return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || 'application/octet-stream' };
    try {
      const bmp = await createImageBitmap(file), k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg' };
    } catch { return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }; }
  }
  ctx.attachList = (kind, refId) => {
    const list = (S.data.attachments || []).filter((a) => a.ref?.kind === kind && a.ref?.id === refId);
    return `<div class="att"><div class="card-head" style="margin:10px 0 4px"><h3 style="margin:0">المرفقات</h3><button type="button" class="link-btn" data-action="att-add" data-kind="${kind}" data-id="${esc(refId)}">+ إرفاق ملف</button></div>
      ${list.length ? `<ul class="list">${list.map((a) => `<li class="item"><div class="body"><div class="title">${esc(a.name)}</div><div class="sub">${esc(dt(a.created))} · ${(a.size / 1024).toFixed(0)} ك.ب${S.session ? ' · مشفر' : ''}</div></div><button type="button" class="btn small" data-action="att-view" data-id="${esc(a.id)}">عرض</button><button type="button" class="btn small ghost-danger" data-action="att-del" data-id="${esc(a.id)}">إزالة</button></li>`).join('')}</ul>` : '<p class="hint" style="margin:0">فاتورة، إيصال تحويل، كشف بنك… تُحفظ على هذا الجهاز فقط ولا تُرفع لأي خدمة.</p>'}</div>`;
  };
  function attAdd(kind, refId, back) {
    sheet('إرفاق ملف', `<p class="hint">صورة أو PDF حتى 12 م.ب. الصور الكبيرة تُصغّر. ${S.session ? 'يُشفَّر الملف بمفتاح قفلك.' : 'فعّل القفل لتشفير المرفقات.'}</p>
      <input type="file" id="attFile" accept="image/*,application/pdf" required><label>اسم المرفق</label><input name="name" maxlength="80" placeholder="فاتورة الشراء">`, {
      submit: 'حفظ المرفق',
      onSubmit: async (v) => {
        const f = $('attFile').files[0]; if (!f) throw new C.ValidationError('اختر ملفًا');
        if (f.size > MAX * 2) throw new C.ValidationError('الملف كبير جدًا');
        const { bytes, type } = await shrinkImage(f);
        if (bytes.length > MAX) throw new C.ValidationError('الملف أكبر من 12 م.ب بعد الضغط');
        const id = C.uid();
        await Store.putAttachment(id, bytes, type, S.session);
        await commit((d) => { (d.attachments ||= []).push({ id, name: C.H.text(v.name, 80) || f.name.slice(0, 80), type, size: bytes.length, created: new Date().toISOString(), ref: { kind, id: refId } }); }, 'تم حفظ المرفق', { label: `إرفاق ملف (${ATT_KINDS[kind] || kind})` });
        back?.();
        return false;
      },
    });
  }
  async function attView(id) {
    const meta = (S.data.attachments || []).find((a) => a.id === id); if (!meta) return;
    const f = await Store.getAttachment(id, S.session);
    if (!f?.bytes) return toast('تعذر فتح المرفق على هذا الجهاز', true);
    const url = URL.createObjectURL(new Blob([f.bytes], { type: f.type }));
    const isImg = /^image\//.test(f.type);
    const d = ctx.modal(`<h2>${esc(meta.name)}</h2>${isImg ? `<img src="${url}" alt="" style="max-width:100%;border-radius:12px">` : '<p class="muted">ملف PDF</p>'}<div class="actions end"><a class="btn" href="${url}" download="${esc(meta.name)}${isImg ? '.jpg' : '.pdf'}">تنزيل</a><button class="btn primary" data-r="1">إغلاق</button></div>`);
    $('modalBody').querySelector('[data-r]').onclick = () => { d.close(); URL.revokeObjectURL(url); };
  }

  // ---------- البحث الشامل ----------
  const KIND_L = { account: 'حساب', tx: 'عملية', transfer: 'تحويل', obligation: 'دين', project: 'عميل/مشروع', goal: 'هدف', recurring: 'مجدول', gold: 'ذهب', security: 'سهم/صندوق', investment: 'استثمار' };
  const OPEN = { tx: 'open-tx', transfer: 'open-transfer', obligation: 'open-ob', project: 'open-project', goal: 'open-goal', gold: 'gold-open', investment: 'inv-open' };
  S.srch ||= { q: '', kind: '', accountId: '', currency: '', from: '', to: '', min: '', max: '' };
  function renderSearch() {
    const f = S.srch, res = f.q || f.kind || f.accountId || f.currency || f.from || f.to || f.min || f.max ? C.globalSearch(S.data, f.q, f) : [];
    const curs = [...new Set([...S.data.accounts.map((a) => a.currency), ...S.data.transactions.map((t) => t.currency)])];
    $('v-search').innerHTML = `${head('البحث', 'home')}
      <div class="card"><input id="srQ" type="search" placeholder="ابحث في الحسابات والحركات والديون والأشخاص والذهب والأسهم والملاحظات…" value="${esc(f.q)}" aria-label="بحث">
        <div class="filters" style="margin-top:8px"><select id="srK" aria-label="النوع"><option value="">كل الأنواع</option>${Object.entries(KIND_L).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="srA" aria-label="الحساب"><option value="">كل الحسابات</option>${S.data.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
        <select id="srC" aria-label="العملة"><option value="">كل العملات</option>${curs.map((c) => `<option>${c}</option>`).join('')}</select>
        <input id="srF" type="date" aria-label="من" value="${esc(f.from)}"><input id="srT" type="date" aria-label="إلى" value="${esc(f.to)}">
        <input id="srMin" inputmode="decimal" placeholder="أقل مبلغ" value="${esc(f.min)}" aria-label="أقل مبلغ"><input id="srMax" inputmode="decimal" placeholder="أعلى مبلغ" value="${esc(f.max)}" aria-label="أعلى مبلغ"></div></div>
      <div class="card">${res.length ? `<p class="hint" style="margin-top:0">${res.length}${res.length >= 300 ? '+' : ''} نتيجة</p><ul class="list">${res.map((r) => `<li><button class="item" ${OPEN[r.kind] ? `data-action="${OPEN[r.kind]}" data-id="${esc(r.id)}"` : r.kind === 'account' ? `data-action="statement" data-id="${esc(r.id)}"` : `data-nav-to="${r.kind === 'security' ? 'stocks' : 'recurring'}"`}><div class="body"><div class="title">${esc(r.title)} <span class="tag">${KIND_L[r.kind]}</span></div><div class="sub">${esc(r.sub || '')}${r.date ? ' · ' + esc(r.date) : ''}</div></div>${r.amount ? `<div class="amt">${money(r.dir === 'expense' ? -r.amount : r.amount, r.currency)}</div>` : ''}</button></li>`).join('')}</ul>` : `<div class="empty">${f.q ? 'لا نتائج' : 'اكتب كلمة أو اختر عامل تصفية'}</div>`}</div>`;
    $('srK').value = f.kind; $('srA').value = f.accountId; $('srC').value = f.currency;
    const upd = () => { S.srch = { q: $('srQ').value, kind: $('srK').value, accountId: $('srA').value, currency: $('srC').value, from: $('srF').value, to: $('srT').value, min: $('srMin').value, max: $('srMax').value };
      const fid = document.activeElement?.id, pos = document.activeElement?.selectionStart; renderSearch(); if (fid && $(fid)) { $(fid).focus(); try { $(fid).setSelectionRange(pos, pos); } catch {} } };
    ['srK', 'srA', 'srC', 'srF', 'srT'].forEach((id) => ($(id).onchange = upd)); ['srQ', 'srMin', 'srMax'].forEach((id) => ($(id).oninput = upd));
  }

  // ---------- التنبيهات ----------
  const notified = () => { try { return new Set(JSON.parse(localStorage.getItem('folosi_notified_v1') || '[]')); } catch { return new Set(); } };
  function alertsNow() {
    return AL.computeAlerts(S.data, { rates: S.rates, lastExport: Store.lsGet('folosi_last_export'), integrityIssues: S.integrityCount || 0, fmt: plain });
  }
  function updateBell() {
    const b = $('bellBtn'); if (!b || !S.data) return;
    const n = alertsNow().filter((a) => a.level !== 'low').length;
    b.querySelector('.badge').textContent = n || ''; b.querySelector('.badge').hidden = !n;
    b.setAttribute('aria-label', n ? `التنبيهات (${n})` : 'التنبيهات');
  }
  async function notifyNew() {
    if (!S.data?.settings.alerts?.system || !('Notification' in window) || Notification.permission !== 'granted') return;
    const seen = notified(), fresh = alertsNow().filter((a) => a.level !== 'low' && !seen.has(a.id));
    if (!fresh.length) return;
    // بلا أرقام أو أسماء في نص الإشعار — قد يظهر على شاشة القفل
    const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
    const body = fresh.length === 1 ? AL.ALERT_KINDS[fresh[0].kind] : `${fresh.length} تنبيهات جديدة`;
    try { reg ? await reg.showNotification('فلوسي', { body, tag: 'folosi-alerts', icon: './icons/icon-192.png' }) : new Notification('فلوسي', { body }); } catch {}
    for (const a of fresh) seen.add(a.id);
    try { localStorage.setItem('folosi_notified_v1', JSON.stringify([...seen].slice(-300))); } catch {}
  }
  ctx.onStart ||= [];
  ctx.onStart.push(() => {
    try { S.integrityCount = [...C.diagnose(S.data, { rates: S.rates }), ...ctx.extraDiagnostics.flatMap((fn) => fn(S.data) || [])].filter((x) => x.severity !== 'info').length; } catch {}
    updateBell(); notifyNew();
    clearInterval(S.alertTimer); S.alertTimer = setInterval(() => { if (S.data && document.visibilityState === 'visible') { updateBell(); notifyNew(); } }, 5 * 60 * 1000);
  });
  ctx.afterRender = updateBell;
  const LV = { high: ['bad', 'عاجل'], mid: ['warn', 'مهم'], low: ['', 'للعلم'] };
  function renderAlerts() {
    const list = alertsNow(), st = S.data.settings.alerts || {}, cur = disp();
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    $('v-alerts').innerHTML = `${head('التنبيهات', 'home')}
      <div class="card">${list.length ? `<ul class="list">${list.map((a) => `<li><button class="item" data-nav-to="${a.nav}"><div class="body"><div class="title">${esc(a.title)} <span class="tag ${LV[a.level][0]}">${LV[a.level][1]}</span></div><div class="sub">${esc(a.detail)}</div></div></button></li>`).join('')}</ul>` : '<div class="empty">✓ لا توجد تنبيهات</div>'}</div>
      <div class="card"><h3>تنبيهات الأسعار</h3>
        ${(S.data.priceAlerts || []).length ? `<ul class="list">${S.data.priceAlerts.map((p) => { const sec = S.data.wealth.securities.find((x) => x.id === p.securityId); return `<li class="item"><div class="body"><div class="title">${p.asset === 'gold' ? `ذهب عيار ${p.karat}` : esc(sec?.symbol || 'سهم')} ${p.op === 'above' ? '≥' : '≤'} ${p.value} ${p.asset === 'gold' ? esc(p.currency) : esc(sec?.currency || '')}</div></div><button class="btn small ghost-danger" data-action="pa-del" data-id="${esc(p.id)}">حذف</button></li>`; }).join('')}</ul>` : '<p class="hint">مثال: نبّهني إذا تجاوز سعر جرام عيار 21 مبلغًا معينًا.</p>'}
        <button class="btn small" data-action="pa-add">إضافة تنبيه سعر</button></div>
      <div class="card"><h3>الإعدادات</h3>
        ${Object.entries(AL.ALERT_KINDS).map(([k, l]) => `<label class="check"><input type="checkbox" data-al="${k}" ${st[k] === false ? '' : 'checked'}> ${l}</label>`).join('')}
        <p class="hint">«رصيد منخفض»: حدد الحد لكل حساب من صفحة الحساب.</p>
        <label class="check"><input type="checkbox" id="alSys" ${st.system && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''}> إشعارات النظام (أثناء فتح التطبيق)</label>
        <p class="hint">التنبيهات تُحسب عند فتح فلوسي وكل 5 دقائق أثناء استخدامه. <b>لا تصل والتطبيق مغلق</b>: تطبيقات الويب على الآيفون تحتاج خادم إشعارات (Push) لذلك، وفلوسي لا يرسل بياناتك لأي خادم. نص الإشعار لا يحتوي مبالغ أو أسماء.${perm === 'unsupported' ? ' هذا المتصفح لا يدعم الإشعارات (على الآيفون: ثبّت التطبيق على الشاشة الرئيسية، iOS 16.4+).' : perm === 'denied' ? ' الإشعارات مرفوضة في إعدادات الجهاز.' : ''}</p></div>`;
    $('v-alerts').querySelectorAll('[data-al]').forEach((el) => (el.onchange = () => commit((d) => { d.settings.alerts = { ...(d.settings.alerts || {}), [el.dataset.al]: el.checked }; }, null, { history: false })));
    $('alSys') && ($('alSys').onchange = async (e) => {
      let on = e.target.checked;
      if (on && Notification.permission !== 'granted') on = (await Notification.requestPermission().catch(() => 'denied')) === 'granted';
      await commit((d) => { d.settings.alerts = { ...(d.settings.alerts || {}), system: on }; }, on ? 'تم تفعيل إشعارات النظام' : 'تم الإيقاف', { history: false });
    });
    void cur;
  }
  function priceAlertForm() {
    const secs = S.data.wealth.securities;
    sheet('تنبيه سعر', `<label>الأصل</label><select name="asset"><option value="gold">الذهب (للجرام)</option>${secs.map((s) => `<option value="${esc(s.id)}">${esc(s.symbol)} — ${esc(s.name)}</option>`).join('')}</select>
      <div id="paK"><label>العيار</label><select name="karat">${[24, 22, 21, 18].map((k) => `<option${k === 21 ? ' selected' : ''}>${k}</option>`).join('')}</select><label>العملة</label><select name="currency">${currencyOptions(disp())}</select></div>
      <label>الشرط</label><select name="op"><option value="above">يتجاوز</option><option value="below">ينزل تحت</option></select>
      <label>السعر</label><input name="value" inputmode="decimal" required>`, {
      onChange: (f) => { $('paK').hidden = f.elements.asset.value !== 'gold'; },
      onSubmit: (v) => commit((d) => { (d.priceAlerts ||= []).push({ id: C.uid(), asset: v.asset === 'gold' ? 'gold' : 'security', securityId: v.asset === 'gold' ? null : v.asset, karat: Number(v.karat) || 24, currency: v.currency, op: v.op === 'below' ? 'below' : 'above', value: C.requireAmount(v.value, 'QTY', 'السعر'), active: true }); }, 'تمت الإضافة', { label: 'إضافة تنبيه سعر' }),
    });
  }

  // ---------- الأهداف ----------
  function renderGoals() {
    const g = S.data.goals;
    $('v-goals').innerHTML = `${head('الأهداف المالية')}<button class="btn primary block" data-action="add-goal">هدف جديد</button>
      <div class="card">${g.length ? `<ul class="list">${g.map((x) => { const p = C.goalProgress(x, S.data); return `<li><button class="item" data-action="open-goal" data-id="${esc(x.id)}"><span class="ico">${icon('i-target')}</span><div class="body"><div class="title">${esc(x.name)} <span class="tag">${esc(C.GOAL_KINDS[x.kind] || 'هدف')}</span>${p.pct >= 100 ? ' <span class="tag">تحقق 🎉</span>' : ''}</div><div class="progress good"><span style="width:${p.pct}%"></span></div><div class="sub">${plain(x.saved, x.currency)} من ${plain(x.target, x.currency)} · ${Math.round(p.pct)}%${x.due ? ' · ' + esc(x.due) : ''}${p.perMonth ? ` · ${plain(p.perMonth, x.currency)}/شهر للوصول` : ''}</div></div></button></li>`; }).join('')}</ul>` : '<div class="empty">صندوق طوارئ، سيارة، كاميرا، سفر، استثمار طويل…</div>'}</div>
      <p class="muted" style="font-size:13px">المبلغ المخصص للهدف جزء من أموالك الموجودة أصلًا — لا يُضاف مرة أخرى إلى صافي الثروة ولا يخصم من أي حساب. لنقل المال فعليًا لحساب ادخار استخدم «تحويل».</p>`;
  }
  function goalForm(id) {
    const g = id ? S.data.goals.find((x) => x.id === id) : null;
    const linked = new Set(g?.accountIds || []);
    sheet(g ? 'تعديل الهدف' : 'هدف مالي جديد', `
      <label>نوع الهدف</label><select name="kind">${Object.entries(C.GOAL_KINDS).map(([k, v]) => `<option value="${k}"${(g?.kind || 'custom') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label>اسم الهدف</label><input name="name" required maxlength="90" value="${esc(g?.name || '')}">
      <div class="grid2" style="grid-template-columns:2fr 1fr"><div><label>المبلغ المستهدف</label><input name="target" inputmode="decimal" required value="${esc(g?.target || '')}"></div><div><label>العملة</label><select name="currency" ${g ? 'disabled' : ''}>${currencyOptions(g?.currency || disp())}</select></div></div>
      ${g ? '' : '<label>المبلغ المخصص حاليًا</label><input name="saved" inputmode="decimal" value="0">'}
      <label>التاريخ المستهدف</label><input type="date" name="due" value="${esc(g?.due || '')}">
      <label>حسابات مرتبطة (اختياري — للعرض فقط)</label>${S.data.accounts.filter((a) => !a.archived).map((a) => `<label class="check"><input type="checkbox" data-goal-acc="${esc(a.id)}" ${linked.has(a.id) ? 'checked' : ''}> ${esc(a.name)} (${plain(C.balance(S.data, a), a.currency)})</label>`).join('')}`, {
      onSubmit: (v) => { const ids = [...$('sheetBody').querySelectorAll('[data-goal-acc]:checked')].map((x) => x.dataset.goalAcc); return commit((d) => (g ? C.updateGoal(d, g.id, { ...v, accountIds: ids }) : C.addGoal(d, { ...v, accountIds: ids })), 'تم الحفظ', { label: g ? `تعديل هدف «${g.name}»` : `هدف جديد «${v.name}»` }); },
    });
  }
  function sparkline(series, cur) {
    if (series.length < 2) return '';
    const W0 = 320, H0 = 70, xs = series.map((_, i) => i), ys = series.map((p) => p.value), y0 = Math.min(0, ...ys), y1 = Math.max(...ys) || 1;
    const d = series.map((p, i) => `${i ? 'L' : 'M'}${(6 + (i / (xs.length - 1)) * (W0 - 12)).toFixed(1)},${(H0 - 8 - ((p.value - y0) / (y1 - y0 || 1)) * (H0 - 16)).toFixed(1)}`).join('');
    return `<svg viewBox="0 0 ${W0} ${H0}" class="trend-svg" role="img" aria-label="التقدم عبر الزمن: ${esc(plain(ys.at(-1), cur))}"><path d="${d}" class="line"/></svg>`;
  }
  function goalOpen(id) {
    const g = S.data.goals.find((x) => x.id === id); if (!g) return;
    const p = C.goalProgress(g, S.data);
    sheet(g.name, `<p class="muted">${esc(C.GOAL_KINDS[g.kind] || '')}${g.due ? ' · الهدف ' + esc(g.due) : ''}</p>
      <div class="kpis"><div><small>المخصص</small><b class="good">${money(g.saved, g.currency)}</b></div><div><small>الهدف</small><b>${money(g.target, g.currency)}</b></div><div><small>الإنجاز</small><b>${Math.round(p.pct)}%</b></div></div>
      ${p.perMonth ? `<p class="hint">للوصول في الموعد: نحو ${plain(p.perMonth, g.currency)} شهريًا لمدة ${p.months} شهر.</p>` : ''}
      ${p.linked.length ? `<p class="hint">حسابات مرتبطة: ${p.linked.map((a) => `${esc(a.name)} (${plain(a.balance, a.currency)})`).join('، ')}</p>` : ''}
      ${sparkline(p.series, g.currency)}
      <form id="sf" novalidate><label>المبلغ</label><input name="amount" inputmode="decimal" required><div class="err-msg" id="sfErr"></div>
      <div class="actions"><button type="button" class="btn primary" data-goal-op="add">تخصيص مبلغ إضافي</button><button type="button" class="btn" data-goal-op="withdraw">سحب من المخصص</button></div></form>
      <h3 style="margin-top:14px">السجل</h3>${g.history.length ? `<ul class="list">${[...g.history].reverse().slice(0, 30).map((h) => `<li class="item"><div class="body"><div class="sub">${esc(h.date)}</div></div><div class="amt ${h.amount < 0 ? 'bad' : 'good'}">${money(h.amount, g.currency, { sign: true })}</div></li>`).join('')}</ul>` : '<div class="empty">لا يوجد</div>'}
      <div class="actions"><button class="btn small" data-action="edit-goal" data-id="${esc(g.id)}">تعديل</button><button class="btn small ghost-danger" data-action="del-goal" data-id="${esc(g.id)}">حذف</button></div>`);
    $('sheetBody').querySelectorAll('[data-goal-op]').forEach((b) => (b.onclick = async () => {
      try { await commit((d) => C.addGoalAmount(d, id, $('sf').elements.amount.value, b.dataset.goalOp === 'withdraw'), 'تم', { label: `${b.dataset.goalOp === 'withdraw' ? 'سحب من' : 'تخصيص لـ'} هدف «${g.name}»` }); goalOpen(id); } catch (e) { $('sfErr').textContent = ctx.errText(e); }
    }));
    $('sf').onsubmit = (e) => { e.preventDefault(); $('sheetBody').querySelector('[data-goal-op="add"]').click(); };
  }

  // ---------- العمليات المجدولة ----------
  function renderScheduled() {
    const t = C.today(), up = C.upcomingSchedule(S.data, 60, S.rates), cur = disp();
    const active = S.data.recurring.filter((r) => !r.done).sort((a, b) => a.next.localeCompare(b.next)), done = S.data.recurring.filter((r) => r.done);
    $('v-recurring').innerHTML = `${head('العمليات المجدولة')}
      <div class="notice info">لا يُخصم أي مبلغ من رصيدك قبل أن تؤكد تنفيذه بـ«تسجيل الآن». الالتزامات القادمة للعرض والتنبيه فقط.</div>
      <div class="card"><h3>القادم خلال 60 يومًا</h3><div class="kpis"><div><small>داخل متوقع</small><b class="good">${money(up.incoming, cur)}</b></div><div><small>خارج متوقع</small><b class="bad">${money(up.outgoing, cur)}</b></div></div>
        ${up.items.length ? `<ul class="list" style="margin-top:8px">${up.items.slice(0, 40).map((i) => `<li class="item"><div class="body"><div class="title">${esc(i.label)} ${i.overdue ? '<span class="tag bad">متأخر</span>' : i.date === t ? '<span class="tag warn">اليوم</span>' : ''}</div><div class="sub">${esc(i.date)} · ${esc(i.sub)}</div></div><div class="amt ${i.dir === 'in' ? 'good' : 'bad'}">${money(i.dir === 'in' ? i.amount : -i.amount, i.currency, { sign: true })}</div></li>`).join('')}</ul>` : '<p class="muted">لا شيء خلال الفترة</p>'}</div>
      <button class="btn primary block" data-action="add-rec">إضافة عملية مجدولة</button>
      <div class="card">${active.length ? `<ul class="list">${active.map((r) => `<li class="item"><span class="ico ${r.type === 'income' ? 'in' : 'out'}">${icon('i-repeat')}</span><div class="body"><div class="title">${esc(r.name)} <span class="tag">${esc(C.SCHEDULE_KINDS[r.kind] || '')}</span> ${r.next < t ? '<span class="tag bad">متأخر</span>' : r.next === t ? '<span class="tag warn">اليوم</span>' : ''}</div><div class="sub">${esc(C.FREQUENCIES[r.frequency] || r.frequency)} · القادم ${esc(r.next)}${r.count !== undefined ? ` · متبقٍ ${r.count}` : ''}${r.endDate ? ' · حتى ' + esc(r.endDate) : ''}${r.accountId ? ' · ' + esc(acc(r.accountId)?.name || '') : ''}</div>
        <div class="actions" style="margin-top:6px"><button class="btn small primary" data-action="post-rec" data-id="${esc(r.id)}">تسجيل الآن</button><button class="btn small" data-action="skip-rec" data-id="${esc(r.id)}">${r.frequency === 'once' ? 'إلغاء' : 'تخطي هذه المرة'}</button><button class="btn small ghost-danger" data-action="del-rec" data-id="${esc(r.id)}">حذف</button></div></div><div class="amt">${money(r.amount, r.currency)}</div></li>`).join('')}</ul>` : '<div class="empty">لا توجد عمليات مجدولة</div>'}</div>
      ${done.length ? `<details class="card"><summary>منتهية (${done.length})</summary><ul class="list">${done.map((r) => `<li class="item"><div class="body"><div class="title">${esc(r.name)}</div></div><button class="btn small ghost-danger" data-action="del-rec" data-id="${esc(r.id)}">حذف</button></li>`).join('')}</ul></details>` : ''}`;
  }
  function scheduleForm() {
    sheet('عملية مجدولة', `<div class="seg">${pick('type', 'expense', 'مصروف / التزام', 'out')}${pick('type', 'income', 'دخل متوقع', 'in')}</div><input type="hidden" name="type" value="expense">
      <label>النوع</label><select name="kind">${Object.entries(C.SCHEDULE_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>الاسم</label><input name="name" required maxlength="90" placeholder="إيجار، نتفليكس، قسط السيارة…">
      <label>المبلغ</label><input name="amount" inputmode="decimal" required>
      <label>الحساب</label><select name="accountId">${accountOptions(S.data.accounts.find((a) => !a.archived)?.id)}</select>
      <label>التصنيف</label><select name="category"></select>
      <div class="grid2"><div><label>الموعد (الأول)</label><input type="date" name="next" value="${C.today()}" required></div><div><label>التكرار</label><select name="frequency">${Object.entries(C.FREQUENCIES).map(([k, v]) => `<option value="${k}"${k === 'monthly' ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div id="scEnd" class="grid2"><div><label>ينتهي في (اختياري)</label><input type="date" name="endDate"></div><div><label>عدد الأقساط المتبقية (اختياري)</label><input name="remaining" inputmode="numeric"></div></div>`, {
      onReady: (b, f) => setPick(f, 'type', 'expense'),
      onChange: (f) => { const ty = f.elements.type.value; if (f.dataset.ty !== ty) { f.elements.category.innerHTML = S.data.categories[ty].map((c) => `<option>${esc(c)}</option>`).join(''); if (ty === 'expense') f.elements.category.value = 'فواتير'; f.dataset.ty = ty; if (ty === 'income') f.elements.kind.value = 'income'; } $('scEnd').hidden = f.elements.frequency.value === 'once'; },
      onSubmit: (v) => commit((d) => C.addRecurring(d, v), 'تمت الإضافة', { label: `مجدول جديد «${v.name}»` }),
    });
  }

  // ---------- بطاقة التقارير الموسعة ----------
  ctx.reportCards = [(range) => {
    const r = C.periodReport(S.data, range, S.rates), cur = disp();
    const v = (x) => (x === null ? '<span class="muted">—</span>' : `<span class="${x >= 0 ? 'good' : 'bad'}">${money(x, cur, { sign: true })}</span>`);
    return `<div class="card"><h3>الادخار والديون والثروة</h3>
      <div class="kpis"><div><small>الادخار (دخل − مصروف)</small><b>${v(r.savings)}</b></div><div><small>نسبة الادخار</small><b>${r.savingsRate === null ? '—' : Math.round(r.savingsRate * 100) + '%'}</b></div><div><small>سداد ديون</small><b>${money(r.debtPaid, cur)}</b></div></div>
      <div class="kpis" style="margin-top:8px"><div><small>تغيّر الالتزامات</small><b>${v(r.liabilitiesChange === null ? null : -r.liabilitiesChange)}</b></div><div><small>تغيّر قيمة الاستثمارات</small><b>${v(r.investmentsChange)}</b></div><div><small>تغيّر صافي الثروة</small><b>${v(r.netWorthChange)}</b></div></div>
      <p class="hint">${r.wealthFrom ? `مقارنة لقطات صافي الثروة ${esc(r.wealthFrom)} ← ${esc(r.wealthTo)}. تغيّر الاستثمارات يشمل الأموال الجديدة — راجع «الأداء الاستثماري» للتمييز.` : 'تغيّرات الثروة تظهر بعد تسجيل لقطات يومية لصافي الثروة لهذه الفترة.'} سداد أصل الدين لا يُحتسب مصروفًا إلا لديون الشراء بالآجل.</p></div>`;
  }];

  // زر البحث والتنبيهات في الرأس
  const tb = document.querySelector('.top .toolbar');
  if (tb && !$('bellBtn')) {
    tb.insertAdjacentHTML('afterbegin', `<button class="hbtn" id="searchBtn" data-nav-to="search" aria-label="البحث"><svg class="i"><use href="#i-search"/></svg></button><button class="hbtn" id="bellBtn" data-nav-to="alerts" aria-label="التنبيهات"><svg class="i"><use href="#i-bell"/></svg><span class="badge" hidden></span></button>`);
  }

  return {
    views: { search: renderSearch, alerts: renderAlerts, goals: renderGoals, recurring: renderScheduled },
    nav: { search: 'home', alerts: 'home' },
    actions: {
      'att-add': (b, id) => attAdd(b.dataset.kind, id, () => { const o = { gold: 'gold-open', investment: 'inv-open', tx: 'open-tx', account: 'open-account', obligation: 'open-ob' }[b.dataset.kind]; if (o) ctx.runAction(o, id); }),
      'att-view': (b, id) => attView(id),
      'att-del': async (b, id) => { const m = S.data.attachments.find((a) => a.id === id); if (!m) return; if (!(await confirmBox({ title: 'إزالة المرفق؟', text: `«${m.name}» سيُزال من القائمة. يمكنك التراجع.`, ok: 'إزالة', danger: true }))) return; await commit((d) => { d.attachments = d.attachments.filter((a) => a.id !== id); }, 'أُزيل المرفق', { label: 'إزالة مرفق' }); closeSheet(); },
      'pa-add': () => priceAlertForm(),
      'pa-del': (b, id) => commit((d) => { d.priceAlerts = d.priceAlerts.filter((p) => p.id !== id); }, 'تم الحذف', { label: 'حذف تنبيه سعر' }),
      'add-goal': () => goalForm(), 'edit-goal': (b, id) => goalForm(id), 'open-goal': (b, id) => goalOpen(id),
      'add-rec': () => scheduleForm(),
    },
  };
}
