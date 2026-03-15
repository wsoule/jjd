# Phase 4: Workspace Dashboard

## Goal
The main workspace view — live status, controls, repo info, and activity feed. This is the "home" tab when you click a workspace.

## Layout

```
┌──────────────────────────────────────────────────────┐
│  TopBar                                              │
│  ┌────────────────────────────────────────────────┐  │
│  │ ● describing  │  my-feature  │  ENG-456        │  │
│  │               │  (bookmark)  │  (linear link)  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Tab Bar: [Dashboard] [Diff] [Checkpoints] [Notes]   │
│  ═══════════════════════════════════════════════════  │
│                                                      │
│  ┌─────────────────────┐  ┌────────────────────────┐ │
│  │  Status Card        │  │  Actions Card          │ │
│  │                     │  │                        │ │
│  │  State: describing  │  │  [Describe Now]        │ │
│  │  Files changed: 3   │  │  [Push Now]            │ │
│  │  Since last push:   │  │  [+ Checkpoint]        │ │
│  │    2 min ago        │  │  [Stop Daemon]         │ │
│  │  Change: kqxyz123   │  │                        │ │
│  └─────────────────────┘  └────────────────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────────┐│
│  │  Last Commit Message                             ││
│  │  ┌────────────────────────────────────────────┐  ││
│  │  │  feat: add authentication middleware       │  ││
│  │  │                                            │  ││
│  │  │  Adds JWT-based auth middleware that       │  ││
│  │  │  validates tokens on protected routes...   │  ││
│  │  └────────────────────────────────────────────┘  ││
│  │  Described 45s ago · Pushed 2m ago               ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌──────────────────────────────────────────────────┐│
│  │  Recent Activity                                 ││
│  │                                                  ││
│  │  12:34:02  described  "feat: add auth..."        ││
│  │  12:33:57  debounce   3 files changed            ││
│  │  12:31:15  pushed     bookmark my-feature        ││
│  │  12:31:10  described  "refactor: extract..."     ││
│  │  12:30:45  debounce   1 file changed             ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

## Components

```
src/components/workspace/
├── WorkspaceLayout.tsx        # Tab bar + router outlet for workspace
├── dashboard/
│   ├── DashboardPage.tsx      # Grid layout of cards
│   ├── StatusCard.tsx         # Daemon state, file counts, change ID
│   ├── ActionsCard.tsx        # Manual trigger buttons
│   ├── CommitMessageCard.tsx  # Last auto-described commit message
│   ├── ActivityFeed.tsx       # Scrollable event log
│   └── RepoInfoCard.tsx       # Bookmarks, conflicts, repo path
```

### StatusCard
- Large status dot with label (animated pulse for describing/pushing)
- File change count (from `jj status`)
- Bookmarks on current change
- Change ID (truncated, click to copy full)
- Time since last describe / last push (relative, updates live)

### ActionsCard
- **Describe Now** — `POST /describe` via Tauri command. Disabled during describing state.
- **Push Now** — `POST /push`. Disabled during pushing state.
- **+ Checkpoint** — Opens small input for description, then `POST /checkpoint`.
- **Stop/Start Daemon** — Toggle daemon state. Confirmation for stop.

### CommitMessageCard
- Displays the last commit message written by auto-describe
- Monospace font, preserving formatting
- "Copy" button
- Timestamp of when it was written

### ActivityFeed
- Reverse-chronological log of daemon events
- Types: `described`, `pushed`, `debounce`, `error`, `checkpoint`, `rollback`
- Each entry: timestamp + event type badge + description
- Scrollable, max ~100 entries (from daemon status + push log in SQLite)

**Data source:** The daemon's `/status` endpoint already returns `lastDescribeTime`, `lastPushTime`, `state`, `error`. We need to extend it with an activity log. Options:
1. Add a `/activity` endpoint to the daemon that reads from `push_log` table + in-memory event buffer
2. Have the Rust layer accumulate events from status polling deltas

Leaning toward option 1 — add `/activity` to the sidecar API.

### RepoInfoCard
- Repo path (click to open in Finder)
- Bookmarks on current change
- Conflicts indicator (from `jj status`)
- Working copy parent info

## Data Flow

```
2s polling interval (Rust layer)
    │
    ▼
GET /status → { state, lastDescribeTime, lastPushTime, error,
                fileCount, changeId, bookmarks, conflicts,
                lastCommitMessage }
    │
    ▼
Tauri event: "daemon:status-update"
    │
    ▼
useDaemon() hook → StatusCard, ActionsCard, CommitMessageCard
```

### Extended Status Response

The daemon's `/status` endpoint needs to return more data:

```typescript
interface DaemonStatusExtended {
  // Existing
  state: "idle" | "debouncing" | "describing" | "pushing" | "error";
  error: string | null;

  // From jj status (already returned)
  fileCount: number;
  changeId: string;
  bookmarks: string[];
  conflicts: boolean;

  // New additions needed
  lastCommitMessage: string | null;
  lastDescribeTime: string | null;  // ISO timestamp
  lastPushTime: string | null;
  describeCount: number;            // total describes this session
  pushCount: number;                // total pushes this session
}
```

## Deliverables
- [ ] WorkspaceLayout with tab bar navigation
- [ ] StatusCard with live daemon state
- [ ] ActionsCard with manual triggers
- [ ] CommitMessageCard showing last description
- [ ] ActivityFeed with event history
- [ ] RepoInfoCard with workspace metadata
- [ ] Extended daemon `/status` endpoint
- [ ] Animated status indicators (pulse on describing/pushing)
- [ ] Relative timestamps that update live
