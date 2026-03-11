import { logger } from "../util/logger";
import { Debouncer } from "./debouncer";
import { AutoDescriber } from "./auto-describe";
import { BookmarkManager } from "./bookmark-manager";
import { CheckpointManager } from "./checkpoint";
import { Pusher } from "./pusher";
import { JjOperations } from "../jj/operations";
import type { JjdConfig } from "../config";
import type { StateDB } from "../state";

export type DaemonStateKind =
  | "idle"
  | "debouncing"
  | "describing"
  | "pushing"
  | "error";

export interface DaemonStatus {
  state: DaemonStateKind;
  lastDescribe?: string;
  lastPush?: string;
  error?: string;
}

/**
 * Core state machine governing the daemon's behavior.
 *
 * Flow: idle -> (file change) -> debouncing -> (debounce expires) ->
 *       describing -> (describe done) -> pushing -> idle
 *
 * File changes during any state reset the debounce timer.
 */
export class DaemonEngine {
  private state: DaemonStateKind = "idle";
  private debouncer: Debouncer;
  private pushDebouncer: Debouncer;
  private jj: JjOperations;
  private describer: AutoDescriber | null;
  private bookmarkManager: BookmarkManager;
  private checkpointManager: CheckpointManager;
  private pusher: Pusher;
  private lastError: string | undefined;
  private lastDescribeTime: string | undefined;
  private lastPushTime: string | undefined;
  private describesSinceLastCheckpoint = 0;
  private checkpointInterval = 5; // checkpoint every N describes
  private errorCount = 0;

  constructor(
    private config: JjdConfig,
    private stateDb: StateDB
  ) {
    this.jj = new JjOperations(config.repoPath);

    // Set up auto-describer if API key is available
    if (config.anthropicApiKey) {
      this.describer = new AutoDescriber(config.anthropicApiKey, config.model);
    } else {
      this.describer = null;
      logger.warn("No Anthropic API key — auto-describe disabled");
    }

    this.bookmarkManager = new BookmarkManager(this.jj, config.bookmarkPatterns);
    this.checkpointManager = new CheckpointManager(this.jj, stateDb);
    this.pusher = new Pusher(this.jj, stateDb);

    // Main debouncer: waits for quiet period before describing
    this.debouncer = new Debouncer(config.debounceMs, () => {
      this.onDebounceExpired();
    });

    // Push debouncer: waits longer before pushing
    this.pushDebouncer = new Debouncer(config.pushIdleMs, () => {
      this.onPushIdle();
    });
  }

  /** Handle file change events from the watcher. */
  onFileChanged(_paths: string[]) {
    this.debouncer.trigger();

    // Reset push timer — we're still active
    if (this.pushDebouncer.isPending) {
      this.pushDebouncer.cancel();
    }

    if (this.state === "idle") {
      this.transition("debouncing");
    }
  }

  /** Manually trigger a describe. */
  async manualDescribe(): Promise<string> {
    this.debouncer.cancel();
    return this.doDescribe();
  }

  /** Manually trigger a push. */
  async manualPush(): Promise<boolean> {
    this.pushDebouncer.cancel();
    return this.doPush();
  }

  /** Manually create a checkpoint. */
  async manualCheckpoint(description?: string) {
    return this.checkpointManager.create(description);
  }

  /** Rollback to a checkpoint. */
  async rollback(checkpointId: number) {
    return this.checkpointManager.rollback(checkpointId);
  }

  /** List checkpoints. */
  listCheckpoints(limit?: number) {
    return this.checkpointManager.list(limit);
  }

  /** Get current daemon status. */
  getStatus(): DaemonStatus {
    return {
      state: this.state,
      lastDescribe: this.lastDescribeTime,
      lastPush: this.lastPushTime,
      error: this.lastError,
    };
  }

  // -- Internal transitions --

  private transition(to: DaemonStateKind) {
    logger.debug(`State: ${this.state} -> ${to}`);
    this.state = to;
  }

  private async onDebounceExpired() {
    try {
      await this.doDescribe();
      this.errorCount = 0;
    } catch (err) {
      this.errorCount++;
      this.lastError = String(err);
      this.transition("error");
      logger.error(`Describe failed: ${err}`);
      // Exponential backoff: 5s, 10s, 20s, …, capped at 60s
      const backoffMs = Math.min(5000 * Math.pow(2, this.errorCount - 1), 60_000);
      logger.warn(`Backing off for ${backoffMs / 1000}s before retry (failure #${this.errorCount})`);
      setTimeout(() => this.transition("idle"), backoffMs);
    }
  }

  private async doDescribe(): Promise<string> {
    this.transition("describing");

    // Check if there's anything to describe
    const status = await this.jj.status();
    if (status.workingCopy.empty && status.fileChanges.length === 0) {
      logger.debug("Working copy is empty, nothing to describe");
      this.transition("idle");
      return "";
    }

    // Maybe create a checkpoint before describing
    if (this.config.checkpoints) {
      this.describesSinceLastCheckpoint++;
      if (this.describesSinceLastCheckpoint >= this.checkpointInterval) {
        await this.checkpointManager.create("auto-checkpoint before describe");
        this.describesSinceLastCheckpoint = 0;
      }
    }

    // Generate description (with scope check if we have a current description)
    let message: string;
    let describeResult: import("./auto-describe").DescribeResult | undefined;
    if (this.describer) {
      const diff = await this.jj.diff();
      const currentDesc = status.workingCopy.description;
      describeResult = await this.describer.generateWithScopeCheck(diff, currentDesc);
      message = describeResult.message;
    } else {
      // Fallback: use a timestamp-based message
      message = `wip: changes at ${new Date().toISOString()}`;
    }

    if (describeResult?.split && describeResult.oldScopeFiles?.length) {
      // Surgical split: old scope files stay in @-, new scope files become @
      const oldFiles = describeResult.oldScopeFiles;
      logger.info(`Splitting: old scope (${oldFiles.length} files) → @-, new scope → @`);

      // jj split <old-scope-paths> puts those files in first commit (@-),
      // remainder goes to second commit (new @)
      await this.jj.split(oldFiles);

      // Describe both halves
      await this.jj.describeRevision("@-", status.workingCopy.description || message);
      await this.jj.describe(message);
    } else {
      // Normal: just update the description
      await this.jj.describe(message);
    }

    this.lastDescribeTime = new Date().toISOString();

    // Advance bookmarks
    await this.bookmarkManager.advanceBookmarks();

    // Start push idle timer if auto-push is enabled
    if (this.config.autoPush) {
      this.pushDebouncer.trigger();
    }

    this.transition("idle");
    this.lastError = undefined;
    return message;
  }

  private async onPushIdle() {
    try {
      await this.doPush();
    } catch (err) {
      logger.error(`Push failed: ${err}`);
      this.lastError = String(err);
    }
  }

  private async doPush(): Promise<boolean> {
    this.transition("pushing");

    const pushed = await this.pusher.push();
    if (pushed) {
      this.lastPushTime = new Date().toISOString();
    }

    this.transition("idle");
    return pushed;
  }

  /** Clean up timers. */
  destroy() {
    this.debouncer.cancel();
    this.pushDebouncer.cancel();
  }
}
