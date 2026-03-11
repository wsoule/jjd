import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CheckpointManager } from "../src/engine/checkpoint";
import { StateDB } from "../src/state";
import type { JjOperations } from "../src/jj/operations";

function makeTmpDb(): { db: StateDB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "jjd-cp-test-"));
  mkdirSync(join(dir, ".jj"), { recursive: true });
  return { db: new StateDB(dir), dir };
}

function mockJj(overrides: Partial<{
  currentOperationId(): Promise<string>;
  operationRestore(id: string): Promise<void>;
}> = {}): Pick<JjOperations, "currentOperationId" | "operationRestore"> {
  return {
    currentOperationId: async () => "op-default-123",
    operationRestore: async () => {},
    ...overrides,
  } as any;
}

describe("CheckpointManager", () => {
  let dir: string;
  let db: StateDB;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a checkpoint with the current operation ID", async () => {
    const jj = mockJj({ currentOperationId: async () => "op-xyz-456" });
    const mgr = new CheckpointManager(jj as any, db);

    const cp = await mgr.create("before big refactor");
    expect(cp.operationId).toBe("op-xyz-456");
    expect(cp.description).toBe("before big refactor");
    expect(cp.id).toBeGreaterThan(0);
    expect(cp.createdAt).toBeTruthy();
  });

  it("creates checkpoint with empty description by default", async () => {
    const jj = mockJj();
    const mgr = new CheckpointManager(jj as any, db);

    const cp = await mgr.create();
    expect(cp.description).toBe("");
  });

  it("lists checkpoints in reverse creation order", async () => {
    const jj = mockJj();
    const mgr = new CheckpointManager(jj as any, db);

    await mgr.create("first");
    await mgr.create("second");
    await mgr.create("third");

    const list = mgr.list();
    expect(list).toHaveLength(3);
    expect(list[0].description).toBe("third");
    expect(list[1].description).toBe("second");
    expect(list[2].description).toBe("first");
  });

  it("list respects the limit parameter", async () => {
    const jj = mockJj();
    const mgr = new CheckpointManager(jj as any, db);

    for (let i = 0; i < 5; i++) await mgr.create(`cp-${i}`);

    const list = mgr.list(2);
    expect(list).toHaveLength(2);
  });

  it("rolls back to a checkpoint by restoring its operation ID", async () => {
    let restored = "";
    const jj = mockJj({
      currentOperationId: async () => "op-target",
      operationRestore: async (id) => { restored = id; },
    });
    const mgr = new CheckpointManager(jj as any, db);

    const cp = await mgr.create("the checkpoint");
    await mgr.rollback(cp.id);

    expect(restored).toBe("op-target");
  });

  it("throws on rollback to a nonexistent checkpoint ID", async () => {
    const mgr = new CheckpointManager(mockJj() as any, db);
    await expect(mgr.rollback(9999)).rejects.toThrow("not found");
  });

  it("multiple checkpoints have unique IDs", async () => {
    const jj = mockJj();
    const mgr = new CheckpointManager(jj as any, db);

    const a = await mgr.create("a");
    const b = await mgr.create("b");
    const c = await mgr.create("c");

    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });
});
