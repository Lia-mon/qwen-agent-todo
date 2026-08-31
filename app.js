/**
 * @typedef {Object} Todo
 * @property {number} id - Auto-generated unique identifier (IndexedDB autoIncrement)
 * @property {string} text - Task description
 * @property {number} createdAt - Unix timestamp of task creation
 * @property {number} [completedAt] - Unix timestamp when task was completed (null if not completed)
 * @property {number} completed - Completion flag: 0 (active) or 1 (completed)
 * @property {number} deleted - Deletion flag: 0 (active) or 1 (trashed)
 * @property {number | null} deletedAt - Unix timestamp when task was deleted (null if not deleted)
 * @property {string | null} repeat - Repeat schedule: 'daily' | 'weekly' | 'biweekly' (twice weekly) | 'monthly' | 'biyearly' | 'yearly' | '30s' (legacy) | '' | null
 * @property {string} notes - Free-form notes
 * @property {Array<{id: string, text: string, done: boolean}>} subtasks - Simple checklist
 * @property {Array<{id: string, name: string, type: string, size: number, blob: Blob}>} attachments - File attachments
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

/** @type {HTMLUListElement} */
const subtaskList = document.getElementById('subtask-list');

/** @type {HTMLInputElement} */
const subtaskInput = document.getElementById('subtask-input');

/** @type {HTMLButtonElement} */
const subtaskAddBtn = document.getElementById('subtask-add-btn');

/** @type {HTMLInputElement} */
const attachmentInput = document.getElementById('attachment-input');

/** @type {HTMLUListElement} */
const attachmentList = document.getElementById('attachment-list');

/** @type {HTMLElement} */
const attachmentGallery = document.getElementById('attachment-gallery');

/** @type {HTMLElement} */
const galleryTrack = document.getElementById('gallery-track');

/** @type {HTMLButtonElement} */
const galleryPrev = document.getElementById('gallery-prev');

/** @type {HTMLButtonElement} */
const galleryNext = document.getElementById('gallery-next');

/** @type {HTMLElement} */
const galleryCounter = document.getElementById('gallery-counter');

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

/** @type {HTMLDialogElement} */
const confirmDialog = document.getElementById('confirm-dialog');

/** @type {HTMLElement} */
const confirmMessage = document.getElementById('confirm-message');

/** @type {HTMLButtonElement} */
const confirmCancel = document.getElementById('confirm-cancel');

/** @type {HTMLButtonElement} */
const confirmOk = document.getElementById('confirm-ok');

/** Items per page for completed and trash views. */
/** @type {HTMLButtonElement} */
const dialogCancel = document.getElementById('dialog-cancel');

/** @type {HTMLButtonElement} */
const dialogDelete = document.getElementById('dialog-delete');

/** @type {HTMLElement} */
const dialogSubmit = document.querySelector('#add-task-dialog .dialog-submit');

/** @type {HTMLButtonElement} */
const filterToggle = document.getElementById('filter-toggle');

/** @type {HTMLElement} */
const filtersPanel = document.querySelector('.filters');

// ── IndexedDB Setup ──────────────────────────────────────────

/** @type {string} */
const DB_NAME = 'TodoAppDB';

/** @type {number} */
const DB_VERSION = 3;

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

/** Working subtask list for the dialog. Deep-copied into the todo on save. */
let dialogSubtasks = [];

/** Working attachment list for the dialog. Each: {id, name, type, size, blob}. */
let dialogAttachments = [];

/** Object URLs created for image thumbnails; revoked on re-render/close. */
let attachmentThumbUrls = [];

/** @type {'notifications'|'data'|'personalization'|'trash'} */
let activeSettingsTab = 'notifications';

/** Items per page for completed and trash views. */
const PAGE_SIZE = 10;

/** @type {number} */
let completedPage = 1;

/** @type {number} */
let trashPage = 1;

// ── Confirm Dialog ────────────────────────────────────────────

/**
 * Shows the confirm dialog and resolves with the user's choice.
 * @param {string} message - The message shown in the dialog.
 * @param {boolean} [danger] - Style the confirm button as a destructive action.
 * @returns {Promise<boolean>} True if the user confirmed.
 */
function showConfirm(message, danger = false) {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    confirmOk.classList.toggle('danger', danger);
    confirmCancel.className = danger ? 'dialog-neutral' : 'dialog-cancel';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      confirmDialog.close();
      resolve(result);
    };
    confirmOk.onclick = () => settle(true);
    confirmCancel.onclick = () => settle(false);
    confirmDialog.onclose = () => settle(false);
    confirmDialog.showModal();
  });
}

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
  store.createIndex('nextRepeatDate', 'nextRepeatDate', { unique: false });

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
 * v2 → v3 migration: adds the 'nextRepeatDate' index to todos so due
 * repeatable tasks can be queried without scanning the whole store.
 * @param {IDBTransaction} tx - The versionchange transaction
 */
