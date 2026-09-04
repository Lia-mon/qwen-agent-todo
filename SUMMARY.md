# Todo App — Project Summary

## Overview

A vanilla HTML/CSS/JS **Progressive Web App** (PWA) for tracking tasks with repeatable schedules, importance levels, urgency tracking, and deadline management. Data is persisted in IndexedDB with a soft-delete trash system.

---

## Next Up

The repeatable task rework (fixed-schedule re-emergence + stacking) is implemented and merged. Open items:

- **Re-emergence notifications** — `runScheduledReemergence()` logs only; the old "N tasks re-emerged" notification is not wired in (part of the notifications rework in `untracked/report.md`).
- **README refresh** — README still claims SW background sync, repeat notifications, and the old repeat list; rewrite pending.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page HTML structure. Contains the task panel, settings dialog, add/edit dialog, and confirm dialog. Loads all CSS themes and the JS bundle. |
| `app.js` | All application logic (~2900 lines). DOM manipulation, IndexedDB operations, rendering, filtering, pagination, notifications, theme switching, profile management, data import/export. |
| `styles.css` | Base styles and CSS custom properties (colors, radii, transitions, spacing). Defines the "Classic" theme. Includes base layout, components, badges, trash actions, pagination, and responsive breakpoints. |
| `girly.css` | Pink/pastel theme override — rounded corners, soft shadows, pink accent colors. |
| `suave.css` | Dark navy theme — sharp corners, no shadows, cool blue/red palette, Inter font. |
| `gothic.css` | Black/red gothic theme — zero border-radius, serif fonts (Cinzel), no shadows, dramatic red accents, decorative emoji icons. |
| `farm.css` | Warm pastoral theme — green accent, rounded corners, soft shadows, Nunito font, radial gradient background, decorative emoji icons. |
| `manifest.json` | PWA manifest — name, icons (192×192, 512×512), standalone display mode, theme/background colors. |
| `sw.js` | Development service worker — pre-caches critical assets on activate, network-first fetch with stale-while-revalidate re-caching, notification click handler to focus/open app window. |
| `icon-192x192.png` | PWA icon (192×192). |
| `icon-512x512.png` | PWA icon (512×512). |
| `icon.xcf` | GIMP source file for the PWA icons. |
| `SUMMARY.md` | This document. |

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
  repeat: string | null  // 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'biyearly' | 'yearly'; '' = no repeat; '30s' legacy-only
  notes: string          // Free-form notes (dialog textarea)
  subtasks: Array<{id: string, text, done}>  // id is a UUID string (crypto.randomUUID) — unlike numeric todo/profile ids
  attachments: Array<{id, name, type, size, blob: Blob}>  // File attachments
  completed: number      // 0 = active, 1 = completed
  completedAt: number | null
  deleted: number        // 0 = not deleted, 1 = trashed
  deletedAt: number | null
  nextRepeatDate: number  // Next fixed cycle moment; present on all repeatable tasks (active or completed), deleted (never nulled) otherwise
  repeatStack: number     // Count of crossed cycles stacked while the task was still active (0 when none)
  profileId: number              // Owning profile (profiles store)
}
```

Two boolean flags (`completed`, `deleted`) create four logical states:

| completed | deleted | State |
|-----------|---------|-------|
| 0 | 0 | Active |
| 1 | 0 | Completed |
| 0 | 1 | Deleted (trash) |
| 1 | 1 | Deleted (trash) |

### Storage

- **IndexedDB** (version 3): `TodoAppDB` → `todos` store with indexes on `deleted`, `completed`, `createdAt`, `completedAt`, `profileId`, `nextRepeatDate` (non-unique); `profiles` store (`id` autoIncrement, `name`) with a `name` index
- **Profiles**: each todo belongs to a profile via `profileId`. The v1 → v2 migration creates a 'Default' profile and assigns all legacy todos to it; the v2 → v3 migration adds the `nextRepeatDate` index (existing DBs upgrade on next open). Only the current profile's todos are loaded into memory; switching profiles (`loadProfile` → `activateProfile`) reloads that profile's todos, sorts them, resets pagination/urgency state, and persists the choice to `localStorage('activeProfile')`. `activateProfile(id)` is the shared body used by profile switching and full-data restore (it works even when the profile is already active). Deleting a profile hard-deletes its todos (active profile and last profile cannot be deleted)
- **In-memory arrays**: `active[]`, `completed[]`, `deleted[]` — the JS source of truth for the current profile, synced to IndexedDB
- **localStorage**: Theme preference (`theme` key), active profile (`activeProfile` key)

### Core Flow

```
init()
  ├── openDB() — open IndexedDB connection (runs version upgrades; shows a
  │              "another tab is open" banner if the upgrade is blocked)
  ├── ensureStore() — recreate DB if a store is missing
  ├── resolveCurrentProfile() — pick saved/first profile, persist choice
  ├── dbGet(profileId) — load that profile's active/completed/deleted into memory
  ├── runScheduledReemergence() — process due repeatables: re-emerge or stack (all profiles)
  ├── lastUrgencyMap seed → checkTasks() — one-shot urgency tracking
  ├── render() — build DOM from memory arrays
  └── event listeners setup

