// ── Fetch ─────────────────────────────────────────────────────
// Network-first for all requests. Simpler during development —
// always fetches fresh assets, no manual cache invalidation needed.

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
