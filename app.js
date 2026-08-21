/**
 * @typedef {Object} Todo
 * @property {number} id - Auto-generated unique identifier (IndexedDB autoIncrement)
 * @property {string} text - Task description
 * @property {number} createdAt - Unix timestamp of task creation
 * @property {number} [completedAt] - Unix timestamp when task was completed (null if not completed)
 * @property {number} completed - Completion flag: 0 (active) or 1 (completed)
 * @property {number} deleted - Deletion flag: 0 (active) or 1 (trashed)
 * @property {number | null} deletedAt - Unix timestamp when task was deleted (null if not deleted)
 * @property {string | null} repeat - Repeat schedule: 'daily' | 'weekly' | 'monthly' | '30s' | '' | null
 * @property {'high' | 'medium' | 'low'} importance - Task priority level
 * @property {number | null} deadline - Unix timestamp of deadline (null if none)
 * @property {string | null} duration - Duration string: '5' | '10' | '30' | '60' | 'multi' | null
 * @property {number} [nextRepeatDate] - Next re-emergence timestamp (only for completed repeatable tasks)
 * @property {number} profileId - ID of the profile this todo belongs to
 */

// ── DOM References ─────────────────────────────────────────────

/** @type {HTMLDialogElement} */
const dialog = document.getElementById('add-task-dialog');

/** @type {HTMLButtonElement} */
const addBtn = document.getElementById('add-btn');

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

/** @type {HTMLTextAreaElement} */
const notesInput = document.getElementById('notes-input');

/** @type {HTMLElement} */
const todoList = document.getElementById('todo-list');
if (!todoList) console.error('todoList is null!');

/** @type {HTMLElement} */
const activeListEl = document.getElementById('active-list');

/** @type {HTMLElement} */
const footer = document.getElementById('footer');

/** @type {HTMLElement} */
const countEl = document.getElementById('count');

/** @type {HTMLDialogElement} */
const settingsDialog = document.getElementById('settings-dialog');

/** @type {HTMLElement} */
const settingsClose = document.getElementById('settings-close');

/** @type {HTMLElement} */
const settingsDeletedList = document.getElementById('settings-deleted-list');

/** @type {HTMLElement} */
const settingsPagination = document.getElementById('settings-pagination');

/** Items per page for completed and trash views. */
/** @type {HTMLButtonElement} */
const dialogCancel = document.getElementById('dialog-cancel');

/** @type {HTMLButtonElement} */
const dialogDelete = document.getElementById('dialog-delete');

/** @type {HTMLElement} */
const dialogTitle = document.querySelector('#dialog-task-title');

/** @type {HTMLElement} */
const dialogSubmit = document.querySelector('.dialog-submit');

/** @type {HTMLButtonElement} */
const filterToggle = document.getElementById('filter-toggle');

/** @type {HTMLElement} */
const filtersPanel = document.querySelector('.filters');

// ── IndexedDB Setup ──────────────────────────────────────────

/** @type {string} */
const DB_NAME = 'TodoAppDB';

/** @type {number} */
const DB_VERSION = 2;

/** @type {string} */
const STORE_NAME = 'todos';

/** @type {string} */
const PROFILES_STORE_NAME = 'profiles';

/** @type {IDBDatabase | null} */
let db = null;

/** @type {Todo[]} */
let active = [];

/** @type {Todo[]} */
let completed = [];

/** @type {Todo[]} */
let deleted = [];

/** @type {number | null} */
let currentProfileId = null;

/** @type {number | null} */
let editingTodoId = null;

/** @type {'notifications'|'data'|'personalization'|'trash'} */
let activeSettingsTab = 'notifications';

/** Items per page for completed and trash views. */
const PAGE_SIZE = 10;

/** @type {number} */
let completedPage = 1;

/** @type {number} */
let trashPage = 1;

/**
 * Inserts `item` into a sorted array at the correct position using binary search.
 * Mutates the array in place.
 * @template T
 * @param {T[]} arr - A sorted array
 * @param {T} item - Item to insert
 * @param {(a: T, b: T) => number} compare - Compare function returning <0 if a < b, >0 if a > b
 */
function binaryInsert(arr, item, compare) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compare(arr[mid], item) < 0) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, item);
}


/**
 * Creates the 'todos' and 'profiles' object stores with their indexes on the given database.
 * @param {IDBDatabase} database
 */
function createStore(database) {
  const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
  store.createIndex('deleted', 'deleted', { unique: false });
  store.createIndex('completed', 'completed', { unique: false });
  store.createIndex('createdAt', 'createdAt', { unique: false });
  store.createIndex('completedAt', 'completedAt', { unique: false });
  store.createIndex('profileId', 'profileId', { unique: false });

  const profilesStore = database.createObjectStore(PROFILES_STORE_NAME, { keyPath: 'id', autoIncrement: true });
  profilesStore.createIndex('name', 'name', { unique: false });
}

/**
 * v1 → v2 migration: adds the 'profileId' index to todos, ensures the 'profiles' store
 * exists, creates a 'Default' profile, and assigns all existing todos to it.
 * @param {IDBDatabase} database
 * @param {IDBTransaction} tx - The versionchange transaction
 */
function migrateToV2(database, tx) {
  if (!database.objectStoreNames.contains(PROFILES_STORE_NAME)) {
    const profilesStore = database.createObjectStore(PROFILES_STORE_NAME, { keyPath: 'id', autoIncrement: true });
    profilesStore.createIndex('name', 'name', { unique: false });
  }

  const todosStore = tx.objectStore(STORE_NAME);
  if (!todosStore.indexNames.contains('profileId')) {
    todosStore.createIndex('profileId', 'profileId', { unique: false });
  }

  const defaultProfileReq = tx.objectStore(PROFILES_STORE_NAME).add({ name: 'Default' });
  defaultProfileReq.onsuccess = () => {
    const profileId = defaultProfileReq.result;
    const cursorReq = todosStore.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      if (cursor.value.profileId == null) {
        cursor.update({ ...cursor.value, profileId });
      }
      cursor.continue();
    };
  };
  defaultProfileReq.onerror = () => console.error('Failed to create Default profile during migration:', defaultProfileReq.error);
}

/**
 * Handles database version upgrades.
 * @param {Event} event - The versionchange event
 */
function onUpgradeNeeded(event) {
  const database = event.target.result;
  const oldVersion = event.oldVersion;

  if (oldVersion < 1) {
    createStore(database);
  }

  if (oldVersion < 2) {
    migrateToV2(database, event.target.transaction);
  }
}

