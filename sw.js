const CACHE_NAME = 'todo-app-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// ── Install & Activate ────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
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
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

// ── Background Repeat Checker ─────────────────────────────────

const REPEAT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'INIT_REPEAT_CHECKER') {
    startRepeatChecker();
  }
});

function startRepeatChecker() {
  checkTasks();
  setInterval(() => {
    checkTasks();
  }, REPEAT_CHECK_INTERVAL);
}

function getRepeatMs(repeat) {
  switch (repeat) {
    case 'daily':   return 24 * 60 * 60 * 1000;
    case 'weekly':  return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    case '30s':     return 30 * 1000;
    default:        return null;
  }
}

function checkTasks() {
  // Read todos from IndexedDB directly in the service worker
  const DB_NAME = 'TodoAppDB';
  const STORE_NAME = 'todos';

  self.clients.matchAll({ type: 'window' }).then(clients => {
    if (clients.length === 0) return;

    // Open IndexedDB in the SW context and check todos
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) return;

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const storedTodos = getAllRequest.result || [];
        const now = Date.now();
        let changed = false;
        let reemergedTodo = null;

        storedTodos.forEach(todo => {
          if (!todo.repeat || !todo.completed) return;
          if (now >= todo.nextRepeatDate) {
            // Re-emerge the task
            todo.completed = false;
            todo.completedAt = null;
            todo.nextRepeatDate = now + getRepeatMs(todo.repeat);
            changed = true;
            reemergedTodo = todo;
          }
        });

        if (changed) {
          // Write updated todos back to IndexedDB
          const writeTx = db.transaction(STORE_NAME, 'readwrite');
          const writeStore = writeTx.objectStore(STORE_NAME);
          storedTodos.forEach(todo => writeStore.put(todo));

          // Notify the page that tasks have been updated
          clients[0].postMessage({ type: 'PUSH_REPEAT_CHECK' });

          // Send a push notification if the page is not focused
          if (Notification.permission === 'granted') {
            self.registration.showNotification('Task Re-emerged! ✨', {
              body: `"${reemergedTodo.text}" is back on your list.`,
              icon: '/icon-192x192.png',
              badge: '/icon-192x192.png',
              tag: 'repeat-task'
            });
          }
        }
      };

      request.onerror = () => console.error('❌ IndexedDB read failed in SW');
    };

    request.onerror = () => console.error('❌ IndexedDB open failed in SW');
  });
}

// ── Push Notification Handler (for when the app is closed) ───

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Task Re-emerged!';
  const body = data.body || 'A repeatable task has become active again.';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      tag: 'repeat-task'
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
        return clients.openWindow('/');
      }
    })
  );
});
