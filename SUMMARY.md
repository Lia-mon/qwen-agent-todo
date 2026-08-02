# Todo App — Summary

## Overview

A vanilla HTML/CSS/JS todo app that tracks tasks with metadata, filtering, and repeat scheduling. Built as a Progressive Web App (PWA) with offline support and background task processing.

## Task Properties

Each task stores:

| Property | Type | Description |
|---|---|---|
| `createdAt` | timestamp | When the task was created |
| `completedAt` | timestamp \| null | When the task was completed (null if active) |
| `completed` | boolean | Completion status |
| `repeat` | string | None / Daily / Weekly / Monthly / 30s (test) |
| `importance` | string | High / Medium / Low |
| `emergence` | string | High / Medium / Low |

## Features

- **Create tasks** with text, repeat schedule, importance, and emergence level
- **Complete / un-complete** tasks by clicking the checkbox
- **Delete** tasks via the × button (appears on hover)
- **Timestamps** displayed for creation and completion times
- **Sorting**: active tasks first (newest first), completed tasks sorted by most-recently-completed
- **Three filter dimensions** combined with AND logic:
  - Status: All / Active / Completed
  - Importance: All / High / Med / Low
  - Emergence: All / High / Med / Low
- **Repeatable tasks**: automatically re-emerge after their period expires, tracked via `nextRepeatDate`

## PWA Capabilities

- **Offline support** — all assets cached via Service Worker (cache-first strategy)
- **Installable** — manifest.json with icons, `display: standalone`, theme color
- **Background repeat checker** — SW runs `checkRepeatableTodos()` every 5 minutes, reading/writing IndexedDB directly so it works even with no tabs open
- **Push notifications** — alerts when a repeatable task re-emerges (requires user permission)
- **IndexedDB persistence** — shared between page and SW (`TodoAppDB` / `todos` store), replacing localStorage

## Project Structure

```
/
├── index.html      # Semantic HTML structure (two panels: create + render)
├── styles.css      # Clean, minimal styling
├── app.js          # App logic: IndexedDB CRUD, rendering, filtering, SW registration
├── sw.js           # Service Worker: caching, background repeat checker, notifications
├── manifest.json   # PWA manifest (name, icons, display mode)
├── icon-192x192.png  # PWA icon (192×192)
└── icon-512x512.png  # PWA icon (512×512)
```

## Architecture Notes

- **IndexedDB** is used instead of localStorage because Service Workers cannot access `localStorage`. The SW reads and writes to the same `TodoAppDB` database.
- The SW communicates with the page via `postMessage` (`PUSH_REPEAT_CHECK`) when it detects changes during background checks, triggering a UI re-render.
- The page also runs its own repeat checker on load/refresh as a fallback.
