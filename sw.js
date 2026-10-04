// 앱 코드만 캐시해서 인터넷 없이도 열리게 한다. 음원은 IndexedDB에 있으므로 여기서 다루지 않는다.
// 코드를 바꾸면 VERSION을 올린다.
const VERSION = 'sorida-v2';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'src/logic.js',
  'src/store.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 캐시를 먼저 보여 주고, 온라인이면 뒤에서 새 버전으로 갱신한다.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/audio/')) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
