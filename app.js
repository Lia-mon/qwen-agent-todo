/**
 * @typedef {Object} Todo
 * @property {number} id - Unix timestamp used as unique identifier
 * @property {string} text - Task description
 * @property {boolean} completed - Whether the task is completed
 * @property {number} createdAt - Unix timestamp of task creation
 * @property {number | null} completedAt - Unix timestamp of completion (null if active)
 * @property {string | null} repeat - Repeat schedule: 'daily' | 'weekly' | 'monthly' | '30s' | '' | null
 * @property {'high' | 'medium' | 'low'} importance - Task priority level
 * @property {number | null} deadline - Unix timestamp of deadline (null if none)
 * @property {string | null} duration - Duration string: '5' | '10' | '30' | '60' | 'multi' | null
 * @property {number | null} nextRepeatDate - Next re-urgency timestamp
 */

// ── DOM References ─────────────────────────────────────────────

/** @type {HTMLDialogElement} */
const dialog = document.getElementById('add-task-dialog');

/** @type {HTMLButtonElement} */
const fabBtn = document.getElementById('fab-btn');

/** @type {HTMLFormElement} */
const todoForm = document.getElementById('todo-form');

/** @type {HTMLInputElement} */
const todoInput = document.getElementById('todo-input');

/** @type {HTMLSelectElement} */
const repeatSelect = document.getElementById('repeat-select');

/** @type {HTMLSelectElement} */
const importanceSelect = document.getElementById('importance-select');

/** @type {HTMLInputElement} */
const deadlineInput = document.getElementById('deadline-input');

/** @type {HTMLSelectElement} */
const durationSelect = document.getElementById('duration-select');

/** @type {HTMLUListElement} */
const todoList = document.getElementById('todo-list');

/** @type {HTMLElement} */
const footer = document.getElementById('footer');

/** @type {HTMLElement} */
const countEl = document.getElementById('count');

/** @type {HTMLButtonElement} */
const dialogCancel = document.getElementById('dialog-cancel');

/** @type {HTMLButtonElement} */
const dialogDelete = document.getElementById('dialog-delete');

/** @type {HTMLButtonElement} */
const filterToggle = document.getElementById('filter-toggle');

/** @type {HTMLElement} */
const filtersPanel = document.querySelector('.filters');

// ── IndexedDB Setup ──────────────────────────────────────────

/** @type {string} */
const DB_NAME = 'TodoAppDB';

/** @type {number} */
const DB_VERSION = 1;

/** @type {string} */
const STORE_NAME = 'todos';

/** @type {IDBDatabase | null} */
let db = null;

/** @type {Todo[]} */
let todos = [];

/** @type {number | null} */
let editingTodoId = null;

/**
 * Converts a millisecond timestamp to a datetime-local string for the input.
 * @param {number} ms - Unix timestamp in milliseconds.
 * @returns {string} datetime-local formatted string.
 */
