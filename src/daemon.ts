import { loadConfig, type JjdConfig } from "./config";
import { StateDB } from "./state";
import { JjOperations } from "./jj/operations";
import { DaemonEngine } from "./engine/state-machine";
import { createWatcher, type Watcher } from "./watcher";
import { ApiServer } from "./api/server";
import { logger, setLogLevel } from "./util/logger";
import { writeFileSync, existsSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Orchestrates all daemon components:
 * watcher -> engine (debounce -> describe -> push) + API server
 */
export class Daemon {
  private config: JjdConfig;
  private stateDb: StateDB;
  private jj: JjOperations;
  private engine: DaemonEngine;
  private watcher: Watcher;
  private apiServer: ApiServer;
  private running = false;

  constructor(repoPath: string, configPath?: string) {
    this.config = loadConfig(repoPath, configPath);
    setLogLevel(this.config.logLevel);

    this.stateDb = new StateDB(this.config.repoPath);
    this.jj = new JjOperations(this.config.repoPath);
    this.engine = new DaemonEngine(this.config, this.stateDb);

    this.watcher = createWatcher(this.config, (paths) => {
      this.engine.onFileChanged(paths);
    });

    this.apiServer = new ApiServer(
      this.engine,
      this.jj,
      this.config.apiPort,
      () => this.stop()
    );
  }

  async start() {
    // Verify this is a jj repo
    if (!(await this.jj.isRepo())) {
      throw new Error(`${this.config.repoPath} is not a jj repository`);
    }

    logger.info(`Starting jjd for ${this.config.repoPath}`);
    logger.info(`Config: debounce=${this.config.debounceMs}ms, pushIdle=${this.config.pushIdleMs}ms, watcher=${this.config.watcher}`);

    this.running = true;

    // Write PID file
    this.writePidFile();

    // Start components
    if ("start" in this.watcher) {
      await (this.watcher as any).start();
    }
    this.apiServer.start();

    // Handle signals
    const shutdown = () => this.stop();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Store state
    this.stateDb.set("daemon.pid", String(process.pid));
    this.stateDb.set("daemon.startedAt", new Date().toISOString());

    logger.info("jjd is running. Press Ctrl+C to stop.");
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    logger.info("Shutting down jjd...");

    this.engine.destroy();
    this.watcher.stop();
    this.apiServer.stop();
    this.stateDb.set("daemon.pid", "");
    this.stateDb.close();
    this.removePidFile();

    logger.info("jjd stopped.");
    process.exit(0);
  }

  private get pidFilePath(): string {
    return join(this.config.repoPath, ".jj", "jjd.pid");
  }

  private writePidFile() {
    writeFileSync(this.pidFilePath, String(process.pid));
  }

  private removePidFile() {
    try {
      unlinkSync(this.pidFilePath);
    } catch {
      // ignore
    }
  }

  /** Check if a daemon is already running for a repo. */
  static isRunning(repoPath: string): { running: boolean; pid?: number } {
    const pidPath = join(repoPath, ".jj", "jjd.pid");
    if (!existsSync(pidPath)) return { running: false };

    try {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      // Check if process is alive
      process.kill(pid, 0); // signal 0 = check existence
      return { running: true, pid };
    } catch {
      // PID file exists but process is dead — stale
      try {
        unlinkSync(pidPath);
      } catch {
        // ignore
      }
      return { running: false };
    }
  }
}