The `init()` call has a top-level `.catch()` that logs and alerts, so a failed
open no longer leaves a silently blank page.

addTodo() → dbAdd() → prepend item + updateFooter()
toggleTodo() → dbPut() → removeTodoFromDOM() + updateFooter() (completing a repeatable sets nextRepeatDate on the fixed schedule and resets any stack to 0; decompleting re-sets it from now)
deleteTodo() → dbPut() → removeTodoFromDOM() + updateFooter() + renderSettingsTrash() (if trash tab open)
restoreTrash() → dbPut() → render() (re-renders main list + trash tab)
permanentDeleteTrash() → dbDelete() → animate + remove → update pagination
updateTodo() → dbPut() → updateTodoInDOM() (in-place, no pagination reset)
exportData() → all profiles + all todos → JSON download
importData() → dispatches on file format: 'all' → atomic wipe+restore, 'profile' → new profile, legacy → atomic wipe+write over current profile
importProfileData() → accepts 'profile' files only → new profile, nothing overwritten
clearAllData() → clears the entire todos store (all profiles)
purgeAllTrash() → manual (Data Management): permanently deletes trash >30 days old, all profiles
```

---

## Features

### Task Management

- **Add tasks** via dialog with text, repeat schedule, importance, duration, deadline, notes, subtasks, and file attachments
- **Edit tasks** via the Edit button at the right of the item (same dialog, `editingTodoId` tracks mode)
- **Dialog sizing** — on ≤600px viewports the add/edit dialog takes over the full screen (100dvh, no radius); the form scrolls internally (`flex: 1; min-height: 0; overflow-y: auto`) with a visible themed scrollbar — styled `::-webkit-scrollbar` forces a persistent scrollbar on mobile browsers that default to invisible overlays
- **Notes** — free-form textarea in the dialog; a note badge (file-text icon) shows at the right of the list item
- **Subtasks** — inline checklist in the dialog (add/check/remove); an `N/M` progress badge shows at the right of the list item; subtasks can also be toggled directly from the Details panel (persists via `dbPut`, updates badge/heading in place)
- **Attachments** — styled file picker in the dialog (dashed drop-zone, image files get a gallery preview); blobs stored on the todo, single badge at the right of the list item — paperclip icon when there are non-image attachments, image icon + count for images (inline Feather SVGs, `stroke: currentColor`, so they follow the badge's theme color; images viewable in the Details panel); click a name in the edit dialog to download
- **Details panel** — a Details button (shown when the item has notes, subtasks, or image attachments) toggles an inline `.task-extras` panel showing the notes text, a tappable subtask checklist (✓/○), and an Images section (grid of attached images) when present; attachments themselves (name + size, click to download) live only in the edit dialog. The chevron rotates to indicate the open state. Toggled via the `expand-extras` delegated action
- **Complete tasks** by clicking the checkbox — fade+shrink exit animation (`.todo-item.removing`, element removed on `transitionend` with a timeout fallback), then moves from active to completed
- **Delete tasks** (soft delete) — moves to trash, not permanently removed
- **Restore from trash** — moves back to active or completed depending on prior state
- **Permanent delete** — removes from IndexedDB, animated removal from trash list

### Repeatable Tasks

Repeatable tasks track their next fixed calendar cross at **all times** (local time), not just while completed:

| Repeat (UI label) | Cycle crosses at |
|-------------------|---------------|
| `daily` (Daily) | Every day, 5am |
| `biweekly` (Twice Weekly) | Wednesday 5pm or Sunday 5am, whichever is next |
| `weekly` (Weekly) | Sunday 5am |
| `monthly` (Monthly) | 1st of the month, 5am |
| `biyearly` (Twice Yearly) | Jul 1 5am or Jan 1 5am, whichever is next |
| `yearly` (Yearly) | Jan 1 5am |

- `nextRepeatDate` is maintained via `syncNextRepeatDate(todo, afterMs)` at every state change: add, edit, complete, decomplete, and restore-from-trash. Completing anchors it to `completedAt`; active tasks anchor to now (an existing still-future date is kept on edit unless the repeat changed).
- **Stacking** — when a due scan finds an active task past its `nextRepeatDate`, it does not re-emerge; instead every cross missed since the stored date (the stored date itself is due and counts) is added to `repeatStack`, and `nextRepeatDate` advances to the first cross after now. Missed cycles accumulate (shown as an `x N` suffix on the title, where N = repeatStack + 1, i.e. total cycles owed; coloured per theme via `--stack-count`) until the task is completed, which resets the stack. Due active tasks are grouped by repeat value: all tasks of a type land on the same final date, so it is computed once per type; each task counts its own missed crosses with a simple loop.
- **Re-emergence** — when a cycle cross arrives while the task is completed, `runScheduledReemergence()` moves it back to active (`completed = 0`, `completedAt = null`, `repeatStack` reset to 0) and re-anchors `nextRepeatDate` to the next cross from now — re-emerged tasks carry a next cycle just like any other active repeatable. Re-emergence is one-shot: crosses missed while completed are not counted. It scans the `nextRepeatDate` index for records ≤ now (`dbGetDueTodos`) **across all profiles**, re-renders, and logs counts. Runs on `init()` and on every `activateProfile()` (profile switch / full-data restore).
- Editing a completed repeatable recomputes `nextRepeatDate` from `completedAt` (or deletes it if the repeat was removed).
- Re-emerged tasks keep their original `createdAt` sort position (they don't jump to the top of the list).
- Legacy `'30s'` repeat values have no fixed schedule: `nextCrossMoment` returns `null`, so `syncNextRepeatDate` deletes the field and legacy tasks stop repeating once their stored `nextRepeatDate` (if any) is processed.

### Urgency System

`calculateUrgency(deadline, duration)` computes urgency by comparing available time until deadline against estimated task duration:

- **Stressy**: Deadline is close relative to duration (tight window)
- **Balanced**: Reasonable buffer between duration and deadline
- **Lax**: Plenty of time relative to duration

`checkTasks()` (urgency tracking only) detects changes and triggers grouped notifications. Dormant while the periodic interval is disabled — it runs once on init; `lastUrgencyMap` seeds the baseline at init and on profile switch.

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
| Data Management | Export JSON (all profiles + all todos), Import JSON (dispatched by file format), Import Profile (adds a new profile from a profile file), Purge Trash (permanently deletes trash older than 30 days, all profiles), Clear All Data — all profiles (attachment blobs are serialized to base64 data URLs for export and restored to Blobs on import) |
| Personalization | Theme selector (Classic/Girly/Suave/Gothic/Farm), Reduce Motion toggle |
| Trash | Paginated list of deleted tasks with Restore / Delete Forever buttons |
| Profiles | Add/Edit/Delete profiles; Load button switches the active profile (marked with an "Active" badge); per-row Export button downloads that profile's todos |

### Theming

Five themes applied by enabling/disabling separate CSS files. Theme is persisted in `localStorage`. Each theme defines its own `:root` CSS custom properties (colors, radii, shadows, transitions) and overrides component styles. Theme color meta tag updates to match.

The base `styles.css` is fully tokenized: every color lives in `:root` as a custom property (including `--color-title`, `--color-hover`, `--color-toggle-off`, `--color-toggle-knob`, `--color-checkbox-border`, `--color-backdrop`, `--color-on-accent`). Component rules never hardcode a color, so themes re-skin by overriding tokens in their `:root` block plus a handful of structural overrides (fonts, radii, decorative icons, gradients). Theme files contain only rules that genuinely differ from the base — redundant copies of base declarations have been pruned.

In the dark themes (`gothic`, `suave`), `--color-primary` is too dark to read as text on the dark background, so each file ends with a small override block giving text-color uses of the accent (attachment names, some hover states) a lighter theme-appropriate color, and overriding the note/subtasks/attachments badge tokens (which the base theme renders with light backgrounds).

### Notifications

Browser Notification API. Grouped notifications (`sendGroupedNotification`) support:
- Task re-emergence (repeatable tasks) — not emitted; `runScheduledReemergence` logs only
- Urgency changes — the only type wired (via `checkTasks`), but currently unreachable: `init()` seeds `lastUrgencyMap` right before the first `checkTasks()` run, so no change is ever detected, and the periodic interval is disabled

Notification click focuses or opens the app window (handled by SW).

The whole path is dormant until the notifications rework (separate branch; see `untracked/report.md`).

### Service Worker

Development strategy: **network-first** with stale-while-revalidate caching. Always fetches fresh assets, caches successful GET responses for future requests. Caches named `todo-app-dev`.

---

## Key Patterns

### Event Delegation

`#todo-list`, `#settings-deleted-list`, and `#settings-profiles-list` (load/export/edit/delete) use event delegation via `data-action` + `data-id` attributes on child elements, with `closest('[data-action]')` to find the clicked action.

