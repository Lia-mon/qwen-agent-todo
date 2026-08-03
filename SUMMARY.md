# LLM Test Todo App — Summary

## Goal

A vanilla HTML/CSS/JS Progressive Web App (PWA) for task management with urgency tracking, repeat scheduling, offline support, and a dialog-based task creation flow. Built as a local agent exploration project using Qwen 3.6-35B-A3B-Q4 running locally via llama.cpp through the Zed editor.

---

## State

### Completed
- **Task model**: `id`, `text`, `completed`, `createdAt`, `completedAt`, `repeat`, `importance`, `deadline` (ms timestamp), `duration` (string), `nextRepeatDate`
- **Urgency** is a **computed property** (not stored) — recalculated each render from `deadline` + `duration` + current time
- **Urgency levels**: `stressy` (overdue or ratio ≤ 3), `balanced` (ratio > 3), `lax` (ratio > 5 AND available time > 1 day / 2 days for multi-hour)
- **Repeat scheduling**: daily, weekly, monthly, 30s (test) — background checked every 5 min by SW
- **Filters** (AND logic): Status (all/active/completed), Importance (all/high/med/low), Deadline (all/overdue/today/this week), Urgency (all/stressy/balanced/lax)
- **Task creation**: `<dialog>` modal with FAB button, datetime-local deadline input, duration select (5/10/30/60 min, multi hours)
- **PWA**: Service Worker with cache-first strategy, background repeat checker, push notifications
- **Responsive**: body 80%/835px on desktop,inbetween size under 1043px width, 100% on mobile, task list scrolls internally, no top/bottom padding on mobile
- **JSDoc annotations**: fully applied to `app.js` and `sw.js`
- **README.md**: created with project details, tech stack, agent notes

---

## Context

### Constraints & Preferences
- **No frameworks** — pure vanilla HTML/CSS/JS
- **No build step** — serve via any static server
- **IndexedDB** over localStorage (SW needs DB access)
- **Urgency is derived data** — never stored, always recalculated on render
- **Deadline stored as ms timestamp** — converted from `datetime-local` string on submit via `new Date(deadlineStr.replace(' ', 'T')).getTime()`
- **Mobile**: body `max-width: 100%`, `padding-top: 0`, `padding-bottom: 0`, panels `height: 100vh`, `#todo-list` with `flex: 1` + `overflow-y: auto`
- **Desktop**: body `width: 80%`, `max-width: 835px`, `padding: 20px` top/bottom, panels `height: 95vh`
- **FAB button**: fixed bottom-right, 56px circle, blue, `z-index: 100`
- **Dialog backdrop**: `rgba(0,0,0,0.4)` with `backdrop-filter: blur(4px)`
- **Delete confirmation**: browser `confirm()` dialog
- **Agent model**: Qwen 3.6-35B-A3B-Q4, llama.cpp, Zed editor

### Key Files
| File | Purpose |
|---|---|
| `index.html` | App shell — task panel, filters, dialog modal, FAB |
| `styles.css` | All responsive styles, dialog, badges, FAB |
| `app.js` | IndexedDB CRUD, rendering, filtering, SW registration, init |
| `sw.js` | Service Worker — caching, background repeat checker, notifications |
| `manifest.json` | PWA manifest |
| `SUMMARY.md` | Project context summary |
| `README.md` | GitHub readme |

---

## Pitfalls

- **`datetime-local` timezone**: The input returns a local datetime string like `"2026-08-02T15:30"` which `new Date()` can misinterpret as UTC. Fixed by replacing space with `T` before parsing. Do not remove this fix.
- **Urgency was once stored, now computed**: Any code that still tries to persist or read `todo.emergence` from IndexedDB will be wrong. Urgency is only computed on-the-fly in `calculateUrgency()` and used in `render()`.
- **SW has no urgency logic**: The service worker only handles repeat task re-emergence. Urgency calculation is page-only. This is intentional.
- **`padding-bottom: 0px`** in CSS — the `px` is redundant (cosmetic, not a bug).
