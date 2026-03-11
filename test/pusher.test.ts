import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Pusher } from "../src/engine/pusher";
import { StateDB } from "../src/state";
import type { JjOperations } from "../src/jj/operations";
import type { JjStatus } from "../src/jj/types";

function makeTmpDb(): { db: StateDB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "jjd-pusher-test-"));
  mkdirSync(join(dir, ".jj"), { recursive: true });
  return { db: new StateDB(dir), dir };
}

function makeStatus(bookmarks: string[]): JjStatus {
  return {
    workingCopy: {
      changeId: "aaabbbccc",
      commitId: "dddeeefff",
      description: "feat: test",
      empty: false,
      bookmarks,
    },
    fileChanges: [],
    hasConflicts: false,
  };
}

describe("Pusher", () => {
  let dir: string;
  let db: StateDB;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false and skips push when no bookmarks on working copy", async () => {
    const pushed: string[] = [];
    const jj = {
      status: async () => makeStatus([]),
      gitPush: async (bm: string) => { pushed.push(bm); return { success: true, output: "" }; },
    } as unknown as JjOperations;

    const pusher = new Pusher(jj, db);
    const result = await pusher.push();

    expect(result).toBe(false);
    expect(pushed).toHaveLength(0);
  });

  it("pushes each bookmark on the working copy", async () => {
    const pushed: string[] = [];
    const jj = {
      status: async () => makeStatus(["feat/foo", "eng-123"]),
      gitPush: async (bm: string) => { pushed.push(bm); return { success: true, output: "" }; },
    } as unknown as JjOperations;

    const pusher = new Pusher(jj, db);
    const result = await pusher.push();

    expect(result).toBe(true);
    expect(pushed).toEqual(["feat/foo", "eng-123"]);
  });

  it("returns false when all pushes fail", async () => {
    const jj = {
      status: async () => makeStatus(["main-bm"]),
      gitPush: async () => ({ success: false, output: "remote: permission denied" }),
    } as unknown as JjOperations;

    const pusher = new Pusher(jj, db);
    const result = await pusher.push();

    expect(result).toBe(false);
  });

  it("returns true if at least one bookmark pushes successfully", async () => {
    let call = 0;
    const jj = {
      status: async () => makeStatus(["ok-bm", "fail-bm"]),
      gitPush: async () => {
        const success = call++ === 0;
        return { success, output: success ? "" : "error" };
      },
    } as unknown as JjOperations;

    const pusher = new Pusher(jj, db);
    const result = await pusher.push();

    expect(result).toBe(true);
  });

  it("logs successful pushes to the state DB", async () => {
    const jj = {
      status: async () => makeStatus(["my-bookmark"]),
      gitPush: async () => ({ success: true, output: "" }),
    } as unknown as JjOperations;

    const pusher = new Pusher(jj, db);
    await pusher.push();

    const recent = db.recentPushes(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].bookmark).toBe("my-bookmark");
    expect(recent[0].result).toBe("ok");
  });

  it("logs failed pushes to the state DB", async () => {
    const jj = {
      status: async () => makeStatus(["bad-bm"]),
      gitPush: async () => ({ success: false, output: "remote error" }),
    } as unknown as JjOperations;

    const pusher = new Pusher(jj, db);
    await pusher.push();

    const recent = db.recentPushes(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].bookmark).toBe("bad-bm");
    expect(recent[0].result).toBe("remote error");
  });
});
