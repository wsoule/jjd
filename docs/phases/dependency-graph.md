# Phase Dependency Graph

## Visual

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
  │                      │
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
| **7b** Scripts | 1 | 1 complete (Rust process exec, no sidecar) | 2, 3, 4, 5, 8 |
| **8** Terminal | 1 | 1 complete (pty is pure Rust + xterm.js) | 2, 3, 4, 5, 7b, 9a |
| **9a** Menu/Tray/Shortcuts/Palette | 1 | 1 complete (structural, wires up later) | 2, 3, 4, 5, 7b, 8 |
| **9b** Notifications/Update/Persistence | 3, 4, 6 | Core features complete | 10 |
| **10** code.storage | All | Everything stable | — |

## Parallel Work Streams

After Phase 1 is done, you can split into **four independent streams**:

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

## What Shares State (Integration Points)

These are the seams where parallel streams need to agree on interfaces:

| Interface | Between | Contract |
|-----------|---------|----------|
| `Workspace` type | Streams A, B, C, D | Shared TypeScript type: `{ id, repoId, path, branchName, status, daemonPort }` |
| Zustand `workspaceStore` | All streams | Active workspace ID, workspace list, repo list |
| Tauri command naming | Streams A, C | `daemon_*` for sidecar, `terminal_*` for pty, `jj_*` for direct jj calls |
| Tab routing | Streams A, D | `/workspace/:id/(dashboard|diff|checkpoints|notes)` |
| Tauri event naming | Streams A, B, C | `daemon:*`, `terminal:*`, `script:*` — namespaced by concern |
| Layout slots | All streams | Sidebar (Stream A), TopBar (A+B), TabContent (A+D), TerminalPanel (C) |

## Recommended Order for a Solo Developer

If you're working alone (not parallelizing):

```
1 → 2 → 3 → 4 → 5 → 6 → 7a → 7b → 8 → 9 → 10
```

This gives you a usable app earliest — each phase adds visible value on top of the last.

## Minimum Viable App

Phases **1 + 2 + 3 + 4** = a working Tauri app that can:
- Show a sidebar with workspaces
- Create/archive jj workspaces
- Display live daemon status
- Trigger describe/push/checkpoint from the UI

Everything after that is progressive enhancement.
