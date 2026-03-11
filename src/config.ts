import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { logger } from "./util/logger";

export interface BookmarkPattern {
  pattern: string;
  autoAdvance: boolean;
}

export interface JjdConfig {
  repoPath: string;
  debounceMs: number;
  pushIdleMs: number;
  watcher: "fs" | "poll";
  pollIntervalMs: number;
  anthropicApiKey?: string;
  model: string;
  bookmarkPatterns: BookmarkPattern[];
  autoPush: boolean;
  checkpoints: boolean;
  apiPort: number;
  ignorePaths: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

const DEFAULTS: Omit<JjdConfig, "repoPath"> = {
  debounceMs: 5000,
  pushIdleMs: 30_000,
  watcher: "fs",
  pollIntervalMs: 2000,
  model: "claude-haiku-4-5-20251001",
  bookmarkPatterns: [],
  autoPush: true,
  checkpoints: true,
  apiPort: 7433,
  ignorePaths: ["node_modules", ".next", "dist", "*.log", ".jj"],
  logLevel: "info",
};

/**
 * Load config from (in order of priority):
 * 1. Explicit config path
 * 2. <repoPath>/jjd.config.json
 * 3. ~/.config/jjd/config.json
 * 4. Defaults
 */
export function loadConfig(repoPath: string, configPath?: string): JjdConfig {
  const candidates = [
    configPath,
    join(repoPath, "jjd.config.json"),
    join(process.env.HOME ?? "~", ".config", "jjd", "config.json"),
  ].filter(Boolean) as string[];

  let fileConfig: Partial<JjdConfig> = {};

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const text = readFileSync(path, "utf-8");
        fileConfig = JSON.parse(text);
        logger.info(`Loaded config from ${path}`);
        break;
      } catch (e) {
        logger.warn(`Failed to parse config at ${path}: ${e}`);
      }
    }
  }

  // Env overrides
  const anthropicApiKey =
    fileConfig.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;

  const apiPort = process.env.JJD_PORT
    ? parseInt(process.env.JJD_PORT, 10)
    : fileConfig.apiPort ?? DEFAULTS.apiPort;

  return {
    ...DEFAULTS,
    ...fileConfig,
    repoPath,
    apiPort,
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
  };
}