function msToDatetimeLocal(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

/**
 * Opens the IndexedDB database and creates the todos object store if it doesn't exist.
 * @returns {Promise<IDBDatabase>}
 */
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

/**
 * Writes or updates a todo in IndexedDB.
 * @param {Todo} todo
 * @returns {Promise<void>}
 */
function dbPut(todo) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(todo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Deletes a todo by its ID from IndexedDB.
 * @param {number} id
 * @returns {Promise<void>}
 */
function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Reads all todos from IndexedDB.
 * @returns {Promise<Todo[]>}
 */
function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Loads all todos from IndexedDB into the in-memory `todos` array.
 * @returns {Promise<void>}
 */
async function loadTodos() {
  todos = await dbGetAll();
}

// ── Timestamp helpers ──────────────────────────────────────────

/**
 * Formats a Unix timestamp (ms) into a human-readable date string.
 * @param {number} ms - Unix timestamp in milliseconds
 * @returns {string}
 */
function formatTimestamp(ms) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

/**
 * Formats a remaining time in milliseconds into a human-readable countdown string.
 * @param {number} ms - Milliseconds remaining (negative means overdue)
 * @returns {string}
 */
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

/**
 * Converts a duration string to milliseconds.
 * @param {string} duration - Duration value ('5', '10', '30', '60', 'multi')
 * @returns {number} Milliseconds, or 3 hours for 'multi'
 */
function getDurationMs(duration) {
  if (duration === 'multi') return 3 * 60 * 60 * 1000; // 3 hours default
  return parseInt(duration) * 60 * 1000;
}

/**
 * Calculates the urgency level based on available time vs required duration.
 * @param {number | null} deadlineMs - Unix timestamp of deadline
 * @param {string | null} duration - Duration string
 * @returns {'stressy' | 'balanced' | 'lax'}
 */
/**
 * Calculates the urgency level of a task based on deadline and duration.
 * @param {number|null} deadlineMs - Deadline as a millisecond timestamp.
 * @param {string} duration - Duration string (e.g. '5', '10', '30', '60', 'multi').
 * @returns {'stressy' | 'balanced' | 'lax'} The computed urgency level.
 */
function calculateUrgency(deadlineMs, duration) {
  if (!deadlineMs) return 'balanced';
  const now = Date.now();
  const durationMs = getDurationMs(duration);
  const availableTime = deadlineMs - now;

  if (availableTime <= 0) return 'stressy';

  const ratio = availableTime / durationMs;

  // Time threshold depends on duration type
  const timeThreshold = duration === 'multi' ? 2 * 24 * 60 * 60 * 1000 : 1 * 24 * 60 * 60 * 1000;

  if (ratio > 5 && availableTime > timeThreshold) return 'lax';
  if (ratio > 3) return 'balanced';
  return 'stressy';
}

// ── Repeat logic ───────────────────────────────────────────────

/**
 * Converts a repeat schedule string to milliseconds.
 * @param {string} repeat - Repeat schedule string
 * @returns {number | null} Milliseconds, or null if 'None'
 */
function getRepeatMs(repeat) {
  switch (repeat) {
    case 'daily':   return 24 * 60 * 60 * 1000;
    case 'weekly':  return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    case '30s':     return 30 * 1000;
    default:        return null;
  }
}

/**
 * Checks for tasks that need to re-emerge based on their repeat schedule,
 * then saves changes to IndexedDB and triggers a UI re-render.
 * @returns {void}
 */
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

/**
 * Renders the filtered and sorted todo list to the DOM.
 * Updates the footer count and active filter button states.
 * @returns {void}
 */
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

    // Urgency filter (computed on-the-fly)
    if (urgencyFilter !== 'all') {
      const taskUrgency = calculateUrgency(todo.deadline, todo.duration);
      if (taskUrgency !== urgencyFilter) return false;
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

      // Urgency badge (computed on-the-fly)
      const emBadge = document.createElement('span');
      const taskUrgency = calculateUrgency(todo.deadline, todo.duration);
      emBadge.className = `badge urgency-${taskUrgency}`;
      emBadge.textContent = taskUrgency.charAt(0).toUpperCase() + taskUrgency.slice(1);
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
      // const deleteBtn = document.createElement('button');
      // deleteBtn.className = 'delete-btn';
      // deleteBtn.innerHTML = '&times;';
      // deleteBtn.title = 'Delete';
      // deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

      li.append(checkbox, textArea);

      // Click task to edit
      li.addEventListener('click', (e) => {
        if (e.target === checkbox || checkbox.contains(e.target)) return;
        openEditDialog(todo);
      });

      todoList.appendChild(li);
    });
  }

  const activeCount = todos.filter(t => !t.completed).length;
  footer.style.display = todos.length ? 'flex' : 'none';
  countEl.textContent = `${activeCount} item${activeCount !== 1 ? 's' : ''} left`;

  updateFilterButtons();
}

/**
 * Highlights the currently active filter buttons based on filter state.
 * @returns {void}
 */
function updateFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const filter = btn.dataset.filter;
    const ifilter = btn.dataset.ifilter;
    const dfilter = btn.dataset.dfilter;
    const ufilter = btn.dataset.ufilter;

    if (filter !== undefined) {
      btn.classList.toggle('active', filter === statusFilter);
    }
    if (ifilter !== undefined) {
      btn.classList.toggle('active', ifilter === importanceFilter);
    }
    if (dfilter !== undefined) {
      btn.classList.toggle('active', dfilter === deadlineFilter);
    }
    if (ufilter !== undefined) {
      btn.classList.toggle('active', ufilter === urgencyFilter);
    }
  });
}

// ── Actions ────────────────────────────────────────────────────

/**
 * Creates a new todo, saves it to IndexedDB, and re-renders.
 * @param {string} text
 * @param {string} repeat
 * @param {'high' | 'medium' | 'low'} importance
 * @param {string | null} deadlineStr - datetime-local string (e.g. '2026-08-02T15:30')
 * @param {string} duration
 * @returns {Promise<void>}
 */
