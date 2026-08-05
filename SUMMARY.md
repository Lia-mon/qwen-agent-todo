# LLM Test Todo App — Summary

## Goal

A vanilla HTML/CSS/JS Progressive Web App (PWA) for task management with urgency tracking, repeat scheduling, offline support, trash/archive system, and a dialog-based task creation/editing flow. Built as a local agent exploration project using Qwen 3.6-35B-A3B-Q4 running locally via llama.cpp through the Zed editor.

---

## State

### Completed
- **Task model** (single store): `id` (IndexedDB autoIncrement), `text`, `createdAt`, `completedAt` (timestamp or null), `completed` (0|1), `deleted` (0|1), `deletedAt` (timestamp or null), `repeat`, `importance`, `deadline` (ms timestamp), `duration` (string), `nextRepeatDate`
- **Single-store IndexedDB**: `todos` store with indexes on `id` (keyPath), `deleted`, `completed`, `createdAt`, `completedAt`. DB version: 1. AutoIncrement IDs — no manual counter needed. Store+indexes created unconditionally in `onupgradeneeded`.
- **Three in-memory arrays**: `active` (deleted=0, completed=0), `completed` (deleted=0, completed=1), `deleted` (deleted=1). All loaded from single store via `dbGetActive()`, `dbGetCompleted()`, `dbGetDeleted()` — each fetches all and filters in memory.
- **Three-section DOM**: `render()` builds three separate `<div class="section">` containers (active, completed, deleted), each with its own `<h3>` header and `<ul>` list. Filter buttons toggle section visibility via CSS class on `#todo-list` (`view-active`, `view-completed`, `view-deleted`). Toggle operations use `moveToCompleted()`/`moveToActive()` to move DOM elements directly — no full re-render.
- **Urgency** is a **computed property** (not stored) — recalculated in `checkTasks()` for notifications and in `render()` for display
- **Urgency levels**: `stressy` (overdue or ratio ≤ 3), `balanced` (ratio > 3), `lax` (ratio > 5 AND available time > 1 day / 2 days for multi-hour)
- **Repeat scheduling**: daily, weekly, monthly, 30s (test) — checked every 5 min via `setInterval` (Periodic Background Sync removed — not supported in Firefox/Safari)
- **Filters** (AND logic): Status (all/active/completed/trash), Importance (all/high/med/low), Deadline (all/overdue/today/this week), Urgency (all/stressy/balanced/lax)
- **Task creation/editing**: `<dialog>` modal opened by FAB button. Clicking a task opens the dialog in **edit mode** with pre-filled values, Cancel/Delete/Save buttons. Backdrop click does NOT close the dialog.
- **Delete confirmation**: browser `confirm()` dialog before deletion — sets `deleted = 1`, `deletedAt = Date.now()` (soft delete)
- **Trash restore UI**: "Trash" status filter renders deleted items with "Restore" and "Delete Forever" buttons. Restore sets `deleted = 0`, `deletedAt = null`. Delete Forever permanently removes from DB.
- **Auto-purge trash**: `checkTasks()` permanently deletes trash items older than 30 days on each 5-min interval check.
- **Toggle complete/decomplete**: Searches both `active` and `completed` arrays. Completes → moves to `completed` (sets `completed=1`, `completedAt`, `nextRepeatDate`). Decompletes → moves back to `active` (clears `completed`, `completedAt`, `nextRepeatDate`).
- **Delete from any view**: `deleteTodo()` searches `active` then `completed`. Moves item from its current array to `deleted`, sets `deleted=1`, `deletedAt`.
- **PWA**: Service Worker with cache-first for assets, network-first for HTML, offline fallback. SW only handles caching — repeat checking is page-only
- **Responsive**: body `width: 80%`, `max-width: 835px` on desktop; `width: 100%` on mobile (two breakpoints: 1043px and 600px). Panels `height: 95vh` on desktop, `100vh` on mobile. `#todo-list` with `flex: 1` + `overflow-y: auto`. No top/bottom padding on mobile
- **JSDoc annotations**: fully applied to `app.js` and `sw.js`
- **README.md**: created with project details, tech stack, agent notes

### Current Blockers
- **None**

---

## Context

### Constraints & Preferences
- **No frameworks** — pure vanilla HTML/CSS/JS
- **No build step** — serve via any static server
- **IndexedDB** over localStorage (SW needs DB access)
- **Urgency is derived data** — never stored, always recalculated on render
- **Deadline stored as ms timestamp** — converted from `datetime-local` string on submit via `new Date(deadlineStr.replace(' ', 'T')).getTime()`
- **Mobile**: body `width: 100%`, `padding-top: 0`, `padding-bottom: 0`, panels `height: 100vh`, `#todo-list` with `flex: 1` + `overflow-y: auto`
- **Desktop**: body `width: 80%`, `max-width: 835px`, `padding: 20px` top/bottom, panels `height: 95vh`
- **FAB button**: fixed bottom-right, 56px circle, blue, `z-index: 100`
- **Dialog backdrop**: `rgba(0,0,0,0.4)` with `backdrop-filter: blur(4px)` — backdrop click does NOT close dialog (Cancel/Save required)
- **Delete confirmation**: browser `confirm()` dialog
- **Filter bar**: horizontal layout with gear button (`⚙`) and collapsible filter panel, wrapped in `.filter-bar` flex container
- **Agent model**: Qwen 3.6-35B-A3B-Q4, llama.cpp, Zed editor

