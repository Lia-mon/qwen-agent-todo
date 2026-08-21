# Todo App — Project Summary

## Overview

A vanilla HTML/CSS/JS **Progressive Web App** (PWA) for tracking tasks with repeatable schedules, importance levels, urgency tracking, and deadline management. Data is persisted in IndexedDB with a soft-delete trash system.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page HTML structure. Contains the task panel, settings dialog, and add/edit dialog. Loads all CSS themes and the JS bundle. |
| `app.js` | All application logic (~2160 lines). DOM manipulation, IndexedDB operations, rendering, filtering, pagination, notifications, theme switching, data import/export. |
| `styles.css` | Base styles and CSS custom properties (colors, radii, transitions, spacing). Defines the "Classic" theme. Includes base layout, components, badges, trash actions, pagination, and responsive breakpoints. |
| `girly.css` | Pink/pastel theme override — rounded corners, soft shadows, pink accent colors. |
| `suave.css` | Dark navy theme — sharp corners, no shadows, cool blue/red palette, Inter font. |
| `gothic.css` | Black/red gothic theme — zero border-radius, serif fonts (Cinzel), no shadows, dramatic red accents, decorative emoji icons. |
| `farm.css` | Warm pastoral theme — green accent, rounded corners, soft shadows, Nunito font, radial gradient background, decorative emoji icons. |
| `manifest.json` | PWA manifest — name, icons (192×192, 512×512), standalone display mode, theme/background colors. |
| `sw.js` | Development service worker — fetch-first strategy with stale-while-revalidate caching, notification click handler to focus/open app window. |
| `icon-192x192.png` | PWA icon (192×192). |
| `icon-512x512.png` | PWA icon (512×512). |

---

## Architecture

### Data Model

```
Todo {
  id: number           // IndexedDB autoIncrement
  text: string
  createdAt: number    // Unix timestamp
  deadline: number | null   // Unix timestamp
  duration: string | null  // '5' | '10' | '30' | '60' | 'multi'
  importance: 'high' | 'medium' | 'low'
  repeat: string | null  // 'daily' | 'weekly' | 'biweekly' | 'monthly' | '30s' | ''
  notes: string          // Free-form notes (dialog textarea)
  subtasks: Array<{id, text, done}>  // Simple checklist, managed in the dialog
  attachments: Array<{id, name, type, size, blob: Blob}>  // File attachments
  completed: number      // 0 = active, 1 = completed
  completedAt: number | null
  deleted: number        // 0 = not deleted, 1 = trashed
  deletedAt: number | null
  nextRepeatDate: number | null  // For repeatable tasks
  profileId: number              // Owning profile (profiles store)
}
```

Three boolean flags (`completed`, `deleted`) create four logical states:

| completed | deleted | State |
|-----------|---------|-------|
| 0 | 0 | Active |
| 1 | 0 | Completed |
| 0 | 1 | Deleted (trash) — *invalid state, never persisted* |
| 1 | 1 | Deleted (trash) |

### Storage

- **IndexedDB** (version 2): `TodoAppDB` → `todos` store with indexes on `deleted`, `completed`, `createdAt`, `completedAt`, `profileId`; `profiles` store (`id` autoIncrement, `name`) with a `name` index
- **Profiles**: each todo belongs to a profile via `profileId`. The v1 → v2 migration creates a 'Default' profile and assigns all legacy todos to it. Only the current profile's todos are loaded into memory; switching profiles (`loadProfile`) reloads that profile's todos, resets pagination/urgency state, and persists the choice to `localStorage('activeProfile')`. Deleting a profile hard-deletes its todos (active profile and last profile cannot be deleted)
- **In-memory arrays**: `active[]`, `completed[]`, `deleted[]` — the JS source of truth for the current profile, synced to IndexedDB
- **localStorage**: Theme preference (`theme` key), active profile (`activeProfile` key)

### Core Flow

```
init()
  ├── openDB() — open IndexedDB connection (runs version upgrades)
  ├── ensureStore() — recreate DB if a store is missing
  ├── resolveCurrentProfile() — pick saved/first profile, persist choice
  ├── dbGet(profileId) — load that profile's active/completed/deleted into memory
  ├── checkTasks() — one-shot: handle repeatables & urgency changes
  ├── render() — build DOM from memory arrays
  └── event listeners setup

addTodo() → dbAdd() → prepend item + updateFooter()
toggleTodo() → dbPut() → removeTodoFromDOM() + updateFooter()
deleteTodo() → dbPut() → removeTodoFromDOM() + updateFooter() + renderSettingsTrash() (if trash tab open)
restoreTrash() → dbPut() → render() (re-renders main list + trash tab)
permanentDeleteTrash() → dbDelete() → animate + remove → update pagination
```

---

## Features

### Task Management