/**
 * Opens the dialog in edit mode, pre-filling fields with the task's values.
 * @param {Todo} todo - The task to edit.
 */
function openEditDialog(todo) {
  editingTodoId = todo.id;

  todoInput.value = todo.text;
  repeatSelect.value = todo.repeat || '';
  importanceSelect.value = todo.importance;
  durationSelect.value = todo.duration || '5';
  deadlineInput.value = todo.deadline ? msToDatetimeLocal(todo.deadline) : '';

  document.querySelector('.dialog-title').textContent = 'Edit Task';
  document.querySelector('.dialog-submit').textContent = 'Save';
  dialogDelete.style.display = 'inline-block';

  dialog.showModal();
  todoInput.focus();
}

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

/**
 * Updates an existing task with new values, persists to IndexedDB, and re-renders.
 * @param {number} id - Todo ID to update.
 * @param {string} text - New task description.
 * @param {string} repeat - New repeat schedule.
 * @param {'high' | 'medium' | 'low'} importance - New priority level.
 * @param {string | null} deadlineStr - New datetime-local string.
 * @param {string} duration - New duration string.
 * @returns {Promise<void>}
 */
async function updateTodo(id, text, repeat, importance, deadlineStr, duration) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  todo.text = text;
  todo.repeat = repeat || null;
  todo.importance = importance;
  todo.duration = duration;
  todo.deadline = deadlineStr ? new Date(deadlineStr.replace(' ', 'T')).getTime() : null;

  await dbPut(todo);
  render();
}

/**
 * Toggles a todo's completion status, updates IndexedDB, and re-renders.
 * @param {number} id - Todo ID
 * @returns {Promise<void>}
 */
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

/**
 * Deletes a todo after user confirmation.
 * @param {number} id - Todo ID
 * @returns {Promise<void>}
 */
async function deleteTodo(id) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  todos = todos.filter(t => t.id !== id);
  await dbDelete(id);
  render();
}

// ── Filter state ───────────────────────────────────────────────

/** @type {'all' | 'active' | 'completed'} */
let statusFilter = 'all';

/** @type {'all' | 'high' | 'medium' | 'low'} */
let importanceFilter = 'all';

/** @type {'all' | 'overdue' | 'today' | 'week'} */
let deadlineFilter = 'all';

/** @type {'all' | 'stressy' | 'balanced' | 'lax'} */
let urgencyFilter = 'all';

// ── Events ─────────────────────────────────────────────────────

// Open dialog
fabBtn.addEventListener('click', () => {
  dialog.showModal();
  todoInput.focus();
});

// Cancel button
dialogCancel.addEventListener('click', () => {
  resetDialog();
  dialog.close();
});

// Delete button
dialogDelete.addEventListener('click', () => {
  if (editingTodoId !== null) {
    deleteTodo(editingTodoId);
    resetDialog();
    dialog.close();
  }
});

// Handle form submission
todoForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;

  if (editingTodoId !== null) {
    // Edit mode
    updateTodo(
      editingTodoId,
      text,
      repeatSelect.value,
      importanceSelect.value,
      deadlineInput.value,
      durationSelect.value
    );
    resetDialog();
    dialog.close();
  } else {
    // Add mode
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

/**
 * Resets the dialog to its default "add" state.
 */
function resetDialog() {
  editingTodoId = null;
  document.querySelector('.dialog-title').textContent = 'New Task';
  document.querySelector('.dialog-submit').textContent = 'Add';
  dialogDelete.style.display = 'none';
  todoForm.reset();
}

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

// Urgency filters
document.querySelectorAll('[data-ufilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    urgencyFilter = btn.dataset.ufilter;
    render();
  });
});

// Filter toggle
filterToggle.addEventListener('click', () => {
  const isExpanded = filtersPanel.classList.toggle('expanded');
  filterToggle.classList.toggle('active', isExpanded);
});

// ── Service Worker Registration ────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
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

/**
 * Initializes the application: opens DB, loads todos, starts background checkers, and renders.
 * @returns {Promise<void>}
 */
async function init() {
  await openDB();
  await loadTodos();
  checkTasks();
  setInterval(checkTasks, 5 * 60 * 1000);
  setInterval(render, 60 * 1000); // Update deadline badges & urgency every minute
  render();
}

init();