/**
 * Opens the IndexedDB database, running any needed upgrades.
 * @returns {Promise<void>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = onUpgradeNeeded;

    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onerror = () => reject(request.error);

    request.onblocked = () => {
      console.warn('DB upgrade blocked — another tab has the DB open. Close it and reload.');
    };
  });
}

/**
 * Inserts or updates a todo in the store.
 * @param {Todo} todo
 * @returns {Promise<number>} The stored key (id).
 */
function dbPut(todo) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(todo);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Inserts a new todo into the store (autoIncrement ID).
 * @param {Todo} todo
 * @returns {Promise<number>} The assigned ID.
 */
function dbAdd(todo) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(todo);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Deletes a todo by ID.
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
 * Retrieves all todos for a profile, split into active/completed/deleted arrays.
 * @param {number} profileId - Profile to load todos for
 * @returns {Promise<{active: Todo[], completed: Todo[], deleted: Todo[]}>}
 */
function dbGet(profileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).index('profileId').getAll(profileId);
    request.onsuccess = () => {
      const all = request.result;
      const active = [], completed = [], deleted = [];
      for (const todo of all) {
        if (todo.deleted === 1) deleted.push(todo);
        else if (todo.completed === 1) completed.push(todo);
        else active.push(todo);
      }
      resolve({ active, completed, deleted });
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves all profiles from the store.
 * @returns {Promise<{id: number, name: string}[]>}
 */
function dbGetProfiles() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE_NAME, 'readonly');
    const request = tx.objectStore(PROFILES_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a profile (insert or update).
 * @param {{id?: number, name: string}} profile
 * @returns {Promise<number>}
 */
function dbPutProfile(profile) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROFILES_STORE_NAME);
    const obj = profile.id ? profile : { name: profile.name };
    const request = profile.id ? store.put(obj) : store.add(obj);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes a profile by ID.
 * @param {number} id
 * @returns {Promise<void>}
 */