function migrateToV3(tx) {
  const todosStore = tx.objectStore(STORE_NAME);
  if (!todosStore.indexNames.contains('nextRepeatDate')) {
    todosStore.createIndex('nextRepeatDate', 'nextRepeatDate', { unique: false });
  }
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

  if (oldVersion < 3) {
    migrateToV3(event.target.transaction);
  }
}

/**
 * Shows a banner when a DB version upgrade is blocked by another open tab.
 * Removed automatically once the blocked open succeeds.
 */
function showBlockedBanner() {
  if (document.getElementById('db-blocked-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'db-blocked-banner';
  banner.textContent =
    'Another tab has this app open and is blocking a database update. '
    + 'Close or reload the other tab — this page will continue automatically.';
  document.body.appendChild(banner);
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
      document.getElementById('db-blocked-banner')?.remove();
      db = request.result;
      resolve();
    };

    request.onerror = () => reject(request.error);

    request.onblocked = () => {
      console.warn('DB upgrade blocked — another tab has the DB open. Close it and reload.');
      showBlockedBanner();
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

/**
 * Returns all todos across all profiles.
 * @returns {Promise<Object[]>}
 */
function dbGetAllTodos() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Returns all todos whose `nextRepeatDate` is at or before `nowMs`, via
 * the `nextRepeatDate` index (records without one are excluded).
 * @param {number} nowMs - Upper bound (inclusive), ms since epoch.
 * @returns {Promise<Object[]>}
 */
function dbGetDueTodos(nowMs) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('nextRepeatDate');
    const request = index.getAll(IDBKeyRange.upperBound(nowMs));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
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
        <button class="settings-action-btn profile-export-btn" data-action="export" data-id="${profile.id}">Export</button>
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
  if (!(await showConfirm(`Delete this profile and its ${todoCount} ${taskWord}? This cannot be undone.`, true))) return;
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
  await activateProfile(id);
}

/**
 * Loads the given profile into memory and re-renders, even when it is
 * already the active profile.
 * @param {number} id
 */
async function activateProfile(id) {
  currentProfileId = id;
  localStorage.setItem('activeProfile', String(id));
  ({ active, completed, deleted } = await dbGet(currentProfileId));
  active.sort((a, b) => b.createdAt - a.createdAt);
  completed.sort((a, b) => b.completedAt - a.completedAt);
  await runScheduledReemergence();
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
  // Include the year only for other years, to keep this-year timestamps compact
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `/${d.getFullYear()}`;
  return `${month}/${day}${year} ${hour}:${minute}:${second}`;
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
 * Tracks urgency changes on active todos.
 * Re-emergence is handled by runScheduledReemergence; trash purging is manual (Purge Trash button).
 */
function checkTasks() {
  let changed = false;
  const changes = [];

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

  if (changed) {
    render();
    sendGroupedNotification(changes);
  }
}


// ── Scheduled Re-emergence ────────────────────────────────────

/**
 * Next fixed re-emergence moment for a todo's repeat value, strictly
 * after `afterMs`, local time.
 *
 *   daily    - 5am, any calendar day
 *   weekly   - 5am Sunday
 *   biweekly - 5pm Wednesday or 5am Sunday, whichever is next
 *   monthly  - 5am on the 1st of a month
 *   biyearly - 5am Jul 1 or 5am Jan 1, whichever is next
 *   yearly   - 5am Jan 1
 *
 * @param {string} repeat - The todo's repeat value.
 * @param {number} afterMs - Lower bound (exclusive), ms since epoch.
 * @returns {number | null} Timestamp of the next moment, or null for
 *   repeat values outside the fixed schedule (e.g. legacy '30s').
 */
function nextCrossMoment(repeat, afterMs) {
  const d = new Date(afterMs);

  // next moment (strictly after afterMs): weekday wd at `hour`, local time
  const nextWeekday = (wd, hour) => {
    const t = new Date(d);
    t.setHours(hour, 0, 0, 0);
    t.setDate(t.getDate() + ((wd - t.getDay() + 7) % 7));
    if (t.getTime() <= afterMs) t.setDate(t.getDate() + 7);
    return t.getTime();
  };

  // next moment (strictly after afterMs): month m, day `day`, at 5am
  const nextAnnual = (m, day) => {
    let t = new Date(d.getFullYear(), m, day);
    t.setHours(5, 0, 0, 0);
    if (t.getTime() <= afterMs) {
      t = new Date(d.getFullYear() + 1, m, day);
      t.setHours(5, 0, 0, 0);
    }
    return t.getTime();
  };

  switch (repeat) {
    case 'daily': {
      const t = new Date(d);
      t.setHours(5, 0, 0, 0);
      if (t.getTime() <= afterMs) t.setDate(t.getDate() + 1);
      return t.getTime();
    }
    case 'weekly':
      return nextWeekday(0, 5);
    case 'biweekly':
      return Math.min(nextWeekday(3, 17), nextWeekday(0, 5));
    case 'monthly': {
      let t = new Date(d.getFullYear(), d.getMonth(), 1);
      t.setHours(5, 0, 0, 0);
      if (t.getTime() <= afterMs) {
        t = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        t.setHours(5, 0, 0, 0);
      }
      return t.getTime();
    }
    case 'biyearly':
      return Math.min(nextAnnual(6, 1), nextAnnual(0, 1));
    case 'yearly':
      return nextAnnual(0, 1);
    default:
      return null;
  }
}

/**
 * Re-emerges completed repeatable tasks whose `nextRepeatDate` has
 * arrived — across all profiles. Each re-emerged task moves back to
 * active; its `nextRepeatDate` is cleared and is re-set (on the fixed
 * schedule, via nextCrossMoment) the next time the task is completed.
 *
 * Not wired into init()/intervals yet.
 * @returns {Promise<void>}
 */
async function runScheduledReemergence() {
  const now = Date.now();
  const due = await dbGetDueTodos(now);
  let reemerged = 0;
  for (const todo of due) {
    // The index only matches records that have a nextRepeatDate, but
    // trashed completed repeatables keep theirs — skip those.
    if (todo.deleted !== 0 || todo.completed !== 1 || !todo.repeat) continue;
    todo.completed = 0;
    todo.completedAt = null;
    delete todo.nextRepeatDate;
    await dbPut(todo);
    reemerged++;
    // Keep the current profile's in-memory arrays in sync.
    const local = completed.find(t => t.id === todo.id);
    if (!local) continue;
    local.completed = 0;
    local.completedAt = null;
    delete local.nextRepeatDate;
    completed.splice(completed.indexOf(local), 1);
    binaryInsert(active, local, (a, b) => b.createdAt - a.createdAt);
  }
  if (reemerged === 0) return;
  render();
  console.log(`Scheduled re-emergence: ${reemerged} task(s) re-emerged`);
}

// ── Render ────────────────────────────────────────────────────

/** In-memory urgency tracking — populated on init, updated in checkTasks */
const lastUrgencyMap = new Map();

// Feather icons (stroke=currentColor) for the note and attachments badges —
// sized via .badge svg in styles.css, colored by the badge's theme token.
const ICON_NOTE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
const ICON_PAPERCLIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
const ICON_IMAGE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

/**
 * Image attachments (MIME type starts with "image/").
 * @param {Object} todo - The todo object
 * @returns {Array} The image attachments (empty array when there are none)
 */
function imageAttachments(todo) {
  return (todo.attachments || []).filter(a => a.type && a.type.startsWith('image/'));
}

/**
 * Revokes the object URLs held by a todo <li> (if any) — used by the
 * images section in the Details panel. Called whenever the item is
 * removed from or replaced in the DOM.
 * @param {HTMLElement} el - The todo <li>
 */
function revokeTodoUrls(el) {
  if (el._urls) {
    for (const url of el._urls) URL.revokeObjectURL(url);
    el._urls = null;
  }
}

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

    textArea.append(textEl, meta);
    textArea.appendChild(buildTimestamps(todo));

    // Right-side extras: plain badges + Details expand button + Edit button
    const hasNotes = Boolean(todo.notes);
    const hasSubtasks = Boolean(todo.subtasks && todo.subtasks.length);
    const hasAttachments = Boolean(todo.attachments && todo.attachments.length);
    const images = imageAttachments(todo);
    const doneCount = todo.subtasks ? todo.subtasks.filter(s => s.done).length : 0;

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    if (hasNotes) {
      const noteBadge = document.createElement('span');
      noteBadge.className = 'badge note';
      noteBadge.innerHTML = ICON_NOTE;
      noteBadge.title = 'Notes';
      actions.appendChild(noteBadge);
    }

    if (hasSubtasks) {
      const stBadge = document.createElement('span');
      stBadge.className = 'badge subtasks';
      stBadge.textContent = `${doneCount}/${todo.subtasks.length}`;
      stBadge.title = `${doneCount} of ${todo.subtasks.length} subtasks done`;
      actions.appendChild(stBadge);
    }

    if (hasAttachments) {
      const attBadge = document.createElement('span');
      attBadge.className = 'badge attachments';
      const parts = [];
      if (todo.attachments.length - images.length > 0) parts.push(ICON_PAPERCLIP);
      if (images.length > 0) parts.push(`${ICON_IMAGE} ${images.length}`);
      attBadge.innerHTML = parts.join(' ');
      attBadge.title = images.length > 0
        ? 'View images in Details'
        : todo.attachments.map(a => a.name).join(', ');
      actions.appendChild(attBadge);
    }

    if (hasNotes || hasSubtasks || images.length > 0) {
      const expandBtn = document.createElement('button');
      expandBtn.className = 'item-action expand-btn';
      expandBtn.textContent = 'Details';
      expandBtn.dataset.action = 'expand-extras';
      expandBtn.dataset.id = todo.id;
      expandBtn.setAttribute('aria-expanded', 'false');
      actions.appendChild(expandBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'item-action edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.dataset.action = 'edit';
    editBtn.dataset.id = todo.id;
    actions.appendChild(editBtn);

    li.append(checkbox, textArea, actions);

    if (hasNotes || hasSubtasks || images.length > 0) {
      const extras = document.createElement('div');
      extras.className = 'task-extras';

      if (hasNotes) {
        const notesSection = document.createElement('div');
        notesSection.className = 'extras-section';
        const notesHeading = document.createElement('div');
        notesHeading.className = 'extras-heading';
        notesHeading.textContent = 'Notes';
        const notesText = document.createElement('div');
        notesText.className = 'notes-text';
        notesText.textContent = todo.notes;
        notesSection.append(notesHeading, notesText);
        extras.appendChild(notesSection);
      }

      if (hasSubtasks) {
        const stSection = document.createElement('div');
        stSection.className = 'extras-section subtasks-section';
        const stHeading = document.createElement('div');
        stHeading.className = 'extras-heading';
        stHeading.textContent = `Subtasks (${doneCount}/${todo.subtasks.length})`;
        const stList = document.createElement('ul');
        stList.className = 'subtask-list';
        for (const st of todo.subtasks) {
          const stItem = document.createElement('li');
          stItem.className = 'subtask-item' + (st.done ? ' done' : '');
          stItem.dataset.action = 'toggle-subtask';
          stItem.dataset.id = todo.id;
          stItem.dataset.subtaskId = st.id;
          stItem.title = st.done ? 'Mark as not done' : 'Mark as done';
          const stCheck = document.createElement('span');
          stCheck.className = 'subtask-check';
          stCheck.textContent = st.done ? '✓' : '○';
          const stText = document.createElement('span');
          stText.className = 'subtask-text';
          stText.textContent = st.text;
          stItem.append(stCheck, stText);
          stList.appendChild(stItem);
        }
        stSection.append(stHeading, stList);
        extras.appendChild(stSection);
      }

      if (images.length > 0) {
        const imgSection = document.createElement('div');
        imgSection.className = 'extras-section';
        const imgHeading = document.createElement('div');
        imgHeading.className = 'extras-heading';
        imgHeading.textContent = `Images (${images.length})`;
        const imgGrid = document.createElement('div');
        imgGrid.className = 'image-grid';
        const urls = [];
        for (const att of images) {
          const img = document.createElement('img');
          const url = URL.createObjectURL(att.blob);
          urls.push(url);
          img.src = url;
          img.alt = att.name;
          img.loading = 'lazy';
          imgGrid.appendChild(img);
        }
        li._urls = urls;
        imgSection.append(imgHeading, imgGrid);
        extras.appendChild(imgSection);
      }

      li.appendChild(extras);
    }
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
    revokeTodoUrls(el);
    el.remove();
    return;
  }
  const newEl = buildItem(todo, view);
  revokeTodoUrls(el);
  el.replaceWith(newEl);
}

/**
 * Removes a todo element from its list. The element fades and
 * shrinks out via the `.removing` class and is removed on
 * `transitionend` (with a 400ms fallback in case the event never
 * fires). Reduce-motion skips the animation.
 * @param {number} id - Todo ID
 */
function removeTodoFromDOM(id) {
  const el = document.querySelector(`li[data-id="${id}"]`);
  if (!el) return;
  const dispose = () => {
    revokeTodoUrls(el);
    el.remove();
  };
  if (document.documentElement.classList.contains('reduce-motion')) {
    dispose();
    return;
  }
  el.addEventListener('transitionend', dispose, { once: true });
  setTimeout(dispose, 400);
  el.classList.add('removing');
}



/**
 * Populates the three section lists with filtered items.
 * Full DOM rebuild — called on filter changes and initial load.
 * Individual CRUD operations use targeted DOM helpers instead.
 */
function render() {
  const activeList = document.getElementById('active-list');
  const completedList = document.getElementById('completed-list');
  activeList.querySelectorAll('li.todo-item').forEach(revokeTodoUrls);
  completedList.querySelectorAll('li.todo-item').forEach(revokeTodoUrls);
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
  settingsDeletedList.querySelectorAll('li.todo-item').forEach(revokeTodoUrls);
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
/** Generates a unique-enough id without requiring a secure context. */
function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Dialog subtasks ────────────────────────────────────────────

/**
 * Rebuilds the dialog's subtask list from dialogSubtasks.
 */
function renderDialogSubtasks() {
  subtaskList.innerHTML = '';
  for (const st of dialogSubtasks) {
    const li = document.createElement('li');
    li.className = 'subtask-item';

    const label = document.createElement('label');
    label.className = 'subtask-label';

    const textEl = document.createElement('span');
    textEl.className = `subtask-text${st.done ? ' done' : ''}`;
    textEl.textContent = st.text;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'subtask-check';
    check.checked = st.done;
    check.addEventListener('change', () => {
      st.done = check.checked;
      textEl.classList.toggle('done', st.done);
    });

    label.append(check, textEl);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'subtask-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove subtask';
    delBtn.addEventListener('click', () => {
      dialogSubtasks = dialogSubtasks.filter(s => s.id !== st.id);
      renderDialogSubtasks();
    });

    li.append(label, delBtn);
    subtaskList.appendChild(li);
  }
}

/**
 * Adds the subtask typed in subtaskInput to the dialog's working list.
 */
function addDialogSubtask() {
  const text = subtaskInput.value.trim();
  if (!text) return;
  dialogSubtasks.push({ id: newId(), text, done: false });
  subtaskInput.value = '';
  renderDialogSubtasks();
  subtaskInput.focus();
}

subtaskAddBtn.addEventListener('click', addDialogSubtask);
subtaskInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addDialogSubtask();
  }
});

// ── Dialog attachments ─────────────────────────────────────────

/**
 * Formats a byte count as a short human-readable string.
 * @param {number} n
 * @returns {string}
 */
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Triggers a browser download of a blob under the given filename.
 * Revoke is deferred so the download has started in every browser.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Revokes all thumbnail object URLs (called before re-render and on close).
 */
function clearAttachmentThumbs() {
  for (const url of attachmentThumbUrls) URL.revokeObjectURL(url);
  attachmentThumbUrls = [];
}

/**
 * Rebuilds the dialog's attachment list from dialogAttachments, then the
 * image gallery. The gallery handles previews; list rows manage (download
 * / remove) all attachments.
 */
function renderDialogAttachments() {
  clearAttachmentThumbs();
  attachmentList.innerHTML = '';
  for (const att of dialogAttachments) {
    const li = document.createElement('li');
    li.className = 'attachment-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'attachment-name';
    nameEl.textContent = att.name;
    nameEl.title = 'Download';
    nameEl.addEventListener('click', () => downloadBlob(att.blob, att.name));

    const sizeEl = document.createElement('span');
    sizeEl.className = 'attachment-size';
    sizeEl.textContent = formatBytes(att.size);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'subtask-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove attachment';
    delBtn.addEventListener('click', () => {
      dialogAttachments = dialogAttachments.filter(a => a.id !== att.id);
      renderDialogAttachments();
    });

    li.append(nameEl, sizeEl, delBtn);
    attachmentList.appendChild(li);
  }
  renderGallery();
}

// Must match the .gallery-track gap in styles.css.
const GALLERY_GAP = 8;

/**
 * Rebuilds the swipeable image gallery from dialogAttachments. Non-image
 * attachments are skipped; the gallery is hidden entirely when there are
 * no images. The scroll position is preserved across re-renders so adding
 * or removing an attachment doesn't yank the user back to slide one.
 */
function renderGallery() {
  const images = dialogAttachments.filter(a => a.type && a.type.startsWith('image/'));
  if (images.length === 0) {
    attachmentGallery.hidden = true;
    galleryTrack.innerHTML = '';
    return;
  }
  const savedScroll = galleryTrack.scrollLeft;
  galleryTrack.innerHTML = '';
  for (const att of images) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(att.blob);
    img.alt = att.name;
    attachmentThumbUrls.push(img.src);
    galleryTrack.appendChild(img);
  }
  attachmentGallery.hidden = false;
  galleryTrack.scrollLeft = savedScroll;
  updateGalleryState();
}