### Key Files
| File | Purpose |
|---|---|
| `index.html` | App shell — task panel, filter bar (with Trash button), dialog modal, FAB |
| `styles.css` | All responsive styles, dialog, badges, FAB, filter bar, trash actions |
| `app.js` | IndexedDB CRUD (single store), rendering, filtering, SW registration, init, `checkTasks()` |
| `sw.js` | Service Worker — caching (install/activate/fetch), notification click handler |
| `manifest.json` | PWA manifest |
| `SUMMARY.md` | Project context summary |
| `README.md` | GitHub readme |

---

## Architecture Decisions

1. **Edit dialog**: Clicking a task opens dialog in edit mode with pre-filled values. Delete button only visible in edit mode. Backdrop click does NOT close dialog.
2. **Filter bar**: Horizontal layout with gear button (`⚙`) and collapsible filter panel. Uses `filter-bar` flex container.
3. **Single store + 3 in-memory arrays + 3-section DOM**: `todos` store with integer flags `completed` (0/1) and `deleted` (0/1). IndexedDB autoIncrement for IDs. All records fetched via `store.openCursor()` then filtered in memory into `active` (deleted=0, completed=0), `completed` (deleted=0, completed=1), `deleted` (deleted=1) arrays. `render()` builds three `<div class="section">` containers. Filter buttons toggle section visibility via CSS class on `#todo-list`. Toggle operations use `moveToCompleted()`/`moveToActive()` to move DOM elements directly — no full re-render. Store+indexes created unconditionally (DB_VERSION=1, no migration).
4. **No Periodic Background Sync**: Not supported in Firefox/Safari. `setInterval` every 5 min is the only client-side option.
5. **Race condition fix**: Page handles all repeat checking (`checkTasks()` in app.js). SW only handles caching and notifications when app is closed.
6. **Grouped notifications**: `sendGroupedNotification()` sends one notification per `checkTasks()` run, grouping re-emerges + urgency changes.
7. **Urgency tracking**: In-memory `lastUrgencyMap` (not stored in DB).
8. **Render split**: `render()` for full rebuilds (filter changes, initial load), targeted DOM helpers (`addTodoToDOM`, `updateTodoInDOM`, `removeTodoFromDOM`, `addTrashTodoToDOM`, `restoreTodoToDOM`) for individual CRUD operations — each updates only the affected element. `moveToCompleted()` / `moveToActive()` for toggle operations. `updateTimers()` for lightweight badge/countdown updates by matching `data-id`.
9. **Service Worker**: Cache-first for static assets, network-first for HTML, offline fallback to `./index.html`. Per-resource error handling on install. Cache name: `todo-app-v3`.
10. **Capacitor compatibility**: Files can be bundled directly — IndexedDB data persists, SW caching won't work in WebView but is harmless.

---

## Pitfalls

- **`datetime-local` timezone**: The input returns a local datetime string like `"2026-08-02T15:30"` which `new Date()` can misinterpret as UTC. Fixed by replacing space with `T` before parsing. Do not remove this fix.
- **SW paths must be relative**: Use `./` prefix for all cached resources and icon references. Absolute paths (`/index.html`) fail on GitHub Pages subdirectory deployments.
- **SW no longer handles repeat checking**: The page (`app.js`) is now the sole writer to IndexedDB for repeat tasks. SW only caches assets and shows notifications.
- **Periodic Background Sync removed**: Not supported in Firefox/Safari; `setInterval` is the only client-side option.
- **`completed`/`deleted` are integers (0/1)**: Booleans are not valid IndexedDB key types for `IDBKeyRange`. Fresh DB with integer flags — no migration from old boolean data.
- **`completedAt` is nullable timestamp**: Set to `Date.now()` on complete, `null` on decomplete.
- **`toggleTodo()` searches all arrays**: Finds tasks in both `active` and `completed` — clicking a completed task's checkbox decompletes it (moves back to active, clears `completedAt`/`nextRepeatDate`).
- **`deleteTodo()` searches all arrays**: Finds tasks in both `active` and `completed` — moves item to `deleted` array.
- **`lastUrgencyMap` is in-memory only**: Urgency is never persisted to IndexedDB.
- **Reopened tasks strip completion metadata**: `checkTasks()` sets `completed = 0`, `completedAt = null`, deletes `nextRepeatDate` before persisting.
- **Toggle from completed view**: `toggleTodo()` searches both `active` and `completed` arrays — clicking a completed task's checkbox decompletes it (moves back to active, clears `completedAt`/`nextRepeatDate`).
- **`updateTimers()` matches by `data-id`**: Never match by text content — fragile with duplicate task names.
- **`moveToCompleted()` strips urgency badge**: When moving an element from active to completed, the urgency badge is removed. When moving back, it's re-added if the task has a deadline.
- **Section-based DOM**: Filter buttons toggle `view-*` class on `#todo-list` — CSS hides/shows sections. Toggle operations move DOM elements between sections directly.
- **`padding-bottom: 0px`** in CSS — the `px` is redundant (cosmetic, not a bug).

