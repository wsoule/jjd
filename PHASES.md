# jjd Tauri App — Phase Plan

## Architecture

A Tauri v2 desktop app that wraps the existing jjd Bun daemon as a sidecar, with a React + shadcn/ui frontend. The app surfaces all existing jjd functionality through a GUI while adding Conductor-style workspace management.

**Tech stack:** Tauri v2 (Rust) · React 19 · shadcn/ui · @pierre/diffs · Zustand · xterm.js

---

## jjd Feature Map

Every existing jjd feature must be accessible from the Tauri app. This table maps daemon capabilities to their UI surface.

### Core Engine Features

| jjd Feature | What It Does | Phase | UI Surface |
|---|---|---|---|
| Auto-describe | Watches files, debounces, calls Anthropic to generate commit message, runs `jj describe` | 4 | Status card shows state (idle/debouncing/describing), last commit message card, activity feed logs each describe |
| Scope splitting | Detects when changes span different architectural layers, runs `jj split` to separate commits | 4 | Activity feed shows "split: N files moved to parent commit". Diff viewer (Phase 5) shows both resulting commits |
| Bookmark advancement | After describe, advances jj bookmarks to track the working copy | 4 | Repo info card shows current bookmarks. Activity feed logs bookmark moves |
| Auto-push | After describe, debounces 30s then runs `jj git push` for each bookmark | 4 | Status card shows "pushing" state. Activity feed logs push results. Dashboard shows last push time |
| Error backoff | On failure: 5s, 10s, 20s... capped at 60s. Resets on success | 4 | Status card shows error state + retry countdown. Error banner with message. Activity feed logs errors |
| Checkpoints | Auto-checkpoint every N describes, manual checkpoints, stores jj operation IDs | 6 | Checkpoint timeline, create button, rollback with confirmation |
| Rollback | Restores jj operation (`jj op restore`) to a checkpoint | 6 | Rollback button per checkpoint, confirmation dialog, diff preview of what will change |
| File watching | FSEvents (macOS) or poll-based watcher, triggers debounce on file changes | 4 | Status card shows "debouncing" + file count. Could show which files changed |
| Debouncing | 5s debounce for describe, 30s for push (configurable) | 4 | Visual debounce timer/progress in status card |

### Session Features

| jjd Feature | What It Does | Phase | UI Surface |
|---|---|---|---|
| `session start <id>` | Fetches Linear issue, creates jj workspace, allocates port, starts daemon, optionally launches Claude | 3 | "New Workspace" dialog → Linear Issue tab. Pre-fills from Linear API |
| `session stop <id>` | Final describe + push, creates PR via `gh`, kills daemon | 3 | "Archive Workspace" in context menu. Shows PR creation dialog before archiving |
| `session resume <id>` | Restarts daemon for a stale workspace | 3 | "Resume" button on stale workspace items in sidebar |
| `session resume-all` | Resumes all stale sessions | 3 | "Resume All" in repo context menu, or auto-resume on app launch |
| `session list` | Lists sessions from `.jjd-sessions/*.json` | 3 | Sidebar workspace list (always visible) |
| `session log <id>` | Tails daemon log file | 8 | Terminal panel can `tail -f` the log, or dedicated "Daemon Log" tab |
| `session which` | Finds session by traversing `.jjd-session` markers | 3 | Not needed in GUI (app knows which workspace is active) |
| `session cleanup <id>` | Stop + `jj workspace forget` | 3 | "Delete Workspace" in context menu (stop + forget + remove files) |

### CLI Commands → GUI Actions

| CLI Command | Phase | GUI Equivalent |
|---|---|---|
| `jjd start` | 2 | Automatic: daemon starts when workspace is created or app launches |
| `jjd stop` | 2 | "Stop Daemon" button in actions card, or via context menu |
| `jjd status` | 4 | Status card (always visible in dashboard) |
| `jjd describe` | 4 | "Describe Now" button in actions card |
| `jjd push` | 4 | "Push Now" button in actions card |
| `jjd checkpoint [msg]` | 6 | "+ Checkpoint" button → description input |
| `jjd rollback <id>` | 6 | "Rollback" button per checkpoint in timeline |
| `jjd checkpoints` | 6 | Checkpoints tab (always available) |
| `jjd ui` | — | The app IS the UI |
| `jjd init` | 3 | "Add Repository" flow checks deps (jj, claude, gh), installs hooks |
| `jjd hooks install` | 3 | Part of "Add Repository" flow |
| `jjd shell-prompt` | — | Not needed (app shows status visually) |
| `jjd version` | 9 | About dialog, settings page |

### Configuration

| Config Feature | Phase | UI Surface |
|---|---|---|
| `debounceMs` (default 5000) | 7b | Settings → Repo → Debounce delay slider |
| `pushIdleMs` (default 30000) | 7b | Settings → Repo → Push delay slider |
| `model` (default haiku) | 7b | Settings → Repo → AI model selector |
| `autoPush` (default true) | 4 | Toggle in actions card + settings |
| `checkpoints` (default true) | 6 | Toggle in settings |
| `apiPort` | 2 | Auto-allocated, shown in settings |
| `watcherType` (fs/poll) | 7b | Settings → Repo → Watcher type |
| `ANTHROPIC_API_KEY` | 9 | Settings → API Keys (secure storage) |
| `LINEAR_API_KEY` | 9 | Settings → API Keys (secure storage) |
| Config cascade (explicit → repo → user → defaults) | 7b | Settings shows effective config with source indicators |

### External Integrations

