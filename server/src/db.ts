import { rootServer } from "@rootsdk/server-app";
import sqlite3 from "sqlite3";

// ============================================================================
// SQLite access. Root backs up and restores the database file it hands us in
// rootServer.dataStore.config, so everything persistent lives in that file.
// ============================================================================

export type Database = sqlite3.Database;

let _db: Database | undefined;

export async function openDatabase(): Promise<Database> {
  if (_db) return _db;
  const config = rootServer.dataStore.config.sqlite3;
  if (!config) {
    throw new Error("SQLite config not available — check databaseType");
  }
  _db = await new Promise<Database>((resolve, reject) => {
    const db = new sqlite3.Database(config.filename, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
  return _db;
}

export function db(): Database {
  if (!_db) throw new Error("Database not opened yet — call openDatabase() first");
  return _db;
}

// --- Promisified helpers ----------------------------------------------------

export function run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastID: number }> {
  return new Promise((resolve, reject) => {
    db().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

export function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db().get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T | undefined)));
  });
}

export function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}

// Placeholder list for "IN (...)" clauses.
export function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

// Serialized transactions: one shared connection cannot nest BEGIN, so
// callers queue on a promise chain. A failed transaction does not poison
// the chain for later callers.
let txChain: Promise<unknown> = Promise.resolve();

export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const prior = txChain.catch(() => undefined);
  const current = prior.then(async () => {
    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      const result = await fn();
      await run("COMMIT");
      return result;
    } catch (err) {
      try {
        await run("ROLLBACK");
      } catch {
        // already rolled back
      }
      throw err;
    }
  });
  txChain = current;
  return current;
}

// --- Schema -----------------------------------------------------------------

const SCHEMA_VERSION = 1;

export async function migrate(): Promise<void> {
  const row = await get<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      identifier TEXT NOT NULL,
      image_uri TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      next_number INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);

  await run(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, project_id)
    )`);

  await run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);

  await run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      assignee_kind INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  await run("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_kind, assignee_id)");

  await run(`
    CREATE TABLE IF NOT EXISTS task_tags (
      task_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, tag_id)
    )`);
  await run("CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags (tag_id)");

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      edited_at INTEGER NOT NULL DEFAULT 0
    )`);
  await run("CREATE INDEX IF NOT EXISTS idx_comments_task ON comments (task_id)");

  await run(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      actor_id TEXT NOT NULL,
      kind INTEGER NOT NULL,
      from_value TEXT NOT NULL DEFAULT '',
      to_value TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
  await run("CREATE INDEX IF NOT EXISTS idx_activity_task ON activity (task_id)");

  // Files attached to a task (comment_id = 0) or to a comment. A draft row
  // (draft = 1) belongs to its uploader until a new task/comment claims it.
  await run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL DEFAULT 0,
      comment_id INTEGER NOT NULL DEFAULT 0,
      draft INTEGER NOT NULL DEFAULT 0,
      asset_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      kind INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
  await run("CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments (task_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_attachments_comment ON attachments (comment_id)");

  await run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