function dbDeleteProfile(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
    tx.objectStore(PROFILES_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Counts todos belonging to a profile.
 * @param {number} profileId
 * @returns {Promise<number>}
 */
function dbCountProfileTodos(profileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).index('profileId').count(profileId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes all todos belonging to a profile.
 * @param {number} profileId
 * @returns {Promise<void>}
 */
function dbDeleteProfileTodos(profileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.objectStore(STORE_NAME).index('profileId');
    const cursorReq = index.openCursor(IDBKeyRange.only(profileId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @type {number | null} */
let editingProfileId = null;

/**
 * Renders the profiles list in the settings panel.
 */
async function renderProfiles() {
  const list = document.getElementById('settings-profiles-list');
  if (!list) return;
  list.innerHTML = '';
  const profiles = await dbGetProfiles();

  if (profiles.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No profiles yet.';
    list.appendChild(empty);
    return;
  }

  for (const profile of profiles) {
    const li = document.createElement('li');
    li.className = 'profile-item' + (profile.id === currentProfileId ? ' active' : '');
    li.dataset.id = profile.id;
    li.innerHTML = `
      <span class="profile-name">${escapeHtml(profile.name)}</span>
      <div class="profile-actions">
        ${profile.id === currentProfileId
          ? '<span class="profile-active-badge">Active</span>'
          : `<button class="settings-action-btn profile-load-btn" data-action="load" data-id="${profile.id}">Load</button>`}
        <button class="settings-action-btn profile-edit-btn" data-action="edit" data-id="${profile.id}">Edit</button>
        <button class="settings-action-btn danger profile-delete-btn" data-action="delete" data-id="${profile.id}">Delete</button>
      </div>
    `;
    list.appendChild(li);
  }
}

/**
 * Opens the profile dialog for adding or editing.
 * @param {number|null} id - Profile ID to edit, or null for new
 */
function openProfileDialog(id = null) {
  editingProfileId = id;
  const dialog = document.getElementById('profile-dialog');
  const title = document.getElementById('profile-dialog-title');
  const input = document.getElementById('profile-name-input');
  const saveBtn = document.getElementById('profile-save-btn');

  if (id !== null) {
    dbGetProfiles().then(profiles => {
      const profile = profiles.find(p => p.id === id);
      if (profile) {
        title.textContent = 'Edit Profile';
        input.value = profile.name;
        saveBtn.textContent = 'Save';
      }
    });
  } else {
    title.textContent = 'New Profile';
    input.value = '';
    saveBtn.textContent = 'Add';
  }
  dialog.showModal();
}

/**
 * Saves the profile from the dialog.
 */
async function saveProfile() {
  const input = document.getElementById('profile-name-input');
  const name = input.value.trim();
  if (!name) return;

  try {
    await dbPutProfile({ id: editingProfileId, name });
    document.getElementById('profile-dialog').close();
    renderProfiles();
  } catch (err) {
    console.error('Failed to save profile:', err);
  }
}

/**
 * Deletes a profile and all of its todos after confirmation.
 * @param {number} id
 */
async function deleteProfile(id) {
  if (id === currentProfileId) {
    alert('Cannot delete the active profile.');
    return;
  }
  const profiles = await dbGetProfiles();
  if (profiles.length <= 1) {
    alert('Cannot delete the last profile.');
    return;
  }
  const todoCount = await dbCountProfileTodos(id);
  const taskWord = todoCount === 1 ? 'task' : 'tasks';
  if (!confirm(`Delete this profile and its ${todoCount} ${taskWord}? This cannot be undone.`)) return;
  try {
    await dbDeleteProfileTodos(id);
    await dbDeleteProfile(id);
    renderProfiles();
  } catch (err) {
    console.error('Failed to delete profile:', err);
  }
}

/**
 * Switches to the given profile: loads its todos into memory,
 * resets pagination/urgency state, and re-renders the UI.
 * @param {number} id
 */
async function loadProfile(id) {
  if (id === currentProfileId) return;
  currentProfileId = id;
  localStorage.setItem('activeProfile', String(id));
  ({ active, completed, deleted } = await dbGet(currentProfileId));
  active.sort((a, b) => b.createdAt - a.createdAt);
  completed.sort((a, b) => b.completedAt - a.completedAt);
  completedPage = 1;
  trashPage = 1;
  lastUrgencyMap.clear();
  active.forEach(todo => lastUrgencyMap.set(todo.id, calculateUrgency(todo.deadline, todo.duration)));
  render();
  renderProfiles();
  if (activeSettingsTab === 'trash') renderSettingsTrash();
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Timestamp Formatting ──────────────────────────────────────

/**
 * Converts a millisecond timestamp to a formatted date string.
 * @param {number} timestamp - Unix timestamp in milliseconds.
 * @returns {string} Formatted date string.
 */
function formatTimestamp(timestamp) {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  const second = String(d.getSeconds()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}:${second}`;
}

/**
 * Formats a remaining time in milliseconds to a human-readable string.
 * @param {number} ms - Remaining time in milliseconds.
 * @returns {string} Formatted remaining time.
 */
function formatRemaining(ms) {
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 7) return `${Math.floor(days / 7)}w ${days % 7}d`;
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Converts a duration string to milliseconds.
 * @param {string | null} duration
 * @returns {number} Duration in milliseconds.
 */
function getDurationMs(duration) {
  if (duration === 'multi') return 3 * 60 * 60 * 1000;
  return (parseInt(duration) || 5) * 60 * 1000;
}

// ── Urgency Calculation ───────────────────────────────────────

/**
 * Calculates the urgency level of a task based on deadline and duration.
 * @param {number | null} deadline - Deadline timestamp or null.
 * @param {string | null} duration - Duration string or null.
 * @returns {'stressy' | 'balanced' | 'lax'} Urgency level.
 */
function calculateUrgency(deadline, duration) {
  if (!deadline) return 'lax';
  const now = Date.now();
  const durationMs = getDurationMs(duration);
  const availableTime = deadline - now;

  if (availableTime <= 0) return 'stressy';

  const ratio = availableTime / durationMs;

  // Multi-hour tasks need more buffer
  const timeThreshold = duration === 'multi' ? 2 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  if (ratio <= 3) return 'stressy';
  if (ratio > 5 && availableTime > timeThreshold) return 'lax';
  return 'balanced';
}

/**
 * Gets the repeat interval in milliseconds for a given schedule.
 * @param {string} repeat - Repeat schedule string.
 * @returns {number} Interval in milliseconds.
 */
function getRepeatMs(repeat) {
  switch (repeat) {
    case 'daily': return 24 * 60 * 60 * 1000;
    case 'weekly': return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    case '30s': return 30 * 1000;
    default: return 0;
  }
}

// ── Notification ──────────────────────────────────────────────

/**
 * Sends a grouped notification for task changes (re-emerges + urgency changes).
 * @param {{ type: string; text: string; from?: string; to?: string }[]} changes
 */
function sendGroupedNotification(changes) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const reEmerges = changes.filter(c => c.type === 're-emerged');
  const urgencyChanges = changes.filter(c => c.type === 'urgency-change');

  const hasBoth = reEmerges.length && urgencyChanges.length;
  const title = hasBoth
    ? `${reEmerges.length} task${reEmerges.length > 1 ? 's' : ''} re-emerged, ${urgencyChanges.length} urgency change${urgencyChanges.length > 1 ? 's' : ''}`
    : reEmerges.length > 0
      ? `${reEmerges.length} task${reEmerges.length > 1 ? 's' : ''} re-emerged`
      : `${urgencyChanges.length} urgency change${urgencyChanges.length > 1 ? 's' : ''}`;

  const body = (hasBoth ? [...reEmerges.slice(0, 3), ...urgencyChanges.slice(0, 3)]
    : reEmerges.length > 0 ? reEmerges : urgencyChanges)
    .map(c => c.type === 're-emerged' ? `🔄 ${c.text}` : `⚡ ${c.text}: ${c.from} → ${c.to}`)
    .join('\n');

  new Notification(title, {
    body: body || 'Tasks updated',
    icon: './icon-192x192.png',
    tag: 'todo-updates'
  });
}

/**
 * Sends a foreground notification listing active tasks.
 * Called every 30 seconds while the app is visible.
 */
function sendForegroundNotification() {
  if (active.length === 0) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const preview = active.slice(0, 5).map(t => t.text).join(' • ');
  const suffix = active.length > 5 ? ` +${active.length - 5} more` : '';

  new Notification('Active tasks', {
    body: `${active.length} task${active.length > 1 ? 's' : ''}${preview ? ': ' + preview + suffix : ''}`,
    icon: './icon-192x192.png',
    tag: 'active-tasks'
  });
}

// ── Background Check ──────────────────────────────────────────

/**
 * Checks repeatable tasks for re-emergence, tracks urgency changes, and purges old trash.
 * Runs every 5 minutes via setInterval.
 */
function checkTasks() {
  const now = Date.now();
  let changed = false;
  const changes = [];
  const changedIds = new Set();
  let purgedCount = 0;

  // Check completed repeatable tasks for re-emergence
  for (let i = 0; i < completed.length; i++) {
    const todo = completed[i];
    if (todo.repeat && todo.nextRepeatDate && now >= todo.nextRepeatDate) {
      changes.push({ type: 're-emerged', text: todo.text });
      todo.completed = 0;
      todo.completedAt = null;
      todo.nextRepeatDate = now + getRepeatMs(todo.repeat);
      changed = true;
      changedIds.add(todo.id);
      // Move back to active
      const idx = completed.indexOf(todo);
      if (idx > -1) completed.splice(idx, 1);
      active.push(todo);
    }
  }

  // Urgency check on active todos only
  active.forEach(todo => {
    const urgency = calculateUrgency(todo.deadline, todo.duration);
    const prev = lastUrgencyMap.get(todo.id);
    if (prev && prev !== urgency) {
      changed = true;
      changes.push({ type: 'urgency-change', text: todo.text, from: prev, to: urgency });
    }
    lastUrgencyMap.set(todo.id, urgency);
  });

  // Auto-purge trash older than 30 days
  for (let i = deleted.length - 1; i >= 0; i--) {
    const todo = deleted[i];
    if (todo.deletedAt && (now - todo.deletedAt) > 30 * 24 * 60 * 60 * 1000) {
      purgedCount++;
      deleted.splice(i, 1);
    }
  }

  // Persist changes to DB (changed items + purged trash in one transaction)
  if (changedIds.size > 0 || purgedCount > 0) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of changedIds) {
      const todo = active.find(t => t.id === id);
      if (todo) store.put(todo);
    }
    deleted.forEach(todo => {
      if (todo.deletedAt && (now - todo.deletedAt) > 30 * 24 * 60 * 60 * 1000) {
        store.delete(todo.id);
      }
    });
  }

  if (changed) {
    render();
    sendGroupedNotification(changes);
  }
}

// ── Render ────────────────────────────────────────────────────

/** In-memory urgency tracking — populated on init, updated in checkTasks */
const lastUrgencyMap = new Map();

/**
 * Builds a DOM element for a single todo item.
 * Extracted from render() for targeted DOM updates.
 * @param {Object} todo - The todo object
 * @param {'active' | 'completed' | 'deleted'} view - Which section this belongs to
 * @returns {HTMLElement}
 */
function buildItem(todo, view) {
  const now = Date.now();
  const li = document.createElement('li');
  li.className = `todo-item${view === 'completed' ? ' completed' : ''}${view === 'deleted' ? ' trash-item' : ''}`;
  li.dataset.id = todo.id;

  if (view === 'deleted') {
    const textArea = document.createElement('div');
    textArea.className = 'text-area';

    const textEl = document.createElement('span');
    textEl.className = 'text';
    textEl.textContent = todo.text;
    textEl.style.textDecoration = 'line-through';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const impBadge = document.createElement('span');
    impBadge.className = `badge importance-${todo.importance}`;
    impBadge.textContent = todo.importance;
    meta.appendChild(impBadge);

    if (todo.repeat) {
      const repBadge = document.createElement('span');
      repBadge.className = 'badge repeatable';
      repBadge.textContent = todo.repeat;
      meta.appendChild(repBadge);
    }

    textArea.append(textEl, meta);
    textArea.appendChild(buildTimestamps(todo));

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'trash-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'trash-btn restore-btn';
    restoreBtn.dataset.action = 'restore';
    restoreBtn.dataset.id = todo.id;
    restoreBtn.textContent = 'Restore';

    const permDeleteBtn = document.createElement('button');
    permDeleteBtn.className = 'trash-btn perm-delete-btn';
    permDeleteBtn.dataset.action = 'perm-delete';
    permDeleteBtn.dataset.id = todo.id;
    permDeleteBtn.textContent = 'Delete Forever';

    actionsDiv.append(restoreBtn, permDeleteBtn);
    li.append(textArea, actionsDiv);
  } else {
    const checkbox = document.createElement('div');
    checkbox.className = 'checkbox';
    checkbox.dataset.action = 'toggle';
    checkbox.dataset.id = todo.id;

    const textArea = document.createElement('div');
    textArea.className = 'text-area';
    textArea.dataset.action = 'edit';
    textArea.dataset.id = todo.id;

    const textEl = document.createElement('span');
    textEl.className = 'text';
    textEl.textContent = todo.text;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const impBadge = document.createElement('span');
    impBadge.className = `badge importance-${todo.importance}`;
    impBadge.textContent = todo.importance;
    meta.appendChild(impBadge);

    if (view === 'active') {
      const emBadge = document.createElement('span');
      const taskUrgency = calculateUrgency(todo.deadline, todo.duration);
      emBadge.className = `badge urgency-${taskUrgency}`;
      emBadge.textContent = taskUrgency.charAt(0).toUpperCase() + taskUrgency.slice(1);
      meta.appendChild(emBadge);
    }

    if (todo.repeat) {
      const repBadge = document.createElement('span');
      repBadge.className = 'badge repeatable';
      repBadge.textContent = todo.repeat;
      meta.appendChild(repBadge);
    }

    if (todo.deadline) {
      const dlBadge = document.createElement('span');
      dlBadge.className = 'badge deadline';
      dlBadge.dataset.deadline = todo.deadline;
      const remaining = todo.deadline - now;
      dlBadge.textContent = remaining <= 0 ? 'Overdue' : formatRemaining(remaining);
      meta.appendChild(dlBadge);
    }

    if (todo.notes) {
      const noteBadge = document.createElement('span');
      noteBadge.className = 'badge note';
      noteBadge.textContent = '📝';
      noteBadge.title = todo.notes;
      meta.appendChild(noteBadge);
    }

    textArea.append(textEl, meta);
    textArea.appendChild(buildTimestamps(todo));
    li.append(checkbox, textArea);
  }

  return li;
}

/**
 * Builds a timestamps div for a todo item.
 * Shared between active/completed and deleted branches of buildItem.
 * @param {Object} todo
 * @returns {HTMLElement}
 */
function buildTimestamps(todo) {
  const timestamps = document.createElement('div');
  timestamps.className = 'timestamps';

  const createdSpan = document.createElement('span');
  createdSpan.className = 'timestamp created';
  createdSpan.textContent = 'created: ' + formatTimestamp(todo.createdAt);
  timestamps.appendChild(createdSpan);

  if (todo.completedAt) {
    const completedSpan = document.createElement('span');
    completedSpan.className = 'timestamp completed';
    completedSpan.textContent = `completed: ${formatTimestamp(todo.completedAt)}`;
    timestamps.appendChild(completedSpan);
  }

  if (todo.deletedAt) {
    const deletedSpan = document.createElement('span');
    deletedSpan.className = 'timestamp deleted';
    deletedSpan.textContent = 'deleted: ' + formatTimestamp(todo.deletedAt);
    timestamps.appendChild(deletedSpan);
  }

  return timestamps;
}

/**
 * Checks if a todo matches the current importance + deadline + urgency filters.
 * Used by targeted DOM helpers to avoid adding items that should be hidden.
 * @param {Object} todo - The todo to check
 * @param {boolean} isActive - Whether this is an active task (for urgency filter)
 * @returns {boolean}
 */
function matchesFilters(todo, isActive) {
  if (importanceFilter !== 'all' && todo.importance !== importanceFilter) return false;
  if (deadlineFilter !== 'all') {
    if (!todo.deadline) return false;
    if (deadlineFilter === 'overdue' && todo.deadline > Date.now()) return false;
    if (deadlineFilter === 'today') {
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (todo.deadline > todayEnd.getTime()) return false;
    }
    if (deadlineFilter === 'week') {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      weekEnd.setHours(23, 59, 59, 999);
      if (todo.deadline > weekEnd.getTime()) return false;
    }
  }
  if (isActive && urgencyFilter !== 'all') {
    if (calculateUrgency(todo.deadline, todo.duration) !== urgencyFilter) return false;
  }
  return true;
}

/**
 * Replaces an existing todo element with updated content.
 * If the updated todo no longer matches filters, removes it instead.
 * @param {Object} todo - The updated todo
 */
function updateTodoInDOM(todo) {
  const el = document.querySelector(`li[data-id="${todo.id}"]`);
  if (!el) return;
  const view = el.classList.contains('completed') ? 'completed' : 'active';
  if (!matchesFilters(todo, view === 'active')) {
    el.remove();
    return;
  }
  const newEl = buildItem(todo, view);
  el.replaceWith(newEl);
}

/**
 * Removes a todo element from its list. Fire-and-forget — the
 * animation runs asynchronously and the element is cleaned up
 * when the transition completes (or after a 250ms fallback).
 * @param {number} id - Todo ID
 */
function removeTodoFromDOM(id) {
  const el = document.querySelector(`li[data-id="${id}"]`);
  if (!el) return;
  el.remove();
}



/**
 * Populates the three section lists with filtered items.
 * Full DOM rebuild — called on filter changes and initial load.
 * Individual CRUD operations use targeted DOM helpers instead.
 */
function render() {
  const activeList = document.getElementById('active-list');
  const completedList = document.getElementById('completed-list');
  activeList.innerHTML = '';
  completedList.innerHTML = '';
  todoList.className = VIEW_CLASS_MAP[statusFilter] || '';

  if (statusFilter === 'active') {
    active.sort((t1, t2) => t2.createdAt - t1.createdAt);
    const activeItems = active.filter(todo => matchesFilters(todo, true));
    activeItems.forEach(todo => activeList.appendChild(buildItem(todo, 'active')));

    if (activeItems.length === 0) {
      const emptyMsg = document.createElement('li');
      emptyMsg.className = 'empty-state';
      emptyMsg.textContent = 'No tasks yet. Add one!';
      activeList.appendChild(emptyMsg);
    }

    updateFooter();
  } else if (statusFilter === 'completed') {
    const completedItems = completed.filter(todo => matchesFilters(todo, false));
    const completedTotal = completedItems.length;
    const completedPages = Math.max(1, Math.ceil(completedTotal / PAGE_SIZE));

    completedPage = Math.min(completedPage, completedPages);

    const completedStart = (completedPage - 1) * PAGE_SIZE;
    completedItems.slice(completedStart, completedStart + PAGE_SIZE)
      .forEach(todo => completedList.appendChild(buildItem(todo, 'completed')));

    if (completedItems.length === 0) {
      const emptyMsg = document.createElement('li');
      emptyMsg.className = 'empty-state';
      emptyMsg.textContent = 'No completed tasks.';
      completedList.appendChild(emptyMsg);
    }

    updateFooter(completedTotal, completedPages);
  }
  updateFilterButtons();
  if (activeSettingsTab === 'trash') renderSettingsTrash();
}

/**
 * Renders pagination controls.
 * @param {number} total - Total items
 * @param {number} totalPages - Total pages
 * @param {number} currentPage - Current page number
 * @param {'completed'|'trash'} view - View name
 */
function renderPagination(total, totalPages, currentPage, view) {
  const pagination = view === 'trash' ? settingsPagination : document.getElementById('pagination');
  if (!pagination) return;

  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.textContent = '‹';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.addEventListener('click', () => {
    if (view === 'completed') {
      completedPage--;
      render();
    } else {
      trashPage--;
      renderSettingsTrash();
    }
  });

  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.textContent = '›';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.addEventListener('click', () => {
    if (view === 'completed') {
      completedPage++;
      render();
    } else {
      trashPage++;
      renderSettingsTrash();
    }
  });

  pagination.replaceChildren(prevBtn, pageInfo, nextBtn);
}

/**
 * Updates the footer visibility and count based on current view.
 * Pagination params are optional — computed internally when omitted.
 */
function updateFooter(completedTotal, completedPages) {
  const hasItems = active.length || completed.length || deleted.length;
  footer.style.display = hasItems ? 'flex' : 'none';

  if (!hasItems) return;

  // Compute filtered pagination totals if not provided
  if (completedTotal === undefined) {
    completedTotal = completed.filter(t => matchesFilters(t, false)).length;
    completedPages = Math.max(1, Math.ceil(completedTotal / PAGE_SIZE));
  }

  if (statusFilter === 'completed') {
    countEl.textContent = `${completed.length} completed`;
    renderPagination(completedTotal, completedPages, completedPage, 'completed');
  } else {
    countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''} left`;
    document.getElementById('pagination').innerHTML = '';
  }
}

/**
 * Renders trash items in the settings panel with pagination.
 */
function renderSettingsTrash() {
  settingsDeletedList.innerHTML = '';
  const trashTotal = deleted.length;
  const trashPages = Math.max(1, Math.ceil(trashTotal / PAGE_SIZE));

  trashPage = Math.min(trashPage, trashPages);

  const start = (trashPage - 1) * PAGE_SIZE;
  deleted.slice(start, start + PAGE_SIZE)
    .forEach(todo => settingsDeletedList.appendChild(buildItem(todo, 'deleted')));

  if (trashTotal === 0) {
    const emptyMsg = document.createElement('li');
    emptyMsg.className = 'empty-state';
    emptyMsg.textContent = 'Trash is empty.';
    settingsDeletedList.appendChild(emptyMsg);
  }

  if (trashPages <= 1) {
    settingsPagination.innerHTML = '';
  } else {
    renderPagination(trashTotal, trashPages, trashPage, 'trash');
  }
}



/**
 * Lightweight timer update: only refreshes urgency badges and deadline countdowns.
 * Called by the interval so the DOM isn't rebuilt every minute.
 */
function updateTimers() {
  const now = Date.now();

  // Build ID→todo lookup from active and completed (deleted items use .trash-item, not .todo-item)
  const todoMap = new Map();
  active.forEach(todo => todoMap.set(todo.id, todo));
  completed.forEach(todo => todoMap.set(todo.id, todo));

  const items = todoList.querySelectorAll('.todo-item');

  items.forEach(li => {
    const todo = todoMap.get(Number(li.dataset.id));
    if (!todo) return;

    const meta = li.querySelector('.meta');
    if (!meta) return;

    // Update urgency badge (only for active tasks)
    const emBadge = meta.querySelector('.badge.urgency');
    if (emBadge && todo.completed === 0) {
      const urgency = calculateUrgency(todo.deadline, todo.duration);
      emBadge.className = `badge urgency-${urgency}`;
      emBadge.textContent = urgency.charAt(0).toUpperCase() + urgency.slice(1);
    }

    // Update deadline badge / countdown
    const dlBadge = meta.querySelector('.badge.deadline');
    if (dlBadge) {
      const remaining = (dlBadge.dataset.deadline ? Number(dlBadge.dataset.deadline) : 0) - now;
      if (remaining <= 0) {
        dlBadge.textContent = 'Overdue';
      } else {
        dlBadge.textContent = formatRemaining(remaining);
      }
    }
  });

  updateFooter();
  updateFilterButtons();
}

/**
 * Highlights the currently active filter buttons based on filter state.
 * @returns {void}
 */
function updateFilterButtons() {
  const btns = document.querySelectorAll('.filter-btn');
  btns.forEach(btn => {
    const filter = btn.dataset.filter;
    const ifilter = btn.dataset.ifilter;
    const dfilter = btn.dataset.dfilter;
    const ufilter = btn.dataset.ufilter;

    if (filter !== undefined) btn.classList.toggle('active', filter === statusFilter);
    if (ifilter !== undefined) btn.classList.toggle('active', ifilter === importanceFilter);
    if (dfilter !== undefined) btn.classList.toggle('active', dfilter === deadlineFilter);
    if (ufilter !== undefined) btn.classList.toggle('active', ufilter === urgencyFilter);
  });
}

// ── Dialog Reset ───────────────────────────────────────────────

/** Resets the dialog to its default "add" state. */
function resetDialog() {
  editingTodoId = null;
  dialogTitle.textContent = 'New Task';
  dialogSubmit.textContent = 'Add';
  dialogDelete.style.display = 'none';
  todoForm.reset();
  deadlineInput.value = '';
  durationSelect.value = '5';
  notesInput.value = '';
}

// ── Actions ────────────────────────────────────────────────────

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
  notesInput.value = todo.notes || '';

  dialogTitle.textContent = 'Edit Task';
  dialogSubmit.textContent = 'Save';
  dialogDelete.style.display = 'inline-block';

  dialog.showModal();
  todoInput.focus();
}

/**
 * Converts a millisecond timestamp to datetime-local string.
 * @param {number} timestamp
 * @returns {string}
 */
function msToDatetimeLocal(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

/**
 * Adds a new todo, saves it to IndexedDB, and re-renders.
 * @param {string} text
 * @param {string} repeat
 * @param {'high' | 'medium' | 'low'} importance
 * @param {string | null} deadlineStr - datetime-local string
 * @param {string} duration
 * @returns {Promise<void>}
 */
async function addTodo(text, repeat, importance, deadlineStr, duration, notes) {
  const now = Date.now();
  const deadlineMs = deadlineStr ? new Date(deadlineStr.replace(' ', 'T')).getTime() : null;
  const todo = {
    text,
    createdAt: now,
    repeat,
    importance,
    deadline: deadlineMs,
    duration,
    notes,
    completed: 0,
    completedAt: null,
    deleted: 0,
    deletedAt: null,
    profileId: currentProfileId
  };
  const id = await dbAdd(todo);
  todo.id = id;
  active.unshift(todo);
  const item = buildItem(todo, 'active');
  activeListEl.prepend(item);
  const emptyMsg = activeListEl.querySelector('.empty-state');
  if (emptyMsg) emptyMsg.remove();
  updateFooter();
  updateFilterButtons();
}

/**
 * Updates an existing task with new values, persists to IndexedDB, and updates the DOM element in place.
 * @param {number} id - Todo ID to update.
 * @param {string} text - New task description.
 * @param {string} repeat - New repeat schedule.
 * @param {'high' | 'medium' | 'low'} importance - New priority level.
 * @param {string | null} deadlineStr - New datetime-local string.
 * @param {string} duration - New duration string.
 * @returns {Promise<void>}
 */
async function updateTodo(id, text, repeat, importance, deadlineStr, duration, notes) {
  // Search in active first, then completed
  const todo = active.find(t => t.id === id) || completed.find(t => t.id === id);
  if (!todo) return;

  todo.text = text;
  todo.repeat = repeat || null;
  todo.importance = importance;
  todo.duration = duration;
  todo.deadline = deadlineStr ? new Date(deadlineStr.replace(' ', 'T')).getTime() : null;
  todo.notes = notes;

  await dbPut(todo);
  updateTodoInDOM(todo);
  completedPage = 1;
  updateFooter();
  updateFilterButtons();
}

/**
 * Toggles a todo's completion status. Sets completed flag and completedAt timestamp.
 * @param {number} id - Todo ID
 * @returns {Promise<void>}
 */
async function toggleTodo(id) {
  // Search in active first, then completed
  const todo = active.find(t => t.id === id) || completed.find(t => t.id === id);
  if (!todo) return;

  if (todo.completed === 0) {
    // Complete: active → completed
    todo.completed = 1;
    todo.completedAt = Date.now();
    if (todo.repeat) {
      const periodMs = getRepeatMs(todo.repeat);
      todo.nextRepeatDate = Date.now() + periodMs;
    }
    const idx = active.indexOf(todo);
    if (idx > -1) active.splice(idx, 1);
    binaryInsert(completed, todo, (a, b) => b.completedAt - a.completedAt);
    removeTodoFromDOM(todo.id);
  } else {
    // Decomplete: completed → active
    todo.completed = 0;
    todo.completedAt = null;
    delete todo.nextRepeatDate;
    const idx = completed.indexOf(todo);
    if (idx > -1) completed.splice(idx, 1);
    active.push(todo);
    removeTodoFromDOM(todo.id);
  }

  await dbPut(todo);
  completedPage = 1;
  updateFooter();
  updateFilterButtons();
}

/**
 * Deletes a todo after user confirmation. Sets deleted flag and deletedAt timestamp.
 * @param {number} id - Todo ID to delete.
 * @returns {Promise<void>}
 */
async function deleteTodo(id) {
  if (!confirm('Are you sure you want to delete this task?')) return;

  // Search in active first, then completed
  const activeIdx = active.findIndex(t => t.id === id);
  const completedIdx = completed.findIndex(t => t.id === id);
  const todo = activeIdx !== -1 ? active[activeIdx] : completedIdx !== -1 ? completed[completedIdx] : null;
  if (!todo) return;

  todo.deleted = 1;
  todo.deletedAt = Date.now();

  if (activeIdx !== -1) {
    active.splice(activeIdx, 1);
  } else {
    completed.splice(completedIdx, 1);
  }
  deleted.push(todo);

  removeTodoFromDOM(todo.id);
  await dbPut(todo);
  trashPage = 1;
  updateFooter();
  updateFilterButtons();
  if (activeSettingsTab === 'trash') renderSettingsTrash();
}

/**
 * Restores a deleted todo back to active status.
 * @param {number} id - Todo ID to restore.
 * @returns {Promise<void>}
 */
async function restoreTrash(id) {
  const idx = deleted.findIndex(t => t.id === id);
  const todo = idx !== -1 ? deleted[idx] : null;
  if (!todo) return;

  const wasCompleted = todo.completed === 1;
  todo.deleted = 0;
  todo.deletedAt = null;

  deleted.splice(idx, 1);
  if (wasCompleted) {
    binaryInsert(completed, todo, (a, b) => b.completedAt - a.completedAt);
  } else {
    active.push(todo);
  }

  removeTodoFromDOM(todo.id);
  await dbPut(todo);
  trashPage = 1;
  render();
}

/**
 * Permanently deletes a todo from the store.
 * @param {number} id - Todo ID to permanently delete.
 * @returns {Promise<void>}
 */
async function permanentDeleteTrash(id) {
  if (!confirm('Permanently delete this task? This cannot be undone.')) return;

  const idx = deleted.findIndex(t => t.id === id);
  if (idx === -1) return;
  deleted.splice(idx, 1);
  await dbDelete(id);

  // Pull the first item from the next page down to fill the gap.
  const trashItem = settingsDeletedList.querySelector(`li[data-id="${id}"]`);
  if (trashItem) {
    // Calculate which item to promote from the next page
    // Would be top of next page but delete 1 that's why minus 1
    const start = (trashPage) * PAGE_SIZE - 1;
    let replacementEl = null;
    if (start < deleted.length) {
      replacementEl = buildItem(deleted[start], 'deleted');
    }

    if (replacementEl) {
      settingsDeletedList.appendChild(replacementEl);
    }

    trashItem.remove();
  }

  // Clamp trashPage to the new page count
  trashPage = Math.min(trashPage, Math.max(1, Math.ceil(deleted.length / PAGE_SIZE)));
  updateFooter();
  updateFilterButtons();

  // Always update the trash list UI — we're always in the trash context
  const trashPages = Math.max(1, Math.ceil(deleted.length / PAGE_SIZE));
  if (trashPages <= 1) {
    settingsPagination.innerHTML = '';
  } else {
    renderPagination(deleted.length, trashPages, trashPage, 'trash');
  }
  if (deleted.length === 0) {
    const emptyMsg = document.createElement('li');
    emptyMsg.className = 'empty-state';
    emptyMsg.textContent = 'Trash is empty.';
    settingsDeletedList.appendChild(emptyMsg);
  }
}

// ── Filter state ───────────────────────────────────────────────

/** @type {'active' | 'completed'} */
let statusFilter = 'active';

/** Maps status filter values to CSS view classes. */
const VIEW_CLASS_MAP = { active: 'view-active', completed: 'view-completed', trash: 'view-deleted' };

/** @type {'all' | 'high' | 'medium' | 'low'} */
let importanceFilter = 'all';

/** @type {'all' | 'overdue' | 'today' | 'week'} */
let deadlineFilter = 'all';

/** @type {'all' | 'stressy' | 'balanced' | 'lax'} */
let urgencyFilter = 'all';

// ── Events ─────────────────────────────────────────────────────

// Open dialog
addBtn.addEventListener('click', () => {
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
  }
  resetDialog();
  dialog.close();
});

// Handle form submission
todoForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;

  dialogSubmit.disabled = true;

  try {
    if (editingTodoId !== null) {
      await updateTodo(
        editingTodoId,
        text,
        repeatSelect.value,
        importanceSelect.value,
        deadlineInput.value,
        durationSelect.value,
        notesInput.value.trim()
      );
      resetDialog();
      dialog.close();
    } else {
      await addTodo(
        text,
        repeatSelect.value,
        importanceSelect.value,
        deadlineInput.value,
        durationSelect.value,
        notesInput.value.trim()
      );
      todoInput.value = '';
      notesInput.value = '';
      dialog.close();
    }
  } finally {
    dialogSubmit.disabled = false;
  }
});

// Status buttons
const statusBtns = document.querySelectorAll('.status-btn');
statusBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    statusFilter = btn.dataset.filter;
    todoList.className = VIEW_CLASS_MAP[statusFilter] || '';
    // Reset pagination when switching views
    if (statusFilter === 'completed') completedPage = 1;
    statusBtns.forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});

// Settings button
const settingsBtn = document.getElementById('settings-btn');
settingsBtn.addEventListener('click', () => {
  settingsDialog.showModal();
  switchSettingsTab(activeSettingsTab);
});

// Settings close button
settingsClose.addEventListener('click', () => {
  settingsDialog.close();
});

// Settings tabs
const settingsTabs = document.querySelectorAll('.settings-tab');
settingsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchSettingsTab(tab.dataset.tab);
  });
});

