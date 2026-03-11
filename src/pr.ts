import { exec } from "./util/process";
import { JjCli } from "./jj/cli";
import { logger } from "./util/logger";
import { resolve, dirname } from "path";
import { readFileSync, existsSync, statSync } from "fs";

export interface PrResult {
  url: string;
  number: number;
}

/**
 * Resolve the colocated git repo path for a jj workspace.
 *
 * `gh` needs to run from a directory that contains `.git`. For jj workspaces
 * (created via `jj workspace add`), `.git` lives in the main repo, not the
 * workspace. We follow the chain:
 *   workspace/.jj/repo  →  (file pointing to main repo's .jj/repo)
 *   main/.jj/repo/store/git_target  →  (relative path to .git)
 *   dirname(.git)  →  the directory gh should run from
 */
function resolveGitRepoPath(repoPath: string): string {
  // Colocated: .git exists directly — use as-is
  const dotGit = resolve(repoPath, ".git");
  if (existsSync(dotGit)) return repoPath;

  // Workspace: .jj/repo is a file pointing to the main repo's .jj/repo
  const jjRepo = resolve(repoPath, ".jj", "repo");
  if (existsSync(jjRepo) && statSync(jjRepo).isFile()) {
    const repoPointer = readFileSync(jjRepo, "utf-8").trim();
    const mainJjRepo = resolve(repoPath, ".jj", repoPointer);
    const gitTarget = resolve(mainJjRepo, "store", "git_target");

    if (existsSync(gitTarget)) {
      const target = readFileSync(gitTarget, "utf-8").trim();
      const gitDir = resolve(dirname(gitTarget), target);
      // .git dir's parent is the colocated repo root
      return dirname(gitDir);
    }
  }

  // Fallback
  return repoPath;
}

/**
 * Creates a GitHub PR for a session's bookmark using `gh`.
 *
 * Relies on the `gh` CLI being installed and authenticated.
 * The bookmark becomes the branch name (jj pushes bookmarks as git branches).
 */
export class PrCreator {
  private gitRepoPath: string;

  constructor(private repoPath: string) {
    this.gitRepoPath = resolveGitRepoPath(repoPath);
    if (this.gitRepoPath !== repoPath) {
      logger.info(`Resolved git repo path: ${this.gitRepoPath}`);
    }
  }

  /** Check if gh CLI is available and authenticated. */
  async isAvailable(): Promise<boolean> {
    const result = await exec(["gh", "auth", "status"], {
      cwd: this.gitRepoPath,
      timeoutMs: 5000,
    });
    return result.exitCode === 0;
  }

  /**
   * Create a PR for the given bookmark/branch.
   *
   * @param bookmark   Branch name (pushed by jj git push)
   * @param title      PR title
   * @param body       PR body (markdown)
   * @param draft      Create as draft PR
   * @param base       Base branch (default: main)
   */
  async create(opts: {
    bookmark: string;
    title: string;
    body: string;
    draft?: boolean;
    base?: string;
  }): Promise<PrResult | null> {
    const { bookmark, title, body, draft = false, base } = opts;

    const args = [
      "gh", "pr", "create",
      "--head", bookmark,
      "--title", title,
      "--body", body,
    ];

    if (draft) args.push("--draft");
    if (base) args.push("--base", base);

    logger.info(`Creating PR for bookmark "${bookmark}": ${title}`);

    const result = await exec(args, {
      cwd: this.gitRepoPath,
      timeoutMs: 30_000,
    });

    if (result.exitCode !== 0) {
      // Check if PR already exists
      if (result.stderr.includes("already exists")) {
        logger.info("PR already exists for this branch");
        // Try to get the existing PR URL
        const existing = await this.getExistingPr(bookmark);
        return existing;
      }
      logger.error(`gh pr create failed: ${result.stderr}`);
      return null;
    }

    // gh pr create outputs the URL on stdout
    const url = result.stdout.trim();
    const numberMatch = url.match(/\/pull\/(\d+)/);
    const number = numberMatch ? parseInt(numberMatch[1], 10) : 0;

    logger.info(`PR created: ${url}`);
    return { url, number };
  }

  /** Get an existing PR for a branch. */
  private async getExistingPr(branch: string): Promise<PrResult | null> {
    const result = await exec(
      ["gh", "pr", "view", branch, "--json", "url,number"],
      { cwd: this.gitRepoPath, timeoutMs: 10_000 }
    );

    if (result.exitCode !== 0) return null;

    try {
      const data = JSON.parse(result.stdout);
      return { url: data.url, number: data.number };
    } catch {
      return null;
    }
  }

  /**
   * Generate a PR body from session info and diff summary.
   */
  async generateBody(opts: {
    linearId: string;
    linearTitle: string;
    bookmark: string;
  }): Promise<string> {
    let fileList = "";
    try {
      const jj = new JjCli(this.repoPath);
      const summary = await jj.runOrThrow(["diff", "--summary"]);
      const lines = summary.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        fileList = `\n## Changes\n${lines.map((l) => `- \`${l.trim()}\``).join("\n")}\n`;
      }
    } catch {
      // Diff might fail if workspace is already clean
    }

    return `## ${opts.linearId}: ${opts.linearTitle}
${fileList}
---
*Generated by jjd*`;
  }
}
