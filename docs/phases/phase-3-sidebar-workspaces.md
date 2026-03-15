# Phase 3: Sidebar + Workspace Management

## Goal
Users can add repositories, create/manage workspaces (jj workspaces), and navigate between them in the sidebar — the core navigation experience.

## Conductor Parity

Conductor's sidebar shows:
- Repository name at top
- List of workspaces, each with a city name + branch/PR title
- Status indicator per workspace (agent running, idle, etc.)
- "+ New Workspace" button
- Workspace creation from: blank branch, existing branch, GitHub PR, Linear issue

jjd's equivalent:
- Repository name (from jj root)
- List of jj workspaces / sessions
- Status dot per workspace (daemon state: idle/debouncing/describing/pushing/error)
- "+ New Workspace" button
- Workspace creation from: new jj workspace, existing branch, Linear issue (existing), GitHub PR (new)

## Steps

### 3.1 Repository Management

**Data model:**
```typescript
interface Repository {
  id: string;          // hash of path
  path: string;        // absolute path to repo root
  name: string;        // directory name
  isJjRepo: boolean;
  isGitRepo: boolean;
}
```

**Tauri commands:**
```rust
#[tauri::command]
fn add_repository(path: String) -> Result<Repository, String>;
// Validates: is it a jj repo? is it a git repo? Returns repo info.

#[tauri::command]
fn remove_repository(id: String) -> Result<(), String>;

#[tauri::command]
fn list_repositories() -> Result<Vec<Repository>, String>;

#[tauri::command]
fn scan_workspaces(repo_id: String) -> Result<Vec<Workspace>, String>;
// Reads .jjd-sessions/*.json + jj workspace list
```

**Storage:** Repos stored in `~/.config/jjd/repos.json` (simple JSON array of paths). Lightweight — no database needed for app-level config.

### 3.2 Workspace Data Model

```typescript
interface Workspace {
  id: string;              // session ID or workspace name
  repoId: string;
  name: string;            // display name (city name à la Conductor, or session ID)
  branchName: string;      // jj bookmark name
  path: string;            // absolute path to workspace directory
  status: WorkspaceStatus;
  daemonPort?: number;
  linearIssue?: {
    id: string;
    title: string;
    url: string;
  };
  githubPr?: {
    number: number;
    title: string;
    url: string;
  };
  createdAt: string;
}

type WorkspaceStatus =
  | "creating"     // workspace being set up
  | "active"       // daemon running
  | "idle"         // workspace exists, no daemon
  | "stale"        // daemon died unexpectedly
  | "archived";    // workspace forgotten
```

### 3.3 Sidebar Component

```
src/components/sidebar/
├── AppSidebar.tsx         # Main sidebar container (shadcn Sidebar)
├── RepoSection.tsx        # Repo name + settings gear
├── WorkspaceList.tsx      # Scrollable workspace list
├── WorkspaceItem.tsx      # Single workspace row
├── NewWorkspaceButton.tsx # "+ New Workspace" trigger
└── NewWorkspaceDialog.tsx # Modal for workspace creation
```

**WorkspaceItem layout:**
```
┌─────────────────────────────┐
│ ● workspace-name            │  ● = status dot (colored)
│   feature/add-auth          │  branch name (muted)
│   ENG-456                   │  linear issue (if linked)
└─────────────────────────────┘
```

- Click: navigate to workspace view
- Right-click: context menu (Stop daemon, Archive, Open in terminal, Open in editor)
- Status dot colors: green=active/idle, yellow=debouncing, blue=describing, purple=pushing, red=error, gray=stale

### 3.4 Workspace Creation Dialog

A multi-step dialog (shadcn `Dialog` + `Tabs`):

**Tab 1: New Branch**
- Branch name input (auto-prefixed, e.g., `feature/`)
- Optional description
- Creates: `jj workspace add` + new bookmark

**Tab 2: Existing Branch**
- Dropdown/search of existing bookmarks (`jj bookmark list`)
- Creates: `jj workspace add` pointed at that branch

**Tab 3: GitHub PR**
- PR number or URL input
- Fetches PR info via `gh pr view`
- Creates: workspace from PR's branch

**Tab 4: Linear Issue**
- Issue ID input (e.g., `ENG-123`)
- Fetches issue info via Linear API (existing `linear.ts`)
- Creates: workspace using existing `SessionManager.start()`

All tabs:
- Start daemon checkbox (default: on)
- Launch Claude checkbox (default: off)
- Shows preview of workspace path and branch name before creation

### 3.5 Workspace Lifecycle Commands

```rust
#[tauri::command]
async fn create_workspace(
    repo_id: String,
    source: WorkspaceSource,  // NewBranch | ExistingBranch | GitHubPr | LinearIssue
    start_daemon: bool,
    launch_claude: bool,
) -> Result<Workspace, String>;

#[tauri::command]
async fn archive_workspace(workspace_id: String) -> Result<(), String>;
// Stops daemon, optionally creates PR, runs archive script, jj workspace forget

#[tauri::command]
async fn resume_workspace(workspace_id: String) -> Result<(), String>;
// Restarts daemon for a stale workspace

#[tauri::command]
async fn open_in_editor(workspace_id: String) -> Result<(), String>;
// Opens workspace path in configured editor (code, cursor, zed, etc.)

#[tauri::command]
async fn open_in_terminal(workspace_id: String) -> Result<(), String>;
// Opens workspace path in default terminal
```

### 3.6 Zustand Store

```typescript
// src/stores/workspaceStore.ts
interface WorkspaceStore {
  repos: Repository[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  // Actions
  addRepo: (path: string) => Promise<void>;
  removeRepo: (id: string) => Promise<void>;
  refreshWorkspaces: (repoId: string) => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (opts: CreateWorkspaceOpts) => Promise<Workspace>;
  archiveWorkspace: (id: string) => Promise<void>;
}
```

### 3.7 jj Operations (Rust Layer)

For workspace management, the Rust layer needs to call jj directly (not through the sidecar, since the sidecar IS the daemon for a specific workspace):

```rust
// src-tauri/src/jj.rs
fn workspace_list(repo_path: &Path) -> Result<Vec<JjWorkspace>>;
fn workspace_add(repo_path: &Path, name: &str, path: &Path) -> Result<()>;
fn workspace_forget(repo_path: &Path, name: &str) -> Result<()>;
fn bookmark_list(repo_path: &Path) -> Result<Vec<String>>;
fn log(repo_path: &Path, revset: &str) -> Result<Vec<JjLogEntry>>;
```

These run `jj` as a subprocess from Rust using `std::process::Command`.

## Deliverables
- [ ] Repository add/remove with persistence
- [ ] Sidebar with repo section and workspace list
- [ ] Status dots reflecting daemon state
- [ ] Workspace creation dialog (4 sources)
- [ ] Workspace lifecycle: create, archive, resume
- [ ] Right-click context menu on workspaces
- [ ] Workspace navigation (click → loads workspace view)
- [ ] jj operations from Rust layer

## Design Notes
- Conductor uses city names for workspaces. We could do the same (fun, memorable) or use the branch/session name directly. Could be a setting.
- The sidebar should be resizable (shadcn `ResizablePanel`).
- Keyboard shortcut: `Cmd+N` for new workspace, `Cmd+1-9` for workspace switching.