function switchSettingsTab(tabName) {
  activeSettingsTab = tabName;
  settingsTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.settings-tab-content').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`settings-${tabName}`);
  if (panel) panel.classList.add('active');
  settingsPagination.parentElement.classList.toggle('hidden', tabName !== 'trash');
  if (tabName === 'trash') renderSettingsTrash();
  if (tabName === 'profiles') renderProfiles();
}

// Extra filter buttons
const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.ifilter !== undefined) importanceFilter = btn.dataset.ifilter;
    if (btn.dataset.dfilter !== undefined) deadlineFilter = btn.dataset.dfilter;
    if (btn.dataset.ufilter !== undefined) urgencyFilter = btn.dataset.ufilter;
    render();
  });
});

// Filter toggle
filterToggle.addEventListener('click', () => {
  const isExpanded = filtersPanel.classList.toggle('expanded');
  filterToggle.classList.toggle('active', isExpanded);
});

// Event delegation for todo list items (works with section-based DOM)
todoList.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = Number(actionEl.dataset.id);

  switch (action) {
    case 'toggle':
      toggleTodo(id);
      break;
    case 'edit':
      const editTodo = active.find(t => t.id === id) || completed.find(t => t.id === id);
      if (editTodo) openEditDialog(editTodo);
      break;
    case 'restore':
      restoreTrash(id);
      break;
    case 'perm-delete':
      permanentDeleteTrash(id);
      break;
  }
});

