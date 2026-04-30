// public/sw.js — network-first，让代码更新即时生效，不再依赖 bump CACHE_NAME
// 策略分层：
//   - /api/*           → 直接走网络，不缓存
//   - HTML/JS/CSS      → network-first，更新缓存；网络不通才用缓存
//   - 图片/字体/icon   → cache-first（极少变化）
//   - navigate fallback → 离线时返回缓存的 '/'
//
// CACHE_NAME 变化时仍会清旧缓存，但你不再需要每次改前端都来 bump 版本号。
const CACHE_NAME = 'claudio-fm-v19-network-first';

const PRECACHE = [
  '/',
  '/css/main.css',
  '/css/player.css',
  '/css/chat.css',
  '/css/lyrics.css',
  '/css/voice.css',
  '/js/app.js',
  '/js/player.js',
  '/js/chat.js',
  '/js/visual.js',
  '/js/lyrics.js',
  '/js/voice.js',
  '/js/api.js',
  '/js/config.js',
  '/js/panels.js',
  '/js/radio.js',
  '/icon-192.svg',
  '/icon-512.svg',
];

// 安装：尽量预缓存（任一资源失败不阻塞）
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(PRECACHE.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

// 激活：清掉所有不匹配的旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 静态资源（图片/字体/icon）极少变化，cache-first 即可
function isImmutableAsset(pathname) {
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(pathname);
}

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // API 请求：直接走网络，不动
  if (url.pathname.startsWith('/api/')) return;

  // 跨域请求（如 cdn）：直接走网络，不动
  if (url.origin !== self.location.origin) return;

  // 只缓存 GET
  if (request.method !== 'GET') return;

  // 静态二进制资源 → cache-first
  if (isImmutableAsset(url.pathname)) {
    e.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // HTML / JS / CSS → network-first：始终拉最新；同时刷新缓存；离线时回退
  e.respondWith(
    fetch(request).then(res => {
      // 拿到 ok 响应就更新缓存
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
      }
      return res;
    }).catch(() => {
      // 网络挂了，回退到缓存；连页面都没有就返根 /
      return caches.match(request).then(cached => {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/');
        return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
