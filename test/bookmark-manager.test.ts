import { describe, it, expect } from "bun:test";
import { BookmarkManager } from "../src/engine/bookmark-manager";
import type { JjOperations } from "../src/jj/operations";
import type { JjStatus } from "../src/jj/types";

function makeJj(bookmarks: string[]): JjOperations {
  return {
    bookmarkSet: async () => {},
    status: async (): Promise<JjStatus> => ({
      workingCopy: {
        changeId: "abc123",
        commitId: "def456",
        description: "feat: stuff",
        empty: false,
        bookmarks,
      },
      fileChanges: [],
      hasConflicts: false,
    }),
  } as unknown as JjOperations;
}

describe("BookmarkManager", () => {
  describe("shouldAutoAdvance", () => {
    it("matches wildcard glob pattern", () => {
      const mgr = new BookmarkManager({} as any, [{ pattern: "feat/*", autoAdvance: true }]);
      expect(mgr.shouldAutoAdvance("feat/my-feature")).toBe(true);
      expect(mgr.shouldAutoAdvance("feat/something-else")).toBe(true);
      expect(mgr.shouldAutoAdvance("fix/something")).toBe(false);
    });

    it("matches exact name pattern", () => {
      const mgr = new BookmarkManager({} as any, [{ pattern: "main", autoAdvance: true }]);
      expect(mgr.shouldAutoAdvance("main")).toBe(true);
      expect(mgr.shouldAutoAdvance("main-branch")).toBe(false);
      expect(mgr.shouldAutoAdvance("not-main")).toBe(false);
    });

    it("respects autoAdvance: false", () => {
      const mgr = new BookmarkManager({} as any, [{ pattern: "feat/*", autoAdvance: false }]);
      expect(mgr.shouldAutoAdvance("feat/anything")).toBe(false);
    });

    it("returns false with no patterns configured", () => {
      const mgr = new BookmarkManager({} as any, []);
      expect(mgr.shouldAutoAdvance("feat/anything")).toBe(false);
    });

    it("matches multiple patterns — any match wins", () => {
      const mgr = new BookmarkManager({} as any, [
        { pattern: "feat/*", autoAdvance: true },
        { pattern: "fix/*", autoAdvance: true },
      ]);
      expect(mgr.shouldAutoAdvance("feat/foo")).toBe(true);
      expect(mgr.shouldAutoAdvance("fix/bar")).toBe(true);
      expect(mgr.shouldAutoAdvance("chore/baz")).toBe(false);
    });

    it("matches catch-all wildcard", () => {
      const mgr = new BookmarkManager({} as any, [{ pattern: "*", autoAdvance: true }]);
      expect(mgr.shouldAutoAdvance("anything")).toBe(true);
      expect(mgr.shouldAutoAdvance("eng-123")).toBe(true);
    });
  });

  describe("advanceBookmarks", () => {
    it("sets bookmarks that match patterns", async () => {
      const setCalls: string[] = [];
      const jj = {
        bookmarkSet: async (name: string) => { setCalls.push(name); },
        status: async (): Promise<JjStatus> => ({
          workingCopy: {
            changeId: "a", commitId: "b", description: "", empty: false,
            bookmarks: ["feat/cool", "unrelated"],
          },
          fileChanges: [],
          hasConflicts: false,
        }),
      } as unknown as JjOperations;

      const mgr = new BookmarkManager(jj, [{ pattern: "feat/*", autoAdvance: true }]);
      const advanced = await mgr.advanceBookmarks();

      expect(advanced).toEqual(["feat/cool"]);
      expect(setCalls).toEqual(["feat/cool"]);
    });

    it("skips bookmarks not matching any pattern", async () => {
      const setCalls: string[] = [];
      const jj = {
        bookmarkSet: async (name: string) => { setCalls.push(name); },
        status: async (): Promise<JjStatus> => ({
          workingCopy: {
            changeId: "a", commitId: "b", description: "", empty: false,
            bookmarks: ["main", "other"],
          },
          fileChanges: [],
          hasConflicts: false,
        }),
      } as unknown as JjOperations;

      const mgr = new BookmarkManager(jj, [{ pattern: "feat/*", autoAdvance: true }]);
      const advanced = await mgr.advanceBookmarks();

      expect(advanced).toHaveLength(0);
      expect(setCalls).toHaveLength(0);
    });

    it("returns empty array when working copy has no bookmarks", async () => {
      const mgr = new BookmarkManager(
        makeJj([]),
        [{ pattern: "*", autoAdvance: true }]
      );
      const advanced = await mgr.advanceBookmarks();
      expect(advanced).toHaveLength(0);
    });

    it("advances multiple matching bookmarks", async () => {
      const setCalls: string[] = [];
      const jj = {
        bookmarkSet: async (name: string) => { setCalls.push(name); },
        status: async (): Promise<JjStatus> => ({
          workingCopy: {
            changeId: "a", commitId: "b", description: "", empty: false,
            bookmarks: ["feat/a", "feat/b", "chore/c"],
          },
          fileChanges: [],
          hasConflicts: false,
        }),
      } as unknown as JjOperations;

      const mgr = new BookmarkManager(jj, [{ pattern: "feat/*", autoAdvance: true }]);
      const advanced = await mgr.advanceBookmarks();

      expect(advanced).toEqual(["feat/a", "feat/b"]);
    });
  });
});
