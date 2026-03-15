# Phase 9: Polish & Platform

## Goal
Native platform integration, keyboard shortcuts, system tray, auto-update, and UX refinements that make jjd feel like a real Mac app.

## Native Menu Bar

```rust
// src-tauri/src/menu.rs
Menu::new()
  .add_submenu("jjd", Menu::new()
    .add_native_item(MenuItem::About)
    .add_native_item(MenuItem::Separator)
    .add_item("Settings...", "Cmd+,")
    .add_native_item(MenuItem::Separator)
    .add_native_item(MenuItem::Quit)
  )
  .add_submenu("File", Menu::new()
    .add_item("New Workspace", "Cmd+N")
    .add_item("Open Repository...", "Cmd+O")
    .add_item("Close Workspace", "Cmd+W")
  )
  .add_submenu("Workspace", Menu::new()
    .add_item("Describe Now", "Cmd+D")
    .add_item("Push Now", "Cmd+P")
    .add_item("Create Checkpoint", "Cmd+Shift+C")
    .add_native_item(MenuItem::Separator)
    .add_item("Start Daemon", "")
    .add_item("Stop Daemon", "")
    .add_native_item(MenuItem::Separator)
    .add_item("Open in Editor", "Cmd+Shift+E")
    .add_item("Open in Terminal", "Cmd+Shift+T")
  )
  .add_submenu("View", Menu::new()
    .add_item("Dashboard", "Cmd+1")
    .add_item("Diff", "Cmd+2")
    .add_item("Checkpoints", "Cmd+3")
    .add_item("Notes", "Cmd+4")
    .add_native_item(MenuItem::Separator)
    .add_item("Toggle Sidebar", "Cmd+B")
    .add_item("Toggle Terminal", "Cmd+`")
  )
```

## System Tray

Tray icon showing aggregate daemon status:
- Green: all daemons idle
- Blue (animated): at least one daemon describing
- Purple: at least one daemon pushing
- Red: at least one daemon in error state
- Gray: no active daemons

Tray menu:
```
jjd
──────────────
● workspace-1 (idle)
● workspace-2 (describing)
● workspace-3 (pushing)
──────────────
New Workspace...
──────────────
Show Window
Quit
```

Click tray icon: show/hide main window.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New workspace |
| `Cmd+1-4` | Switch tabs (Dashboard/Diff/Checkpoints/Notes) |
| `Cmd+[` / `Cmd+]` | Previous/next workspace |
| `Cmd+B` | Toggle sidebar |
| `Cmd+`` ` | Toggle terminal panel |
| `Cmd+D` | Describe now |
| `Cmd+P` | Push now |
| `Cmd+Shift+C` | Create checkpoint |
| `Cmd+Shift+E` | Open in editor |
| `Cmd+Shift+T` | Open in terminal |
| `Cmd+,` | Settings |
| `Cmd+K` | Command palette (fuzzy finder for actions) |

## Command Palette

A Spotlight-style command palette (`Cmd+K`):

```
┌─────────────────────────────────────────┐
│  🔍 Type a command...                   │
│  ─────────────────────────────────────  │
│  > Describe Now                         │
│  > Push Now                             │
│  > Create Checkpoint                    │
│  > New Workspace                        │
│  > Switch to workspace-1                │
│  > Switch to workspace-2                │
│  > Open Settings                        │
│  > Toggle Theme                         │
└─────────────────────────────────────────┘
```

Uses shadcn `Command` component (built on cmdk).

## Auto-Update

Tauri v2 has built-in auto-update support:

```rust
// src-tauri/src/main.rs
tauri::Builder::default()
    .plugin(tauri_plugin_updater::init())
```

Update config in `tauri.conf.json`:
```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.jjd.dev/{{target}}/{{arch}}/{{current_version}}"],
      "pubkey": "..."
    }
  }
}
```

Or use GitHub releases as the update source (simpler for open source).

## Theme System

- Dark mode (default) — zinc-based, matching current dashboard aesthetic
- Light mode — for the contrarians
- System — follow macOS appearance
- Stored in app settings, applied via CSS class on `<html>`

shadcn/ui supports this natively with CSS variables.

## Window Management

- Remember window size and position across launches
- Restore sidebar width
- Restore active workspace and tab on relaunch
- Support multiple windows (one per repo?) — future consideration

## Notification System

Desktop notifications for key events:
- Agent finished working (terminal process exited)
- Push completed / failed
- Describe error (API failure, etc.)
- All todos completed

```rust
use tauri_plugin_notification::NotificationExt;

app.notification()
    .builder()
    .title("jjd")
    .body("Push completed for workspace-1")
    .show()?;
```

## Deliverables
- [ ] Native menu bar with all actions
- [ ] System tray with aggregate status
- [ ] Full keyboard shortcut set
- [ ] Command palette (`Cmd+K`)
- [ ] Auto-update mechanism
- [ ] Theme switching (dark/light/system)
- [ ] Window state persistence
- [ ] Desktop notifications
- [ ] App icon and branding

## Dependencies (Tauri plugins)
- `tauri-plugin-updater`
- `tauri-plugin-notification`
- `tauri-plugin-store` (for persisting window state, settings)
