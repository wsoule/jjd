# Phase 2: Sidecar Integration

## Goal
The existing jjd Bun daemon runs as a Tauri sidecar process. The Rust layer manages its lifecycle (start/stop/restart). The React frontend communicates with the daemon through Tauri IPC → Rust → HTTP/stdio bridge.

## Architecture

```
React (webview)
    │ invoke("daemon_status", { workspaceId })
    ▼
Rust (Tauri commands)
    │ HTTP GET http://localhost:{port}/status
    ▼
jjd sidecar (Bun process)
    │ Engine state machine
    ▼
jj CLI + Anthropic API + SQLite
```

### Why HTTP bridge (not stdio)?
The jjd daemon already has a full HTTP API (`/status`, `/describe`, `/push`, `/checkpoint`, `/rollback`, `/checkpoints`, `/stop`). Reusing this is the fastest path. The Rust layer acts as a thin proxy — it spawns the sidecar, tracks its port, and forwards requests.

In the future, we could add a stdio JSON-RPC protocol for tighter integration, but HTTP works now with zero daemon changes.

## Steps

### 2.1 Package jjd as a Sidecar Binary

Tauri sidecars need to be compiled binaries with platform-specific naming.

Build the jjd binary:
```bash
cd sidecar/
bun build index.ts --compile --outfile ../src-tauri/binaries/jjd-aarch64-apple-darwin
```

Register in `src-tauri/tauri.conf.json`:
```json
{
  "bundle": {
    "externalBin": ["binaries/jjd"]
  }
}
```

The sidecar binary must follow Tauri's naming convention: `jjd-{target-triple}` (e.g., `jjd-aarch64-apple-darwin`, `jjd-x86_64-apple-darwin`).

### 2.2 Rust Sidecar Manager

Create `src-tauri/src/sidecar.rs`:

```rust
// Manages jjd sidecar processes — one per workspace
struct SidecarManager {
    // workspace_id → (child_process, port)
    processes: HashMap<String, SidecarProcess>,
}

struct SidecarProcess {
    child: CommandChild,  // Tauri shell CommandChild
    port: u16,
    repo_path: PathBuf,
    workspace_id: String,
}

impl SidecarManager {
    // Start a daemon for a workspace
    fn start(&mut self, workspace_id: &str, repo_path: &Path, port: u16) -> Result<()>;

    // Stop a specific workspace daemon
    fn stop(&mut self, workspace_id: &str) -> Result<()>;

    // Stop all daemons (app shutdown)
    fn stop_all(&mut self) -> Result<()>;

    // Get the port for a workspace's daemon
    fn get_port(&self, workspace_id: &str) -> Option<u16>;

    // Check if a daemon is alive
    fn is_alive(&self, workspace_id: &str) -> bool;
}
```

### 2.3 Tauri Commands (IPC)

Create `src-tauri/src/commands/daemon.rs`:

```rust
#[tauri::command]
async fn start_daemon(workspace_id: String, repo_path: String) -> Result<DaemonInfo, String>;

#[tauri::command]
async fn stop_daemon(workspace_id: String) -> Result<(), String>;

#[tauri::command]
async fn daemon_status(workspace_id: String) -> Result<DaemonStatus, String>;

#[tauri::command]
async fn daemon_describe(workspace_id: String) -> Result<DescribeResult, String>;

#[tauri::command]
async fn daemon_push(workspace_id: String) -> Result<PushResult, String>;

#[tauri::command]
async fn daemon_checkpoint(workspace_id: String, description: String) -> Result<Checkpoint, String>;

#[tauri::command]
async fn daemon_rollback(workspace_id: String, checkpoint_id: String) -> Result<(), String>;

#[tauri::command]
async fn daemon_checkpoints(workspace_id: String) -> Result<Vec<Checkpoint>, String>;
```

Each command:
1. Looks up the workspace's sidecar port from `SidecarManager`
2. Makes an HTTP request to `http://localhost:{port}/{endpoint}`
3. Returns the JSON response to the frontend

