# jjd

Automation daemon for [Jujutsu (jj)](https://github.com/jj-vcs/jj) that auto-describes, bookmarks, and pushes your changes using AI. Designed for parallel Claude Code sessions — each task gets its own jj workspace with a dedicated daemon.

## The idea

When you're using Claude Code (or coding manually), version control is manual ceremony. jj's design — auto-tracking working copy, no staging area, operation-level undo — makes it ideal for full automation. jjd watches your repo, waits for a quiet moment, then:

1. Generates a conventional commit message via Claude Haiku
2. Runs `jj describe` with that message
3. Advances your bookmark
4. Pushes to the remote after an idle period
5. Creates periodic checkpoints you can roll back to

You never think about commits. You just write code.

## Quick start

```bash
# Option A: install from source
bun install
bun run build       # produces ./jjd binary
cp jjd /usr/local/bin/  # or anywhere on your PATH

# Option B: run directly with bun
bun install
bunx jjd help

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start a session — creates workspace, starts daemon, launches Claude Code
jjd session start ENG-123 --claude
```

## Install

### Compiled binary (recommended)

```bash
git clone <repo> && cd jjd
bun install
bun run build          # builds ./jjd for your platform
sudo cp jjd /usr/local/bin/jjd
```

Cross-compile for other platforms:

```bash
bun run build:mac          # macOS arm64
bun run build:mac-x64      # macOS x86_64
bun run build:linux         # Linux x86_64
bun run build:linux-arm     # Linux arm64
bun run build:all           # all of the above
```

### Via bun link (development)

```bash
bun install
bun link    # makes `jjd` available globally via bun
```

## Requirements

- [jj](https://github.com/jj-vcs/jj) >= 0.20
- [Bun](https://bun.sh) >= 1.0 (only needed for building, not for the compiled binary)
- [gh](https://cli.github.com/) (optional, for auto PR creation)
- `ANTHROPIC_API_KEY` for AI commit messages
- `LINEAR_API_KEY` (optional, for auto-fetching task details)

## Session workflow

Sessions are the core abstraction. Each session creates an isolated jj workspace for a task, runs a background daemon, and optionally launches Claude Code with full task context.

### Start parallel sessions

```bash
# Terminal 1 — start a session
jjd session start ENG-123 --claude
# Creates workspace at ../your-repo-eng-123/
# Starts background daemon on port 7433
# Fetches task details from Linear (if LINEAR_API_KEY set)
# Installs Claude Code hooks + CLAUDE.md
# Launches Claude Code with task context as initial prompt

# Terminal 2 — simultaneously, another task
jjd session start ENG-456 --claude
# Creates workspace at ../your-repo-eng-456/
# Starts background daemon on port 7434
# Launches another Claude Code instance
```

What happens automatically in each session:
- Claude writes code -> hook snapshots working copy -> daemon detects change
- After 5s of quiet -> Haiku generates conventional commit message -> `jj describe`
- Bookmark (e.g. `eng-123`) advances with the work
- After 30s of idle -> `jj git push` sends to remote
- Periodic checkpoints for rollback safety

### Know where you are

```bash
# Check which session the current directory belongs to
jjd session which
# Session:   eng-123
# Task:      ENG-123
# Bookmark:  eng-123
# Daemon:    http://localhost:7433

# Add to your shell prompt (in .zshrc or .bashrc)
jjd_prompt() { jjd shell-prompt 2>/dev/null; }
PS1='$(jjd_prompt)%~ %# '
# Shows: [jjd:eng-123] ~/code/repo-eng-123 %
```

When `--claude` launches Claude Code, it also sets env vars (`JJD_SESSION`, `JJD_SESSION_PORT`, `JJD_WORKSPACE`) so tools inside the session can discover the daemon.

### Monitor sessions

```bash
jjd session list
# ● eng-123              active   Implement OAuth2 login flow
#     bookmark: eng-123  port: 7433  workspace: ../repo-eng-123
# ● eng-456              active   Add search feature
#     bookmark: eng-456  port: 7434  workspace: ../repo-eng-456

# View a session's daemon log
jjd session log eng-123
```

### Stop sessions

```bash
# Stop session — auto-creates a PR (via gh), final describe + push
jjd session stop eng-123
# Session "eng-123" stopped.
# PR created: https://github.com/org/repo/pull/42

# Stop without PR
jjd session stop eng-456 --no-pr

# Stop + create draft PR
jjd session stop eng-789 --draft

# Stop + forget the jj workspace
jjd session cleanup eng-456
```

### Resume after restart

If your machine reboots or a daemon crashes, sessions show as "stale":

```bash
jjd session list
# ○ eng-123              stale    Implement OAuth2 login flow
#     (use 'jjd session resume eng-123' to restart)

# Resume one session
jjd session resume eng-123

# Or resume all stale sessions at once
jjd session resume-all
```

## Standalone daemon

You can also run jjd without sessions, as a simple watcher for any jj repo:

```bash
cd /path/to/your-jj-repo
jjd start              # foreground, Ctrl+C to stop
jjd start --debug      # verbose logging
jjd status             # check daemon state
jjd stop               # stop the daemon
```

### Manual triggers

While the daemon is running, you can trigger actions manually:

```bash
jjd describe           # generate + apply a commit message now
jjd push               # push now
jjd checkpoint "before refactor"   # create a rollback point
jjd checkpoints        # list checkpoints
jjd rollback 3         # restore to checkpoint #3
```

## Configuration

Create `jjd.config.json` in your repo root or `~/.config/jjd/config.json`:

```json
{
  "debounceMs": 5000,
  "pushIdleMs": 30000,
  "watcher": "fs",
  "pollIntervalMs": 2000,
  "model": "claude-haiku-4-5-20251001",
  "autoPush": true,
  "checkpoints": true,
  "apiPort": 7433,
  "bookmarkPatterns": [
    { "pattern": "feat/*", "autoAdvance": true },
    { "pattern": "fix/*", "autoAdvance": true }
  ],
  "ignorePaths": ["node_modules", ".next", "dist", "*.log"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `debounceMs` | `5000` | Wait this long after last file change before describing |
| `pushIdleMs` | `30000` | Wait this long after last describe before pushing |
| `watcher` | `"fs"` | `"fs"` for FSEvents, `"poll"` for `jj status` polling |
| `pollIntervalMs` | `2000` | Poll interval when using poll watcher |
| `model` | `claude-haiku-4-5-20251001` | Anthropic model for commit messages |
| `autoPush` | `true` | Auto-push after idle period |
| `checkpoints` | `true` | Create periodic rollback checkpoints |
| `apiPort` | `7433` | HTTP API port (0 to disable) |
| `bookmarkPatterns` | `[]` | Bookmark names to auto-advance |
| `ignorePaths` | `[...]` | Paths to ignore in file watcher |

Environment variables override config file values:
- `ANTHROPIC_API_KEY` — required for AI commit messages
- `LINEAR_API_KEY` — for fetching task details when starting sessions
- `JJD_PORT` — override the API port (used internally for multi-session)

## HTTP API

Each daemon exposes a local HTTP API for programmatic control:

```
GET  /status              Daemon state + repo info
POST /describe            Trigger auto-describe
POST /push                Trigger push
POST /checkpoint          Create checkpoint (body: {"description": "..."})
POST /rollback/:id        Rollback to checkpoint
GET  /checkpoints         List checkpoints
POST /stop                Graceful shutdown
```

## Claude Code integration

When a session starts, jjd installs two things in the workspace:

**Claude Code hooks** (`.claude/settings.json`) — auto-snapshot on every `Edit`/`Write` tool call, create a checkpoint when Claude starts.

**CLAUDE.md** — tells Claude about the task, the jjd daemon, and that it doesn't need to worry about version control:

```markdown
# Session: ENG-123

## Task
**ENG-123**: Implement OAuth2 login flow

[Full task description from Linear]

## Version Control
- This workspace uses jj for version control
- A jjd daemon handles describe + push automatically
- Your bookmark is `eng-123`
- Don't worry about committing — just write code
```

## How it works

### jj workspaces

Each session creates a [jj workspace](https://jj-vcs.github.io/jj/latest/working-copy/#workspaces) — an independent working copy of the same repo. Workspaces share the commit graph but each has its own `@` (working copy change). This means:

- Two Claude sessions edit different files without conflicts
- Bookmarks from both sessions are visible everywhere
- `jj log` from any workspace shows all work
- One session's work can be rebased onto another's trivially

### State machine

The daemon uses a state machine to prevent race conditions:

```
idle -> (file change) -> debouncing -> (5s quiet) -> describing -> (done) -> idle
                                                                          \-> pushing -> idle
```

File changes during any state reset the debounce timer. A separate push timer (30s) fires only after describe completes and no new changes arrive.

### Checkpoints

Rather than duplicating data, checkpoints record jj operation IDs. Rolling back calls `jj operation restore <id>` — jj's native undo mechanism. Safe, fast, and reversible (you can even undo the undo).

## Project structure

```
src/
├── index.ts              CLI entrypoint
├── daemon.ts             Daemon orchestrator (watcher + engine + API)
├── session.ts            Session lifecycle (workspace + daemon + Claude)
├── config.ts             Config loading with cascading defaults
├── state.ts              SQLite persistence (bun:sqlite)
├── linear.ts             Linear API client
├── hooks.ts              Claude Code hooks + CLAUDE.md generation
├── pr.ts                 PR creation via gh CLI
├── jj/
│   ├── cli.ts            Low-level jj command runner
│   ├── types.ts          TypeScript types for jj concepts
│   └── operations.ts     High-level jj operations
├── watcher/
│   ├── index.ts          Watcher factory
│   ├── fs-watcher.ts     FSEvents-based file watcher
│   └── poll-watcher.ts   Polling fallback
├── engine/
│   ├── state-machine.ts  Core daemon state machine
│   ├── debouncer.ts      Resettable debounce timer
│   ├── auto-describe.ts  Anthropic API for commit messages
│   ├── bookmark-manager.ts  Auto-advance bookmarks
│   ├── checkpoint.ts     Checkpoint create/rollback
│   └── pusher.ts         Push to git remote
├── api/
│   └── server.ts         HTTP API (Bun.serve)
└── util/
    ├── logger.ts         Structured logging
    └── process.ts        Child process helpers
```

## Why jj

- **Auto-tracking** — no `git add` to forget, working copy changes are always visible
- **`jj undo`** — any operation is reversible, not just commits
- **Bookmarks over branches** — just labels, not tied to HEAD, impossible to commit to wrong branch
- **No detached HEAD** — can't get into a broken state
- **Workspaces** — first-class parallel working copies, perfect for multi-session AI coding
- **`jj squash`** — collapse changes without interactive rebase when you're ready to clean up
