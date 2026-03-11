import { JjOperations } from "../jj/operations";
import type { BookmarkPattern } from "../config";
import { logger } from "../util/logger";

/**
 * Manages bookmarks on the working copy based on configured patterns.
 * Auto-advances matching bookmarks to @ after describe.
 */
export class BookmarkManager {
  constructor(
    private jj: JjOperations,
    private patterns: BookmarkPattern[]
  ) {}

  /**
   * After a describe, check if any bookmarks on @ match our patterns
   * and ensure they're advanced to the current change.
   */
  async advanceBookmarks(): Promise<string[]> {
    const status = await this.jj.status();
    const currentBookmarks = status.workingCopy.bookmarks;
    const advanced: string[] = [];

    for (const bm of currentBookmarks) {
      if (this.shouldAutoAdvance(bm)) {
        // Bookmark is already on @, ensure it's set
        await this.jj.bookmarkSet(bm);
        advanced.push(bm);
      }
    }

    if (advanced.length > 0) {
      logger.info(`Advanced bookmarks: ${advanced.join(", ")}`);
    }

    return advanced;
  }

  /**
   * Check if a bookmark name matches any auto-advance pattern.
   */
  shouldAutoAdvance(bookmarkName: string): boolean {
    return this.patterns.some(
      (p) => p.autoAdvance && matchPattern(p.pattern, bookmarkName)
    );
  }
}

/**
 * Simple glob-style pattern matching for bookmark names.
 * Supports * as wildcard.
 */
function matchPattern(pattern: string, name: string): boolean {
  // Convert simple glob to regex
  const regexStr = "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  return new RegExp(regexStr).test(name);
}