/**
 * Syncs the gallery counter and prev/next visibility with the current
 * scroll position. Runs on scroll (native swipe / trackpad / keyboard)
 * and after each re-render.
 */
function updateGalleryState() {
  const n = galleryTrack.children.length;
  if (n === 0) return;
  const step = galleryTrack.clientWidth + GALLERY_GAP;
  const i = Math.min(n - 1, Math.max(0, Math.round(galleryTrack.scrollLeft / step)));
  galleryCounter.textContent = `${i + 1} / ${n}`;
  galleryPrev.hidden = i === 0;
  galleryNext.hidden = i === n - 1;
}

// Gallery navigation: the arrows step exactly one slide. Native swipe
// (mobile), trackpad/shift+scroll (desktop) and keyboard (the track is
// focusable) all work directly on the track; the scroll listener keeps
// the counter and arrows in sync with any of them.
galleryTrack.addEventListener('scroll', updateGalleryState, { passive: true });
function scrollGallery(dir) {
  const reduceMotion = document.documentElement.classList.contains('reduce-motion');
  galleryTrack.scrollBy({
    left: dir * (galleryTrack.clientWidth + GALLERY_GAP),
    behavior: reduceMotion ? 'auto' : 'smooth'
  });
}
galleryPrev.addEventListener('click', () => scrollGallery(-1));
galleryNext.addEventListener('click', () => scrollGallery(1));

