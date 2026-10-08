// فلوسي — Service Worker. يخزن ملفات التطبيق فقط (لا يلمس بياناتك المالية).
// غيّر VERSION مع كل إصدار حتى يكتشف الجهاز وجود تحديث.
const VERSION = '3.0.1';
const CACHE = 'folosi-app-' + VERSION;
const ASSETS = [
  './', './index.html', './privacy.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/core.js', './js/store.js', './js/security.js', './js/fx.js', './js/drive.js', './js/config.js', './js/theme-boot.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2', './fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2', './fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2',
  './fonts/ibm-plex-sans-arabic-latin-400-normal.woff2', './fonts/ibm-plex-sans-arabic-latin-500-normal.woff2', './fonts/ibm-plex-sans-arabic-latin-700-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    // الإصدارات 2.x كانت تجلب الملفات من الشبكة مباشرة، فالصفحة المفتوحة هي الجديدة أصلًا — التفعيل الفوري آمن
    const keys = await caches.keys();
    if (keys.some((k) => /^folosi-v2/.test(k))) await self.skipWaiting();
  })());
});
self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('folosi-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google وأسعار الصرف تمر مباشرة دون تخزين
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const path = url.pathname.endsWith('/privacy.html') ? './privacy.html' : './index.html';
      return (await cache.match(path)) || fetch(req).catch(() => cache.match('./index.html'));
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch { return new Response('', { status: 504, statusText: 'offline' }); }
  })());
});