---

## SW.js Audit

| # | Feature | Status |
|---|---------|--------|
| 1 | Per-resource install error handling | ✅ |
| 2 | Cache cleanup on activate | ✅ |
| 3 | `clients.claim()` + `skipWaiting()` | ✅ |
| 4 | Network-first for HTML | ✅ |
| 5 | Cache-first for assets | ✅ |
| 6 | Notification click handler | ✅ |
| 7 | Offline fallback | ✅ |
| 8 | Navigation preload | ⚠️ (deferred) |
| 9 | HTML cache-warming | ⚠️ (deferred) |
| 10 | Push handler | Removed (intentional) |
| 11 | Message handler | Not needed |

**Summary**: SW.js hardened. Install has per-resource error handling. Fetch differentiates HTML (network-first) from assets (cache-first). Two deferred optimizations: navigation preload + HTML cache-warming.

---

## App Verification (Completed)
- [x] Single-store refactor: all CRUD operations use one store with integer flags
- [x] Edge case: toggle complete/decomplete moves between `active` and `completed` arrays
- [x] Edge case: delete works from both active and completed views
- [x] Edge case: filter bar "completed" view shows `completed` array
- [x] Edge case: urgency filter only applies to active tasks (verified: `isCompletedView` guard)
- [x] Edge case: grouped notification fires for re-emerges + urgency changes (verified in `checkTasks`)
- [x] Fix: `updateTimers()` now matches by `data-id` instead of text
- [x] Fix: `checkTasks()` uses in-place mutation (no store switching)
- [x] Fix: Reopened tasks strip `completedAt`/`nextRepeatDate` before moving to active
- [x] Fix: `updateTimers()` looks up tasks from all three arrays
- [x] Cleanup: `openDB()` — unconditional store+index creation (no migration guards)
- [x] Cleanup: `dbGet*()` functions — simplified to `store.openCursor()` + in-memory filter
- [x] Cleanup: `checkTasks()` — consolidated duplicate purge loops into single pass
- [x] Cleanup: `sendGroupedNotification()` — replaced nested ternaries with block logic
- [x] Cleanup: `resetDialog()` — now resets `deadlineInput` and `durationSelect`
- [x] Improvement: Event delegation on `todoList` — single click handler replaces per-item listeners
- [x] Improvement: `updateTimers()` footer uses `updateFooter()` — consistent counts
- [x] Improvement: `deleteTodo()` / `restoreTrash()` use `findIndex` + `splice` — single-pass array ops
- [x] Improvement: `onblocked` handler in `openDB()` — warns when DB upgrade is blocked
- [x] Major refactor: Three-section DOM (active/completed/deleted) — filter buttons toggle visibility via CSS class
- [x] Major refactor: `moveToCompleted()` / `moveToActive()` — DOM elements moved directly on toggle, no full re-render
- [x] Major refactor: `updateFooter()` helper — centralized footer logic from `render()`, `toggleTodo()`, `updateTimers()`
- [x] Fix: `dbPut` returns assigned ID via `request.result`; added `dbAdd()` for new-item inserts
- [x] Fix: `addTodo` uses `dbAdd()` and assigns `todo.id` before DOM operations — fixes `data-id="undefined"` breaking event delegation on new elements
- [x] Cleanup: Removed debug `console.log` from `addTodoToDOM()` and event delegation handler
- [x] **Code review cleanup** — extracted duplicate `classMap` to module-level `VIEW_CLASS_MAP`; consolidated 3 `querySelector` calls in `moveToActive` to single group selector; removed dead `.todo-item .delete-btn` CSS; fixed `padding-bottom: 0px` → `0`; merged duplicate label styles in CSS
- [x] **DB store recovery** — added `ensureStore()` in `init()`: checks if `todos` store exists, and if missing (e.g. after manual DB deletion), closes connection, deletes DB, and reopens fresh to force `onupgradeneeded`
- [x] **Form `method="dialog"` removal** — was causing dialog to close synchronously on submit before async `addTodo` completed

