# Phase 6: Checkpoints & Rollback

## Goal
Visual checkpoint timeline showing turn-by-turn changes, with one-click rollback to any previous state — matching Conductor's checkpoint feature but backed by jj's native operation log.

## How jjd Checkpoints Work (Existing)

The daemon already has a checkpoint system:
- `DaemonEngine` creates auto-checkpoints every N describes (configurable)
- Manual checkpoints via `POST /checkpoint`
- Each checkpoint stores a jj operation ID (`jj op log` hash)
- Rollback calls `jj operation restore <op_id>` to revert the repo
- Stored in SQLite: `checkpoints(id, operation_id, description, created_at)`

This is more powerful than Conductor's checkpoints (which use hidden git refs). jj's operation log means we can restore to any point in the repo's history, including undoing splits, merges, and rebases.

## Layout

```
┌──────────────────────────────────────────────────────┐
│  Tab Bar: [Dashboard] [Diff] [Checkpoints] [Notes]   │
│  ═══════════════════════════════════════════════════  │
│                                                      │
│  ┌─ Checkpoints Timeline ───────────────────────────┐│
│  │                                                  ││
│  │  ○ Current State                          now    ││
│  │  │  3 files changed since last checkpoint        ││
│  │  │                                               ││
│  │  ● Checkpoint #4: "auth middleware done"  2m ago ││
│  │  │  [View Diff] [Rollback]                       ││
│  │  │  5 files · +89/-12                            ││
│  │  │                                               ││
│  │  ● Checkpoint #3: "auto"                 15m ago ││
│  │  │  [View Diff] [Rollback]                       ││
│  │  │  2 files · +34/-8                             ││
│  │  │                                               ││
│  │  ● Checkpoint #2: "routing setup"        45m ago ││
│  │  │  [View Diff] [Rollback]                       ││
│  │  │  8 files · +156/-23                           ││
│  │  │                                               ││
│  │  ● Checkpoint #1: "initial scaffold"      1h ago ││
│  │  │  [View Diff] [Rollback]                       ││
│  │  │  12 files · +312/-0                           ││
│  │  │                                               ││
│  │  ○ Workspace Created                      1h ago ││
│  │                                                  ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ Checkpoint Detail (expandable) ─────────────────┐│
│  │  Checkpoint #4: "auth middleware done"           ││
│  │  Created: 12:34:02 PM · Operation: abc123def     ││
│  │                                                  ││
│  │  Changes in this checkpoint:                     ││
│  │  M src/auth/middleware.ts  (+45/-3)              ││
│  │  A src/auth/validator.ts   (+38/-0)              ││
│  │  M src/index.ts            (+6/-9)               ││
│  │  M src/routes/protected.ts (+0/-0)               ││
│  │  A tests/auth.test.ts      (+0/-0)               ││
│  │                                                  ││
│  │  Commit message at this point:                   ││
│  │  "feat: add JWT auth middleware with validation" ││
│  │                                                  ││
│  │  ┌──────────────┐  ┌───────────────────────┐    ││
│  │  │  View Diff   │  │  ⚠ Rollback to Here  │    ││
│  │  └──────────────┘  └───────────────────────┘    ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

## Components

```
src/components/checkpoints/
├── CheckpointsPage.tsx        # Page wrapper
├── CheckpointTimeline.tsx     # Vertical timeline with nodes
├── CheckpointNode.tsx         # Single checkpoint in timeline
├── CheckpointDetail.tsx       # Expanded detail panel
├── RollbackDialog.tsx         # Confirmation dialog for rollback
└── CreateCheckpointDialog.tsx # Manual checkpoint creation
```

### CheckpointTimeline
- Vertical timeline with connected dots
- Top = current state, bottom = workspace creation
- Auto-checkpoints labeled "auto", manual ones show user description
- Each node shows: description, relative time, file change summary
- Click node → expand detail panel

### CheckpointNode
- Status indicator: filled circle for checkpoints, hollow for current/creation
- Hover: show action buttons (View Diff, Rollback)
- Change stats: files changed, insertions/deletions (computed from diff between this checkpoint and the previous one)

### RollbackDialog
- **Destructive action** — requires confirmation
- Shows what will be lost: "This will undo all changes after this checkpoint"
- Lists files that will be affected
- Warning: "This action cannot be undone" (though jj op log means it technically CAN be undone manually)
- Red "Rollback" button

### "View Diff" Integration
- Clicking "View Diff" on a checkpoint navigates to the Diff tab
- Pre-fills the revision selector with: `this_checkpoint_op..previous_checkpoint_op`
- Uses the diff viewer from Phase 5

## Data Flow

```
GET /checkpoints → [{ id, operation_id, description, created_at }]
    │
    ▼
For each checkpoint, compute diff stats:
    jj diff --git --stat -r <prev_op>...<this_op>
    │
    ▼
Render timeline with stats
```

### Extended Checkpoint API

The sidecar needs a richer checkpoint endpoint:

```typescript
// Existing
GET /checkpoints → Checkpoint[]

// New: checkpoint detail with diff stats
GET /checkpoints/:id/stats → {
  checkpoint: Checkpoint,
  files: { path: string, type: "M"|"A"|"D"|"R", insertions: number, deletions: number }[],
  commitMessage: string,
}
```

Or compute this in the Rust layer by running `jj` commands directly.

## Tauri Commands

```rust
#[tauri::command]
async fn list_checkpoints(workspace_id: String) -> Result<Vec<CheckpointWithStats>, String>;

#[tauri::command]
async fn create_checkpoint(workspace_id: String, description: String) -> Result<Checkpoint, String>;

#[tauri::command]
async fn rollback_to_checkpoint(workspace_id: String, checkpoint_id: String) -> Result<(), String>;

#[tauri::command]
async fn checkpoint_diff(workspace_id: String, checkpoint_id: String) -> Result<String, String>;
// Returns git-format diff for this checkpoint's changes
```

## Deliverables
- [ ] Vertical checkpoint timeline
- [ ] Checkpoint nodes with descriptions and stats
- [ ] Expandable detail panel per checkpoint
- [ ] "View Diff" linking to diff viewer with correct revisions
- [ ] Rollback with confirmation dialog
- [ ] Manual checkpoint creation
- [ ] Diff stats per checkpoint (files, insertions, deletions)
- [ ] Live updates when new checkpoints are created
