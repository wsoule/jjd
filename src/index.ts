#!/usr/bin/env bun

// @ts-ignore: outside rootDir but Bun bundles package.json into the compiled binary
import { version as VERSION } from "../package.json";

import { Daemon } from "./daemon";
import { JjOperations } from "./jj/operations";
import { SessionManager } from "./session";
import { LinearClient } from "./linear";
import { installWorktreeHooks } from "./hooks";
import { logger } from "./util/logger";
import { resolve } from "path";

const HELP = `
jjd — Jujutsu automation daemon

Usage:
  jjd start [options]                Start the daemon (standalone)
  jjd stop                           Stop the running daemon
  jjd status                         Show daemon and repo status

  jjd session start <id> [title]     Start a session for a Linear task
  jjd session stop <id>              Stop session, create PR, push final state
  jjd session resume <id>            Resume a stale/stopped session
  jjd session resume-all             Resume all stale sessions
  jjd session list                   List all sessions
  jjd session log <id>               View daemon log for a session
  jjd session which                  Show which session the cwd belongs to
  jjd session cleanup <id>           Stop + forget workspace

  jjd shell-prompt                   Print session info for shell PS1

  jjd hooks install [--with-daemon]  Install WorktreeCreate/WorktreeRemove hooks
                                     in this repo's .claude/settings.json so jj
                                     workspaces stay in sync with Claude worktrees.
                                     --with-daemon also starts/stops jjd per worktree.

  jjd describe                       Manually trigger auto-describe
  jjd push                           Manually trigger push
  jjd checkpoint [msg]               Create a rollback checkpoint
  jjd rollback <id>                  Rollback to a checkpoint
  jjd checkpoints                    List checkpoints
  jjd init                           One-time setup: check deps, install hooks
  jjd version                        Print version
  jjd help                           Show this help

Options:
  --repo <path>       Repository path (default: current directory)
  --config <path>     Config file path
  --claude            Launch Claude Code in the session workspace
  --prompt <text>     Initial prompt for Claude Code
  --no-pr             Skip PR creation when stopping a session
  --draft             Create PR as draft
  --debug             Enable debug logging

Environment:
  ANTHROPIC_API_KEY   Required for AI-generated commit messages
  LINEAR_API_KEY      Optional, for fetching task details from Linear
`.trim();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  // Parse flags
  let repoPath = process.cwd();
  let configPath: string | undefined;
  let debug = false;
  let launchClaude = false;
  let claudePrompt: string | undefined;
  let noPr = false;
  let draft = false;
  let withDaemon = false;

  // Track which arg indices are consumed by flags so we can filter them
  // from what we pass to subcommands
  const consumedIndices = new Set<number>();

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--repo":
        consumedIndices.add(i);
        consumedIndices.add(i + 1);
        repoPath = resolve(args[++i]);
        break;
      case "--config":
        consumedIndices.add(i);
        consumedIndices.add(i + 1);
        configPath = resolve(args[++i]);
        break;
      case "--debug":
        consumedIndices.add(i);
        debug = true;
        break;
      case "--claude":
        consumedIndices.add(i);
        launchClaude = true;
        break;
      case "--prompt":
        consumedIndices.add(i);
        consumedIndices.add(i + 1);
        claudePrompt = args[++i];
        break;
      case "--no-pr":
        consumedIndices.add(i);
        noPr = true;
        break;
      case "--draft":
        consumedIndices.add(i);
        draft = true;
        break;
      case "--with-daemon":
        consumedIndices.add(i);
        withDaemon = true;
        break;
    }
  }

  // Filter consumed flags from the args passed to subcommands
  const remainingArgs = args.filter((_, i) => i === 0 || !consumedIndices.has(i));

  if (debug) {
    const { setLogLevel } = await import("./util/logger");
    setLogLevel("debug");
  }

  const apiPort = resolveApiPort(repoPath, configPath);

  switch (command) {
    case "start":
      return cmdStart(repoPath, configPath);
    case "stop":
      return cmdStop(repoPath, apiPort);
    case "status":
      return cmdStatus(repoPath, apiPort);
    case "session":
      return cmdSession(repoPath, remainingArgs.slice(1), { launchClaude, claudePrompt, noPr, draft });
    case "shell-prompt":
      return cmdShellPrompt();
    case "hooks":
      return cmdHooks(repoPath, remainingArgs.slice(1), withDaemon);
    case "_on-worktree-create":
      return cmdOnWorktreeCreate(repoPath);
    case "_on-worktree-remove":
      return cmdOnWorktreeRemove(repoPath);
    case "describe":
      return cmdDescribe(apiPort);
    case "push":
      return cmdPush(apiPort);
    case "checkpoint":
      return cmdCheckpoint(apiPort, args.slice(1).filter((a) => !a.startsWith("--")).join(" "));
    case "rollback":
      return cmdRollback(apiPort, args[1]);
    case "checkpoints":
      return cmdListCheckpoints(apiPort);
    case "init":
      return cmdInit(repoPath);
    case "version":
    case "--version":
    case "-v":
      console.log(`jjd ${VERSION}`);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

async function cmdStart(repoPath: string, configPath?: string) {
  const existing = Daemon.isRunning(repoPath);
  if (existing.running) {
    console.error(`jjd is already running (PID ${existing.pid})`);
    process.exit(1);
  }

  const daemon = new Daemon(repoPath, configPath);
  await daemon.start();

  // Keep the process alive
  await new Promise(() => {}); // Block forever (until signal)
}

async function cmdStop(repoPath: string, apiPort: number) {
  const existing = Daemon.isRunning(repoPath);
  if (!existing.running || !existing.pid) {
    console.log("jjd is not running");
    return;
  }

  // Try API first, then signal
  try {
    const resp = await fetch(`http://localhost:${apiPort}/stop`, { method: "POST" });
    if (resp.ok) {
      console.log("jjd stopping...");
      return;
    }
  } catch {
    // API not available, use signal
  }

  process.kill(existing.pid, "SIGTERM");
  console.log(`Sent SIGTERM to PID ${existing.pid}`);
}

async function cmdStatus(repoPath: string, apiPort: number) {
  const existing = Daemon.isRunning(repoPath);

  if (!existing.running) {
    console.log("jjd: not running");
    const jj = new JjOperations(repoPath);
    try {
      const status = await jj.status();
      console.log(`\nRepo: ${repoPath}`);
      console.log(`Change: ${status.workingCopy.changeId.slice(0, 12)}`);
      console.log(`Description: ${status.workingCopy.description || "(empty)"}`);
      console.log(`Files changed: ${status.fileChanges.length}`);
      console.log(`Bookmarks: ${status.workingCopy.bookmarks.join(", ") || "(none)"}`);
    } catch (err) {
      console.log(`Not a jj repository or jj error: ${err}`);
    }
    return;
  }

  try {
    const resp = await fetch(`http://localhost:${apiPort}/status`);
    const data = await resp.json();
    console.log(`jjd: running (PID ${existing.pid})`);
    console.log(`State: ${data.daemon.state}`);
    if (data.daemon.lastDescribe) console.log(`Last describe: ${data.daemon.lastDescribe}`);
    if (data.daemon.lastPush) console.log(`Last push: ${data.daemon.lastPush}`);
    if (data.daemon.error) console.log(`Error: ${data.daemon.error}`);
    console.log(`\nRepo change: ${data.repo.changeId?.slice(0, 12)}`);
    console.log(`Description: ${data.repo.description || "(empty)"}`);
    console.log(`Files changed: ${data.repo.fileChanges}`);
    console.log(`Bookmarks: ${data.repo.bookmarks?.join(", ") || "(none)"}`);
  } catch {
    console.log(`jjd: running (PID ${existing.pid}) but API not reachable`);
  }
}

async function cmdDescribe(apiPort: number) {
  try {
    const resp = await fetch(`http://localhost:${apiPort}/describe`, { method: "POST" });
    const data = await resp.json();
    if (data.ok) {
      console.log(`Described: ${data.message}`);
    } else {
      console.error(`Failed: ${data.error}`);
    }
  } catch {
    console.error("jjd is not running. Start it with: jjd start");
    process.exit(1);
  }
}

async function cmdPush(apiPort: number) {
  try {
    const resp = await fetch(`http://localhost:${apiPort}/push`, { method: "POST" });
    const data = await resp.json();
    console.log(data.pushed ? "Pushed successfully" : "Nothing to push");
  } catch {
    console.error("jjd is not running. Start it with: jjd start");
    process.exit(1);
  }
}

async function cmdCheckpoint(apiPort: number, description: string) {
  try {
    const resp = await fetch(`http://localhost:${apiPort}/checkpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const data = await resp.json();
    if (data.ok) {
      console.log(`Checkpoint #${data.checkpoint.id} created`);
    }
  } catch {
    console.error("jjd is not running. Start it with: jjd start");
    process.exit(1);
  }
}

async function cmdRollback(apiPort: number, idStr: string) {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error("Usage: jjd rollback <checkpoint-id>");
    process.exit(1);
  }

  try {
    const resp = await fetch(`http://localhost:${apiPort}/rollback/${id}`, { method: "POST" });
    const data = await resp.json();
    if (data.ok) {
      console.log(`Rolled back to checkpoint #${id}`);
    } else {
      console.error(`Failed: ${data.error}`);
    }
  } catch {
    console.error("jjd is not running. Start it with: jjd start");
    process.exit(1);
  }
}

