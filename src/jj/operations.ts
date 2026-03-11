import { JjCli } from "./cli";
import type { JjBookmark, JjFileChange, JjOperation, JjStatus, JjWorkspace, FileChangeStatus } from "./types";
import { logger } from "../util/logger";

export class JjOperations {
  private cli: JjCli;

  constructor(repoPath: string) {
    this.cli = new JjCli(repoPath);
  }

  /** Check whether this is a valid jj repo. */
  async isRepo(): Promise<boolean> {
    const result = await this.cli.run(["root"]);
    return result.exitCode === 0;
  }

  /** Get the repo root path. */
  async root(): Promise<string> {
    return (await this.cli.runOrThrow(["root"])).trim();
  }

  /** Snapshot the working copy (jj auto-does this, but explicit is fine). */
  async snapshot(): Promise<void> {
    // Running any jj command snapshots the working copy.
    // `jj status` is the lightest way to trigger it.
    await this.cli.run(["status"]);
  }

  /** Get the working copy status (parsed). */
  async status(): Promise<JjStatus> {
    // Use templates for structured output
    const changeOut = await this.cli.runOrThrow([
      "log",
      "--no-graph",
      "-r",
      "@",
      "-T",
      'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ description.first_line() ++ "\\t" ++ empty ++ "\\t" ++ bookmarks ++ "\\n"',
    ]);

    const parts = changeOut.trim().split("\t");
    const workingCopy = {
      changeId: parts[0] ?? "",
      commitId: parts[1] ?? "",
      description: parts[2] ?? "",
      empty: parts[3] === "true",
      bookmarks: parts[4] ? parts[4].split(" ").filter(Boolean) : [],
    };

    // Get file changes
    const diffSummary = await this.cli.runOrThrow(["diff", "--summary"]);
    const fileChanges = parseDiffSummary(diffSummary);

    // Check for conflicts
    const statusOut = await this.cli.runOrThrow(["status"]);
    const hasConflicts = statusOut.includes("conflict");

    return { workingCopy, fileChanges, hasConflicts };
  }

  /** Get the diff text for the working copy. */
  async diff(maxBytes = 32_000): Promise<string> {
    const summary = await this.cli.runOrThrow(["diff", "--summary"]);
    const fullDiff = await this.cli.runOrThrow(["diff"]);

    if (fullDiff.length <= maxBytes) {
      return `Summary:\n${summary}\n\nFull diff:\n${fullDiff}`;
    }

    // Truncate to fit, keeping summary intact
    const truncatedDiff = fullDiff.slice(0, maxBytes);
    return `Summary:\n${summary}\n\nFull diff (truncated to ${maxBytes} bytes):\n${truncatedDiff}`;
  }

  /** Describe the working copy with a message. */
  async describe(message: string): Promise<void> {
    await this.cli.runOrThrow(["describe", "-m", message]);
    logger.info(`Described @ with: ${message}`);
  }

  /** Create a new empty change on top of @. */
  async new(message?: string): Promise<void> {
    const args = ["new"];
    if (message) args.push("-m", message);
    await this.cli.runOrThrow(args);
  }

  /** Set a bookmark on the current change. Allows backward moves. */
  async bookmarkSet(name: string): Promise<void> {
    const result = await this.cli.run(["bookmark", "set", name]);
    if (result.exitCode !== 0) {
      // Retry with --allow-backwards if jj refuses the move
      if (result.stderr.includes("--allow-backwards")) {
        await this.cli.runOrThrow(["bookmark", "set", name, "--allow-backwards"]);
      } else {
        throw new Error(`jj bookmark set failed: ${result.stderr}`);
      }
    }
    logger.info(`Bookmark ${name} set on @`);
  }

  /** Move a bookmark to the current change. */
  async bookmarkMove(name: string, to = "@"): Promise<void> {
    await this.cli.runOrThrow(["bookmark", "set", name, "-r", to]);
    logger.info(`Bookmark ${name} moved to ${to}`);
  }

