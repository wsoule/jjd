import { JjOperations } from "../jj/operations";
import { logger } from "../util/logger";
import type { WatcherCallback } from "./fs-watcher";

/**
 * Polling watcher that detects changes by comparing jj status output.
 * Fallback for platforms where fs.watch recursive isn't reliable.
 */
export class PollWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStatus = "";
  private jj: JjOperations;

  constructor(
    repoPath: string,
    private intervalMs: number,
    private callback: WatcherCallback
  ) {
    this.jj = new JjOperations(repoPath);
  }

  async start() {
    logger.info(`Starting poll watcher (interval: ${this.intervalMs}ms)`);

    // Capture initial state
    this.lastStatus = await this.jj.rawStatus();

    this.timer = setInterval(async () => {
      try {
        const current = await this.jj.rawStatus();
        if (current !== this.lastStatus) {
          this.lastStatus = current;
          logger.debug("Poll watcher detected changes");
          this.callback(["(detected via poll)"]);
        }
      } catch (err) {
        logger.warn(`Poll watcher error: ${err}`);
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Poll watcher stopped");
  }
}
