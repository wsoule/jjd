import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DaemonEngine } from "../src/engine/state-machine";
import { StateDB } from "../src/state";
import type { JjdConfig } from "../src/config";

function makeTmpDb(): { db: StateDB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "jjd-sm-test-"));
  mkdirSync(join(dir, ".jj"), { recursive: true });
  return { db: new StateDB(dir), dir };
}

/**
 * A config that has no API key (disables AutoDescriber) and very long
 * debounce timers so debouncers never fire unexpectedly in tests.
 */
function makeConfig(dir: string, overrides: Partial<JjdConfig> = {}): JjdConfig {
  return {
    repoPath: dir,
    debounceMs: 60_000,
    pushIdleMs: 60_000,
    watcher: "fs",
    pollIntervalMs: 2000,
    model: "claude-haiku-4-5-20251001",
    bookmarkPatterns: [],
    autoPush: false,
    checkpoints: false,
    apiPort: 7433,
    ignorePaths: [],
    logLevel: "error",
    ...overrides,
  };
}

describe("DaemonEngine — state transitions", () => {
  let dir: string;
  let db: StateDB;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts in idle state", () => {
    const engine = new DaemonEngine(makeConfig(dir), db);
    expect(engine.getStatus().state).toBe("idle");
    engine.destroy();
  });

  it("transitions to debouncing on the first file change", () => {
    const engine = new DaemonEngine(makeConfig(dir), db);
    engine.onFileChanged(["src/foo.ts"]);
    expect(engine.getStatus().state).toBe("debouncing");
    engine.destroy();
  });

  it("stays in debouncing (not double-transition) on repeated file changes", () => {
    const engine = new DaemonEngine(makeConfig(dir), db);
    engine.onFileChanged(["a.ts"]);
    engine.onFileChanged(["b.ts"]);
    engine.onFileChanged(["c.ts"]);
    expect(engine.getStatus().state).toBe("debouncing");
    engine.destroy();
  });

  it("getStatus returns undefined for lastDescribe/lastPush initially", () => {
    const engine = new DaemonEngine(makeConfig(dir), db);
    const status = engine.getStatus();
    expect(status.lastDescribe).toBeUndefined();
    expect(status.lastPush).toBeUndefined();
    expect(status.error).toBeUndefined();
    engine.destroy();
  });

  it("destroy cancels debouncers without throwing", () => {
    const engine = new DaemonEngine(makeConfig(dir), db);
    engine.onFileChanged(["src/foo.ts"]);
    expect(() => engine.destroy()).not.toThrow();
  });
});

/** Poll until the engine reaches an expected state, or timeout. */
async function waitForState(
  engine: DaemonEngine,
  target: string,
  timeoutMs = 10_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = engine.getStatus().state;
    if (s === target) return s;
    await Bun.sleep(100);
  }
  return engine.getStatus().state; // return whatever we got
}

describe("DaemonEngine — debounce fires and triggers describe", () => {
  let dir: string;
  let db: StateDB;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("transitions to error when describe fails (no jj repo)", async () => {
    const engine = new DaemonEngine(makeConfig(dir, { debounceMs: 20 }), db);
    engine.onFileChanged(["src/foo.ts"]);

    // Poll until state leaves "describing" — jj subprocess needs real time to fail
    const state = await waitForState(engine, "error");
    expect(state).toBe("error");
    expect(engine.getStatus().error).toBeTruthy();
    engine.destroy();
  }, 10_000);

  it("error state recovers to idle after first backoff (5s)", async () => {
    const engine = new DaemonEngine(makeConfig(dir, { debounceMs: 20 }), db);
    engine.onFileChanged(["src/foo.ts"]);

    // Wait for error state
    await waitForState(engine, "error");
    expect(engine.getStatus().state).toBe("error");

    // Wait for backoff (5s) to return to idle
    const recovered = await waitForState(engine, "idle", 8000);
    expect(recovered).toBe("idle");
    engine.destroy();
  }, 15_000);
});

describe("DaemonEngine — error backoff", () => {
  let dir: string;
  let db: StateDB;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("subsequent errors use longer backoff delay", async () => {
    // Trigger two separate failure cycles and verify the second backoff is longer
    const engine = new DaemonEngine(makeConfig(dir, { debounceMs: 20 }), db);

    // First error cycle
    engine.onFileChanged(["a.ts"]);
    await waitForState(engine, "error");
    expect(engine.getStatus().state).toBe("error");

    // After backoff 1 (~5s), returns to idle
    await waitForState(engine, "idle", 8000);
    expect(engine.getStatus().state).toBe("idle");

    // Second error cycle
    engine.onFileChanged(["b.ts"]);
    await waitForState(engine, "error");
    expect(engine.getStatus().state).toBe("error");

    // Second backoff should be 10s — verify still in error after 7s
    await Bun.sleep(7000);
    expect(engine.getStatus().state).toBe("error");
    engine.destroy();
  }, 25_000);
});
