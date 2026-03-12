import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../util/logger";

const SYSTEM_PROMPT = `You are a commit message generator. Given a code diff, write a concise conventional commit message.

Rules:
- Use conventional commit format: type(scope): description
- Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
- Scope is optional, use it when the change is clearly scoped to one area
- Description should be lowercase, imperative mood, no period at the end
- Keep it to one line (under 72 characters) unless the change is complex
- For complex changes, add a blank line then a brief body (2-3 lines max)
- Focus on WHAT changed and WHY, not HOW
- If the diff is truncated, do your best with what you can see

Examples:
- feat(auth): add OAuth2 login flow
- fix: prevent crash when config file is missing
- refactor(api): simplify request validation middleware`;

const SCOPE_CHECK_PROMPT = `You are a commit scope analyzer. You receive a CURRENT commit description and a file-change summary listing every modified file.

Your job: decide if the working copy has grown beyond the current commit's scope. The PRIMARY signal is FILE PATHS — different directories, layers, or subsystems are strong evidence of a scope change.

Strong signals for a NEW scope (split):
- Files span different architectural layers: API/backend files alongside UI/frontend files
  e.g. "src/api/users.ts" + "src/components/UserList.tsx" → split
- Files are in unrelated subsystems or features
  e.g. "src/auth/login.ts" + "src/billing/invoice.ts" → split
- Files mix infrastructure with product code
  e.g. "docker-compose.yml" + "src/features/search.ts" → split

Weak signals (usually same scope, don't split):
- Tests added alongside the code they test
- Types/interfaces added alongside their implementation
- Related files within the same directory or module

When uncertain, prefer splitting — it is always better to have too many commits than too few.

Respond with ONLY a JSON object (no markdown, no backticks):
- No split: {"split": false}
- Split: {"split": true, "reason": "brief explanation", "oldScopeFiles": ["path/to/file1"], "newScopeFiles": ["path/to/file2"]}

oldScopeFiles = files that belong to the CURRENT description's scope.
newScopeFiles = files representing the NEW, different unit of work.
Every changed file must appear in exactly one list.`;

export interface DescribeResult {
  message: string;
  split: boolean;
  splitReason?: string;
  oldScopeFiles?: string[];
  newScopeFiles?: string[];
}

export class AutoDescriber {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateMessage(diff: string): Promise<string> {
    if (!diff.trim()) {
      return "(empty change)";
    }

    logger.debug("Generating commit message via Anthropic API");

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Generate a commit message for this diff:\n\n${diff}`,
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      return cleanMessage(text);
    } catch (err) {
      logger.error(`Anthropic API error: ${err}`);
      throw err;
    }
  }

  /**
   * Generate a commit message AND check if the scope has shifted
   * from the current description. If so, recommends a split (jj new).
   *
   * The scope check receives only the diff summary (file paths) — not the
   * full diff — because paths are the primary signal for scope changes and
   * code content is noise for this task.
   */
  async generateWithScopeCheck(
    diff: string,
    currentDescription: string
  ): Promise<DescribeResult> {
    if (!diff.trim()) {
      return { message: "(empty change)", split: false };
    }

    // If there's no current description, no split possible
    if (!currentDescription.trim() || currentDescription === "(empty change)") {
      const message = await this.generateMessage(diff);
      return { message, split: false };
    }

    logger.debug("Generating commit message with scope check");

    // Extract just the file summary for scope checking (first section of diff output)
    const summary = extractSummary(diff);

    try {
      // Run both calls in parallel
      const [messageResponse, scopeResponse] = await Promise.all([
        this.client.messages.create({
          model: this.model,
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Generate a commit message for this diff:\n\n${diff}`,
            },
          ],
        }),
        this.client.messages.create({
          model: this.model,
          max_tokens: 512,
          system: SCOPE_CHECK_PROMPT,
          messages: [
            {
              role: "user",
              content: `CURRENT DESCRIPTION:\n${currentDescription}\n\nCHANGED FILES:\n${summary}`,
            },
          ],
        }),
      ]);

      const message =
        messageResponse.content[0].type === "text"
          ? cleanMessage(messageResponse.content[0].text)
          : "";

      const scopeText =
        scopeResponse.content[0].type === "text"
          ? scopeResponse.content[0].text
          : "{}";

      let split = false;
      let splitReason: string | undefined;
      let oldScopeFiles: string[] | undefined;
      let newScopeFiles: string[] | undefined;

      try {
        const parsed = JSON.parse(scopeText.trim());
        split = parsed.split === true;
        splitReason = parsed.reason;
        if (split) {
          oldScopeFiles = parsed.oldScopeFiles;
          newScopeFiles = parsed.newScopeFiles;
        }
      } catch {
        logger.warn(`Failed to parse scope check response: ${scopeText}`);
      }

      // Validate: if split but missing file lists, fall back to no split
      if (split && (!oldScopeFiles?.length || !newScopeFiles?.length)) {
        logger.warn("Scope split recommended but file lists missing — skipping split");
        split = false;
      }

      logger.info(`Generated message: ${message.split("\n")[0]}`);
      if (split) {
        logger.info(`Scope change detected: ${splitReason}`);
        logger.info(`Old scope: ${oldScopeFiles!.join(", ")}`);
        logger.info(`New scope: ${newScopeFiles!.join(", ")}`);
      }

      return { message, split, splitReason, oldScopeFiles, newScopeFiles };
    } catch (err) {
      logger.error(`Anthropic API error: ${err}`);
      throw err;
    }
  }
}

function cleanMessage(text: string): string {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^commit message:\s*/i, "")
    .trim();
}

/**
 * Extract the file-change summary from the combined diff string.
 * The diff() method returns "Summary:\n<paths>\n\nFull diff:\n<code>".
 * We want only the paths — they're the signal for scope detection.
 */
function extractSummary(diff: string): string {
  const match = diff.match(/^Summary:\n([\s\S]*?)(?:\n\nFull diff:|$)/);
  return match ? match[1].trim() : diff.split("\n").slice(0, 20).join("\n");
}