async function cmdListCheckpoints(apiPort: number) {
  try {
    const resp = await fetch(`http://localhost:${apiPort}/checkpoints`);
    const data = await resp.json();
    if (data.checkpoints.length === 0) {
      console.log("No checkpoints");
      return;
    }
    for (const cp of data.checkpoints) {
      console.log(`#${cp.id}  ${cp.createdAt}  ${cp.description || "(no description)"}`);
    }
  } catch {
    console.error("jjd is not running. Start it with: jjd start");
    process.exit(1);
  }
}

// -- Session commands --

async function cmdSession(
  repoPath: string,
  args: string[],
  opts: { launchClaude: boolean; claudePrompt?: string; noPr: boolean; draft: boolean }
) {
  const subcommand = args.find((a) => !a.startsWith("--")) ?? "list";
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const mgr = new SessionManager(repoPath);

  switch (subcommand) {
    case "start": {
      const linearId = positionalArgs[1];
      if (!linearId) {
        console.error("Usage: jjd session start <linear-id> [title]");
        process.exit(1);
      }

      // Try to fetch full details from Linear
      let title = positionalArgs.slice(2).join(" ");
      let linearDescription: string | undefined;
      let linearUrl: string | undefined;

      const linear = new LinearClient();
      if (linear.isConfigured) {
        console.log(`Fetching task from Linear...`);
        const issue = await linear.getIssue(linearId);
        if (issue) {
          if (!title) title = issue.title;
          linearDescription = issue.description;
          linearUrl = issue.url;
          console.log(`  ${issue.identifier}: ${issue.title}`);
          console.log(`  Status: ${issue.state}`);
          if (issue.url) console.log(`  ${issue.url}`);
        }
      }
      if (!title) title = linearId;

      const session = await mgr.start(linearId, title, {
        launchClaude: opts.launchClaude,
        claudePrompt: opts.claudePrompt,
        linearDescription,
        linearUrl,
      });

      console.log(`\nSession started!`);
      console.log(`  ID:        ${session.id}`);
      console.log(`  Task:      ${session.linearId} — ${session.linearTitle}`);
      console.log(`  Bookmark:  ${session.bookmark}`);
      console.log(`  Workspace: ${session.workspacePath}`);
      console.log(`  Daemon:    http://localhost:${session.daemonPort} (PID ${session.daemonPid})`);
      console.log(`  Log:       ${session.daemonLogFile}`);

      if (opts.launchClaude) {
        console.log(`\nLaunching Claude Code...`);
        // This replaces the current process — never returns
        mgr.launchClaude(session);
      } else {
        console.log(`\nTo work in this session:`);
        console.log(`  cd ${session.workspacePath}`);
        console.log(`  claude  # start Claude Code here`);
      }
      break;
    }

    case "stop": {
      const sessionId = positionalArgs[1];
      if (!sessionId) {
        console.error("Usage: jjd session stop <session-id>");
        process.exit(1);
      }

      console.log(`Stopping session "${sessionId}"...`);
      const result = await mgr.stop(sessionId, {
        createPr: !opts.noPr,
        draft: opts.draft,
      });

      console.log(`Session "${sessionId}" stopped.`);
      if (result.prUrl) {
        console.log(`PR created: ${result.prUrl}`);
      }
      break;
    }

    case "resume": {
      const sessionId = positionalArgs[1];
      if (!sessionId) {
        console.error("Usage: jjd session resume <session-id>");
        process.exit(1);
      }

      const session = await mgr.resume(sessionId);
      console.log(`Session "${sessionId}" resumed.`);
      console.log(`  Daemon: http://localhost:${session.daemonPort} (PID ${session.daemonPid})`);
      console.log(`  Workspace: ${session.workspacePath}`);
      break;
    }

    case "resume-all": {
      console.log("Resuming all stale sessions...");
      const resumed = await mgr.resumeAll();
      if (resumed.length === 0) {
        console.log("No stale sessions to resume.");
      } else {
        for (const s of resumed) {
          console.log(`  Resumed: ${s.id} (port ${s.daemonPort}, PID ${s.daemonPid})`);
        }
      }
      break;
    }

    case "log": {
      const sessionId = positionalArgs[1];
      if (!sessionId) {
        console.error("Usage: jjd session log <session-id>");
        process.exit(1);
      }

      const log = mgr.getLog(sessionId);
      if (log === null) {
        console.error(`No log found for session "${sessionId}"`);
        process.exit(1);
      }
      console.log(log);
      break;
    }

    case "cleanup": {
      const sessionId = positionalArgs[1];
      if (!sessionId) {
        console.error("Usage: jjd session cleanup <session-id>");
        process.exit(1);
      }
      await mgr.stop(sessionId, { cleanup: true, createPr: !opts.noPr, draft: opts.draft });
      console.log(`Session "${sessionId}" stopped and workspace forgotten.`);
      break;
    }

    case "which": {
      // Check if cwd (or --repo) is inside a session workspace
      const marker = findSessionMarker(repoPath);
      if (marker) {
        console.log(`Session:   ${marker.id}`);
        console.log(`Task:      ${marker.linearId}`);
        console.log(`Bookmark:  ${marker.bookmark}`);
        console.log(`Daemon:    http://localhost:${marker.port}`);
      } else if (process.env.JJD_SESSION) {
        console.log(`Session:   ${process.env.JJD_SESSION}`);
        console.log(`Port:      ${process.env.JJD_SESSION_PORT}`);
        console.log(`Workspace: ${process.env.JJD_WORKSPACE}`);
      } else {
        console.log("Not inside a jjd session workspace.");
        process.exit(1);
      }
      break;
    }

    case "list": {
      const sessions = mgr.list();
      if (sessions.length === 0) {
        console.log("No sessions.");
        return;
      }

      console.log("Sessions:\n");
      for (const s of sessions) {
        const statusIcon =
          s.status === "active" ? "●" : s.status === "stale" ? "○" : "·";
        console.log(
          `  ${statusIcon} ${s.id.padEnd(24)} ${s.status.padEnd(8)} ${s.linearTitle.slice(0, 50)}`
        );
        console.log(
          `    bookmark: ${s.bookmark}  port: ${s.daemonPort}  workspace: ${s.workspacePath}`
        );
        if (s.prUrl) console.log(`    pr: ${s.prUrl}`);
        if (s.status === "stale") console.log(`    (use 'jjd session resume ${s.id}' to restart)`);
      }
      break;
    }

    default:
      console.error(`Unknown session subcommand: ${subcommand}`);
      console.error("Usage: jjd session [start|stop|resume|resume-all|list|log|cleanup]");
      process.exit(1);
  }
}

