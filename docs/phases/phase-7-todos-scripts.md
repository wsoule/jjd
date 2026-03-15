# Phase 7: Todos & Scripts

## Goal
Add a todo checklist system (blocks merging until complete) and a scripts system (setup/run/archive lifecycle hooks) — matching Conductor's workflow features.

## Part A: Todos

### Concept
Todos are a per-workspace checklist of things that need to happen before the work is merged. They block the "Create PR" / "Merge" action until all items are checked off.

Sources of todos:
1. **User-created**: manually added via the Notes tab
2. **Agent-created**: Claude can write todos via a `@todos` mention or a Tauri MCP tool
3. **Auto-generated**: from Linear issue checklist items (if linked)
4. **System**: e.g., "All tests pass", "No conflicts"

### Data Model

```typescript
interface Todo {
  id: string;
  workspaceId: string;
  text: string;
  completed: boolean;
  source: "user" | "agent" | "linear" | "system";
  createdAt: string;
  completedAt?: string;
}
```

**Storage:** Todos stored in workspace-local JSON file: `<workspace>/.jjd-todos.json`. This keeps them alongside the workspace and makes them accessible to the sidecar/agent.

### Layout (Notes Tab)

```
┌──────────────────────────────────────────────────────┐
│  Tab Bar: [Dashboard] [Diff] [Checkpoints] [Notes]   │
│  ═══════════════════════════════════════════════════  │
│                                                      │
│  ┌─ Todos ──────────────────────────────────────────┐│
│  │  ⚠ 2 of 5 remaining — workspace blocked         ││
│  │                                                  ││
│  │  ☑ Set up database migrations                    ││
│  │  ☑ Implement auth middleware                     ││
│  │  ☑ Write unit tests                              ││
│  │  ☐ Integration test with staging API             ││
│  │  ☐ Update API documentation                      ││
│  │                                                  ││
│  │  [+ Add todo]                                    ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Notes (free text) ─────────────────────────────┐ │
│  │  Markdown editor / plain text area              │ │
│  │  for workspace-specific notes                   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Components

```
src/components/notes/
├── NotesPage.tsx          # Todos + free-text notes
├── TodoList.tsx           # Checklist with add/remove
├── TodoItem.tsx           # Single checkbox + text + delete
├── TodoBlocker.tsx        # Warning banner when incomplete
└── NotesEditor.tsx        # Free-form markdown notes
```

### Blocking Logic

When todos exist and are incomplete:
- "Create PR" button shows a warning badge
- "Merge" action is disabled with tooltip "Complete all todos first"
- Sidebar workspace item shows a small warning indicator
- User can override with "Force Create PR" (requires confirmation)

---

## Part B: Scripts

### Concept
Scripts are shell commands that run at workspace lifecycle events. They're configured per-repo and shared via a `jjd.config.json` file (extending the existing config system).

Three script types (matching Conductor):

| Script | When It Runs | Example |
|--------|-------------|---------|
| **Setup** | After workspace creation | `npm install && cp .env.example .env` |
| **Run** | On-demand via "Run" button | `npm run dev` |
| **Archive** | Before workspace deletion | `docker compose down` |

### Configuration

Extend `jjd.config.json`:

```json
{
  "scripts": {
    "setup": "bun install",
    "run": "bun run dev",
    "archive": "echo 'cleaning up'"
  }
}
```

Also support a `conductor.json` at repo root for team sharing (Conductor compatibility):

```json
{
  "scripts": {
    "setup": "bun install",
    "run": "bun run dev",
    "archive": ""
  }
}
```

### Environment Variables

Scripts receive these env vars (Conductor-compatible):

| Variable | Value |
|----------|-------|
| `JJD_WORKSPACE_PATH` | Absolute path to workspace |
| `JJD_WORKSPACE_NAME` | Workspace name/ID |
| `JJD_ROOT_PATH` | Path to main repo root |
| `JJD_BRANCH` | Current bookmark name |
| `JJD_PORT` | Daemon API port |

### Script Execution

```rust
#[tauri::command]
async fn run_script(
    workspace_id: String,
    script_type: ScriptType,  // Setup | Run | Archive
) -> Result<ScriptHandle, String>;

#[tauri::command]
async fn stop_script(handle: String) -> Result<(), String>;

#[tauri::command]
async fn get_script_output(handle: String) -> Result<ScriptOutput, String>;
```

Scripts run as child processes managed by the Rust layer. Output is streamed to the frontend via Tauri events:

```rust
app.emit("script:output", ScriptOutputPayload {
    workspace_id: String,
    line: String,
    stream: "stdout" | "stderr",
});

app.emit("script:exit", ScriptExitPayload {
    workspace_id: String,
    code: i32,
});
```

### Run Script Panel

The "Run" script gets a dedicated panel in the workspace view — a small embedded terminal showing the script's output:

```
┌─ Run Script ────────────────────────────────────┐
│  $ bun run dev                          [Stop]  │
│  ────────────────────────────────────────────── │
│  Server started on http://localhost:3000         │
│  Compiled successfully in 245ms                  │
│  [HMR] Waiting for changes...                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Settings UI

Scripts are configured in the repo settings (accessible from sidebar repo header):

```
src/pages/
└── SettingsPage.tsx
    ├── ScriptSettings.tsx    # Edit setup/run/archive scripts
    ├── RepoSettings.tsx      # General repo config
    └── AppSettings.tsx       # Global app settings (theme, editor, etc.)
```

## Deliverables
- [ ] Todo data model and JSON persistence
- [ ] TodoList component with add/remove/check
- [ ] Blocking logic for PR creation when todos incomplete
- [ ] Free-text notes editor
- [ ] Script configuration in jjd.config.json
- [ ] Script execution with output streaming
- [ ] Setup script runs on workspace creation
- [ ] Run script panel with stop button
- [ ] Archive script runs on workspace deletion
- [ ] Script settings UI
- [ ] Environment variables for scripts
- [ ] conductor.json compatibility