  /** List bookmarks. */
  async bookmarkList(): Promise<JjBookmark[]> {
    const out = await this.cli.runOrThrow(["bookmark", "list", "--all-remotes"]);
    const bookmarks: JjBookmark[] = [];

    for (const line of out.split("\n").filter(Boolean)) {
      // Parse bookmark list output — format varies by jj version
      const match = line.match(/^(\S+)/);
      if (match) {
        const name = match[1];
        const tracking = line.includes("@origin") ? "origin" : undefined;
        bookmarks.push({ name, present: true, tracking });
      }
    }

    return bookmarks;
  }

  /** Push to git remote. */
  async gitPush(bookmark?: string): Promise<{ success: boolean; output: string }> {
    const args = ["git", "push"];
    if (bookmark) args.push("--bookmark", bookmark);

    const result = await this.cli.run(args);
    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /** Get the current operation ID (for checkpoints). */
  async currentOperationId(): Promise<string> {
    const out = await this.cli.runOrThrow([
      "operation",
      "log",
      "--no-graph",
      "--limit",
      "1",
      "-T",
      "self.id()",
    ]);
    return out.trim();
  }

  /** Restore to a previous operation (rollback). */
  async operationRestore(opId: string): Promise<void> {
    await this.cli.runOrThrow(["operation", "restore", opId]);
    logger.info(`Restored to operation ${opId}`);
  }

  /**
   * Non-interactive split: puts changes to `firstPaths` in the first commit,
   * everything else in the second. After split, @ is the second commit.
   */
  async split(firstPaths: string[]): Promise<void> {
    if (firstPaths.length === 0) {
      throw new Error("split requires at least one path for the first commit");
    }
    // Use JJ_EDITOR=true to skip the diff editor
    await this.cli.runOrThrow(
      ["split", "--", ...firstPaths],
      { env: { JJ_EDITOR: "true" } }
    );
    logger.info(`Split @ — first commit has ${firstPaths.length} path(s), remainder in new @`);
  }

  /** Describe a specific revision. */
  async describeRevision(rev: string, message: string): Promise<void> {
    await this.cli.runOrThrow(["describe", "-r", rev, "-m", message]);
    logger.info(`Described ${rev} with: ${message}`);
  }

  /** Undo the last operation. */
  async undo(): Promise<void> {
    await this.cli.runOrThrow(["undo"]);
    logger.info("Undid last operation");
  }

  /** Get the raw status output (for polling comparison). */
  async rawStatus(): Promise<string> {
    return this.cli.runOrThrow(["status"]);
  }

  // -- Workspace operations --

  /** Create a new workspace at the given path. */
  async workspaceAdd(name: string, path: string): Promise<void> {
    await this.cli.runOrThrow(["workspace", "add", "--name", name, path]);
    logger.info(`Created workspace "${name}" at ${path}`);
  }

  /** List all workspaces. */
  async workspaceList(): Promise<JjWorkspace[]> {
    const out = await this.cli.runOrThrow(["workspace", "list"]);
    const workspaces: JjWorkspace[] = [];

    for (const line of out.split("\n").filter(Boolean)) {
      // Format: "name: path (active)" or "name: path"
      const match = line.match(/^(\S+):\s+(.+?)(\s+\(active\))?$/);
      if (match) {
        workspaces.push({
          name: match[1],
          path: match[2].trim(),
          active: !!match[3],
        });
      }
    }

    return workspaces;
  }

  /** Forget (remove) a workspace. Does not delete files. */
  async workspaceForget(name: string): Promise<void> {
    await this.cli.runOrThrow(["workspace", "forget", name]);
    logger.info(`Forgot workspace "${name}"`);
  }
}

function parseDiffSummary(summary: string): JjFileChange[] {
  const changes: JjFileChange[] = [];

  for (const line of summary.split("\n").filter(Boolean)) {
    const match = line.match(/^([AMDR])\s+(.+)$/);
    if (!match) continue;

    const statusMap: Record<string, FileChangeStatus> = {
      A: "added",
      M: "modified",
      D: "deleted",
      R: "renamed",
    };

    changes.push({
      status: statusMap[match[1]] ?? "modified",
      path: match[2].trim(),
    });
  }

  return changes;
}
