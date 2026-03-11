import { logger } from "./logger";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command and return stdout/stderr/exitCode.
 * Throws only on spawn failure or timeout — non-zero exit is returned, not thrown.
 */
export async function exec(
  cmd: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  } = {}
): Promise<ExecResult> {
  const { cwd, timeoutMs = 30_000, env } = options;

  logger.debug(`exec: ${cmd.join(" ")}`, { cwd });

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout);
  }
}
