import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from "fs";
import { join, resolve, basename } from "path";
import { JjOperations } from "./jj/operations";
import { exec } from "./util/process";
import { installHooks, installClaudeMd, installTaskPrompt } from "./hooks";
import { PrCreator } from "./pr";
import { logger } from "./util/logger";

export interface SessionInfo {
  id: string;
  linearId: string;
  linearTitle: string;
  linearDescription?: string;
  linearUrl?: string;
  bookmark: string;
  workspaceName: string;
  workspacePath: string;
  daemonPort: number;
  daemonPid?: number;
  daemonLogFile?: string;
  claudePid?: number;
  prUrl?: string;
  createdAt: string;
  stoppedAt?: string;
  status: "active" | "stopped" | "stale";
}

const SESSIONS_DIR_NAME = ".jjd-sessions";

/**
 * Manages the lifecycle of parallel coding sessions.
 *
 * Each session:
 * 1. Creates a jj workspace (isolated working copy)
 * 2. Sets a bookmark named after the Linear ticket
 * 3. Starts a jjd daemon (background, with log file)
 * 4. Installs Claude Code hooks + CLAUDE.md with task context
 * 5. Optionally launches Claude Code with a prompt built from the Linear task
 *
 * Multiple sessions run simultaneously — each in its own workspace,
 * each with its own daemon on a different port.
 */
export class SessionManager {
  private repoPath: string;
  private sessionsDir: string;
  private jj: JjOperations;

  constructor(repoPath: string) {
    this.repoPath = resolve(repoPath);
    this.sessionsDir = join(this.repoPath, SESSIONS_DIR_NAME);
    this.jj = new JjOperations(this.repoPath);
  }

  /**
   * Start a new session for a Linear task.
   */
  async start(
    linearId: string,
    title: string,
    opts: {
      launchClaude?: boolean;
      claudePrompt?: string;
      linearDescription?: string;
      linearUrl?: string;
      basePort?: number;
      background?: boolean;
    } = {}
  ): Promise<SessionInfo> {
    const {
      launchClaude = false,
      claudePrompt,
      linearDescription,
      linearUrl,
      basePort = 7433,
      background = true,
    } = opts;

    // Derive names
    const sanitizedId = linearId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const bookmark = sanitizedId;
    const workspaceName = `session-${sanitizedId}`;
    const workspacePath = join(this.repoPath, "..", `${basename(this.repoPath)}-${sanitizedId}`);

    // Check for existing session
    const existing = this.getSession(sanitizedId);
    if (existing && existing.status === "active") {
      throw new Error(`Session for ${linearId} is already active (PID ${existing.daemonPid})`);
    }

    // Allocate a unique port
    const port = await this.allocatePort(basePort);

    logger.info(`Creating session for ${linearId}: "${title}"`);

    // 1. Create jj workspace
    if (!existsSync(workspacePath)) {
      await this.jj.workspaceAdd(workspaceName, workspacePath);
    }

    // 2. Set bookmark on the workspace's working copy
    const wsJj = new JjOperations(workspacePath);
    await wsJj.bookmarkSet(bookmark);

    // 3. Write session metadata
    const logFile = join(this.sessionsDir, `${sanitizedId}.log`);

    const session: SessionInfo = {
      id: sanitizedId,
      linearId,
      linearTitle: title,
      linearDescription,
      linearUrl,
      bookmark,
      workspaceName,
      workspacePath,
      daemonPort: port,
      daemonLogFile: logFile,
      createdAt: new Date().toISOString(),
      status: "active",
    };

    this.saveSession(session);

    // 4. Install Claude Code hooks, CLAUDE.md, and task prompt
    installHooks(workspacePath, port);
    installClaudeMd(workspacePath, linearId, title, linearDescription);
    installTaskPrompt(workspacePath, linearId, title, linearDescription);

    // 5. Write a .jjd-session marker for workspace detection
    writeFileSync(
      join(workspacePath, ".jjd-session"),
      JSON.stringify({ id: sanitizedId, linearId, port, bookmark }, null, 2)
    );

    // 6. Start jjd daemon (background by default)
    await this.startDaemon(session, background);
    this.saveSession(session);

    return session;
  }

  /**
   * Stop a session — final describe + push, optional PR creation, cleanup.
   */
  async stop(
    sessionId: string,
    opts: { cleanup?: boolean; createPr?: boolean; draft?: boolean } = {}
  ): Promise<{ prUrl?: string }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    const result: { prUrl?: string } = {};

