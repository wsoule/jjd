import { watch, type FSWatcher } from "fs";
import { join, relative } from "path";
import { logger } from "../util/logger";

export type WatcherCallback = (paths: string[]) => void;

/**
 * Filesystem watcher using Node's fs.watch (recursive on macOS via FSEvents).
 * Batches rapid events into a single callback with all changed paths.
 */
export class FsWatcher {
  private watcher: FSWatcher | null = null;
  private pendingPaths = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchMs = 200; // batch rapid FS events before emitting

  constructor(
    private repoPath: string,
    private ignorePaths: string[],
    private callback: WatcherCallback
  ) {}

  start() {
    logger.info(`Starting FS watcher on ${this.repoPath}`);

    this.watcher = watch(this.repoPath, { recursive: true }, (_event, filename) => {
      if (!filename) return;

      // Ignore .jj directory and configured ignore patterns
      if (this.shouldIgnore(filename)) return;

      this.pendingPaths.add(filename);
      this.scheduleBatch();
    });

    this.watcher.on("error", (err) => {
      logger.error(`FS watcher error: ${err.message}`);
    });
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingPaths.clear();
    logger.info("FS watcher stopped");
  }

  private shouldIgnore(filepath: string): boolean {
    // Always ignore .jj directory
    if (filepath.startsWith(".jj/") || filepath.startsWith(".jj\\")) return true;

    for (const pattern of this.ignorePaths) {
      // Simple glob matching for common patterns
      if (pattern.startsWith("*.")) {
        const ext = pattern.slice(1);
        if (filepath.endsWith(ext)) return true;
      } else if (filepath.startsWith(pattern + "/") || filepath === pattern) {
        return true;
      }
    }

    return false;
  }

  private scheduleBatch() {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      const paths = Array.from(this.pendingPaths);
      this.pendingPaths.clear();

      if (paths.length > 0) {
        logger.debug(`FS watcher batch: ${paths.length} files changed`);
        this.callback(paths);
      }
    }, this.batchMs);
  }
}
