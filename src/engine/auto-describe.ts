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

const SCOPE_CHECK_PROMPT = `You are a commit scope analyzer. You will be given the CURRENT commit description and a NEW diff that represents all changes in the working copy.

Your job: decide whether the new diff has grown beyond the scope of the current commit description. A scope change means the developer has moved on to a logically different unit of work — not just expanding the same feature.

Examples of SAME scope (no split):
- Current: "feat(auth): add login form" → diff adds validation to the same login form
- Current: "fix(api): handle null response" → diff adds a test for the same fix
- Current: "chore: update dependencies" → diff updates more dependencies

Examples of NEW scope (split):
- Current: "feat(auth): add login form" → diff now also refactors the dashboard layout
- Current: "fix(api): handle null response" → diff now adds a completely new API endpoint
- Current: "chore: update dependencies" → diff now fixes a bug in the payment module

The diff summary will list changed files with their status (A/M/D/R). Use the file paths exactly as shown.

Respond with ONLY a JSON object (no markdown, no backticks):
- No split: {"split": false}
- Split: {"split": true, "reason": "brief explanation", "oldScopeFiles": ["path/to/file1", "path/to/file2"], "newScopeFiles": ["path/to/file3"]}

oldScopeFiles = files that belong to the CURRENT commit description's scope.
newScopeFiles = files that represent the NEW, different unit of work.
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
              content: `CURRENT DESCRIPTION:\n${currentDescription}\n\nNEW DIFF:\n${diff}`,
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