attachmentInput.addEventListener('change', () => {
  for (const file of attachmentInput.files) {
    dialogAttachments.push({
      id: newId(),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file
    });
  }
  attachmentInput.value = '';
  renderDialogAttachments();
});

// Clear the working lists whenever the dialog closes (cancel, submit, ESC, backdrop)
// so state never leaks into the next open. renderDialogAttachments() also
// revokes any thumbnail object URLs.
dialog.addEventListener('close', () => {
  dialogSubtasks = [];
  dialogAttachments = [];
  renderDialogSubtasks();
  renderDialogAttachments();
});

function resetDialog() {
  editingTodoId = null;
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
  dialogSubtasks = (todo.subtasks || []).map(s => ({ ...s }));
  renderDialogSubtasks();
  dialogAttachments = (todo.attachments || []).map(a => ({ ...a }));
  renderDialogAttachments();

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
async function addTodo(text, repeat, importance, deadlineStr, duration, notes, subtasks, attachments) {
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
    subtasks: (subtasks || []).map(s => ({ ...s })),
    attachments: (attachments || []).map(a => ({ ...a })),
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
async function updateTodo(id, text, repeat, importance, deadlineStr, duration, notes, subtasks, attachments) {
  // Search in active first, then completed
  const todo = active.find(t => t.id === id) || completed.find(t => t.id === id);
  if (!todo) return;

  todo.text = text;
  todo.repeat = repeat || null;
  // Keep the pending re-emergence in sync with the (possibly changed) repeat.
  if (todo.completed === 1) {
    const next = nextCrossMoment(todo.repeat, todo.completedAt || Date.now());
    if (next != null) todo.nextRepeatDate = next;
    else delete todo.nextRepeatDate;
  }
  todo.importance = importance;
  todo.duration = duration;
  todo.deadline = deadlineStr ? new Date(deadlineStr.replace(' ', 'T')).getTime() : null;
  todo.notes = notes;
  todo.subtasks = (subtasks || []).map(s => ({ ...s }));
  todo.attachments = (attachments || []).map(a => ({ ...a }));

  await dbPut(todo);
  updateTodoInDOM(todo);
  updateFooter();
  updateFilterButtons();
}

/**
 * Toggles a subtask's done state from the details panel.
 * Persists the todo and updates the panel item, heading, and N/M badge in place
 * (a full item rebuild would collapse the open panel).
 * @param {number} todoId
 * @param {string} subtaskId
 * @returns {Promise<void>}
 */
async function toggleSubtask(todoId, subtaskId) {
  const todo = active.find(t => t.id === todoId) || completed.find(t => t.id === todoId);
  if (!todo || !todo.subtasks) return;
  const subtask = todo.subtasks.find(s => s.id === subtaskId);
  if (!subtask) return;

  subtask.done = !subtask.done;
  await dbPut(todo);

  const doneCount = todo.subtasks.filter(s => s.done).length;
  const el = document.querySelector(`li[data-id="${todoId}"]`);
  if (!el) return;

  const stItem = el.querySelector(`.subtask-item[data-subtask-id="${subtaskId}"]`);
  if (stItem) {
    stItem.classList.toggle('done', subtask.done);
    stItem.title = subtask.done ? 'Mark as not done' : 'Mark as done';
    const stCheck = stItem.querySelector('.subtask-check');
    if (stCheck) stCheck.textContent = subtask.done ? '✓' : '○';
  }

  const stHeading = el.querySelector('.subtasks-section .extras-heading');
  if (stHeading) stHeading.textContent = `Subtasks (${doneCount}/${todo.subtasks.length})`;

  const stBadge = el.querySelector('.badge.subtasks');
  if (stBadge) {
    stBadge.textContent = `${doneCount}/${todo.subtasks.length}`;
    stBadge.title = `${doneCount} of ${todo.subtasks.length} subtasks done`;
  }
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
    const next = nextCrossMoment(todo.repeat, Date.now());
    if (next != null) todo.nextRepeatDate = next;
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
    binaryInsert(active, todo, (a, b) => b.createdAt - a.createdAt);
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
  if (!(await showConfirm('Permanently delete this task? This cannot be undone.', true))) return;

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

    revokeTodoUrls(trashItem);
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
const VIEW_CLASS_MAP = { active: 'view-active', completed: 'view-completed' };

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
        notesInput.value.trim(),
        dialogSubtasks,
        dialogAttachments
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
        notesInput.value.trim(),
        dialogSubtasks,
        dialogAttachments
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
    case 'edit': {
      const editTodo = active.find(t => t.id === id) || completed.find(t => t.id === id);
      if (editTodo) openEditDialog(editTodo);
      break;
    }
    case 'expand-extras': {
      const item = actionEl.closest('.todo-item');
      if (item) {
        const expanded = item.classList.toggle('expanded');
        item.querySelectorAll('.expand-btn').forEach(btn => btn.setAttribute('aria-expanded', String(expanded)));
      }
      break;
    }
    case 'toggle-subtask':
      // Subtask ids are string UUIDs (newId()), not numbers
      toggleSubtask(id, actionEl.dataset.subtaskId);
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

/**
 * Encodes an ArrayBuffer as base64 in chunks (avoids call-stack limits on large files).
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Converts a todo's attachments (Blobs) into JSON-safe base64 data URLs.
 * @param {Object[]} attachments
 * @returns {Promise<Object[]>}
 */
async function serializeAttachments(attachments) {
  const out = [];
  for (const att of attachments || []) {
    if (!att || !att.blob) continue;
    const buf = await att.blob.arrayBuffer();
    out.push({
      id: att.id,
      name: att.name,
      type: att.type,
      size: att.size,
      data: `data:${att.type || 'application/octet-stream'};base64,${bufferToBase64(buf)}`
    });
  }
  return out;
}

/**
 * Restores base64 data-URL attachments back into Blob objects.
 * @param {Object[]} attachments
 * @returns {Promise<Object[]>}
 */
async function deserializeAttachments(attachments) {
  const out = [];
  for (const att of attachments || []) {
    if (!att || typeof att.data !== 'string') continue;
    try {
      const blob = await fetch(att.data).then(r => r.blob());
      out.push({
        id: att.id || newId(),
        name: att.name,
        type: att.type || blob.type,
        size: blob.size,
        blob
      });
    } catch (err) {
      console.warn('Failed to restore attachment:', att.name, err);
    }
  }
  return out;
}

/**
 * Maps a todo array to export-safe copies with serialized attachments.
 * @param {Object[]} todos
 * @returns {Promise<Object[]>}
 */
async function prepareExportTodos(todos) {
  return Promise.all((todos || []).map(async todo => ({
    ...todo,
    attachments: await serializeAttachments(todo.attachments)
  })));
}

async function exportData() {
  try {
    const profiles = await dbGetProfiles();
    const allTodos = await dbGetAllTodos();
    const data = {
      version: 1,
      type: 'all',
      exportedAt: new Date().toISOString(),
      profiles,
      todos: await prepareExportTodos(allTodos)
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `todo-app-export-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    console.error('Export failed:', err);
    alert('Failed to export data.');
  }
}

/**
 * Exports a single profile with all of its tasks as a profile file.
 * @param {number} id
 */
async function exportProfile(id) {
  try {
    const profiles = await dbGetProfiles();
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    const { active, completed, deleted } = await dbGet(id);
    const data = {
      version: 1,
      type: 'profile',
      exportedAt: new Date().toISOString(),
      profile: { name: profile.name },
      todos: await prepareExportTodos([...active, ...completed, ...deleted])
    };
    const slug = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `todo-app-profile-${slug || 'profile'}-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    console.error('Profile export failed:', err);
    alert('Failed to export profile.');
  }
}

/**
 * Reads a file as JSON. Resolves null (with an alert) on read or parse failure.
 * @param {File} file
 * @returns {Promise<Object|null>}
 */
function readJsonFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => {
      alert('Failed to read the file.');
      resolve(null);
    };
    reader.onload = (ev) => {
      try {
        resolve(JSON.parse(ev.target.result));
      } catch {
        alert('Invalid JSON file.');
        resolve(null);
      }
    };
    reader.readAsText(file);
  });
}

/**
 * Full import: dispatches on the file's format. "all" files restore
 * everything, "profile" files add a profile, legacy files overwrite
 * the current profile.
 */
async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const data = await readJsonFile(file);
  if (data === null) return;
  if (data.version === 1 && data.type === 'profile') await importProfileFile(data);
  else if (data.version === 1 && data.type === 'all') await restoreAllData(data);
  else if (data.active || data.completed || data.deleted) await importLegacyData(data);
  else alert('Invalid data file — no tasks found.');
}

