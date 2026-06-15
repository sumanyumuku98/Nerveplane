import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { agents } from "../src/storage/schema.ts";
import { isAgentLive, sweepPresence } from "../src/core/presence.ts";
import { discoverAgents, noteConnection } from "../src/core/registry.ts";
import { newId, nowIso, isoMsAgo } from "../src/core/util.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-presence-")), "test.db"));
runMigrations();

// A PID that is overwhelmingly unlikely to exist → isProcessAlive() returns false.
const DEAD_PID = 999_999;

function insertAgent(over: Partial<typeof agents.$inferSelect> = {}) {
  const id = newId("agent");
  getDb()
    .insert(agents)
    .values({ id, name: id, status: "available", registeredAt: nowIso(), lastSeenAt: nowIso(), ...over })
    .run();
  return id;
}

test("live bridge PID ⇒ online even with a stale lastSeenAt (no TTL needed)", () => {
  const id = insertAgent({ connectionPid: process.pid, lastSeenAt: isoMsAgo(60 * 60_000) }); // seen 1h ago
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get()!;
  expect(isAgentLive(row)).toBe(true);
  expect(discoverAgents().some((a) => a.id === id)).toBe(true);
  expect(sweepPresence() >= 0).toBe(true);
  expect(getDb().select().from(agents).where(eq(agents.id, id)).get()?.status).not.toBe("offline");
});

test("dead bridge PID ⇒ offline regardless of how recently it was seen", () => {
  const id = insertAgent({ connectionPid: DEAD_PID, lastSeenAt: nowIso() });
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get()!;
  expect(isAgentLive(row)).toBe(false);
  expect(discoverAgents().some((a) => a.id === id)).toBe(false); // hidden from discover
  sweepPresence();
  expect(getDb().select().from(agents).where(eq(agents.id, id)).get()?.status).toBe("offline");
});

test("no connection PID ⇒ falls back to the heartbeat TTL", () => {
  const live = insertAgent({ connectionPid: null, lastSeenAt: isoMsAgo(5 * 60_000) }); // 5 min — within 15-min TTL
  const dead = insertAgent({ connectionPid: null, lastSeenAt: isoMsAgo(20 * 60_000) }); // 20 min — past TTL
  expect(isAgentLive(getDb().select().from(agents).where(eq(agents.id, live)).get()!)).toBe(true);
  expect(isAgentLive(getDb().select().from(agents).where(eq(agents.id, dead)).get()!)).toBe(false);
});

test("noteConnection records the PID and revives an offline agent", () => {
  const id = insertAgent({ status: "offline", connectionPid: null, lastSeenAt: isoMsAgo(60 * 60_000) });
  noteConnection(id, process.pid);
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get()!;
  expect(row.connectionPid).toBe(process.pid);
  expect(row.status).toBe("available"); // revived
  expect(discoverAgents().some((a) => a.id === id)).toBe(true);
});
