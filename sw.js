/** @type {string} */
const CACHE_NAME = 'todo-app-v3';

/** @type {string[]} */
const STATIC_RESOURCES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png'
];

// ── Install & Activate ────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Per-resource caching: partial success is ok, one failure won't abort the whole install
      Promise.all(
        STATIC_RESOURCES.map(resource =>
          cache.add(resource).catch(() => {
            console.warn('[SW] Failed to cache:', resource);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // HTML/navigation requests: network-first (get fresh content)
  if (request.mode === 'navigate' || (url.pathname.endsWith('.html'))) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Clone the response to cache it for future requests
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html')) // offline fallback
    );
    return;
  }

  // Static assets: cache-first (fast, works offline)
  event.respondWith(
    caches.match(request).then(response => {
      if (response) return response;
      return fetch(request).catch(() => caches.match('./index.html'));
    })
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
