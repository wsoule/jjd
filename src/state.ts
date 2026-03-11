import { Database } from "bun:sqlite";
import { join } from "path";
import { logger } from "./util/logger";

export interface Checkpoint {
  id: number;
  operationId: string;
  description: string;
  createdAt: string;
}

export interface PushRecord {
  id: number;
  bookmark: string | null;
  result: string;
  createdAt: string;
}

export class StateDB {
  private db: Database;

  constructor(repoPath: string) {
    const dbPath = join(repoPath, ".jj", "jjd.sqlite");
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.migrate();
    logger.debug(`State DB opened at ${dbPath}`);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS push_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bookmark TEXT,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // -- Key-value store for daemon state --

  get(key: string): string | null {
    const row = this.db.query("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | null;
    return row?.value ?? null;
  }

  set(key: string, value: string) {
    this.db
      .query("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  // -- Checkpoints --

  createCheckpoint(operationId: string, description: string): Checkpoint {
    this.db
      .query("INSERT INTO checkpoints (operation_id, description) VALUES (?, ?)")
      .run(operationId, description);
    const id = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return {
      id: id.id,
      operationId,
      description,
      createdAt: new Date().toISOString(),
    };
  }

  listCheckpoints(limit = 20): Checkpoint[] {
    return this.db
      .query(
        "SELECT id, operation_id as operationId, description, created_at as createdAt FROM checkpoints ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as Checkpoint[];
  }

  getCheckpoint(id: number): Checkpoint | null {
    return this.db
      .query(
        "SELECT id, operation_id as operationId, description, created_at as createdAt FROM checkpoints WHERE id = ?"
      )
      .get(id) as Checkpoint | null;
  }

  // -- Push log --

  logPush(bookmark: string | null, result: string) {
    this.db
      .query("INSERT INTO push_log (bookmark, result) VALUES (?, ?)")
      .run(bookmark, result);
  }

  recentPushes(limit = 10): PushRecord[] {
    return this.db
      .query(
        "SELECT id, bookmark, result, created_at as createdAt FROM push_log ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as PushRecord[];
  }

  close() {
    this.db.close();
  }
}