## Next Steps

### Code Improvements (Ongoing)
- [x] **Event delegation** on `todoList` — replaced per-item `addEventListener` with single delegated handler using `data-action` + `data-id` attributes. Eliminates listener churn on every render.
- [x] **`updateTimers()` footer alignment** — now uses `updateFooter()` helper so counts stay consistent.
- [x] **Simplified CRUD** — `deleteTodo()` and `restoreTrash()` now use `findIndex` + `splice` (single pass) instead of `find` + `indexOf` + `splice` (two passes).
- [x] **`onblocked` handler** in `openDB()` — warns user when DB upgrade is blocked by another tab holding a connection.
- [x] **Three-section DOM** — `render()` builds separate active/completed/deleted section containers. Filter buttons toggle visibility via CSS class (`view-active`, `view-completed`, `view-deleted`). Toggle operations use `moveToCompleted()`/`moveToActive()` to move DOM elements directly — no full re-render.
- [x] **`updateFooter()` helper** — centralized footer visibility/count logic, called from `render()`, `toggleTodo()`, `updateTimers()`, and filter button handler.
- [x] **Targeted DOM updates** — extracted `buildItem()` as standalone function; CRUD operations use `addTodoToDOM()`, `updateTodoInDOM()`, `removeTodoFromDOM()`, `addTrashTodoToDOM()`, `restoreTodoToDOM()` to update only the affected element instead of full re-render. `render()` reserved for filter changes and initial load.
- [x] **`dbPut` returns assigned ID** — captures `request.result` from IndexedDB so callers get the autoIncrement ID. Added `dbAdd()` for new-item inserts.
- [x] **`addTodo` ID timing fix** — uses `dbAdd()` and assigns `todo.id` before `addTodoToDOM()`, fixing `data-id="undefined"` on new elements that broke event delegation.
- [x] **Debug logs removed** — cleaned up `console.log` statements from `addTodoToDOM()` and event delegation handler.

### SW.js (Deferred)
- [ ] Enable `navigationPreload` in activate handler
- [ ] Add `cache.put()` for HTML in network-first path

### Capacitor (Future)
- [ ] Bundle existing files into Capacitor project
- [ ] SW caching will be inert in WebView (harmless)
- [ ] IndexedDB data persists across sessions

---

### Current Status

**All code review items completed.** The app is structurally sound with:
- **Single-store IndexedDB** with integer `completed` (0|1) and `deleted` (0|1) flags
- **Three-section DOM** — active/completed/deleted `<div class="section">` containers, each with `<h3>` header + `<ul>` list
- **Section visibility** — filter buttons toggle CSS class on `#todo-list` (`view-active`, `view-completed`, `view-deleted`)
- **Targeted DOM updates** — CRUD operations update only the affected element via `addTodoToDOM()`, `updateTodoInDOM()`, `removeTodoFromDOM()`, `addTrashTodoToDOM()`, `restoreTodoToDOM()`. `render()` reserved for filter changes and initial load.
- **Direct DOM move on toggle** — `moveToCompleted()` / `moveToActive()` move elements between sections, stripping/adding urgency badges as needed
- **Event delegation** on `todoList` — single click handler dispatches to `toggleTodo`, `openEditDialog`, `restoreTrash`, `permanentDeleteTrash` via `data-action` attributes. New elements get correct `data-id` from `dbAdd()` return value.
- **`dbPut`/`dbAdd` return assigned ID** — `request.result` resolved so `todo.id` is populated before DOM operations.
- **`updateFooter()` helper** — centralized footer visibility/count logic
- **`findIndex` + `splice`** in `deleteTodo()` and `restoreTrash()` — single-pass array operations
- **`onblocked` handler** on DB open — warns user when version upgrade is blocked by another tab
- **DB_VERSION = 1** — unconditional store+index creation in `onupgradeneeded`, no migration logic
- **Three in-memory arrays**: `active`, `completed`, `deleted` — loaded from single store via `store.openCursor()` + in-memory filter
- **IndexedDB autoIncrement** for IDs (no manual counter needed)
- **Indexes** on `deleted`, `completed`, `createdAt`, `completedAt`
- Hardened Service Worker (install/fetch error handling, network-first for HTML)
- Clean task lifecycle: add → toggle → re-emerge → soft-delete → restore or purge
- Trash restore UI with Restore/Delete Forever buttons per item
- Auto-purge of trash items older than 30 days via `checkTasks()`
- In-memory urgency tracking with grouped notifications
- Data-id-based DOM updates in `updateTimers()`
- Simplified DB queries, consolidated purge logic, cleaner notification code
- **Cleaned up** — removed dead CSS, extracted duplicate constants, consolidated filter logic, fixed JSDoc return types
- **DB recovery** — `ensureStore()` handles corrupted/missing object store by deleting and recreating the DB
