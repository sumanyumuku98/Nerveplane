import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb } from "./db.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "..", "..", "drizzle");

/** Applies all pending SQL migrations from ./drizzle. Idempotent. */
export function runMigrations(): void {
  const db = getDb();
  migrate(db, { migrationsFolder });
}

if (import.meta.main) {
  runMigrations();
  console.log("nerveplane: migrations applied");
}