    // Final describe + push before stopping
    await this.finalizeSession(session);

    // Create PR if requested
    if (opts.createPr !== false) {
      const prUrl = await this.createSessionPr(session, opts.draft);
      if (prUrl) {
        result.prUrl = prUrl;
        session.prUrl = prUrl;
      }
    }

    // Kill daemon
    if (session.daemonPid) {
      try {
        process.kill(session.daemonPid, "SIGTERM");
        logger.info(`Killed daemon PID ${session.daemonPid}`);
      } catch {
        // Already dead
      }
    }

    // Update session status
    session.status = "stopped";
    session.stoppedAt = new Date().toISOString();
    session.daemonPid = undefined;
    session.claudePid = undefined;
    this.saveSession(session);

    // Optionally forget the workspace
    if (opts.cleanup) {
      try {
        await this.jj.workspaceForget(session.workspaceName);
        logger.info(`Forgot workspace "${session.workspaceName}"`);
      } catch {
        // May already be forgotten
      }
    }

    logger.info(`Session "${sessionId}" stopped`);
    return result;
  }

  /**
   * Resume a stale session — restart its daemon.
   */
  async resume(sessionId: string): Promise<SessionInfo> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    if (session.status === "active") {
      // Verify it's actually alive
      if (session.daemonPid) {
        try {
          process.kill(session.daemonPid, 0);
          throw new Error(`Session "${sessionId}" is already active (PID ${session.daemonPid})`);
        } catch (e: any) {
          if (e.code !== "ESRCH") throw e;
          // Process is dead, fall through to resume
        }
      }
    }

    // Verify workspace still exists
    if (!existsSync(session.workspacePath)) {
      throw new Error(`Workspace directory is gone: ${session.workspacePath}`);
    }

    // Re-allocate port (old one may be taken)
    const port = await this.allocatePort(session.daemonPort);
    session.daemonPort = port;

    // Restart daemon
    await this.startDaemon(session, true);
    session.status = "active";
    this.saveSession(session);

    logger.info(`Session "${sessionId}" resumed on port ${port}`);
    return session;
  }

  /**
   * Resume all stale sessions.
   */
  async resumeAll(): Promise<SessionInfo[]> {
    const stale = this.list().filter((s) => s.status === "stale");
    const resumed: SessionInfo[] = [];

    for (const s of stale) {
      try {
        const session = await this.resume(s.id);
        resumed.push(session);
      } catch (err) {
        logger.warn(`Could not resume session "${s.id}": ${err}`);
      }
    }

    return resumed;
  }

  /** List all sessions with their current status. */
  list(): SessionInfo[] {
    this.ensureSessionsDir();
    const sessions: SessionInfo[] = [];

    for (const file of readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(this.sessionsDir, file), "utf-8")) as SessionInfo;
        // Check if daemon is still alive
        if (data.daemonPid && data.status === "active") {
          try {
            process.kill(data.daemonPid, 0);
          } catch {
            data.status = "stale";
          }
        }
        sessions.push(data);
      } catch {
        // Skip corrupt files
      }
    }

    return sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Get a single session by ID. */
  getSession(sessionId: string): SessionInfo | null {
    const filePath = join(this.sessionsDir, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as SessionInfo;
    } catch {
      return null;
    }
  }

  /** View the daemon log for a session. */
  getLog(sessionId: string, tail = 50): string | null {
    const session = this.getSession(sessionId);
    if (!session?.daemonLogFile) return null;
    if (!existsSync(session.daemonLogFile)) return null;

    const content = readFileSync(session.daemonLogFile, "utf-8");
    const lines = content.split("\n");
    return lines.slice(-tail).join("\n");
  }

  // -- Internal helpers --

  /** Start the jjd daemon for a session. */
  private async startDaemon(session: SessionInfo, background: boolean) {
    this.ensureSessionsDir();
    const logFile = session.daemonLogFile ?? join(this.sessionsDir, `${session.id}.log`);

    // Detect how we're running: compiled binary vs bun script
    // process.execPath is the binary itself when compiled, or the bun executable when interpreted
    const isCompiled = !process.execPath.includes("bun");
    const jjdCmd = isCompiled
      ? process.execPath
      : `bun run ${join(import.meta.dir, "index.ts")}`;

    if (background) {
      // Spawn detached process with output redirected to log file
      const result = await exec(
        ["bash", "-c", `nohup ${jjdCmd} start --repo ${session.workspacePath} > ${logFile} 2>&1 & echo $!`],
        {
          cwd: session.workspacePath,
          timeoutMs: 5000,
          env: {
            ...process.env,
            JJD_PORT: String(session.daemonPort),
          },
        }
      );

      const pid = parseInt(result.stdout.trim(), 10);
      if (isNaN(pid)) {
        throw new Error(`Failed to start daemon: ${result.stderr}`);
      }

      session.daemonPid = pid;
      session.daemonLogFile = logFile;
      logger.info(`Daemon started in background (PID ${pid}, port ${session.daemonPort}, log: ${logFile})`);
    } else {
      // Foreground spawn (used when jjd start is called directly)
      const fgArgs = isCompiled
        ? [process.execPath, "start", "--repo", session.workspacePath]
        : ["bun", "run", join(import.meta.dir, "index.ts"), "start", "--repo", session.workspacePath];

      const proc = Bun.spawn(fgArgs, {
        cwd: session.workspacePath,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          JJD_PORT: String(session.daemonPort),
        },
      });

      session.daemonPid = proc.pid;
      session.daemonLogFile = logFile;
      logger.info(`Daemon started in foreground (PID ${proc.pid}, port ${session.daemonPort})`);
    }
  }

  /**
   * Launch Claude Code pointed at the session workspace.
   * Uses execSync-style: replaces the current process with Claude.
   * Call this LAST after all setup + output is done.
   *
   * Claude gets the task automatically via:
   * - CLAUDE.md (tells it the task + to start immediately)
   * - SessionStart hook (echoes .jjd-task-prompt on every conversation start)
   */
  launchClaude(session: SessionInfo): never {
    const claudeArgs = ["claude"];

    logger.info(`Replacing process with Claude Code in ${session.workspacePath}`);

    // Use Bun.spawnSync to exec into Claude — this replaces the process
    const result = Bun.spawnSync(claudeArgs, {
      cwd: session.workspacePath,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        JJD_SESSION: session.id,
        JJD_SESSION_PORT: String(session.daemonPort),
        JJD_WORKSPACE: session.workspacePath,
      },
    });

    process.exit(result.exitCode);
  }

  /** Do a final describe + push for a session. */
  private async finalizeSession(session: SessionInfo) {
    try {
      // Try via daemon API first
      try {
        const descResp = await fetch(`http://localhost:${session.daemonPort}/describe`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        });
        if (descResp.ok) {
          await fetch(`http://localhost:${session.daemonPort}/push`, {
            method: "POST",
            signal: AbortSignal.timeout(30_000),
          });
          return;
        }
      } catch {
        // Daemon not reachable
      }

      // Fallback: do it directly
      const wsJj = new JjOperations(session.workspacePath);
      const status = await wsJj.status();
      if (!status.workingCopy.empty || status.fileChanges.length > 0) {
        logger.info("Direct finalize: describing and pushing...");
        if (!status.workingCopy.description || status.workingCopy.description === "(no description set)") {
          await wsJj.describe(`chore: finalize session ${session.linearId}`);
        }
        await wsJj.gitPush(session.bookmark);
      }
    } catch (err) {
      logger.warn(`Finalize failed (non-fatal): ${err}`);
    }
  }

  /** Create a PR for the session's bookmark. */
  private async createSessionPr(
    session: SessionInfo,
    draft = false
  ): Promise<string | null> {
    const pr = new PrCreator(session.workspacePath);

    if (!(await pr.isAvailable())) {
      logger.warn("gh CLI not available — skipping PR creation");
      return null;
    }

    const body = await pr.generateBody({
      linearId: session.linearId,
      linearTitle: session.linearTitle,
      bookmark: session.bookmark,
    });

    const result = await pr.create({
      bookmark: session.bookmark,
      title: `${session.linearId}: ${session.linearTitle}`,
      body,
      draft,
    });

    return result?.url ?? null;
  }

  private saveSession(session: SessionInfo) {
    this.ensureSessionsDir();
    const filePath = join(this.sessionsDir, `${session.id}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  private ensureSessionsDir() {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /** Find an available port starting from basePort. */
  private async allocatePort(basePort: number): Promise<number> {
    const activeSessions = this.list().filter((s) => s.status === "active");
    const usedPorts = new Set(activeSessions.map((s) => s.daemonPort));

    let port = basePort;
    while (usedPorts.has(port)) {
      port++;
    }

    // Also verify the port is actually free
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const server = Bun.serve({ port, fetch: () => new Response("") });
        server.stop(true);
        return port;
      } catch {
        port++;
      }
    }

    throw new Error("Could not find an available port");
  }
}
