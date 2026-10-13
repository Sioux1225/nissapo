// オフラインでも開けるようにアプリのファイルを保存する（確サポと同じ「ネット優先」）。
// アプリを更新したら VERSION と js/app.js の APP_VERSION を上げること。
const VERSION = 'nippo-v0.1.0';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/xlsx.js',
  './js/pdf.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});
