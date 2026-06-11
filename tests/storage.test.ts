import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { agents } from "../src/storage/schema.ts";
import { sweepPresence } from "../src/core/presence.ts";
import { newId, nowIso, isoMsAgo } from "../src/core/util.ts";
import { eq } from "drizzle-orm";

// Point the singleton at an isolated temp DB before anything opens the default.
const dir = mkdtempSync(join(tmpdir(), "np-storage-"));
const db = getDb(join(dir, "test.db"));
runMigrations();

test("migrations create the agents table and WAL is queryable", () => {
  const id = newId("agent");
  db.insert(agents)
    .values({ id, name: "backend-agent", status: "available", registeredAt: nowIso(), lastSeenAt: nowIso() })
    .run();
  const row = db.select().from(agents).where(eq(agents.id, id)).get();
  expect(row?.name).toBe("backend-agent");
  expect(row?.status).toBe("available");
});

test("presence sweeper marks stale agents offline but leaves fresh ones", () => {
  const stale = newId("agent");
  const fresh = newId("agent");
  const staleSeen = isoMsAgo(120_000); // 2 min ago — past the 60s TTL
  db.insert(agents)
    .values({ id: stale, name: "stale", status: "in_progress", registeredAt: staleSeen, lastSeenAt: staleSeen })
    .run();
  db.insert(agents)
    .values({ id: fresh, name: "fresh", status: "in_progress", registeredAt: nowIso(), lastSeenAt: nowIso() })
    .run();

  const swept = sweepPresence();
  expect(swept).toBeGreaterThanOrEqual(1);

  expect(db.select().from(agents).where(eq(agents.id, stale)).get()?.status).toBe("offline");
  expect(db.select().from(agents).where(eq(agents.id, fresh)).get()?.status).toBe("in_progress");
});
