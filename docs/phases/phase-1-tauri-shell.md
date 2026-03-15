# Phase 1: Tauri + React Shell

## Goal
Scaffolded Tauri v2 desktop app with React frontend, shadcn/ui installed, basic layout structure, and routing — a working empty shell you can `cargo tauri dev` and see a window.

## Prerequisites
- Rust toolchain (rustup)
- Node.js or Bun (for frontend build)
- Tauri CLI v2 (`cargo install tauri-cli`)

## Steps

### 1.1 Initialize Tauri v2 Project

Use `cargo tauri init` or `create-tauri-app` to scaffold inside the existing repo. The frontend will live at the repo root (React + Vite), and Tauri's Rust code goes in `src-tauri/`.

```bash
# From repo root
bunx create-tauri-app . --template react-ts --manager bun
```

Key config in `src-tauri/tauri.conf.json`:
- `identifier`: `com.jjd.app`
- `title`: `jjd`
- `width`: 1200, `height`: 800
- `minWidth`: 900, `minHeight`: 600
- `decorations`: true (native title bar for now)
- `devUrl`: `http://localhost:1420` (Vite dev server)
- `frontendDist`: `../dist`

### 1.2 Move Existing Daemon Code to `sidecar/`

Relocate the existing `src/` TypeScript daemon code into `sidecar/` so `src/` is free for the React frontend:

```
mv src/ sidecar/
```

Update `package.json` bin and build scripts to reference `sidecar/index.ts`.

Create a separate `sidecar/package.json` or keep shared — TBD based on dependency isolation needs. The sidecar has only `@anthropic-ai/sdk` + `bun:sqlite`; the frontend needs React, shadcn, etc.

**Decision: Use a monorepo-ish layout with a single root `package.json` and path aliases.**

### 1.3 Install Frontend Dependencies

```bash
# React + Vite (from create-tauri-app)
bun add react react-dom
bun add -d @types/react @types/react-dom

# Tailwind CSS v4
bun add -d tailwindcss @tailwindcss/vite

# shadcn/ui prerequisites
bun add tailwind-merge clsx class-variance-authority
bun add lucide-react
bun add @radix-ui/react-slot

# Routing
bun add react-router-dom

# State management
bun add zustand

# Tauri APIs
bun add @tauri-apps/api @tauri-apps/plugin-shell
```

### 1.4 Configure shadcn/ui

Initialize shadcn with `bunx shadcn@latest init`:
- Style: New York
- Base color: Zinc (dark theme, similar to Conductor's dark UI)
- CSS variables: yes

Install initial components:
```bash
bunx shadcn@latest add button card sidebar sheet tabs scroll-area separator badge tooltip
```

### 1.5 Set Up Tailwind CSS

`tailwind.config.ts`:
- Content paths: `src/**/*.{ts,tsx}`
- Dark mode: `class`
- Extend with shadcn theme tokens

### 1.6 Create Base Layout

```
src/
├── main.tsx              # ReactDOM.createRoot, BrowserRouter
├── App.tsx               # Layout shell: Sidebar + Outlet
├── components/
│   ├── ui/               # shadcn components land here
│   ├── layout/
│   │   ├── AppSidebar.tsx    # Left sidebar (repos, workspaces)
│   │   ├── TopBar.tsx        # Top bar (workspace name, status, actions)
│   │   └── MainContent.tsx   # Router outlet wrapper
│   └── shared/
│       └── StatusDot.tsx     # Colored status indicator
├── pages/
│   ├── DashboardPage.tsx     # Default: workspace overview
│   ├── DiffPage.tsx          # Diff viewer (Phase 5)
│   ├── CheckpointsPage.tsx   # Checkpoints (Phase 6)
│   └── SettingsPage.tsx      # App settings
├── hooks/
│   └── useTauriEvent.ts      # Helper for Tauri event listeners
├── stores/
│   ├── workspaceStore.ts     # Active workspace, list of workspaces
│   └── appStore.ts           # Global app state (sidebar open, theme)
├── lib/
│   └── utils.ts              # cn() helper from shadcn
└── styles/
    └── globals.css           # Tailwind base + shadcn CSS vars
```

### 1.7 Implement App Layout

The layout mimics Conductor's structure:

```
┌────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌──────────────────────────────────┐  │
│ │          │ │ TopBar: workspace name + status   │  │
│ │ Sidebar  │ ├──────────────────────────────────┤  │
│ │          │ │                                  │  │
│ │ [Repos]  │ │  Tab Bar: Dashboard | Diff |     │  │
│ │          │ │          Checkpoints | Notes     │  │
│ │ ─────── │ │                                  │  │
│ │          │ │  Main Content (router outlet)    │  │
│ │ [Spaces] │ │                                  │  │
│ │  space1  │ │                                  │  │
│ │  space2  │ │                                  │  │
│ │  space3  │ │                                  │  │
│ │          │ │                                  │  │
│ │ ─────── │ │                                  │  │
│ │ [+ New]  │ │                                  │  │
│ │          │ │                                  │  │
│ └──────────┘ └──────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

- Sidebar: collapsible, shows repo name at top, list of workspaces below, "New Workspace" button at bottom
- TopBar: shows active workspace branch name, colored status dot (idle/debouncing/describing/pushing/error), action buttons
- Tab bar: navigates between Dashboard, Diff, Checkpoints, Notes tabs
- Main content: renders the active tab's page component

### 1.8 Set Up Routing

```tsx
// Routes
<Route path="/" element={<AppLayout />}>
  <Route index element={<DashboardPage />} />
  <Route path="workspace/:id" element={<WorkspaceLayout />}>
    <Route index element={<DashboardPage />} />
    <Route path="diff" element={<DiffPage />} />
    <Route path="checkpoints" element={<CheckpointsPage />} />
    <Route path="notes" element={<NotesPage />} />
  </Route>
  <Route path="settings" element={<SettingsPage />} />
</Route>
```

### 1.9 Tauri Rust Minimal Setup

`src-tauri/src/main.rs`:
- Create default Tauri app with single window
- Register a `greet` command as smoke test
- Set up plugin-shell for future sidecar management

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}
```

### 1.10 Verify Dev Loop

```bash
cargo tauri dev
```

Should open a native window with the React app showing the sidebar layout, tab bar, and empty dashboard page.

## Deliverables
- [ ] Tauri v2 project scaffolded with `src-tauri/`
- [ ] Existing daemon code moved to `sidecar/`
- [ ] React + Vite frontend with hot reload
- [ ] shadcn/ui initialized with dark theme
- [ ] App layout: sidebar, top bar, tab bar, main content area
- [ ] React Router with workspace routes
- [ ] Zustand stores for workspace and app state
- [ ] `cargo tauri dev` opens working window

## Open Questions
- Should the sidecar have its own `package.json` or share the root? (Leaning: separate, to keep frontend and daemon deps isolated)
- Do we want a custom title bar (frameless window with custom drag region) or native? (Leaning: native for Phase 1, custom later)
