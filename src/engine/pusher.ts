import { JjOperations } from "../jj/operations";
import { StateDB } from "../state";
import { logger } from "../util/logger";

/**
 * Handles pushing to the git remote.
 * Pushes bookmarks that are on the working copy.
 */
export class Pusher {
  constructor(
    private jj: JjOperations,
    private state: StateDB
  ) {}

  /** Push all pushable bookmarks. Returns whether anything was pushed. */
  async push(): Promise<boolean> {
    const status = await this.jj.status();
    const bookmarks = status.workingCopy.bookmarks;

    if (bookmarks.length === 0) {
      logger.debug("No bookmarks on @, skipping push");
      return false;
    }

    let pushed = false;

    for (const bookmark of bookmarks) {
      logger.info(`Pushing bookmark: ${bookmark}`);
      const result = await this.jj.gitPush(bookmark);

      this.state.logPush(bookmark, result.success ? "ok" : result.output);

      if (result.success) {
        pushed = true;
        logger.info(`Pushed ${bookmark} successfully`);
      } else {
        logger.warn(`Push failed for ${bookmark}: ${result.output}`);
      }
    }

    return pushed;
  }
}