| Integration | Phase | UI Surface |
|---|---|---|
| Anthropic API (Haiku) | 2 (sidecar) | Status shows "describing", errors surface API failures |
| Linear API | 3 | Workspace creation from Linear issues, issue info in sidebar |
| GitHub (`gh` CLI) | 3, 5 | PR creation on archive, PR status badge, diff viewer "Create PR" button |
| Claude Code (agent) | 8 | Quick-launch button, terminal embed |
| code.storage | 10 | Cloud workspace option, ephemeral branches |

---

## Phase Dependency Graph

```
Phase 1: Tauri + React Shell
  │
  ├──────────────────────┬──────────────────────┐
  │                      │                      │
  ▼                      ▼                      ▼
Phase 2: Sidecar    Phase 9a: Menu/        Phase 7b: Scripts
  │                 Tray/Shortcuts/         (config schema,
  │                 Command Palette         Rust execution —
  │                 (structural UI,         no daemon needed)
  │                 no daemon needed)
  │
  ├──────────────────────┬──────────────────────┐
  │                      │                      │
  ▼                      ▼                      ▼
Phase 3: Sidebar    Phase 4: Dashboard    Phase 8: Terminal
  │                      │                (pty is independent
  │                      │                 of daemon IPC)
  │                      ▼
  │                 Phase 6: Checkpoints
  │
  ▼
Phase 5: Diff Viewer
  │
  ▼
Phase 7a: Todos
(needs workspace context + "block merge" ties to diff/PR flow)
  │
  ▼
Phase 9b: Notifications, Auto-Update, Window Persistence
(needs all features wired to know what to notify about)
  │
  ▼
Phase 10: code.storage
(additive — needs everything else stable)
```

## Dependency Table

| Phase | Hard Dependencies | Can Start After | Can Run In Parallel With |
|-------|------------------|-----------------|-------------------------|
| **1** Tauri Shell | — | — | Nothing (foundation) |
| **2** Sidecar | 1 | 1 complete | 8, 9a |
| **3** Sidebar + Workspaces | 2 | 2 complete | 4, 8 |
| **4** Dashboard | 2 | 2 complete | 3, 8 |
| **5** Diff Viewer | 1 | 1 complete (uses jj directly, not sidecar) | 2, 8, 9a |
| **6** Checkpoints | 2, 4 | 4 complete (extends dashboard data flow) | 5, 7b, 8 |
| **7a** Todos | 3 | 3 complete (needs workspace context) | 6, 8 |
| **7b** Scripts + Settings | 1 | 1 complete (Rust process exec, no sidecar) | 2, 3, 4, 5, 8 |
| **8** Terminal | 1 | 1 complete (pty is pure Rust + xterm.js) | 2, 3, 4, 5, 7b, 9a |
| **9a** Menu/Tray/Shortcuts | 1 | 1 complete (structural, wires up later) | 2, 3, 4, 5, 7b, 8 |
| **9b** Notifications/Update | 3, 4, 6 | Core features complete | 10 |
| **10** code.storage | All | Everything stable | — |

## Parallel Work Streams

After Phase 1 is done, split into **4 independent streams**:

```
Stream A (core daemon)     Stream B (UI chrome)     Stream C (terminal)     Stream D (diff)
─────────────────────     ──────────────────────    ──────────────────     ──────────────
Phase 2: Sidecar          Phase 9a: Menu/Tray/     Phase 8: Terminal      Phase 5: Diff
    │                     Shortcuts/Palette        (pty + xterm.js)       (@pierre/diffs)
    │                         │                         │                      │
    ├── Phase 3: Sidebar      │                         │                      │
    │       │                 │                         │                      │
    │   Phase 7a: Todos       │                         │                      │
    │                         │                         │                      │
    ├── Phase 4: Dashboard    │                         │                      │
    │       │                 │                         │                      │
    │   Phase 6: Checkpoints  │                         │                      │
    │                         │                         │                      │
    ├── Phase 7b: Scripts     │                         │                      │
    │                         │                         │                      │
    ▼                         ▼                         ▼                      ▼
    └──── All merge into Phase 9b (notifications, persistence, polish) ────────┘
                                            │
                                            ▼
                                     Phase 10: code.storage
```

## Integration Seams (Shared Interfaces)

When working in parallel, these interfaces must be agreed on up front:

| Interface | Between | Contract |
|-----------|---------|----------|
| `Workspace` type | All streams | `{ id, repoId, path, branchName, status, daemonPort }` |
| Zustand `workspaceStore` | All streams | Active workspace ID, workspace list, repo list |
| Tauri command prefixes | A, C | `daemon_*` (sidecar), `terminal_*` (pty), `jj_*` (direct jj) |
| Tab routing | A, D | `/workspace/:id/(dashboard\|diff\|checkpoints\|notes)` |
| Tauri event namespaces | A, B, C | `daemon:*`, `terminal:*`, `script:*` |
| Layout slots | All | Sidebar (A), TopBar (A+B), TabContent (A+D), TerminalPanel (C) |

## Minimum Viable App

**Phases 1 + 2 + 3 + 4** = a working Tauri app with full jjd daemon functionality:
- Sidebar with workspace list
- Create/archive/resume jj workspaces (including from Linear issues)
- Live daemon status (idle → debouncing → describing → pushing)
- Auto-describe with scope splitting, bookmark advancement, auto-push
- Manual describe/push/checkpoint controls
- Error display with backoff status
- All config options surfaced

Everything after that is progressive enhancement (better diffs, checkpoints UI, terminal, polish).

---

## Detailed Phase Docs

Full implementation details for each phase are in `.context/phase-{N}-*.md`.
