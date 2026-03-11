import { exec, type ExecResult } from "../util/process";
import { logger } from "../util/logger";

export class JjCli {
  constructor(private repoPath: string) {}

  /**
   * Run a jj command with standard flags for parseable output.
   */
  async run(args: string[], options?: { timeoutMs?: number; env?: Record<string, string> }): Promise<ExecResult> {
    const cmd = ["jj", "--no-pager", "--color=never", "-R", this.repoPath, ...args];
    const result = await exec(cmd, {
      cwd: this.repoPath,
      timeoutMs: options?.timeoutMs,
      env: options?.env,
    });

    if (result.exitCode !== 0) {
      logger.warn(`jj ${args[0]} exited with ${result.exitCode}`, {
        stderr: result.stderr.slice(0, 500),
      });
    }

    return result;
  }

  /**
   * Run a jj command and return stdout, throwing on non-zero exit.
   */
  async runOrThrow(args: string[], options?: { timeoutMs?: number; env?: Record<string, string> }): Promise<string> {
    const result = await this.run(args, options);
    if (result.exitCode !== 0) {
      throw new Error(`jj ${args[0]} failed (exit ${result.exitCode}): ${result.stderr}`);
    }
    return result.stdout;
  }
}