// -- Workspace detection --

import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";

/** Resolve the daemon's API port from env → config file → default. */
function resolveApiPort(repoPath: string, configPath?: string): number {
  try {
    return loadConfig(repoPath, configPath).apiPort;
  } catch {
    return 7433;
  }
}

interface SessionMarker {
  id: string;
  linearId: string;
  port: number;
  bookmark: string;
}

function findSessionMarker(dir: string): SessionMarker | null {
  const markerPath = join(dir, ".jjd-session");
  if (existsSync(markerPath)) {
    try {
      return JSON.parse(readFileSync(markerPath, "utf-8"));
    } catch {
      return null;
    }
  }

  // Also check parent dirs (in case cwd is a subdirectory of the workspace)
  const parent = resolve(dir, "..");
  if (parent !== dir) {
    return findSessionMarker(parent);
  }
  return null;
}

// -- Init --

const JJD_GITIGNORE_ENTRIES = [
  ".jjd-sessions/",   // session metadata (JSON files per session)
  ".jjd-session",     // workspace marker written by jjd session start
  ".jjd-task-prompt", // task prompt injected into Claude at session start
  ".jjd.log",         // daemon log created by WorktreeCreate hook
];

function updateGitignore(repoPath: string) {
  const gitignorePath = join(repoPath, ".gitignore");

  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";

  const missing = JJD_GITIGNORE_ENTRIES.filter(
    (entry) => !existing.split("\n").some((line) => line.trim() === entry)
  );

  if (missing.length === 0) {
    console.log("  ✓ .gitignore already up to date");
    return;
  }

  const block =
    (existing.length > 0 && !existing.endsWith("\n") ? "\n" : "") +
    "# jjd\n" +
    missing.join("\n") +
    "\n";

  appendFileSync(gitignorePath, block);

  for (const entry of missing) {
    console.log(`  ✓ added ${entry}`);
  }
}

