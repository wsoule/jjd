import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { logger } from "./util/logger";

/**
 * Generates Claude Code hooks configuration for a workspace.
 * Hooks auto-trigger jj operations when Claude writes files.
 */
export function installHooks(workspacePath: string, daemonPort: number) {
  const claudeDir = join(workspacePath, ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // New Claude Code hooks format: record keyed by event type
  const jjdHooks = {
    PostToolUse: [
      {
        matcher: "Edit|Write|NotebookEdit",
        hooks: [
          {
            type: "command" as const,
            command: "jj status > /dev/null 2>&1",
          },
        ],
      },
    ],
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command" as const,
            command: `curl -s -X POST http://localhost:${daemonPort}/checkpoint -H 'Content-Type: application/json' -d '{"description":"session-start"}' > /dev/null 2>&1; cat ${join(workspacePath, ".jjd-task-prompt")} 2>/dev/null || true`,
          },
        ],
      },
    ],
  };

  const settingsPath = join(claudeDir, "settings.json");
  mergeHooksIntoSettings(settingsPath, jjdHooks);
  logger.info(`Installed Claude Code hooks at ${settingsPath}`);
}

/**
 * Generates a CLAUDE.md for the workspace that tells Claude to
 * immediately start working on the task.
 */
export function installClaudeMd(
  workspacePath: string,
  linearId: string,
  title: string,
  description?: string
) {
  const claudeMdPath = join(workspacePath, "CLAUDE.md");
  const bookmark = linearId.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  // Don't overwrite existing CLAUDE.md
  if (existsSync(claudeMdPath)) {
    logger.debug("CLAUDE.md already exists, skipping");
    return;
  }

  const content = `# Session: ${linearId}

## Your Task
You are assigned to **${linearId}: ${title}**.
${description ? `\n${description}\n` : ""}
When you start a conversation, immediately begin working on this task. Read the codebase, understand the context, implement the solution, and write tests if appropriate.

## Version Control (read this — it affects your workflow)
- This workspace uses **jj** (Jujutsu) for version control. Always use jj commands, never git.
- A jjd daemon is running — it **automatically describes and pushes your changes**. You do NOT need to commit, describe, or push anything. Just write code.
- Your bookmark is \`${bookmark}\`.

## Do NOT
- Run \`jj describe\`, \`jj commit\`, \`jj new\`, or \`jj git push\` — the daemon handles all of this.
- Worry about version control at all — focus entirely on the task.
`;

  writeFileSync(claudeMdPath, content);
  logger.info(`Installed CLAUDE.md at ${claudeMdPath}`);
}

/**
 * Writes a .task-prompt file that the SessionStart hook echoes
 * to inject the task as Claude's initial instruction.
 */
export function installTaskPrompt(
  workspacePath: string,
  linearId: string,
  title: string,
  description?: string
) {
  const promptPath = join(workspacePath, ".jjd-task-prompt");

  const parts = [
    `Start working on ${linearId}: ${title}.`,
  ];

  if (description) {
    parts.push("");
    parts.push("Here is the full task description:");
    parts.push(description);
  }

  parts.push("");
  parts.push("Read the codebase to understand the context, then implement the solution.");

  writeFileSync(promptPath, parts.join("\n"));
  logger.info(`Installed task prompt at ${promptPath}`);
}

// ---------------------------------------------------------------------------
// Worktree hooks (one-time setup in the main repo)
// ---------------------------------------------------------------------------

/**
 * Install WorktreeCreate / WorktreeRemove hooks in the repo's
 * .claude/settings.json so that jj workspaces stay in sync with
 * Claude Code worktrees automatically.
 *
 * When `withDaemon` is false (default):
 *   - WorktreeCreate → `jj workspace add <path>`
 *   - WorktreeRemove → `jj workspace forget <path>`
 *
 * When `withDaemon` is true:
 *   - WorktreeCreate → `jjd _on-worktree-create`  (workspace + daemon + hooks)
 *   - WorktreeRemove → `jjd _on-worktree-remove`  (stop daemon + forget workspace)
 *
 * Run once per repo with: `jjd hooks install [--with-daemon]`
 */
export function installWorktreeHooks(repoPath: string, withDaemon = false) {
  const claudeDir = join(repoPath, ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const createCommand = withDaemon
    ? "jjd _on-worktree-create"
    : `jj workspace add "$(cat /dev/stdin | jq -r '.worktree_path')"`;

  const removeCommand = withDaemon
    ? "jjd _on-worktree-remove"
    : `jj workspace forget "$(cat /dev/stdin | jq -r '.worktree_path')"`;

  const worktreeHooks = {
    WorktreeCreate: [
      {
        hooks: [{ type: "command" as const, command: createCommand }],
      },
    ],
    WorktreeRemove: [
      {
        hooks: [{ type: "command" as const, command: removeCommand }],
      },
    ],
  };

  const settingsPath = join(claudeDir, "settings.json");
  mergeHooksIntoSettings(settingsPath, worktreeHooks);
  logger.info(
    `Installed WorktreeCreate/WorktreeRemove hooks at ${settingsPath}${withDaemon ? " (with daemon)" : ""}`
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const JJD_HOOK_MARKERS = ["jj status", "jjd", "/checkpoint", "jj workspace"];

function isJjdHook(entry: unknown): boolean {
  const str = JSON.stringify(entry);
  return JJD_HOOK_MARKERS.some((m) => str.includes(m));
}

/**
 * Read settings.json (if it exists), merge new jjd hooks in, write back.
 * Replaces any pre-existing jjd-owned entries to avoid duplicates.
 */
function mergeHooksIntoSettings(
  settingsPath: string,
  newHooks: Record<string, unknown[]>
) {
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Start fresh if file is corrupt
    }
  }

  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown[]> = {};

  for (const [key, value] of Object.entries(existingHooks)) {
    // Skip numeric keys (old format leftovers) and non-array values
    if (/^\d+$/.test(key) || !Array.isArray(value)) continue;
    // Keep only non-jjd entries from existing config
    merged[key] = value.filter((entry) => !isJjdHook(entry));
  }

  // Add fresh jjd hooks
  for (const [event, entries] of Object.entries(newHooks)) {
    merged[event] = [...(merged[event] ?? []), ...entries];
  }

  // Remove empty arrays
  for (const key of Object.keys(merged)) {
    if (merged[key].length === 0) delete merged[key];
  }

  settings.hooks = merged;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