/**
 * Profile import: only accepts profile files — adds a new profile,
 * never overwrites anything.
 */
async function importProfileData(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const data = await readJsonFile(file);
  if (data === null) return;
  if (data.version === 1 && data.type === 'profile') {
    await importProfileFile(data);
  } else {
    alert('Not a profile file. Use Import Data for full backups.');
  }
}

/**
 * Adds the file's profile as a new profile (name from the file) with its
 * tasks. Existing profiles and tasks are untouched.
 */
async function importProfileFile(data) {
  const name = (data.profile && data.profile.name) || 'Imported';
  const todoCount = Array.isArray(data.todos) ? data.todos.length : 0;
  if (!(await showConfirm(`Add a new profile "${name}" with ${todoCount} ${todoCount === 1 ? 'task' : 'tasks'}? Existing data is not modified.`))) return;
  try {
    const prepared = [];
    for (const todo of data.todos || []) {
      const { id, ...todoWithoutId } = todo;
      prepared.push({
        ...todoWithoutId,
        attachments: await deserializeAttachments(todo.attachments)
      });
    }
    // Profile + tasks in one transaction so a failed import rolls back cleanly
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, PROFILES_STORE_NAME], 'readwrite');
      const profileReq = tx.objectStore(PROFILES_STORE_NAME).add({ name });
      profileReq.onsuccess = () => {
        const newProfileId = profileReq.result;
        for (const todo of prepared) {
          const req = tx.objectStore(STORE_NAME).add({ ...todo, profileId: newProfileId });
          req.onerror = () => console.warn('Failed to import todo:', req.error);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      profileReq.onerror = () => reject(profileReq.error);
    });
    renderProfiles();
    alert(`Profile "${name}" imported.`);
  } catch (err) {
    console.error('Profile import failed:', err);
    alert('Failed to import profile.');
  }
}

