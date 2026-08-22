Full read-through done (all ~2,410 lines, plus a check of the HTML for the repeat options). Overall the code is in good shape — consistent JSDoc, no XSS (everything goes through `textContent` except `renderProfiles`, which uses `escapeHtml`), the in-memory-arrays-as-source-of-truth + targeted-DOM-update pattern is applied consistently, and the in-place subtask toggle design is right. Here's what I found:

## Real bugs

1. **Trash auto-purge never touches IndexedDB** (L752–772). The purge loop splices old items out of `deleted[]`, *then* the persistence step iterates `deleted` again looking for items older than 30 days — but they're already gone, so `store.delete()` never runs. Purged trash comes back on the next load. Fix: collect the purged ids during the splice loop and delete those keys. — **Deferred** (only runs from `checkTasks`, which is disabled; will surface again when the interval is re-enabled).
2. **`checkTasks()` runs exactly once, at init** — the `setInterval` at L2346–49 is commented out, and `updateTimers()` has no other caller. So re-emergence, urgency-change notifications, trash purge, and the deadline countdowns are all currently dead — the countdown badges freeze at whatever value they had on load. If that's intentional while you're testing, fine, but it's silent. — **Deferred** (intentional while testing; timers/notifications rework goes in a dedicated branch, takes #1 with it).
3. **`addTodo` ignores active filters** (L1652–53). It unconditionally `prepend`s the new item, so with e.g. the importance filter on, a non-matching new task still appears. `render()` and `updateTodoInDOM()` both respect filters; `addTodo` doesn't. — **Kept as-is** (deliberate UX: the new task should appear immediately even if it doesn't match the active filter).
4. **Decompleting a task appends to the bottom of the active list** (L1759). The complete path uses `binaryInsert` by `completedAt`; the decomcomplete path does `active.push(todo)`, so the item lands at the end instead of its `createdAt`-sorted position. Same `binaryInsert` call fixes it. — **Fixed** (decomplete path now uses `binaryInsert` by `createdAt` desc).
5. **`importData` doesn't re-sort** (L2226–30). `dbGet` returns index order (oldest first); `init`/`loadProfile` sort descending. After an import, the active list shows oldest-on-top. It also doesn't reset `lastUrgencyMap`, and the `totalCount` log (L2222) becomes `NaN` if any of the three arrays is missing from the file. — **Mostly moot / rest deferred.** Import is now format-dispatched; `restoreAllData` goes through `activateProfile` (sorts + re-seeds `lastUrgencyMap`), and `render()` re-sorts before display anyway. Remaining: legacy path still assigns the unsorted `dbGet` result, doesn't reset `lastUrgencyMap`, and the `totalCount` log can `NaN` — folds into the `lastUrgencyMap` rework branch.
6. **Re-emergence loop skips alternate items** (L724–38). Forward `for` loop + `splice(idx, 1)` — after removing item `i`, the next item shifts into `i`, then `i++` skips it. Skipped tasks re-emerge up to a cycle late. Iterate backwards. — **Fixed** (loop now iterates backwards).
7. **`openDB` can hang `init()` forever** (L279–81). While a version upgrade is `blocked` by another open tab, the promise never settles and the app is a blank page with only a `console.warn`. Worth a visible "another tab is open, reload" message or at least a timeout. — **Fixed** (visible `#db-blocked-banner` while the upgrade is blocked; removed on success).

## Smaller issues

- **`permanentDeleteTrash`** (L1841–57): the "pull first item of next page up" logic is correct but fragile. It's a 10-item list — `renderSettingsTrash()` would replace ~20 lines with one call. — **Kept as-is** (reviewed, works fine).
- **Attachment download snippet is copy-pasted 3×** (buildItem L1003–11, dialog L1453–61, and `exportData` L2161–66 which uses *immediate* revoke instead of the deferred 1s pattern). One `downloadAttachment(att)` helper. — **Fixed** (`downloadBlob(blob, filename)` helper, deferred 1s revoke, used at all 3 sites).
- **`case 'edit':`** (L2034–37) declares an unbraced `const` in the shared switch scope — works, but `expand-extras` already shows the braced style; make them consistent. — **Fixed** (braced).
- **`formatTimestamp`** omits the year — ambiguous for old tasks. — **Fixed** (year shown for non-current years only).
- **`new Blob([file], { type: file.type })`** (L1550) copies the file's data; `File` is already a `Blob`, so you can store `file` directly. — **Fixed** (stores `file` directly).
- **`updateTodo`** unconditionally resets `completedPage = 1` (L1686) even when editing an active task. — **Fixed** (line removed; the status-filter switch already resets pagination).
- **`lastUrgencyMap`** is never pruned on complete/delete → once the interval is re-enabled, decompleting a task can fire a spurious "urgency change" notification. — **Deferred** (dedicated rework branch, along with #5's reset).
- **`importData`**: no `reader.onerror` (silent failure), and the profile wipe happens before the write transaction — if the write fails mid-way, the profile is left empty. — **Fixed** (`readJsonFile` has an `onerror`; legacy wipe+write is now one atomic transaction — keys collected via `getAllKeys` on the `profileId` index, deletes and adds in the same tx).
- **`clearAllData`** clears the *entire* todos store — all profiles, not just the current one. The confirm text says "ALL data" so probably intended, but confirm. — **Confirmed intended, kept as-is.**
- **Notification toggle** (L2256–62) neither persists nor initializes from `Notification.permission` — the checkbox always starts unchecked. Motion-reduce toggle: same, not persisted. — **Deferred** (notifications rework branch; motion-reduce goes with it).
- **`sendForegroundNotification`** is dead code (only called from commented-out code). — **Deferred** (notifications rework branch).
- **`30s (test)`** repeat option — fine for dev, strip before shipping. — **Still in `index.html`; strip before shipping.**
- **Export only covers the current profile** and doesn't export the profiles themselves — multi-profile users can't back up everything in one file. — **Fixed** (Export now dumps all profiles + all todos; per-profile Export button on each profile row; Import Profile adds a new profile without overwriting; legacy files still import and overwrite the current profile).
- **`init()` has no top-level error handling** — a failed `openDB` leaves a silently blank page (unhandled rejection). — **Fixed** (`init().catch()` logs and alerts).

## Structure

2,400 lines in one file is at the upper edge, but the seams are clean if you ever want to split: DB layer (L124–430), render (L786–1340), actions/CRUD (L1567–1877), settings+profiles (L432–560, L2076+). No urgency to do it now.

My suggested priority if you want fixes: **#1 (purge bug)** and **#4 (decomplete ordering)** are the two I'd call actual defects; #3 and #5 are user-visible inconsistencies; #2 is a decision (re-enable the interval or delete the dead code); the rest are polish.

Want me to apply any of these — and if so, which set?
