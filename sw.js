// ── Activate & Pre-cache ─────────────────────────────────────
// Immediately claim all open clients and pre-cache critical assets
// so the app works even if the first fetch fails.

const CRITICAL_ASSETS = [
  './',
  './styles.css',
  './girly.css',
  './suave.css',
  './gothic.css',
  './farm.css',
  './app.js',
  './icon-192x192.png',
  './icon-512x512.png',
  './manifest.json',
];

self.addEventListener('activate', event => {
  event.waitUntil(
    clients.claim().then(() => {
      return caches.open('todo-app-dev').then(cache => {
        return cache.addAll(CRITICAL_ASSETS).catch(() => {
          // Some assets may not exist yet (e.g. on first install)
          console.warn('Pre-cache incomplete, will fill on first fetch');
        });
      });
    })
  );
});

// ── Fetch ─────────────────────────────────────────────────────
// Network-first for all requests. Always fetches fresh assets,
// re-caches on every load to survive iOS 7-day cache expiry.

self.addEventListener('fetch', event => {
  const { request } = event;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Clone and cache for future requests (stale-while-revalidate)
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open('todo-app-dev').then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).catch(() => caches.match('./index.html')))
  );
});

// ── Notification Click Handler ────────────────────────────────

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
