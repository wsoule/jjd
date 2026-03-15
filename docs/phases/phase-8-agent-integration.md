# Phase 8: Agent Integration

## Goal
Embed coding agent interaction into the app — view agent output, send prompts, and manage agent lifecycle from within jjd. This is the "Conductor experience" of seeing what your agents are doing.

## Approach

Unlike Conductor (which wraps Claude Code and Codex directly), jjd takes an agent-agnostic approach:

1. **Terminal embed** — Display a real terminal (pty) running in the workspace. The user can launch any agent (`claude`, `codex`, `aider`, etc.) in it.
2. **Agent-aware hooks** — When a recognized agent is running, jjd can parse its output for status updates, todos, and structured data.
3. **Quick-launch** — One-click buttons to start Claude Code or Codex in the workspace with pre-configured prompts.

### Why Terminal Embed Over Custom Chat UI?

- Works with ANY agent, not just Claude Code
- No need to reverse-engineer agent protocols
- Users see exactly what the agent sees
- jjd's value-add is the workspace management + auto-describe layer, not replacing the agent's UI

## Terminal Integration

### Tauri Terminal

Use a WebGL-based terminal emulator in the webview:

```
Dependencies:
- @xterm/xterm          # Terminal emulator
- @xterm/addon-fit      # Auto-resize
- @xterm/addon-webgl    # GPU-accelerated rendering
```

The terminal connects to a pty (pseudo-terminal) managed by the Rust layer:

```rust
// src-tauri/src/pty.rs
use portable_pty::{native_pty_system, PtySize, CommandBuilder};

#[tauri::command]
async fn create_terminal(
    workspace_id: String,
    workspace_path: String,
    shell: Option<String>,    // default: user's $SHELL
) -> Result<String, String>;  // returns terminal_id

#[tauri::command]
async fn write_terminal(terminal_id: String, data: String) -> Result<(), String>;

#[tauri::command]
async fn resize_terminal(terminal_id: String, cols: u16, rows: u16) -> Result<(), String>;

#[tauri::command]
async fn close_terminal(terminal_id: String) -> Result<(), String>;
```

Terminal output streamed via events:
```rust
app.emit("terminal:data", TerminalDataPayload {
    terminal_id: String,
    data: String,  // raw terminal data (ANSI escape codes included)
});
```

### Layout

The terminal appears as a panel in the workspace view, either:
- **Bottom panel** (like VS Code's integrated terminal)
- **Full tab** (dedicated "Terminal" tab)
- **Split view** (side by side with diff or dashboard)

```
┌──────────────────────────────────────────────────────┐
│  Tab Bar: [Dashboard] [Diff] [Checkpoints] [Notes]   │
│  ═══════════════════════════════════════════════════  │
│                                                      │
│  ┌─ Dashboard Content ─────────────────────────────┐ │
│  │  (status, actions, etc.)                        │ │
│  │                                                 │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  Terminal ▾                          [+] [×]    │ │
│  │  $ claude                                       │ │
│  │  Claude Code v1.2.3                             │ │
│  │  > Working on ENG-456: Add auth middleware      │ │
│  │  Reading src/auth/middleware.ts...              │ │
│  │  █                                              │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Quick Launch

Buttons to start agents with pre-configured context:

### Claude Code
```bash
claude --prompt "$(cat .jjd-task-prompt 2>/dev/null || echo 'Start working')"
```

The existing `session.ts` already generates `.jjd-task-prompt` files with Linear issue context. This file contains the task description, acceptance criteria, and relevant code pointers.

### Codex
```bash
codex --prompt "$(cat .jjd-task-prompt 2>/dev/null)"
```

### Custom Agent
Configurable in settings:
```json
{
  "agents": {
    "claude": {
      "command": "claude",
      "args": ["--prompt", "$TASK_PROMPT"]
    },
    "codex": {
      "command": "codex",
      "args": ["--prompt", "$TASK_PROMPT"]
    }
  }
}
```

## Components

```
src/components/terminal/
├── TerminalPanel.tsx         # Resizable bottom panel
├── TerminalView.tsx          # xterm.js wrapper
├── TerminalTabs.tsx          # Multiple terminals per workspace
└── AgentLauncher.tsx         # Quick-launch buttons
```

```
src/components/workspace/
└── WorkspaceLayout.tsx       # Updated: adds terminal panel
```

## Agent Status Detection

When a recognized agent process is running in the terminal, jjd can show enhanced status:

- **Agent running indicator** in sidebar (e.g., Claude icon next to workspace name)
- **Agent state** in status card (e.g., "Claude: reading files", "Claude: writing code")
- Detection method: check running processes in workspace, or parse terminal output for known patterns

This is optional / best-effort — the core experience works without it.

## Deliverables
- [ ] Pty management in Rust (create, write, resize, close)
- [ ] xterm.js terminal emulator in React
- [ ] Terminal panel (resizable, collapsible)
- [ ] Multiple terminals per workspace (tabs)
- [ ] Quick-launch buttons for Claude Code, Codex
- [ ] Task prompt integration (`.jjd-task-prompt`)
- [ ] Terminal data streaming via Tauri events
- [ ] Agent running indicator (optional)

## Dependencies
- `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
- Rust: `portable-pty` crate