// Event delegation for settings trash list
settingsDeletedList.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = Number(actionEl.dataset.id);

  switch (action) {
    case 'restore':
      restoreTrash(id);
      break;
    case 'perm-delete':
      permanentDeleteTrash(id);
      break;
  }
});

// ── Settings Panel Handlers ────────────────────────────────────

async function exportData() {
  try {
    const { active: activeArr, completed: completedArr, deleted: deletedArr } = await dbGet(currentProfileId);
    const data = {
      active: activeArr,
      completed: completedArr,
      deleted: deletedArr,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `todo-app-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export failed:', err);
    alert('Failed to export data.');
  }
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!confirm('Importing will overwrite all tasks in the current profile. Continue?')) {
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || (!data.active && !data.completed && !data.deleted)) {
        alert('Invalid data file — no tasks found.');
        return;
      }

      // Clear the current profile's existing tasks
      await dbDeleteProfileTodos(currentProfileId);

      // Write imported tasks (strip IDs so auto-increment assigns fresh ones)
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const importCounts = [];
      for (const arr of [data.active, data.completed, data.deleted]) {
        if (Array.isArray(arr)) {
          for (const todo of arr) {
            const { id, ...todoWithoutId } = todo;
            const req = store.add({ ...todoWithoutId, profileId: currentProfileId });
            importCounts.push(req);
            req.onerror = () => console.warn('Failed to import todo:', req.error);
          }
        }
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      const failedCount = importCounts.filter(r => r.error).length;
      const totalCount = data.active?.length + data.completed?.length + data.deleted?.length || 0;
      console.log(`Imported ${totalCount - failedCount} todos`);

      // Refresh JS state
      const { active: activeArr, completed: completedArr, deleted: deletedArr } = await dbGet(currentProfileId);
      active = activeArr;
      completed = completedArr;
      deleted = deletedArr;
      render();
      alert('Data imported successfully!');
    } catch (err) {
      console.error('Import failed:', err);
      alert('Invalid JSON file.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function clearAllData() {
  if (!confirm('Are you sure you want to clear ALL data? This cannot be undone.')) return;
  active = [];
  completed = [];
  deleted = [];
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  render();
  settingsDialog.close();
}

function toggleNotifications(e) {
  if (e.target.checked) {
    Notification.requestPermission().then((perm) => {
      console.log('Notification permission:', perm);
    });
  }
}

function toggleMotion(e) {
  document.documentElement.classList.toggle('reduce-motion', e.target.checked);
}

// ── Service Worker Registration ────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker registered:', registration.scope);

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
 * Ensures the 'todos' object store exists. If missing (e.g. after manual DB deletion),
 * closes the current connection, deletes the DB, and reopens fresh.
 * @returns {Promise<void>}
 */
async function ensureStore() {
  const hasTodos = db.objectStoreNames.contains('todos');
  const hasProfiles = db.objectStoreNames.contains(PROFILES_STORE_NAME);
  if (hasTodos && hasProfiles) return;
  console.warn('Missing stores — recreating database');
  db.close();
  db = null;
  return new Promise((resolve, reject) => {
    const deleteReq = indexedDB.deleteDatabase('TodoAppDB');
    deleteReq.onsuccess = () => {
      // Now open fresh — onupgradeneeded will fire for a brand-new DB
      const openReq = indexedDB.open('TodoAppDB', DB_VERSION);
      openReq.onupgradeneeded = onUpgradeNeeded;
      openReq.onsuccess = () => {
        db = openReq.result;
        resolve();
      };
      openReq.onerror = () => reject(openReq.error);
    };
    deleteReq.onerror = () => reject(deleteReq.error);
  });
}

/**
 * Determines which profile to load: the saved one if it still exists,
 * otherwise the first profile in the store. Persists the choice.
 * @returns {Promise<number | null>}
 */
async function resolveCurrentProfile() {
  const profiles = await dbGetProfiles();
  if (profiles.length === 0) return null;
  const savedId = Number(localStorage.getItem('activeProfile')) || null;
  const current = profiles.some(p => p.id === savedId) ? savedId : profiles[0].id;
  localStorage.setItem('activeProfile', String(current));
  return current;
}

/**
 * Initializes the application: opens DB, loads todos, starts background checkers, and renders.
 * @returns {Promise<void>}
 */
async function init() {
  await openDB();
  await ensureStore();
  currentProfileId = await resolveCurrentProfile();
  ({ active, completed, deleted } = await dbGet(currentProfileId));
  active.sort((a, b) => b.createdAt - a.createdAt);
  completed.sort((t1,t2)=>t2.completedAt - t1.completedAt);
  active.forEach(todo => {
    lastUrgencyMap.set(todo.id, calculateUrgency(todo.deadline, todo.duration));
  });
  checkTasks();
  // setInterval(() => {
  //   checkTasks();
  //   updateTimers();
  // }, 5 * 60 * 1000); // Update repeat tasks & timers every 5 minutes (disabled for now)
  render();
  // Setup settings panel event listeners
  document.getElementById('export-data')?.addEventListener('click', exportData);
  document.getElementById('import-data-btn')?.addEventListener('click', () => document.getElementById('import-data')?.click());
  document.getElementById('import-data')?.addEventListener('change', importData);
  document.getElementById('clear-data')?.addEventListener('click', clearAllData);
  document.getElementById('notif-toggle')?.addEventListener('change', toggleNotifications);
  document.getElementById('motion-toggle')?.addEventListener('change', toggleMotion);

  // Theme buttons
  const savedTheme = localStorage.getItem('theme') || 'styles';
  applyTheme(savedTheme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
    });
  });

  // Profile dialog
  const profileDialog = document.getElementById('profile-dialog');
  document.getElementById('profile-add-btn')?.addEventListener('click', () => openProfileDialog(null));
  document.getElementById('profile-save-btn')?.addEventListener('click', saveProfile);
  document.getElementById('profile-cancel-btn')?.addEventListener('click', () => profileDialog.close());
  profileDialog?.addEventListener('close', () => {
    editingProfileId = null;
    document.getElementById('profile-name-input').value = '';
  });

  // Event delegation for profiles list
  const profilesList = document.getElementById('settings-profiles-list');
  profilesList?.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
    if (action === 'load') loadProfile(id);
    if (action === 'edit') openProfileDialog(id);
    if (action === 'delete') deleteProfile(id);
  });

//   // Notification: list active tasks every 300s
//   setInterval(() => {
//     sendForegroundNotification();
//   }, 300_000);
}

/**
 * Applies a theme by swapping the main stylesheet.
 * @param {string} theme - 'classic' or 'girly'
 */
function applyTheme(theme) {
  localStorage.setItem('theme', theme);
  document.querySelectorAll('[id^="theme-"]').forEach(link => link.disabled = true);
  if (theme !== 'styles') {
    const themeLink = document.getElementById(`theme-${theme}`);
    if (themeLink) themeLink.disabled = false;
  }
  const colorMap = { styles: '#3498db', girly: '#ff69b4', suave: '#0f3460', gothic: '#8b0000', farm: '#6b8e23' };
  document.querySelector('meta[name="theme-color"]').content = colorMap[theme] || '#3498db';
  document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === theme));
}

init();
