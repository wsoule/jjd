import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "jjd-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config.debounceMs).toBe(5000);
    expect(config.pushIdleMs).toBe(30_000);
    expect(config.autoPush).toBe(true);
    expect(config.checkpoints).toBe(true);
    expect(config.watcher).toBe("fs");
    expect(config.apiPort).toBe(7433);
    expect(config.repoPath).toBe(tmpDir);
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it("merges repo config file over defaults", () => {
    writeFileSync(
      join(tmpDir, "jjd.config.json"),
      JSON.stringify({ debounceMs: 1000, autoPush: false })
    );
    const config = loadConfig(tmpDir);
    expect(config.debounceMs).toBe(1000);
    expect(config.autoPush).toBe(false);
    expect(config.pushIdleMs).toBe(30_000); // default unchanged
  });

  it("uses explicit configPath over repo config", () => {
    writeFileSync(
      join(tmpDir, "jjd.config.json"),
      JSON.stringify({ debounceMs: 999 })
    );
    const explicitPath = join(tmpDir, "custom.json");
    writeFileSync(explicitPath, JSON.stringify({ debounceMs: 1234 }));

    const config = loadConfig(tmpDir, explicitPath);
    expect(config.debounceMs).toBe(1234);
  });

  it("uses JJD_PORT env var to override apiPort", () => {
    const orig = process.env.JJD_PORT;
    process.env.JJD_PORT = "9000";
    try {
      const config = loadConfig(tmpDir);
      expect(config.apiPort).toBe(9000);
    } finally {
      if (orig === undefined) delete process.env.JJD_PORT;
      else process.env.JJD_PORT = orig;
    }
  });

  it("uses ANTHROPIC_API_KEY env var", () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    try {
      const config = loadConfig(tmpDir);
      expect(config.anthropicApiKey).toBe("sk-test-key");
    } finally {
      if (orig === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = orig;
    }
  });

  it("config file anthropicApiKey takes precedence over env", () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "env-key";
    writeFileSync(
      join(tmpDir, "jjd.config.json"),
      JSON.stringify({ anthropicApiKey: "file-key" })
    );
    try {
      const config = loadConfig(tmpDir);
      // env overrides file (env is checked after file)
      // loadConfig: fileConfig.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY
      // file wins here since it's the left side of ??
      expect(config.anthropicApiKey).toBe("file-key");
    } finally {
      if (orig === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = orig;
    }
  });

  it("handles malformed config file gracefully and uses defaults", () => {
    writeFileSync(join(tmpDir, "jjd.config.json"), "not valid json {{{");
    const config = loadConfig(tmpDir);
    expect(config.debounceMs).toBe(5000);
    expect(config.apiPort).toBe(7433);
  });

  it("preserves repoPath regardless of config file content", () => {
    writeFileSync(
      join(tmpDir, "jjd.config.json"),
      JSON.stringify({ repoPath: "/some/other/path" })
    );
    const config = loadConfig(tmpDir);
    expect(config.repoPath).toBe(tmpDir);
  });
});
