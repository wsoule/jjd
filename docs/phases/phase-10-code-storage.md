# Phase 10: code.storage Integration

## Goal
Integrate code.storage (by Pierre Computer Company) as an optional remote Git backend — enabling cloud-hosted repos, ephemeral branches, and ultra-low-latency Git operations for AI agent workflows.

## What code.storage Provides

- **API-first Git infrastructure** — programmatic repo creation and management
- **SDKs**: TypeScript, Python, Go (full read/write Git access)
- **Native Git endpoints** — clone, push, fetch via standard Git protocol
- **Ephemeral branches** — temporary branches that auto-clean
- **In-memory writes** — write files without a full clone
- **GitHub sync** — bidirectional sync with GitHub repos
- **Webhooks** — for build systems, bots, AI agents
- **Custom domains** — expose as `git.yourdomain.com`
- **60x faster clones** than S3/R2-based solutions

## Use Cases in jjd

### 1. Cloud Workspace Backing
Instead of local-only jj workspaces, optionally back them with code.storage repos:
- Agent workspaces can live in the cloud
- Multiple machines can access the same workspace
- No local disk space for large repos

### 2. Ephemeral Agent Branches
When spawning AI agents, create ephemeral branches on code.storage:
- Agent works on ephemeral branch
- Branch auto-deletes after merge or timeout
- No branch pollution in the main repo

### 3. Fast Clones for New Workspaces
Use code.storage's fast clone for workspace creation:
- 60x faster than cloning from GitHub for large repos
- Especially valuable when creating many parallel workspaces

### 4. Remote Diff / Grep
code.storage supports server-side grep and diff:
- Run grep across the repo without a full clone
- Get diffs between any refs without local checkout
- Useful for agent context gathering

### 5. Webhook-Driven Automation
code.storage webhooks can trigger jjd actions:
- On push → auto-describe
- On branch create → spin up workspace
- On merge → archive workspace

## Architecture

```
┌──────────────────────────────────────┐
│  jjd App                            │
│  ┌────────────────────────────────┐  │
│  │  code.storage SDK (TypeScript) │  │
│  │  - createRepo()               │  │
│  │  - createBranch(ephemeral)    │  │
│  │  - readFile() / writeFile()   │  │
│  │  - getDiff()                  │  │
│  │  - grep()                     │  │
│  └────────────┬───────────────────┘  │
│               │ HTTPS API            │
└───────────────┼──────────────────────┘
                │
                ▼
┌──────────────────────────────────────┐
│  code.storage Cloud                  │
│  ┌────────────────────────────────┐  │
│  │  Git Infrastructure           │  │
│  │  - Repos (warm / cold)        │  │
│  │  - Branches (persistent /     │  │
│  │    ephemeral)                 │  │
│  │  - Webhooks                   │  │
│  └────────────┬───────────────────┘  │
│               │ GitHub Sync          │
└───────────────┼──────────────────────┘
                │
                ▼
┌──────────────────────────────────────┐
│  GitHub (upstream)                    │
└──────────────────────────────────────┘
```

## Configuration

Extend `jjd.config.json`:
```json
{
  "codeStorage": {
    "enabled": false,
    "apiKey": "$CODE_STORAGE_API_KEY",
    "organization": "my-org",
    "syncWithGithub": true,
    "useEphemeralBranches": true,
    "defaultRegion": "us-east-1"
  }
}
```

## Integration Points

### Settings UI
- code.storage account connection (API key)
- Per-repo: enable/disable cloud backing
- Ephemeral branch preferences
- Sync settings (auto-sync with GitHub, webhook config)

### Workspace Creation
- New option in workspace creation dialog: "Cloud Workspace"
- Uses code.storage API to create repo/branch
- Sets up jj remote pointing to code.storage endpoint

### Diff Viewer
- Option to use code.storage's server-side diff API
- Faster for large repos (no local checkout needed)
- Fallback to local jj diff when offline

## Implementation Notes

- code.storage is built by the same team as @pierre/diffs — the integration story is likely to be very smooth
- The TypeScript SDK can run in the sidecar (Bun process)
- Start with the SDK for repo/branch management, then add webhooks
- This phase is intentionally last — it's additive and optional

## Deliverables
- [ ] code.storage SDK integrated into sidecar
- [ ] Settings UI for account connection
- [ ] Cloud-backed workspace creation option
- [ ] Ephemeral branch support
- [ ] Server-side diff as alternative data source
- [ ] Webhook configuration UI
- [ ] GitHub sync status display
- [ ] Offline fallback (graceful degradation when cloud unavailable)

## Dependencies
- code.storage TypeScript SDK
- API key / account with code.storage

## Open Questions
- Pricing model: per-workspace? per-repo? Need to understand cost implications for many ephemeral branches.
- Should jj's native Git remotes point to code.storage, or use the SDK exclusively? (Leaning: jj remotes for push/fetch, SDK for management operations)
- How does code.storage's GitHub sync interact with jj's `git push`? Need to test for conflicts.
