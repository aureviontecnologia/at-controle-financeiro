const CACHE_NAME = 'at-financeiro-shell-v103';
const APP_SHELL = ['/', '/manifest.json', '/pwa-192.png', '/pwa-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/'))),
    );
    return;
  }

  if (!['script', 'style', 'font', 'image'].includes(request.destination)) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? JSON.parse(event.data.text()) : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title : 'A&T Controle Financeiro';
  const body = typeof payload.body === 'string' ? payload.body : 'Há uma nova movimentação da família.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'at-household-activity',
    renotify: true,
    data: { url: typeof payload.url === 'string' ? payload.url : '/transactions' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/transactions', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
