# Phase 5: Diff Viewer

## Goal
A full diff viewer using `@pierre/diffs` that shows all changes in the current workspace — similar to Conductor's diff viewer but powered by jj/git native diffs.

## Architecture

```
jj diff --git          →  unified diff string
    │
    ▼
parsePatchFiles()      →  parsed diff structure (@pierre/diffs)
    │
    ▼
<MultiFileDiff />      →  rendered diff with syntax highlighting
```

### Why @pierre/diffs?
- Built on Shiki — excellent syntax highlighting with theme support
- React components out of the box (`@pierre/diffs/react`)
- `parsePatchFiles()` accepts unified diff / git diff output directly
- Supports expand unchanged regions, split/unified views
- Active development by Pierre Computer Company (same team as code.storage)

## Data Sources

jjd can produce diffs in multiple ways:

| Diff Type | Command | Use Case |
|-----------|---------|----------|
| Working copy vs parent | `jj diff --git` | Current uncommitted changes |
| Between revisions | `jj diff --git -r <rev1> -r <rev2>` | Checkpoint comparisons |
| Full branch diff | `jj diff --git -r 'trunk()..@'` | PR preview (all changes since branching) |
| Single file | `jj diff --git <path>` | Focused file view |

### Tauri Commands

```rust
#[tauri::command]
async fn get_diff(
    repo_path: String,
    diff_type: DiffType,  // WorkingCopy | Revisions | Branch | File
    options: DiffOptions,
) -> Result<String, String>;
// Returns raw git-format unified diff string

#[tauri::command]
async fn get_file_content(
    repo_path: String,
    path: String,
    revision: Option<String>,
) -> Result<String, String>;
// For full-file view with parseDiffFromFile()

#[tauri::command]
async fn get_changed_files(
    repo_path: String,
    revset: Option<String>,
) -> Result<Vec<ChangedFile>, String>;
// File list with change types (added/modified/deleted/renamed)
```

## Layout

```
┌──────────────────────────────────────────────────────┐
│  Tab Bar: [Dashboard] [Diff] [Checkpoints] [Notes]   │
│  ═══════════════════════════════════════════════════  │
│                                                      │
│  ┌─ Diff Controls ──────────────────────────────────┐│
│  │  Comparing: [Working Copy ▾]  vs  [Parent ▾]    ││
│  │  View: [Unified ○] [Split ○]   [Expand All]     ││
│  │  Files changed: 5  (+124 / -37)                  ││
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  ┌─ File Tree ──┐  ┌─ Diff Content ───────────────┐ │
│  │              │  │                               │ │
│  │ ▼ src/       │  │  src/auth/middleware.ts       │ │
│  │   M auth/    │  │  ────────────────────────     │ │
│  │     M mid..  │  │  @@ -12,6 +12,15 @@          │ │
│  │     A valid.  │  │   import { verify } from..  │ │
│  │   M index.ts │  │  +                           │ │
│  │ A tests/     │  │  +export function authMid..  │ │
│  │   A auth.t.. │  │  +  const token = req...     │ │
│  │              │  │  +  if (!token) {             │ │
│  │              │  │  +    return res.status(401)  │ │
│  │              │  │                               │ │
│  │              │  │  ─── src/index.ts ────────    │ │
│  │              │  │  @@ -1,4 +1,5 @@              │ │
│  │              │  │   import express from..       │ │
│  │              │  │  +import { authMiddleware }   │ │
│  │              │  │                               │ │
│  └──────────────┘  └───────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Components

```
src/components/diff-viewer/
├── DiffPage.tsx              # Page wrapper, data fetching
├── DiffControls.tsx          # Revision selectors, view mode toggle
├── DiffFileTree.tsx          # Left panel: file tree with change indicators
├── DiffContent.tsx           # Right panel: rendered diffs
├── DiffStats.tsx             # Summary: files changed, insertions, deletions
└── RevisionSelector.tsx      # Dropdown for selecting revisions to compare
```

### DiffControls

- **Left revision selector**: "Working Copy", "Parent (@-)", or any jj revision
- **Right revision selector**: "Parent", "trunk()", or any jj revision
- **View mode toggle**: Unified (default) / Split side-by-side
- **Expand All / Collapse All**: Toggle expanded unchanged regions
- Quick presets: "Working Copy Changes", "Branch Diff (vs trunk)", "Last Describe"

### DiffFileTree

- Tree view of changed files, grouped by directory
- Change type indicators: M (modified, blue), A (added, green), D (deleted, red), R (renamed, yellow)
- Click file → scroll to that file's diff in the content panel
- File count badge per directory
- Collapsible directories

### DiffContent

Uses `@pierre/diffs` React components:

```tsx
import { MultiFileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";

function DiffContent({ rawDiff }: { rawDiff: string }) {
  const files = parsePatchFiles(rawDiff);

  return (
    <MultiFileDiff
      files={files}
      theme="github-dark"       // Match app theme
      viewMode="unified"        // or "split"
      expandable={true}         // Show "expand unchanged" buttons
      lineNumbers={true}
      wrapLines={false}
    />
  );
}
```

For full-file diffs (when we have both versions):
```tsx
import { FileDiff, parseDiffFromFile } from "@pierre/diffs";

// When we have the complete file contents (e.g., from jj cat)
const diff = parseDiffFromFile(oldContent, newContent, { filepath });
<FileDiff diff={diff} theme="github-dark" />
```

### RevisionSelector

Fetches revision options from jj:
```
jj log --no-graph -T 'change_id ++ " " ++ description.first_line() ++ "\n"' -r 'ancestors(@, 20)'
```

Shows a searchable dropdown with change IDs and first line of descriptions.

## Integration with Conductor-style "PR Diff"

For the "full branch diff" (what Conductor shows in its diff viewer before merging):

```bash
jj diff --git -r 'trunk()..@'
```

This shows everything that changed on the branch relative to trunk — exactly what would go into a PR. This is the default diff view when the workspace has a PR associated.

## GitHub Sync (Conductor Parity)

Conductor's diff viewer lets you "sync with GitHub" (create/update PR). We handle this via:
1. **Create PR**: Button in diff controls → calls existing `pr.ts` (`gh pr create`)
2. **Update PR**: Push changes → `jj git push` (existing Pusher)
3. **PR link**: Show PR URL and status badge if one exists

## Deliverables
- [ ] `@pierre/diffs` installed and configured with dark theme
- [ ] DiffPage fetching diffs via Tauri commands
- [ ] File tree with change indicators
- [ ] Multi-file diff rendering with syntax highlighting
- [ ] Unified and split view modes
- [ ] Expand/collapse unchanged regions
- [ ] Revision selector (compare any two revisions)
- [ ] Quick presets (working copy, branch diff, last describe)
- [ ] Diff stats (files changed, insertions, deletions)
- [ ] Click file in tree → scroll to diff

## Dependencies
- `@pierre/diffs` (React components + parsers)
- Shiki (pulled in by @pierre/diffs for syntax highlighting)
