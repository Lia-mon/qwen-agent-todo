const dialog = document.getElementById('add-task-dialog');
const fabBtn = document.getElementById('fab-btn');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const repeatSelect = document.getElementById('repeat-select');
const importanceSelect = document.getElementById('importance-select');
const deadlineInput = document.getElementById('deadline-input');
const durationSelect = document.getElementById('duration-select');
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

function formatRemaining(ms) {
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (ms <= 0) return 'Overdue';
  if (days > 0) return `${days}d left`;
  if (hours > 0) return `${hours}h left`;
  if (minutes > 0) return `${minutes}m left`;
  return `${seconds}s left`;
}

// ── Duration helpers ───────────────────────────────────────────

function getDurationMs(duration) {
  if (duration === 'multi') return 3 * 60 * 60 * 1000; // 3 hours default
  return parseInt(duration) * 60 * 1000;
}

function calculateEmergence(deadlineMs, duration) {
  if (!deadlineMs) return 'balance';
  const now = Date.now();
  const durationMs = getDurationMs(duration);
  const availableTime = deadlineMs - now;

  if (availableTime <= 0) return 'stress';

  const ratio = availableTime / durationMs;

  // Time threshold depends on duration type
  const timeThreshold = duration === 'multi' ? 2 * 24 * 60 * 60 * 1000 : 1 * 24 * 60 * 60 * 1000;

  if (ratio > 5 && availableTime > timeThreshold) return 'lax';
  if (ratio > 3) return 'balance';
  return 'stress';
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

function checkTasks() {
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
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    todos.forEach(todo => store.put(todo));
    render();
  }
}

// ── Render ─────────────────────────────────────────────────────

function render() {
  todoList.innerHTML = '';

  const now = Date.now();
  const filtered = todos.filter(todo => {
    // Status filter
    if (statusFilter === 'active' && todo.completed) return false;
    if (statusFilter === 'completed' && !todo.completed) return false;

    // Importance filter
    if (importanceFilter !== 'all' && todo.importance !== importanceFilter) return false;

    // Deadline filter
    if (deadlineFilter !== 'all' && todo.deadline) {
      const deadlineMs = todo.deadline;
      if (deadlineFilter === 'overdue' && deadlineMs > now) return false;
      if (deadlineFilter === 'today') {
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        if (deadlineMs > todayEnd.getTime()) return false;
      }
      if (deadlineFilter === 'week') {
        const weekEnd = new Date();
        weekEnd.setDate(weekEnd.getDate() + 7);
        weekEnd.setHours(23, 59, 59, 999);
        if (deadlineMs > weekEnd.getTime()) return false;
      }
    }

    // Emergence filter (computed on-the-fly)
    if (emergenceFilter !== 'all') {
      const taskEmergence = calculateEmergence(todo.deadline, todo.duration);
      if (taskEmergence !== emergenceFilter) return false;
    }

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

      // Emergence badge (computed on-the-fly)
      const emBadge = document.createElement('span');
      const taskEmergence = calculateEmergence(todo.deadline, todo.duration);
      emBadge.className = `badge emergence-${taskEmergence}`;
      emBadge.textContent = taskEmergence.charAt(0).toUpperCase() + taskEmergence.slice(1);
      meta.appendChild(emBadge);

      // Repeatable badge
      if (todo.repeat) {
        const repBadge = document.createElement('span');
        repBadge.className = 'badge repeatable';
        repBadge.textContent = todo.repeat;
        meta.appendChild(repBadge);
      }

      // Deadline badge
      if (todo.deadline) {
        const dlBadge = document.createElement('span');
        dlBadge.className = 'badge deadline';
        const remaining = todo.deadline - now;
        if (remaining <= 0) {
          dlBadge.textContent = 'Overdue';
        } else {
          dlBadge.textContent = formatRemaining(remaining);
        }
        meta.appendChild(dlBadge);
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
    const dfilter = btn.dataset.dfilter;
    const efilter = btn.dataset.efilter;

    if (filter !== undefined) {
      btn.classList.toggle('active', filter === statusFilter);
    }
    if (ifilter !== undefined) {
      btn.classList.toggle('active', ifilter === importanceFilter);
    }
    if (dfilter !== undefined) {
      btn.classList.toggle('active', dfilter === deadlineFilter);
    }
    if (efilter !== undefined) {
      btn.classList.toggle('active', efilter === emergenceFilter);
    }
  });
}

// ── Actions ────────────────────────────────────────────────────

async function addTodo(text, repeat, importance, deadlineStr, duration) {
  const now = Date.now();
  // Convert datetime-local string to timestamp (handle timezone correctly)
  const deadlineMs = deadlineStr ? new Date(deadlineStr.replace(' ', 'T')).getTime() : null;
  const todo = {
    id: now,
    text,
    completed: false,
    createdAt: now,
    completedAt: null,
    repeat,
    importance,
    deadline: deadlineMs,
    duration,
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
  if (!confirm('Are you sure you want to delete this task?')) return;
  todos = todos.filter(t => t.id !== id);
  await dbDelete(id);
  render();
}

// ── Filter state ───────────────────────────────────────────────

let statusFilter = 'all';
let importanceFilter = 'all';
let deadlineFilter = 'all';
let emergenceFilter = 'all';

// ── Events ─────────────────────────────────────────────────────

// Open dialog
fabBtn.addEventListener('click', () => {
  dialog.showModal();
  todoInput.focus();
});

// Close dialog when backdrop is clicked
dialog.addEventListener('click', e => {
  if (e.target === dialog) {
    dialog.close();
  }
});

// Handle form submission
todoForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (text) {
    addTodo(
      text,
      repeatSelect.value,
      importanceSelect.value,
      deadlineInput.value,
      durationSelect.value
    );
    todoInput.value = '';
    dialog.close();
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

// Deadline filters
document.querySelectorAll('[data-dfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    deadlineFilter = btn.dataset.dfilter;
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
            checkTasks();
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
  checkTasks();
  setInterval(checkTasks, 5 * 60 * 1000);
  setInterval(render, 60 * 1000); // Update deadline badges & emergence every minute
  render();
}

init();