### Incremental DOM Updates

- `updateTodoInDOM()` — finds element by `data-id`, replaces with updated version
- `removeTodoFromDOM()` — removes element by `data-id`
- `permanentDeleteTrash()` — swaps in next-page item from the trash list

### Shared Helpers

- `binaryInsert(arr, item, compare)` — sorted insertion; used when completing and decompleting tasks so items land in their sorted position
- `downloadBlob(blob, filename)` — object-URL download with a deferred (1s) revoke; single implementation for all three download sites (item, details panel, dialog)
- `serializeAttachments()` / `deserializeAttachments()` — base64 data URLs for export/import round-trips
- `activateProfile(id)` — shared profile-activation body (load, sort, reset pagination, re-seed `lastUrgencyMap`, render)
- `nextCrossMoment(repeat, afterMs)` — next fixed re-emergence moment for a repeat value, strictly after `afterMs` (local time); `null` for values outside the schedule
- `syncNextRepeatDate(todo, afterMs)` — sets (or deletes) `todo.nextRepeatDate` from its repeat value; the single write-site for the field
- `dbGetDueTodos(nowMs)` — `nextRepeatDate` index scan for records ≤ now
- `showConfirm(message, danger)` — Promise-based confirm dialog (replaces `confirm()`); `danger` styles the confirm button as destructive

