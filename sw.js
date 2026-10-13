/**
 * Service Worker：离线可用。
 * 缓存名带版本号；升级时新版本安装完整预缓存后接管，并清理旧缓存。
 * 版本号需与 js/version.js 一致（test/pwa.mjs 会校验）。
 */
const VERSION = '1.0.1';
const CACHE = `classcount-${VERSION}`;
const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/ctx.js',
  'js/dom.js',
  'js/store.js',
  'js/version.js',
  'js/logic/course.js',
  'js/logic/schedule.js',
  'js/logic/planner.js',
  'js/views/today.js',
  'js/views/courses.js',
  'js/views/planner.js',
  'js/views/data.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('classcount-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        return hit;
      }
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
