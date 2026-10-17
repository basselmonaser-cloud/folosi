// فلوسي 4.0 — شاشات المحاسبة الإضافية: كشف الحساب، مطابقة البنك، سلامة البيانات، سجل التعديلات.
// تُسجَّل في app.js عبر register(ctx) — لا تعتمد على متغيرات عامة.
export function register(ctx) {
  const { S, $, esc, money, plain, toast, sheet, closeSheet, confirmBox, commit, go, head, acc, dt, download, C, Store } = ctx;
  ctx.extraDiagnostics ||= []; // وحدات أخرى (الثروة) تضيف فحوصها هنا
  ctx.fixers ||= {};           // وتضيف إصلاحاتها هنا

  // ---------- كشف الحساب ----------
  S.stmt ||= { q: '', from: '', to: '', dir: '', min: '', max: '' };
  function renderStatement() {
    const a = acc(S.param);
    if (!a) return go('accounts');
    if (S.stmtFor !== a.id) { S.stmtFor = a.id; S.stmt = { q: '', from: '', to: '', dir: '', min: '', max: '' }; }
    const f = S.stmt, st = C.accountStatement(S.data, a.id, f), cur = a.currency;
    const shown = st.rows.slice(-(S.stmtLimit || 400)).reverse();
    $('v-statement').innerHTML = `${head('كشف حساب', 'accounts')}
      <div class="card"><div class="card-head"><h3 style="margin:0">${esc(a.name)} ${a.archived ? '<span class="tag">مغلق/مؤرشف</span>' : ''}</h3><small>${esc(C.ACCOUNT_TYPES[a.type] || '')} · ${esc(cur)}</small></div>
        <div class="kpis"><div><small>الافتتاحي</small><b>${money(st.opening, cur)}</b></div><div><small>داخل</small><b class="good">${money(st.totals.in, cur)}</b></div><div><small>خارج</small><b class="bad">${money(st.totals.out, cur)}</b></div><div><small>الرصيد</small><b>${money(st.closing, cur)}</b></div></div>
        <div class="actions"><button class="btn small primary" data-action="bank-match" data-id="${esc(a.id)}">مطابقة مع البنك</button><button class="btn small" data-action="export-statement" data-id="${esc(a.id)}">تصدير CSV</button></div></div>
      <div class="card"><div class="filters">
        <input id="stQ" type="search" placeholder="بحث في البيان أو المبلغ…" value="${esc(f.q)}" aria-label="بحث">
        <select id="stDir" aria-label="الاتجاه"><option value="">الكل</option><option value="in">داخل</option><option value="out">خارج</option></select>
        <input id="stFrom" type="date" value="${esc(f.from)}" aria-label="من تاريخ"><input id="stTo" type="date" value="${esc(f.to)}" aria-label="إلى تاريخ">
        <input id="stMin" inputmode="decimal" placeholder="أقل مبلغ" value="${esc(f.min)}" aria-label="أقل مبلغ"><input id="stMax" inputmode="decimal" placeholder="أعلى مبلغ" value="${esc(f.max)}" aria-label="أعلى مبلغ">
      </div><p class="hint" style="margin:8px 0 0">${st.rows.length} من ${st.all} حركة · الرصيد الجاري محسوب من الافتتاحي وكل الحركات بالترتيب</p></div>
      <div class="card">${shown.length ? `<ul class="list">${shown.map((r) => `<li><button class="item" data-action="${r.kind === 'tx' ? 'open-tx' : 'open-transfer'}" data-id="${esc(r.id)}"><div class="body"><div class="title">${esc(r.title)} ${r.linked ? '<span class="tag">مرتبطة</span>' : ''}${r.adjustment ? '<span class="tag warn">تسوية</span>' : ''}</div><div class="sub">${esc(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</div></div><div class="amt"><span class="${r.amount > 0 ? 'good' : 'bad'}">${money(r.amount, cur, { sign: true })}</span><small>${plain(r.balance, cur)}</small></div></button></li>`).join('')}</ul>`
        : '<div class="empty">لا توجد حركات مطابقة</div>'}${st.rows.length > shown.length ? `<button class="btn block" data-action="more-statement">عرض الأقدم (${st.rows.length - shown.length})</button>` : ''}</div>`;
    $('stDir').value = f.dir;
    const upd = () => {
      S.stmt = { q: $('stQ').value, dir: $('stDir').value, from: $('stFrom').value, to: $('stTo').value, min: $('stMin').value, max: $('stMax').value };
      const focused = document.activeElement?.id, pos = document.activeElement?.selectionStart; renderStatement();
      if (focused && $(focused)) { $(focused).focus(); try { if (pos != null) $(focused).setSelectionRange(pos, pos); } catch {} }
    };
    ['stDir', 'stFrom', 'stTo'].forEach((id) => ($(id).onchange = upd)); ['stQ', 'stMin', 'stMax'].forEach((id) => ($(id).oninput = upd));
  }

  // ---------- مطابقة البنك ----------
  function openBankMatch(id) {
    const a = acc(id); if (!a) return;
    const cur = a.currency;
    sheet(`مطابقة «${a.name}» مع البنك`, `
      <p class="muted">الرصيد المحسوب في فلوسي: ${money(C.balance(S.data, a), cur)}</p>
      <label for="bmS">الرصيد الحقيقي في البنك/المحفظة الآن (${esc(cur)})</label><input id="bmS" name="statement" class="amount-input" inputmode="decimal" required placeholder="0">
      <div id="bmA" class="hint">اكتب الرصيد كما يظهر في تطبيق البنك أو الكشف. التحليل لا يغيّر أي شيء.</div>
      <div id="bmAdj" hidden>
        <h3 style="margin-top:14px">حركة تسوية (اختياري)</h3>
        <p class="hint" style="margin-top:0">بعد مراجعة الأسباب أعلاه، يمكنك تسجيل الفرق المتبقي كحركة «تسوية رصيد» واضحة: لا تُحتسب دخلًا أو مصروفًا، ولا تغيّر الافتتاحي أو أي حركة، وتُسجل في سجل التعديلات ويمكن التراجع عنها.</p>
        <label for="bmR">سبب التسوية</label><input id="bmR" name="reason" maxlength="200" placeholder="مثال: فرق غير معروف حتى كشف أكتوبر">
        <label for="bmD">تاريخ التسوية</label><input id="bmD" type="date" name="date" value="${C.today()}">
      </div>`, {
      submit: 'تسجيل حركة التسوية',
      onChange: (form) => {
        const raw = form.elements.statement.value.trim(); let r = null;
        if (raw) { try { r = C.reconcileAnalysis(S.data, a.id, raw); } catch {} }
        $('bmAdj').hidden = !r || r.matched;
        form.querySelector('button[type=submit]').hidden = !r || r.matched;
        if (!r) { $('bmA').innerHTML = 'اكتب الرصيد كما يظهر في تطبيق البنك أو الكشف. التحليل لا يغيّر أي شيء.'; return; }
        if (r.matched) { $('bmA').innerHTML = '<div class="notice info">✓ الرصيد مطابق لكشف البنك.</div>'; return; }
        const li = (t) => `<li class="item"><div class="body"><div class="title">${t}</div></div></li>`;
        const txt = (t) => `${esc(t.category)} ${plain(t.amount, t.currency)} · ${esc(t.date)}`;
        const parts = [];
        if (r.duplicates.length) parts.push(`<h3>حركات قد تكون مكررة (${r.duplicates.length})</h3><ul class="list">${r.duplicates.slice(0, 6).map(([x, y]) => li(`${txt(x)} و ${esc(y.date)}`)).join('')}</ul>`);
        if (r.sameAsDiff.length) parts.push(`<h3>حركات تساوي الفرق تمامًا</h3><p class="hint">${r.diff < 0 ? 'قد تكون مسجلة في فلوسي ولم تحدث في البنك، أو مكررة.' : 'قد تكون حدثت في البنك ولم تُسجل، أو سُجلت بالاتجاه المعاكس.'}</p><ul class="list">${r.sameAsDiff.slice(0, 6).map((t) => li(txt(t))).join('')}</ul>`);
        if (r.halfDiff.length) parts.push(`<h3>حركات نصف الفرق</h3><p class="hint">إذا سُجلت حركة بالاتجاه الخطأ (دخل بدل مصروف) يصبح الفرق ضعف مبلغها.</p><ul class="list">${r.halfDiff.slice(0, 6).map((t) => li(txt(t))).join('')}</ul>`);
        if (r.missingRecurring.length) parts.push(`<h3>فواتير متكررة حان موعدها ولم تُسجل</h3><ul class="list">${r.missingRecurring.map((m) => li(`${esc(m.name)} ${plain(m.amount, cur)} · ${esc(m.next)}`)).join('')}</ul>`);
        if (r.transfers.length) parts.push(`<h3>تحويلات تحتاج مراجعة (${r.transfers.length})</h3><p class="hint">بين عملتين مختلفتين أو مع حساب مؤرشف — تأكد أن المبلغ المستلم مطابق.</p>`);
        if (r.initialDebt.length) parts.push(`<h3>ديون أضافت/خصمت مبلغها عند إنشائها</h3><ul class="list">${r.initialDebt.map((o) => li(`${esc(o.party)} ${plain(o.amount, o.currency)}`)).join('')}</ul><p class="hint">إن لم يحدث هذا فعلًا فهو سبب محتمل للفرق.</p>`);
        if (r.debtLinked.length) parts.push(`<p class="hint">على الحساب ${r.debtLinked.length} حركة مرتبطة بديون أو عملاء.</p>`);
        $('bmA').innerHTML = `<div class="notice"><b>الفرق: ${money(r.diff, cur, { sign: true })}</b> (البنك ${plain(r.statement, cur)} − فلوسي ${plain(r.computed, cur)})</div>
          ${parts.join('') || '<p class="hint">لم يُعثر على سبب واضح للفرق في الحركات المسجلة.</p>'}
          <p class="hint"><b>أثر الرصيد الافتتاحي:</b> لو كان الفرق كله بسبب الافتتاحي، لكان يجب أن يكون ${plain(r.opening.needed, cur)} بدل ${plain(r.opening.current, cur)}. لا يُنصح بتعديله إلا إن تأكدت أن الافتتاحي نفسه خاطئ.</p>`;
      },
      onSubmit: async (v) => {
        const r = C.reconcileAnalysis(S.data, a.id, v.statement);
        if (!(await confirmBox({ title: 'تسجيل حركة تسوية؟', text: `ستُسجل حركة «تسوية رصيد» بقيمة ${plain(r.diff, cur)} في «${a.name}» بتاريخ ${v.date || C.today()}، ليصبح الرصيد ${plain(r.statement, cur)}. لا تُحتسب دخلًا أو مصروفًا، ويمكن التراجع عنها.`, ok: 'تسجيل التسوية' }))) return false;
        await commit((d) => C.reconcileAccount(d, a.id, v), 'تمت التسوية', { label: `تسوية «${a.name}» مع البنك (${plain(r.diff, cur)})` });
      },
    });
  }

  // ---------- سلامة البيانات ----------
  const SEV = { error: ['bad', 'خطر'], warn: ['warn', 'متوسط'], info: ['', 'منخفض'] };
  const FIX_LABEL = { unlink: 'فصل الحركة عن السجل المحذوف', 'delete-tx': 'حذف هذه الحركة', 'drop-payment': 'حذف الدفعة التي بلا حركة', 'recalc-paid': 'تحديث القيمة المخزنة', reconcile: 'مطابقة مع البنك', 'review-initial': 'لم يحدث — احذف الحركة' };
  const FIX_EXPLAIN = { unlink: 'تبقى الحركة ورصيدها كما هما؛ يُزال فقط ربطها بسجل لم يعد موجودًا.', 'delete-tx': 'تُحذف الحركة ويتغير رصيد حسابها.', 'drop-payment': 'تُحذف دفعة لا تقابلها أي حركة؛ يرتفع المتبقي ولا يتغير أي رصيد.', 'recalc-paid': 'تحديث رقم مخزن ليطابق مجموع الدفعات؛ لا يتغير أي رصيد.', reconcile: 'افتح مطابقة البنك وأدخل الرصيد الحقيقي.', 'review-initial': 'إن لم تستلم/تدفع هذا المبلغ فعلًا عند إنشاء الدين تُحذف الحركة.' };
  const allFindings = () => [...C.diagnose(S.data, { rates: S.rates }), ...ctx.extraDiagnostics.flatMap((fn) => { try { return fn(S.data, S.rates) || []; } catch { return []; } })];
  S.integ ||= { sev: '' };
  function renderIntegrity() {
    const f = allFindings(); S.findings = f;
    const order = { error: 0, warn: 1, info: 2 }, cnt = (k) => f.filter((x) => x.severity === k).length;
    const list = f.filter((x) => !S.integ.sev || x.severity === S.integ.sev).sort((a, b) => order[a.severity] - order[b.severity]);
    $('v-integrity').innerHTML = `${head('سلامة البيانات', 'settings')}
      <div class="card ${f.some((x) => x.severity === 'error') ? '' : ''}"><div class="kpis"><div><small>خطر</small><b class="bad">${cnt('error')}</b></div><div><small>متوسط</small><b>${cnt('warn')}</b></div><div><small>منخفض</small><b>${cnt('info')}</b></div></div>
        <p class="hint" style="margin-bottom:0">الفحص للقراءة فقط. <b>لم يُغيَّر أي شيء تلقائيًا.</b> كل إصلاح: معاينة لأثره على الأرصدة ← تأكيد منك ← نسخة احتياطية متحقق منها ← تنفيذ قابل للتراجع.</p></div>
      <div class="seg" style="margin:8px 0">${[['', 'الكل'], ['error', 'خطر'], ['warn', 'متوسط'], ['info', 'منخفض']].map(([k, l]) => `<button data-integ-sev="${k}" aria-pressed="${S.integ.sev === k}">${l}</button>`).join('')}</div>
      <div class="card">${list.length ? `<ul class="list">${list.map((x) => `<li class="item" style="align-items:flex-start"><div class="body"><div class="title">${esc(x.title)} <span class="tag ${SEV[x.severity][0]}">${SEV[x.severity][1]}</span></div>
        <div class="sub" style="white-space:normal;line-height:1.7">${esc(x.detail)}</div>
        ${x.fix ? `<div class="hint" style="margin:4px 0">الإصلاح المقترح: ${esc(FIX_EXPLAIN[x.fix.type] || x.fix.explain || '')}</div><div class="actions" style="margin-top:4px"><button class="btn small" data-action="integrity-fix" data-fid="${esc(x.id)}">${esc(FIX_LABEL[x.fix.type] || x.fix.label || 'إصلاح')}</button></div>` : '<div class="hint" style="margin:4px 0">لا يوجد إصلاح تلقائي — راجع البيانات يدويًا.</div>'}</div></li>`).join('')}</ul>`
        : '<div class="empty">✓ لم تُكتشف أي مشكلة</div>'}</div>
      <p class="hint">لا يمكن للفحص اكتشاف حركات حُذفت سابقًا (مثل دفعات حذفها إصدار قديم مع دين). لمطابقة رصيد مع البنك استخدم «مطابقة مع البنك» من كشف الحساب.</p>
      <div class="actions"><button class="btn small" data-action="copy-integrity">نسخ التقرير</button><button class="btn small" data-action="backups">النسخ الاحتياطية</button></div>`;
  }
  async function integrityFix(fid) {
    const x = (S.findings || []).find((y) => y.id === fid); if (!x?.fix) return;
    let fix = x.fix;
    if (fix.type === 'reconcile') return openBankMatch(fix.accountId);
    if (fix.type === 'review-initial') fix = { type: 'delete-tx', txId: fix.txId };
    const apply = (d) => (ctx.fixers[fix.type] ? ctx.fixers[fix.type](d, fix) : C.applyFix(d, fix));
    // معاينة الأثر على نسخة من البيانات
    let preview;
    try { const clone = JSON.parse(JSON.stringify(S.data)); apply(clone); preview = C.balanceDiff(S.data, clone); } catch (e) { return toast(ctx.errText(e), true); }
    const effect = preview.length ? 'أثره على الأرصدة: ' + preview.map((b) => `«${b.name}» ${plain(b.from, b.currency)} ← ${plain(b.to, b.currency)}`).join('، ') : 'لا يتغير أي رصيد.';
    if (!(await confirmBox({ title: (FIX_LABEL[x.fix.type] || x.fix.label || 'إصلاح') + '؟', text: `${x.title}: ${x.detail} — ${effect} ستُنشأ نسخة احتياطية قبل التنفيذ، ويمكنك التراجع.`, ok: 'تنفيذ', danger: fix.type === 'delete-tx' }))) return;
    await commit(apply, 'تم الإصلاح (مع نسخة احتياطية قبله)', { label: `إصلاح: ${x.title}`, snapshot: 'pre-fix' });
    renderIntegrity();
  }

  // ---------- سجل التعديلات ----------
  const STATUS = { done: ['', 'منفذة'], undone: ['warn', 'تم التراجع عنها'], redone: ['', 'أُعيدت'] };
  const FIELD = { name: 'الاسم', amount: 'المبلغ', opening: 'الافتتاحي', type: 'النوع', currency: 'العملة', archived: 'مؤرشف', category: 'التصنيف', date: 'التاريخ', note: 'ملاحظة', accountId: 'الحساب', party: 'الطرف', due: 'الاستحقاق', target: 'المستهدف', saved: 'المدخر', grams: 'الوزن', remaining: 'المتبقي', karat: 'العيار', cost: 'التكلفة', qty: 'الكمية', price: 'السعر', fees: 'الرسوم', value: 'القيمة', origin: 'الأصل', paid: 'المسدد', payments: 'عدد الدفعات' };
  const OP = { add: 'إضافة', edit: 'تعديل', delete: 'حذف' };
  const val = (k, v) => (v === null || v === undefined || v === '' ? '—' : k === 'archived' ? (v ? 'نعم' : 'لا') : k === 'accountId' ? (acc(v)?.name || '؟') : String(v));
  S.auditQ ||= '';
  async function renderAudit() {
    const el = $('v-audit');
    el.innerHTML = `${head('سجل التعديلات', 'settings')}<div class="card"><div class="empty">جارٍ التحميل…</div></div>`;
    const log = (await Store.loadAudit(S.session)) || { entries: [] };
    if (S.view !== 'audit') return;
    const q = S.auditQ.trim().toLowerCase();
    const list = [...log.entries].reverse().filter((e) => !q || JSON.stringify([e.label, e.changes, e.balances]).toLowerCase().includes(q)).slice(0, S.auditLimit || 150);
    el.innerHTML = `${head('سجل التعديلات', 'settings')}
      <div class="card"><input id="auQ" type="search" placeholder="بحث في السجل (حساب، مبلغ، نوع…)" value="${esc(S.auditQ)}" aria-label="بحث">
        <p class="hint" style="margin-bottom:0">${log.entries.length} عملية مسجلة على هذا الجهاز${S.session ? '، مشفرة بمفتاح قفلك' : ''}. منفصل عن التراجع: يبقى حتى بعد التراجع ويوضح ما حدث.</p></div>
      <div class="card">${list.length ? `<ul class="list">${list.map((e) => `<li class="item" style="align-items:flex-start"><div class="body"><div class="title">${esc(e.label)} ${e.meta ? `<span class="tag">${e.meta === 'undo' ? 'تراجع' : 'إعادة'}</span>` : `<span class="tag ${STATUS[e.status]?.[0] || ''}">${STATUS[e.status]?.[1] || ''}</span>`}</div>
        <div class="sub">${esc(dt(e.at))}</div>
        ${(e.changes || []).slice(0, 8).map((c) => `<div class="sub" style="white-space:normal">${OP[c.op]} ${esc(c.kind)}: ${esc(c.name)}${c.fields ? ' — ' + c.fields.map((x) => `${FIELD[x.field] || x.field}: ${esc(val(x.field, x.from))} ← ${esc(val(x.field, x.to))}`).join('، ') : ''}</div>`).join('')}${(e.changes || []).length > 8 || e.more ? `<div class="sub">و${(e.changes.length - 8) + (e.more || 0)} تغييرات أخرى</div>` : ''}
        ${(e.balances || []).length ? `<div class="sub" style="white-space:normal">الأرصدة: ${e.balances.map((b) => `«${esc(b.name)}» ${plain(b.from, b.currency)} ← ${plain(b.to, b.currency)}`).join('، ')}</div>` : ''}</div></li>`).join('')}</ul>` : '<div class="empty">لا توجد عمليات مسجلة بعد</div>'}</div>`;
    $('auQ').oninput = (ev) => { S.auditQ = ev.target.value; clearTimeout(S.auTimer); S.auTimer = setTimeout(() => renderAudit().then(() => { const i = $('auQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }), 250); };
  }

  document.addEventListener('click', (e) => {
    const sv = e.target.closest('[data-integ-sev]'); if (sv) { S.integ.sev = sv.dataset.integSev; renderIntegrity(); }
  });

  return {
    views: { statement: renderStatement, integrity: renderIntegrity, audit: () => { renderAudit(); } },
    nav: { statement: 'more', integrity: 'more', audit: 'more' },
    actions: {
      statement: (b, id) => { closeSheet(); go('statement', id); },
      'more-statement': () => { S.stmtLimit = (S.stmtLimit || 400) + 400; renderStatement(); },
      'export-statement': (b, id) => { const st = C.accountStatement(S.data, id, S.stmt); download(`folosi-statement-${st.account.name}-${C.today()}.csv`, C.statementCSV(st), 'text/csv;charset=utf-8'); toast('تم تصدير الكشف'); },
      'bank-match': (b, id) => openBankMatch(id),
      'integrity-fix': (b) => integrityFix(b.dataset.fid),
      'copy-integrity': () => { const t = (S.findings || []).map((x) => `[${SEV[x.severity][1]}] ${x.title}: ${x.detail}`).join('\n') || 'لا توجد مشاكل'; navigator.clipboard?.writeText(`سلامة بيانات فلوسي ${C.APP_VERSION} — ${C.today()}\n${t}`).then(() => toast('تم نسخ التقرير'), () => toast('تعذر النسخ', true)); },
      audit: () => { closeSheet(); go('audit'); },
    },
  };
}
