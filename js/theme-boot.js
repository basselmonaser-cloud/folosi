// يطبق المظهر المحفوظ قبل رسم الصفحة لتجنب الوميض
(function () {
  try {
    var t = localStorage.getItem('folosi_ui_theme_v1');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