- **Add tasks** via dialog with text, repeat schedule, importance, duration, deadline, notes, subtasks, and file attachments
- **Edit tasks** by clicking the text area (same dialog, `editingTodoId` tracks mode)
- **Notes** — free-form textarea in the dialog; a 📝 badge marks tasks with notes in the list (hover shows the text)
- **Subtasks** — inline checklist in the dialog (add/check/remove); an `N/M` progress badge shows in the list
- **Attachments** — styled file picker in the dialog (dashed drop-zone, image files get a thumbnail preview); blobs stored on the todo, `N` count badge (📎) in the list, click a name to download
- **Complete tasks** by clicking the checkbox — moves from active to completed
- **Delete tasks** (soft delete) — moves to trash, not permanently removed
- **Restore from trash** — moves back to active or completed depending on prior state
- **Permanent delete** — removes from IndexedDB, animated removal from trash list

### Repeatable Tasks

Tasks can be set to repeat daily, weekly, biweekly, monthly, or a 30s test interval. When a repeatable task is completed, it disappears and re-emerges after its period elapses. `checkTasks()` runs once on init (interval disabled) to process re-emergence and urgency-based notifications.

### Urgency System

`calculateUrgency(deadline, duration)` computes urgency by comparing available time until deadline against estimated task duration:

- **Stressy**: Deadline is close relative to duration (tight window)
- **Balanced**: Reasonable buffer between duration and deadline
- **Lax**: Plenty of time relative to duration

Urgency changes trigger grouped notifications.

### Filtering

Three independent filter dimensions with toggle buttons:

| Dimension | Options |
|-----------|---------|
| Importance | All, High, Med, Low |
| Deadline | All, Overdue, Today, This Week |
| Urgency | All, Stressy, Balanced, Lax |

Filters apply to the main active/completed views. Trash view ignores filters.

### Pagination

- Completed list and trash list are paginated (`PAGE_SIZE` items per page)
- Previous/Next buttons with page info
- Page state tracked via `completedPage` and `trashPage`

### Settings

Five tabs in a `<dialog>` modal:

| Tab | Contents |
|-----|----------|
| Notifications | Enable/disable browser notifications |
| Data Management | Export JSON, Import JSON, Clear All Data (attachment blobs are serialized to base64 data URLs for export and restored to Blobs on import) |
| Personalization | Theme selector (Classic/Girly/Suave/Gothic/Farm), Reduce Motion toggle |
| Trash | Paginated list of deleted tasks with Restore / Delete Forever buttons |
| Profiles | Add/Edit/Delete profiles; Load button switches the active profile (marked with an "Active" badge) |

### Theming

Five themes applied by enabling/disabling separate CSS files. Theme is persisted in `localStorage`. Each theme defines its own `:root` CSS custom properties (colors, radii, shadows, transitions) and overrides component styles. Theme color meta tag updates to match.

The base `styles.css` is fully tokenized: every color lives in `:root` as a custom property (including `--color-title`, `--color-hover`, `--color-toggle-off`, `--color-toggle-knob`, `--color-checkbox-border`, `--color-backdrop`, `--color-on-accent`). Component rules never hardcode a color, so themes re-skin by overriding tokens in their `:root` block plus a handful of structural overrides (fonts, radii, decorative icons, gradients). Theme files contain only rules that genuinely differ from the base — redundant copies of base declarations have been pruned.

### Notifications

Browser Notification API. Grouped notifications for:
- Task re-emergence (repeatable tasks)
- Urgency changes

Notification click focuses or opens the app window (handled by SW).

### Service Worker

Development strategy: **network-first** with stale-while-revalidate caching. Always fetches fresh assets, caches successful GET responses for future requests. Caches named `todo-app-dev`.

---

## Key Patterns

### Event Delegation

Both `#todo-list` and `#settings-deleted-list` use event delegation via `data-action` + `data-id` attributes on child elements, with `closest('[data-action]')` to find the clicked action.

### Incremental DOM Updates

- `moveTo()` — removes element from source list, appends to target list (no full re-render)
- `updateTodoInDOM()` — finds element by `data-id`, replaces with updated version
- `removeTodoFromDOM()` — removes element by `data-id`
- `permanentDeleteTrash()` — swaps in next-page item from the trash list

### Soft-Delete Pattern

Tasks are never immediately removed. Deletion sets `deleted = 1` and `deletedAt = Date.now()`, moving the task to the `deleted[]` array. Tasks reside in trash until permanently deleted, allowing restoration.

---

## Known / Intentional Design Decisions

1. **In-memory arrays as source of truth** — IndexedDB is the persistence layer, but JS arrays drive the UI. Manual DB edits will desync until page reload.
2. **5-minute `checkTasks()` interval disabled** — Runs once on init only. Repeatable task processing and urgency timer updates are paused until re-enabled.
3. **Trash ignores filters** — The settings trash shows all deleted items regardless of active filter state.
4. **Single dialog for add and edit** — `#add-task-dialog` is reused; `editingTodoId` distinguishes the mode.
5. **iOS zoom backstop is scoped, not global** — each form control declares `font-size: 1rem` explicitly; a `@media (pointer: coarse)` rule forces `16px !important` on touch devices only, where mobile browsers auto-zoom on focus of sub-16px inputs. Desktop rendering is governed purely by the explicit declarations.
