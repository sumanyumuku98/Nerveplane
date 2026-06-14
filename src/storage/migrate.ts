import { getRawSqlite } from "./db.ts";
import journal from "../../drizzle/meta/_journal.json";
import m0000 from "../../drizzle/0000_ancient_photon.sql" with { type: "text" };
import m0001 from "../../drizzle/0001_adorable_raza.sql" with { type: "text" };
import m0002 from "../../drizzle/0002_goofy_monster_badoon.sql" with { type: "text" };

/**
 * Embedded migrator. The generated drizzle SQL + journal are imported as text
 * and bundled into the `bun build --compile` binary, so the daemon self-migrates
 * with no on-disk `./drizzle` folder (the npm package ships it too, but the
 * standalone binary must be self-contained). Applied migrations are tracked in
 * `__nerveplane_migrations`.
 *
 * When you add a migration: `bun run db:generate`, then import the new
 * `<tag>.sql` here and add it to MIGRATIONS.
 */
const MIGRATIONS: Record<string, string> = {
  "0000_ancient_photon": m0000,
  "0001_adorable_raza": m0001,
  "0002_goofy_monster_badoon": m0002,
};

interface JournalEntry {
  idx: number;
  tag: string;
}

export function runMigrations(): void {
  const db = getRawSqlite();
  db.exec("CREATE TABLE IF NOT EXISTS __nerveplane_migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");

  const applied = new Set(
    db.query("SELECT tag FROM __nerveplane_migrations").all().map((r) => (r as { tag: string }).tag),
  );
  const entries = ([...(journal as { entries: JournalEntry[] }).entries]).sort((a, b) => a.idx - b.idx);

  // Baseline: a DB created by the previous (drizzle folder) migrator already has
  // the tables but no __nerveplane_migrations rows. Detect via a known table and
  // mark current migrations applied instead of re-running their CREATE TABLEs.
  if (applied.size === 0) {
    const hasSchema = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
      .get();
    if (hasSchema) {
      const stamp = new Date().toISOString();
      const ins = db.query("INSERT INTO __nerveplane_migrations (tag, applied_at) VALUES (?, ?)");
      for (const e of entries) ins.run(e.tag, stamp);
      return;
    }
  }

  for (const e of entries) {
    if (applied.has(e.tag)) continue;
    const sql = MIGRATIONS[e.tag];
    if (!sql) throw new Error(`nerveplane: embedded migration missing for "${e.tag}"`);
    const tag = e.tag;
    db.transaction(() => {
      db.exec(sql); // bun:sqlite runs all statements; "--> statement-breakpoint" is a SQL comment
      db.query("INSERT INTO __nerveplane_migrations (tag, applied_at) VALUES (?, ?)").run(tag, new Date().toISOString());
    })();
  }
}

if (import.meta.main) {
  runMigrations();
  console.log("nerveplane: migrations applied");
}
