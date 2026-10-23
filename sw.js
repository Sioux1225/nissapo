// オフラインでも開けるようにアプリのファイルを保存する（確サポと同じ「ネット優先」）。
// アプリを更新したら VERSION と js/app.js の APP_VERSION を上げること（sw.js が変わったことでブラウザが更新に気づき、画面に「新しいバージョンがあります」が出る）。
const VERSION = 'nippo-v0.18.5';
const RUNTIME = 'nippo-runtime';
// ロゴの文字のフォント（バージョン固定のファイルなので、保存した版を優先）
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/xlsx.js',
  './js/pdf.js',
  './js/accident.js',
  './js/photo.js',
  './js/oil.js',
  './js/expiry.js',
  './js/sales.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // ブラウザのキャッシュを通さず、必ずサーバーから最新のファイルを取得して保存する
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  } catch (e) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await caches.match('./index.html');
      if (index) return index;
    }
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
