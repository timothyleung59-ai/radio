const CACHE_NAME = 'claudio-fm-v7-radio-fix';
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
  '/icon-512.svg'
];

// 安装：预缓存静态资源
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求拦截
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API 请求：直接走网络，不缓存
  if (url.pathname.startsWith('/api/')) return;

  // 静态资源：缓存优先，回退网络
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // 只缓存同源成功响应
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => {
      // 离线回退到首页
      if (e.request.mode === 'navigate') return caches.match('/');
    })
  );
});
