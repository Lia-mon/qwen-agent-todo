const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const repeatSelect = document.getElementById('repeat-select');
const importanceSelect = document.getElementById('importance-select');
const emergenceSelect = document.getElementById('emergence-select');
const todoList = document.getElementById('todo-list');
const footer = document.getElementById('footer');
const countEl = document.getElementById('count');

// ── IndexedDB Setup ──────────────────────────────────────────

const DB_NAME = 'TodoAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'todos';
let db = null;
let todos = [];

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = event => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function dbPut(todo) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(todo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function loadTodos() {
  todos = await dbGetAll();
}

// ── Timestamp helpers ──────────────────────────────────────────

function formatTimestamp(ms) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ── Repeat logic ───────────────────────────────────────────────

function getRepeatMs(repeat) {
  switch (repeat) {
    case 'daily':   return 24 * 60 * 60 * 1000;
    case 'weekly':  return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    case '30s':     return 30 * 1000;
    default:        return null;
  }
}

function checkRepeatableTodos() {
  const now = Date.now();
  let changed = false;

  todos.forEach(todo => {
    if (!todo.repeat || !todo.completed) return;
    if (now >= todo.nextRepeatDate) {
      todo.completed = false;
      todo.completedAt = null;
      todo.nextRepeatDate = now + getRepeatMs(todo.repeat);
      changed = true;
    }
  });

  if (changed) {
    // Re-save all changed todos to IndexedDB
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    todos.forEach(todo => store.put(todo));
    render();
  }
}

// ── Render ─────────────────────────────────────────────────────

function render() {
  todoList.innerHTML = '';

  const filtered = todos.filter(todo => {
    // Status filter
    if (statusFilter === 'active' && todo.completed) return false;
    if (statusFilter === 'completed' && !todo.completed) return false;

    // Importance filter
    if (importanceFilter !== 'all' && todo.importance !== importanceFilter) return false;

    // Emergence filter
    if (emergenceFilter !== 'all' && todo.emergence !== emergenceFilter) return false;

    return true;
  });

  // Sort: active first (newest first), then completed (most recently completed first)
  filtered.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const aTime = a.completedAt || a.createdAt;
    const bTime = b.completedAt || b.createdAt;
    return bTime - aTime;
  });

  if (filtered.length === 0) {
    const msg = todos.length === 0
      ? 'No todos yet. Add one above!'
      : 'No tasks match the current filters.';
    todoList.innerHTML = `<li class="empty-state">${msg}</li>`;
  } else {
    filtered.forEach(todo => {
      const li = document.createElement('li');
      li.className = `todo-item${todo.completed ? ' completed' : ''}`;

      // Checkbox
      const checkbox = document.createElement('div');
      checkbox.className = 'checkbox';
      checkbox.addEventListener('click', () => toggleTodo(todo.id));

      // Text area (text + meta badges)
      const textArea = document.createElement('div');
      textArea.className = 'text-area';

      const textEl = document.createElement('span');
      textEl.className = 'text';
      textEl.textContent = todo.text;

      const meta = document.createElement('div');
      meta.className = 'meta';

      // Importance badge
      const impBadge = document.createElement('span');
      impBadge.className = `badge importance-${todo.importance}`;
      impBadge.textContent = todo.importance;
      meta.appendChild(impBadge);

      // Emergence badge
      const emBadge = document.createElement('span');
      emBadge.className = `badge emergence-${todo.emergence}`;
      emBadge.textContent = 'emerge';
      meta.appendChild(emBadge);

      // Repeatable badge
      if (todo.repeat) {
        const repBadge = document.createElement('span');
        repBadge.className = 'badge repeatable';
        repBadge.textContent = todo.repeat;
        meta.appendChild(repBadge);
      }

      textArea.append(textEl, meta);

      // Timestamps
      const timestamps = document.createElement('div');
      timestamps.className = 'timestamps';

      const createdSpan = document.createElement('span');
      createdSpan.className = 'timestamp created';
      createdSpan.textContent = 'created: ' + formatTimestamp(todo.createdAt);
      timestamps.appendChild(createdSpan);

      if (todo.completedAt) {
        const completedSpan = document.createElement('span');
        completedSpan.className = 'timestamp completed';
        completedSpan.textContent = 'completed: ' + formatTimestamp(todo.completedAt);
        timestamps.appendChild(completedSpan);
      }

      textArea.appendChild(timestamps);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

      li.append(checkbox, textArea, deleteBtn);
      todoList.appendChild(li);
    });
  }

  const activeCount = todos.filter(t => !t.completed).length;
  footer.style.display = todos.length ? 'flex' : 'none';
  countEl.textContent = `${activeCount} item${activeCount !== 1 ? 's' : ''} left`;

  updateFilterButtons();
}

function updateFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const filter = btn.dataset.filter;
    const ifilter = btn.dataset.ifilter;
    const efilter = btn.dataset.efilter;

    if (filter !== undefined) {
      btn.classList.toggle('active', filter === statusFilter);
    }
    if (ifilter !== undefined) {
      btn.classList.toggle('active', ifilter === importanceFilter);
    }
    if (efilter !== undefined) {
      btn.classList.toggle('active', efilter === emergenceFilter);
    }
  });
}

// ── Actions ────────────────────────────────────────────────────

async function addTodo(text, repeat, importance, emergence) {
  const now = Date.now();
  const todo = {
    id: now,
    text,
    completed: false,
    createdAt: now,
    completedAt: null,
    repeat,
    importance,
    emergence,
    nextRepeatDate: null
  };
  todos.unshift(todo);
  await dbPut(todo);
  render();
}

async function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    todo.completedAt = todo.completed ? Date.now() : null;

    // If re-opening a repeatable, set the next uncompletion time
    if (!todo.completed && todo.repeat) {
      const periodMs = getRepeatMs(todo.repeat);
      todo.nextRepeatDate = Date.now() + periodMs;
    }

    await dbPut(todo);
    render();
  }
}

async function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  await dbDelete(id);
  render();
}

// ── Filter state ───────────────────────────────────────────────

let statusFilter = 'all';
let importanceFilter = 'all';
let emergenceFilter = 'all';

// ── Events ─────────────────────────────────────────────────────

todoForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (text) {
    addTodo(
      text,
      repeatSelect.value,
      importanceSelect.value,
      emergenceSelect.value
    );
    todoInput.value = '';
  }
});

// Status filters
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    statusFilter = btn.dataset.filter;
    render();
  });
});

// Importance filters
document.querySelectorAll('[data-ifilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    importanceFilter = btn.dataset.ifilter;
    render();
  });
});

// Emergence filters
document.querySelectorAll('[data-efilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    emergenceFilter = btn.dataset.efilter;
    render();
  });
});

// ── Service Worker Registration ────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', registration.scope);

      // Notify the SW to start the background repeat checker
      if (registration.active) {
        registration.active.postMessage({ type: 'INIT_REPEAT_CHECKER' });
      }

      // Listen for SW messages (repeat check results, push sync)
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'PUSH_REPEAT_CHECK') {
          loadTodos().then(() => {
            checkRepeatableTodos();
          });
        }
      });

      // Ask for notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  });
}

// ── Init ───────────────────────────────────────────────────────

async function init() {
  await openDB();
  await loadTodos();
  checkRepeatableTodos();
  setInterval(checkRepeatableTodos, 5 * 60 * 1000);
  render();
}

init();