### Soft-Delete Pattern

Tasks are never immediately removed. Deletion sets `deleted = 1` and `deletedAt = Date.now()`, moving the task to the `deleted[]` array. Tasks reside in trash until permanently deleted, allowing restoration.

---

## Known / Intentional Design Decisions

1. **In-memory arrays as source of truth** — IndexedDB is the persistence layer, but JS arrays drive the UI. Manual DB edits will desync until page reload.
2. **5-minute `checkTasks()` interval disabled** — `checkTasks` is urgency-only now and runs once on init. Urgency notifications are paused until the interval is re-enabled (see the deferred bundle in `untracked/report.md`).
3. **Trash ignores filters** — The settings trash shows all deleted items regardless of active filter state.
4. **Single dialog for add and edit** — `#add-task-dialog` is reused; `editingTodoId` distinguishes the mode.
5. **iOS zoom backstop is scoped, not global** — each form control declares `font-size: 1rem` explicitly; a `@media (pointer: coarse)` rule forces `16px !important` on touch devices only, where mobile browsers auto-zoom on focus of sub-16px inputs. Desktop rendering is governed purely by the explicit declarations.
6. **`addTodo` prepends regardless of active filters** — a new task should appear immediately even if it doesn't match the current filter.
7. **`clearAllData` clears the entire todos store** — all profiles, not just the current one; the confirm text says "ALL data" on purpose.
8. **Subtask ids are UUID strings, todo/profile ids are numbers** — never `Number()` a subtask id.
9. **`30s` repeat value is legacy** — removed from the UI and from the code (`getRepeatMs` is gone). `nextCrossMoment` returns `null` for it, so legacy tasks stop repeating once their stored `nextRepeatDate` is processed (re-emergence if completed, field deletion if active).
10. **`nextRepeatDate` is deleted, never nulled** — `null` is a valid IndexedDB key that sorts below all numbers and would keep the record in the `nextRepeatDate` index forever.
11. **Stacking resets on completion** — completing (or decompleting) a repeatable resets `repeatStack` to 0; the stack only accumulates while the task sits active across cycle crosses. Restoring an active repeatable from trash re-anchors `nextRepeatDate` to now but keeps any existing stack.
12. **Soft delete has no confirm** — the trash is the safety net; all other destructive actions (permanent delete, profile delete, overwriting imports, purge, clear all) use the custom confirm dialog with the danger variant.
13. **Trash purge is manual** — the Purge Trash button (Data Management) permanently deletes trash older than 30 days across all profiles; there is no automatic purge.
14. **No periodic background run** — PWA background sync doesn't fire in a controlled manner, so re-emergence/stacking fires on page load and profile switch only; crosses missed in between are counted (as a single scan) on next open.
15. **Missed crosses only stack while active** — re-emergence is one-shot (a completed task comes back once and re-anchors from now; crosses missed while completed are not counted), and time spent in trash doesn't stack (restoring re-anchors from now, keeping any existing stack).
16. **`formatTimestamp` omits the year for the current year** — the year is shown only for older tasks.

---

## Credits

- **Feather Icons** (https://feathericons.com) — MIT License, © Cole Bemis. Used for the note and attachments badge icons (inline in `app.js`).
