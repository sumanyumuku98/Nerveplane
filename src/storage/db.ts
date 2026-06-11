import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "../config.ts";
import * as schema from "./schema.ts";

export type DB = BunSQLiteDatabase<typeof schema>;

let _db: DB | null = null;
let _sqlite: Database | null = null;

/**
 * Open (or reuse) the local SQLite database in WAL mode.
 * WAL gives unlimited concurrent readers with a single writer — the right
 * profile for a write-sparse, read-heavy coordination daemon serving many
 * MCP clients (plan Part D / technical research §4).
 */
export function getDb(path: string = DB_PATH): DB {
  if (_db) return _db;
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA cache_size = -65536;"); // 64MB
  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

export function getRawSqlite(): Database {
  if (!_sqlite) getDb();
  return _sqlite!;
}

export function closeDb(): void {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}

export { schema };