### 2.4 Tauri Events (Push Notifications)

For real-time status updates, use Tauri events instead of polling:

```rust
// Emitted when daemon state changes
app.emit("daemon:state-changed", DaemonStatePayload {
    workspace_id: String,
    state: String,        // idle, debouncing, describing, pushing, error
    last_describe: Option<String>,
    last_push: Option<String>,
    error: Option<String>,
});
```

**Polling strategy (Phase 2):** The Rust layer polls each active daemon's `/status` endpoint every 2 seconds (matching the current dashboard) and emits events on change. This replaces the frontend polling the HTTP API directly.

**Future (Phase 8):** Add SSE or WebSocket to the daemon for push-based updates, eliminating polling entirely.

### 2.5 Port Allocation

The existing `SessionManager` already handles port allocation (starting from 7433, checking availability). The Rust layer should:

1. When starting a new workspace daemon: find an available port (start at 7433, increment)
2. Pass the port via `JJD_PORT` env var to the sidecar
3. Store the mapping in `SidecarManager`

```rust
fn find_available_port(start: u16) -> u16 {
    let mut port = start;
    loop {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
        port += 1;
    }
}
```

### 2.6 Frontend IPC Hooks

Create React hooks that wrap Tauri `invoke()` calls:

```typescript
// src/hooks/useDaemon.ts
export function useDaemon(workspaceId: string) {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

  // Poll status via Tauri command
  useEffect(() => {
    const interval = setInterval(async () => {
      const s = await invoke<DaemonStatus>("daemon_status", { workspaceId });
      setStatus(s);
    }, 2000);
    return () => clearInterval(interval);
  }, [workspaceId]);

  // Or listen to Tauri events (preferred)
  useEffect(() => {
    const unlisten = listen<DaemonStatePayload>("daemon:state-changed", (event) => {
      if (event.payload.workspace_id === workspaceId) {
        setStatus(event.payload);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [workspaceId]);

  const describe = () => invoke("daemon_describe", { workspaceId });
  const push = () => invoke("daemon_push", { workspaceId });
  const checkpoint = (desc: string) => invoke("daemon_checkpoint", { workspaceId, description: desc });
  const rollback = (id: string) => invoke("daemon_rollback", { workspaceId, checkpointId: id });

  return { status, describe, push, checkpoint, rollback };
}
```

### 2.7 App Lifecycle

**On app start:**
1. Scan for existing `.jjd-sessions/` in configured repos
2. For any `active` sessions, restart their sidecar daemons
3. Populate sidebar with discovered workspaces

**On app quit:**
1. `SidecarManager.stop_all()` — gracefully stop all daemons
2. Each daemon gets `POST /stop` first, then `SIGTERM` after 5s timeout

**On workspace create:**
1. Allocate port
2. Start sidecar with `--repo <path> --port <port>`
3. Register in SidecarManager
4. Add to sidebar

**On workspace archive/delete:**
1. `POST /stop` to daemon
2. `jj workspace forget` (via sidecar or direct CLI)
3. Remove from SidecarManager
4. Remove from sidebar

## Deliverables
- [ ] jjd builds as a Tauri-compatible sidecar binary
- [ ] `SidecarManager` in Rust handles process lifecycle
- [ ] Tauri commands proxy all daemon HTTP endpoints
- [ ] Status polling from Rust layer, emitted as Tauri events
- [ ] React hooks (`useDaemon`) for frontend consumption
- [ ] Graceful startup (resume existing sessions) and shutdown (stop all daemons)
- [ ] Port allocation handled in Rust layer

## Open Questions
- Should we keep the daemon's HTTP API server running (for external tools / CLI access), or have the sidecar communicate purely via stdio? (Leaning: keep HTTP — it's useful for debugging and CLI fallback)
- Should the Rust layer cache daemon state, or always proxy to HTTP? (Leaning: thin proxy for now, cache later for performance)