async function cmdInit(repoPath: string) {
  const { exec } = await import("./util/process");

  async function checkTool(cmd: string[]): Promise<string | null> {
    try {
      const r = await exec(cmd, { timeoutMs: 3000 });
      return r.exitCode === 0 ? r.stdout.split("\n")[0].trim() : null;
    } catch {
      return null;
    }
  }

  function ok(msg: string) { console.log(`  ✓ ${msg}`); }
  function fail(msg: string, hint?: string) {
    console.log(`  ✗ ${msg}`);
    if (hint) console.log(`    ${hint}`);
  }
  function opt(msg: string) { console.log(`  · ${msg} (optional)`); }

  let hasErrors = false;

  // ── Dependencies ──────────────────────────────────────────────────────────
  console.log("Dependencies:");

  const jjVer = await checkTool(["jj", "--version"]);
  if (jjVer) ok(`jj  ${jjVer}`);
  else { fail("jj not found — required", "brew install jj"); hasErrors = true; }

  const claudeVer = await checkTool(["claude", "--version"]);
  if (claudeVer) ok(`claude  ${claudeVer}`);
  else opt("claude (Claude Code) not found — install from https://claude.ai/download");

  const ghVer = await checkTool(["gh", "--version"]);
  if (ghVer) ok(`gh  ${ghVer.split("\n")[0]}`);
  else opt("gh not found  (needed for auto PR creation — brew install gh)");

  // ── Repository ────────────────────────────────────────────────────────────
  console.log("\nRepository:");

  const jj = new JjOperations(repoPath);
  const isRepo = await jj.isRepo();
  if (isRepo) {
    ok(`jj repository at ${repoPath}`);
  } else {
    fail(
      "Not a jj repository",
      "In an existing git repo: jj git init --colocate\n    New repo:              jj init"
    );
    hasErrors = true;
  }

  // ── API key ───────────────────────────────────────────────────────────────
  console.log("\nAnthropic API key:");

  if (process.env.ANTHROPIC_API_KEY) {
    const masked = process.env.ANTHROPIC_API_KEY.slice(0, 12) + "...";
    ok(`ANTHROPIC_API_KEY is set (${masked})`);
  } else {
    fail("ANTHROPIC_API_KEY is not set");
    console.log(`
    Add to your shell config (~/.zshrc or ~/.bashrc):
      export ANTHROPIC_API_KEY=sk-ant-...
    Then: source ~/.zshrc

    Get a key at: https://console.anthropic.com/settings/keys
`);
  }

  if (hasErrors) {
    console.log("\nFix the issues above and run jjd init again.");
    process.exit(1);
  }

  // ── Install hooks ─────────────────────────────────────────────────────────
  console.log("Claude Code hooks:");

  installWorktreeHooks(repoPath, true); // --with-daemon: starts jjd per worktree
  ok("WorktreeCreate / WorktreeRemove hooks installed");
  ok("jjd will auto-start when Claude opens a worktree");
  console.log(`    (${join(repoPath, ".claude", "settings.json")})`);

  // ── .gitignore ────────────────────────────────────────────────────────────
  console.log("\n.gitignore:");
  updateGitignore(repoPath);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  jjd is ready.

  Start a session:
    jjd session start ENG-123 --claude   # Linear task → Claude Code
    jjd session start my-feature --claude

  Or use Claude Code's worktree feature:
    When you run EnterWorktree / /worktree in Claude,
    jjd automatically starts for that workspace.

  Standalone daemon (no sessions):
    jjd start                            # foreground, Ctrl+C to stop
    jjd status                           # while running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

// -- Hooks commands --

async function cmdHooks(repoPath: string, args: string[], withDaemon: boolean) {
  const sub = args[0];
  if (sub !== "install") {
    console.error("Usage: jjd hooks install [--with-daemon]");
    process.exit(1);
  }

  installWorktreeHooks(repoPath, withDaemon);

  console.log("WorktreeCreate and WorktreeRemove hooks installed.");
  console.log(`  Settings: ${join(repoPath, ".claude", "settings.json")}`);
  if (withDaemon) {
    console.log("  Mode: full (jjd daemon started/stopped per worktree)");
  } else {
    console.log("  Mode: basic (jj workspace add/forget only)");
    console.log("  Tip: use --with-daemon to also auto-start jjd per worktree");
  }
}

/**
 * Internal handler for the WorktreeCreate hook.
 * Claude Code pipes a JSON payload to stdin:
 *   { "name": "...", "worktree_path": "..." }
 *
 * Creates the matching jj workspace and starts a jjd daemon.
 */
async function cmdOnWorktreeCreate(repoPath: string) {
  const payload = await readStdin();
  let data: { name?: string; worktree_path?: string } = {};
  try {
    data = JSON.parse(payload);
  } catch {
    logger.warn("WorktreeCreate: could not parse stdin JSON");
  }

  const worktreePath = data.worktree_path ?? "";
  const name = data.name ?? resolve(worktreePath).split("/").pop() ?? "";

  if (!worktreePath) {
    logger.warn("WorktreeCreate: no worktree_path in payload, skipping");
    return;
  }

  logger.info(`WorktreeCreate hook: adding jj workspace "${name}" at ${worktreePath}`);

  const jj = new JjOperations(repoPath);
  try {
    await jj.workspaceAdd(name, worktreePath);
  } catch (err) {
    // Workspace may already exist if jj's colocated setup handled it
    logger.debug(`workspaceAdd skipped (may already exist): ${err}`);
  }

  // Start jjd daemon for the new workspace in background
  const { exec } = await import("./util/process");
  const isCompiled = !process.execPath.includes("bun");
  const jjdCmd = isCompiled
    ? process.execPath
    : `bun run ${join(import.meta.dir, "index.ts")}`;

  const logFile = join(worktreePath, ".jjd.log");
  await exec(
    ["bash", "-c", `nohup ${jjdCmd} start --repo ${worktreePath} > ${logFile} 2>&1 &`],
    { cwd: worktreePath, timeoutMs: 5000 }
  );

  logger.info(`jjd daemon started for worktree at ${worktreePath}`);
}

/**
 * Internal handler for the WorktreeRemove hook.
 * Claude Code pipes a JSON payload to stdin:
 *   { "worktree_path": "..." }
 *
 * Stops the jjd daemon and forgets the jj workspace.
 */
async function cmdOnWorktreeRemove(repoPath: string) {
  const payload = await readStdin();
  let data: { worktree_path?: string } = {};
  try {
    data = JSON.parse(payload);
  } catch {
    logger.warn("WorktreeRemove: could not parse stdin JSON");
  }

  const worktreePath = data.worktree_path ?? "";
  if (!worktreePath) {
    logger.warn("WorktreeRemove: no worktree_path in payload, skipping");
    return;
  }

  logger.info(`WorktreeRemove hook: cleaning up jj workspace at ${worktreePath}`);

  // Stop daemon if running
  const running = Daemon.isRunning(worktreePath);
  if (running.running && running.pid) {
    try {
      process.kill(running.pid, "SIGTERM");
      logger.info(`Stopped daemon PID ${running.pid} for ${worktreePath}`);
    } catch {
      // Already dead
    }
  }

  // Forget the workspace from jj's perspective
  const jj = new JjOperations(repoPath);
  const name = resolve(worktreePath).split("/").pop() ?? "";
  try {
    await jj.workspaceForget(name);
    logger.info(`jj workspace "${name}" forgotten`);
  } catch (err) {
    logger.debug(`workspaceForget failed (may already be gone): ${err}`);
  }
}

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
  return new Response(process.stdin).text();
}

/**
 * Print a short string for shell PS1 integration.
 * Outputs nothing if not in a session (so it's safe to always call).
 *
 * Usage in .zshrc:
 *   jjd_prompt() { jjd shell-prompt 2>/dev/null }
 *   PS1='$(jjd_prompt)%~ %# '
 */
function cmdShellPrompt() {
  // Check env first (set when --claude launches)
  if (process.env.JJD_SESSION) {
    process.stdout.write(`[jjd:${process.env.JJD_SESSION}] `);
    return;
  }

  // Check for marker file
  const marker = findSessionMarker(process.cwd());
  if (marker) {
    process.stdout.write(`[jjd:${marker.id}] `);
  }
  // Silent if not in a session
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