/**
 * Restores a full backup: replaces all profiles and tasks.
 */
async function restoreAllData(data) {
  if (!(await showConfirm('Importing will replace ALL profiles and tasks. Continue?', true))) return;
  try {
    const prepared = [];
    for (const todo of data.todos || []) {
      const { id, ...todoWithoutId } = todo;
      prepared.push({
        ...todoWithoutId,
        attachments: await deserializeAttachments(todo.attachments)
      });
    }
    // Wipe + write in one transaction; profile ids are kept so the
    // tasks' profileId references stay valid.
    const tx = db.transaction([STORE_NAME, PROFILES_STORE_NAME], 'readwrite');
    const todosStore = tx.objectStore(STORE_NAME);
    const profilesStore = tx.objectStore(PROFILES_STORE_NAME);
    todosStore.clear();
    profilesStore.clear();
    for (const profile of data.profiles || []) {
      profilesStore.put({ id: profile.id, name: profile.name });
    }
    for (const todo of prepared) {
      const req = todosStore.add(todo);
      req.onerror = () => console.warn('Failed to import todo:', req.error);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const profiles = await dbGetProfiles();
    const next = profiles.find(p => p.id === currentProfileId) || profiles[0];
    if (!next) {
      alert('The backup contained no profiles.');
      return;
    }
    await activateProfile(next.id);
    alert('Data imported successfully!');
  } catch (err) {
    console.error('Import failed:', err);
    alert('Failed to import data.');
  }
}

/**
 * Legacy format ({active, completed, deleted}): overwrites the current profile.
 */
async function importLegacyData(data) {
  if (!(await showConfirm('Importing will overwrite all tasks in the current profile. Continue?', true))) return;
  try {
    // Restore attachments to Blobs before writing (async, so outside the transaction)
    const prepared = [];
    for (const arr of [data.active, data.completed, data.deleted]) {
      if (Array.isArray(arr)) {
        for (const todo of arr) {
          const { id, ...todoWithoutId } = todo;
          prepared.push({
            ...todoWithoutId,
            profileId: currentProfileId,
            attachments: await deserializeAttachments(todo.attachments)
          });
        }
      }
    }

    // Wipe + write in one transaction so a failed import can't leave the
    // profile empty (a rejected tx rolls back both the deletes and the adds).
    const existingKeys = await new Promise((resolve, reject) => {
      const readTx = db.transaction(STORE_NAME, 'readonly');
      const req = readTx.objectStore(STORE_NAME).index('profileId').getAllKeys(IDBKeyRange.only(currentProfileId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    existingKeys.forEach(key => store.delete(key));
    const importCounts = prepared.map(todo => {
      const req = store.add(todo);
      req.onerror = () => console.warn('Failed to import todo:', req.error);
      return req;
    });
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
    alert('Failed to import data.');
  }
}

/**
 * Permanently deletes trashed tasks older than 30 days, across all profiles.
 * Syncs the current profile's in-memory trash list afterwards.
 * @returns {Promise<void>}
 */
async function purgeAllTrash() {
  if (!(await showConfirm('Permanently delete trashed tasks older than 30 days, across all profiles? This cannot be undone.', true))) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const request = store.index('deleted').getAll(1);
  request.onsuccess = () => {
    request.result
      .filter(t => t.deletedAt && t.deletedAt < cutoff)
      .forEach(t => store.delete(t.id));
  };
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const before = deleted.length;
  deleted = deleted.filter(t => !(t.deletedAt && t.deletedAt < cutoff));
  if (before !== deleted.length) {
    render();
    console.log(`Trash purge: ${before - deleted.length} item(s) purged`);
  }
}

async function clearAllData() {
  if (!(await showConfirm('Are you sure you want to clear ALL data? This cannot be undone.', true))) return;
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
  await runScheduledReemergence();
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
  document.getElementById('import-profile-btn')?.addEventListener('click', () => document.getElementById('import-profile')?.click());
  document.getElementById('import-profile')?.addEventListener('change', importProfileData);
  document.getElementById('purge-trash')?.addEventListener('click', purgeAllTrash);
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
    if (action === 'export') exportProfile(id);
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

init().catch(err => {
  console.error('Failed to initialize app:', err);
  alert('Failed to start the app. Check the console for details.');
});
