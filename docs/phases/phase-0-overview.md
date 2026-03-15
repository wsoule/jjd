# Phase 0: Architecture Overview

## What We're Building

A Tauri v2 desktop app called **jjd** that replaces the current CLI-only daemon with a full GUI experience, modeled after [Conductor](https://conductor.build). The app manages parallel coding agent workspaces backed by Jujutsu (jj) and Git, with AI-powered auto-describe, checkpoints, and push automation.

## Core Principles

1. **Git + jj native** — All version control goes through real jj/git operations. No abstraction layers that hide what's happening.
2. **Sidecar architecture** — The existing Bun/TypeScript daemon runs as a Tauri sidecar. The Rust layer handles windowing, IPC, and native platform integration. Business logic stays in TypeScript.
3. **React + shadcn/ui frontend** — Modern component library, consistent design system, dark mode first.
4. **@pierre/diffs for diff rendering** — Production-grade syntax-highlighted diffs with expand/collapse, split/unified views.
5. **code.storage ready** — Architecture supports future integration with code.storage for remote Git infrastructure (ephemeral branches, cloud repos, AI agent hosting).

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                  Tauri Window                    │
│  ┌─────────────────────────────────────────────┐│
│  │         React App (Webview)                 ││
│  │  ┌──────────┐ ┌───────────────────────────┐ ││
│  │  │ Sidebar  │ │  Main Content Area        │ ││
│  │  │          │ │                           │ ││
│  │  │ Repos    │ │  Workspace View           │ ││
│  │  │ Spaces   │ │  - Agent Chat / Terminal  │ ││
│  │  │ Status   │ │  - Diff Viewer            │ ││
│  │  │          │ │  - Checkpoints            │ ││
│  │  │          │ │  - Todos                  │ ││
│  │  └──────────┘ └───────────────────────────┘ ││
│  └─────────────────────────────────────────────┘│
│                     │ Tauri IPC                  │
│  ┌──────────────────┴──────────────────────────┐│
│  │           Rust Core (src-tauri/)            ││
│  │  - Window management                        ││
│  │  - Sidecar process management               ││
│  │  - File system access                       ││
│  │  - Native menu / tray                       ││
│  │  - IPC bridge to sidecars                   ││
│  └──────────────────┬──────────────────────────┘│
└─────────────────────┼───────────────────────────┘
                      │ stdio / HTTP
     ┌────────────────┴────────────────┐
     │   jjd Sidecar (Bun process)    │
     │   - DaemonEngine (state machine)│
     │   - AutoDescriber (Anthropic)   │
     │   - JjOperations (jj CLI)      │
     │   - StateDB (SQLite)           │
     │   - FileWatcher                │
     │   - BookmarkManager            │
     │   - Pusher                     │
     └────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop shell | Tauri v2 | Rust-based, small binary, native performance |
| Frontend | React 19 + TypeScript | Vite bundled, runs in Tauri webview |
| UI components | shadcn/ui + Tailwind CSS | Consistent, accessible, themeable |
| Diff rendering | @pierre/diffs | Shiki-based syntax highlighting, React components |
| Backend logic | Bun + TypeScript (sidecar) | Existing jjd daemon, unchanged |
| IPC | Tauri commands + events | Rust ↔ Webview, Rust ↔ Sidecar |
| State | SQLite (existing bun:sqlite) | jjd.sqlite in .jj/ per workspace |
| VCS | jj CLI + git | Subprocess calls via JjOperations |
| AI | Anthropic SDK (Haiku) | Commit messages + scope detection |
| Future: Git infra | code.storage | Remote repos, ephemeral branches |

## Mapping: Conductor Features → jjd Implementation

| Conductor Feature | jjd Equivalent | Status |
|---|---|---|
| Parallel workspaces | `SessionManager` (jj workspaces) | Exists — needs UI |
| Workspace from branch | `jj workspace add` | Exists — needs UI |
| Workspace from PR | `gh pr checkout` + workspace | New |
| Workspace from Linear issue | `session start <LINEAR-ID>` | Exists — needs UI |
| Diff viewer | Dashboard (basic) | Replace with @pierre/diffs |
| Checkpoints (turn-by-turn) | `DaemonEngine` checkpoints | Exists — needs UI |
| Revert to checkpoint | `engine.rollback(id)` | Exists — needs UI |
| Todos | New feature | New |
| Scripts (setup/run/archive) | New feature | New |
| Slash commands | New feature | New |
| MCP integration | New feature | New |
| Agent chat view | New (embed terminal or Claude output) | New |
| Status indicators | Engine state machine | Exists — needs UI |
| Auto-push | `Pusher` | Exists — needs UI |

## Repo Structure (Target)

```
jjd/
├── src-tauri/              # Rust backend (Tauri core)
│   ├── src/
│   │   ├── main.rs         # App entry, window setup
│   │   ├── commands/       # Tauri IPC commands
│   │   ├── sidecar.rs      # Sidecar process management
│   │   └── menu.rs         # Native menu + tray
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── src/                    # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── ui/             # shadcn/ui components
│   │   ├── sidebar/
│   │   ├── workspace/
│   │   ├── diff-viewer/
│   │   ├── checkpoints/
│   │   └── todos/
│   ├── hooks/
│   ├── stores/             # State management (zustand)
│   ├── lib/
│   └── styles/
├── sidecar/                # Existing jjd daemon (moved from src/)
│   ├── index.ts            # CLI entrypoint
│   ├── daemon.ts
│   ├── engine/
│   ├── api/
│   ├── jj/
│   ├── watcher/
│   └── ...
├── package.json            # React app deps
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── index.html
```

## Phase Summary

| Phase | Name | Goal |
|-------|------|------|
| 1 | Tauri + React Shell | Scaffolded Tauri v2 app with React, shadcn/ui, routing, empty layout |
| 2 | Sidecar Integration | jjd daemon as Tauri sidecar, IPC bridge, process lifecycle |
| 3 | Sidebar + Workspace Management | Repo list, workspace creation, session lifecycle UI |
| 4 | Workspace Dashboard | Status, controls, auto-describe status, push controls |
| 5 | Diff Viewer | @pierre/diffs integration, file tree, expand/collapse |
| 6 | Checkpoints & Rollback | Checkpoint list, revert UI, turn-by-turn history |
| 7 | Todos & Scripts | Todo checklist, setup/run/archive scripts, blocking merge |
| 8 | Agent Integration | Terminal embed or chat view, agent output streaming |
| 9 | Polish & Platform | Native menu, tray, keyboard shortcuts, auto-update |
| 10 | code.storage | Remote Git, ephemeral branches, cloud workspace support |
