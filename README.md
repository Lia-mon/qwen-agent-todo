# Todo App

A vanilla HTML/CSS/JS Progressive Web App (PWA) for task management with intelligent urgency tracking, repeat scheduling, and offline support.

> Built as a local agent exploration project using [Qwen 3.6-35B-A3B-Q4](https://github.com/QwenLM/qwen) quantized to 4-bit, running locally via [llama.cpp](https://github.com/ggerganov/llama.cpp) through the [Zed](https://zed.dev) editor (also testing out Zed's agent capabilities).

## Overview

This project is part of an experiment to explore how well local LLM agents can build and iterate on real applications. The entire codebase was developed through conversational prompts — no traditional IDE pair programming, just natural language instructions guiding the agent to write, modify, and refactor code. (Yikes it wrote this !?)

## Features

- **Smart task creation** — set deadlines, durations, importance, and repeat schedules
- **Urgency tracking** — tasks dynamically shift between Stressy, Balanced, and Lax based on available time vs. required effort
- **Repeatable tasks** — daily, weekly, monthly
- **Multi-dimensional filtering** — filter by status, importance, deadline, and urgency level
- **Full PWA support** — installable, works offline, background sync via Service Worker
- **Push notifications** — alerts when repeatable tasks repeat
- **Responsive design** — adapts from desktop to mobile with a floating action button for task creation (meh)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript (ES6+) |
| Persistence | IndexedDB |
| PWA | Service Worker, Web App Manifest |
| Notifications | Push API, Notifications API |
| Agent | Qwen 3.6-35B-A3B-Q4 (local, via llama.cpp + Zed) |

## Project Structure

```
├── index.html          # Application shell
├── styles.css          # Responsive styles
├── app.js              # App logic: IndexedDB CRUD, rendering, filtering
├── sw.js               # Service Worker: caching, background checks, notifications
├── manifest.json       # PWA manifest
├── icon-192x192.png    # PWA icon (null)
├── icon-512x512.png    # PWA icon (null)
├── SUMMARY.md          # Context summary for the 'agent'
└── README.md           # This file
```

## Getting Started

1. Clone the repository
2. Serve via any static server
3. Allow notifications for background alerts
4. Install as a PWA for offline access

## Service Worker

The SW handles:
- **Cache-first offline serving** of all assets
- **Background repeat checker** every 5 minutes (even with no tabs open)
- **Push notifications** when repeatable tasks become active again
- **IndexedDB access** directly from the worker (impossible with localStorage)

## Agent Notes

This project demonstrates the viability of local LLM agents for software development:

- **Model**: Qwen 3.6-35B-A3B-Q4 quantized to 4-bit
- **Runtime**: llama.cpp (local inference)
- **Editor**: Zed (with agent mode — also being tested as part of this experiment)
- **Workflow**: Conversational — each prompt builds on the previous context
- **Strengths shown**: Code generation, refactoring, CSS styling, debugging, architecture decisions
- **No external dependencies** — the user chose vanilla web APIs over frameworks

## User Notes

Damn it's singing it's own praises in the section above o_o. It's okay I'm using a 4060ti 16GB + 32GB of DDR4 RAM

## License

MIT
