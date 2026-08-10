import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent } from "../src/core/registry.ts";
import { recordDecision } from "../src/core/decisions.ts";
import { remember } from "../src/core/memory.ts";
import { memoryCheckpointStatus } from "../src/core/checkpoint.ts";
import { formatMemoryNudge } from "../src/cli/stop-check.ts";
import { agentWorktreeState } from "../src/storage/schema.ts";
import { nowIso } from "../src/core/util.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-checkpoint-")), "test.db"));
runMigrations();

/** Register a fresh agent on its own worktree so tests never share cursors. */
let n = 0;
async function freshAgent() {
  const id = `wt-${n++}`;
  const a = await registerAgent({ name: id, repoPath: "/tmp/np-chk", worktreePath: `/tmp/np-chk/${id}` });
  return a.id;
}

test("formatMemoryNudge renders the signals and the remember instruction", () => {
  const reason = formatMemoryNudge({
    shouldNudge: true,
    decisions: 1,
    handoffs: 0,
    changedFiles: 6,
    signals: ["1 decision(s) recorded", "6 changed file(s)"],
  });
  expect(reason).toContain("1 decision(s) recorded");
  expect(reason).toContain("6 changed file(s)");
  expect(reason).toContain("memory");
  expect(reason).toContain("remember");
  expect(reason).toContain("episode");
});

test("recorded a decision, saved no memory ⇒ nudge", async () => {
  const agent = await freshAgent();
  recordDecision({ createdBy: agent, title: "use RRF fusion for hybrid recall" });

  const status = memoryCheckpointStatus(agent, { ack: false });
  expect(status.shouldNudge).toBe(true);
  expect(status.decisions).toBe(1);
  expect(status.signals.join(" ")).toContain("decision");
});

test("substantial file changes, no memory ⇒ nudge", async () => {
  const agent = await freshAgent();
  getDb()
    .insert(agentWorktreeState)
    .values({ agentId: agent, repoId: "r", changedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"], updatedAt: nowIso() })
    .run();

  const status = memoryCheckpointStatus(agent, { ack: false });
  expect(status.shouldNudge).toBe(true);
  expect(status.changedFiles).toBe(4);
});

test("writing a memory clears the signal", async () => {
  const agent = await freshAgent();
  recordDecision({ createdBy: agent, title: "cache invalidation keyed on contract hash" });
  expect(memoryCheckpointStatus(agent, { ack: false }).shouldNudge).toBe(true);

  await remember({ authorAgentId: agent, kind: "episode", body: "recorded the cache-key decision; landed core change" });
  expect(memoryCheckpointStatus(agent, { ack: false }).shouldNudge).toBe(false);
});

test("acking a nudge suppresses re-nudge for the same work (no nagging)", async () => {
  const agent = await freshAgent();
  recordDecision({ createdBy: agent, title: "one-time ruling" });

  // First check acks the cursor…
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(true);
  // …so a follow-up with no new work does not re-nudge.
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);
});

test("acking suppresses re-nudge for persistent uncommitted file changes", async () => {
  const agent = await freshAgent();
  getDb()
    .insert(agentWorktreeState)
    .values({ agentId: agent, repoId: "r", changedFiles: ["x.ts", "y.ts", "z.ts"], updatedAt: nowIso() })
    .run();

  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(true);
  // Files are still changed, but not re-sensed since the nudge → no nag.
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);
});

test("regression: a persistently dirty worktree is nudged at most once per memory cycle", async () => {
  const agent = await freshAgent();
  const setUpdatedAt = (updatedAt: string) =>
    getDb()
      .insert(agentWorktreeState)
      .values({ agentId: agent, repoId: "r", changedFiles: ["a.ts", "b.ts", "c.ts"], updatedAt })
      .onConflictDoUpdate({ target: agentWorktreeState.agentId, set: { updatedAt } })
      .run();

  // Dirty worktree, no memory → first nudge.
  setUpdatedAt("2026-01-01T00:00:00.000Z");
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(true);

  // The sensing engine used to bump updatedAt every poll; simulate that. It must
  // NOT re-nudge — this was the bug ("23 changed file(s)" every single turn).
  setUpdatedAt("2026-01-01T00:05:00.000Z");
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);
  setUpdatedAt("2026-01-01T00:10:00.000Z");
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);

  // Agent saves a memory → the cycle resets, but the same (older) file set must
  // not immediately re-nudge.
  await Bun.sleep(5);
  await remember({ authorAgentId: agent, kind: "episode", body: "saved progress" });
  await Bun.sleep(5);
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);

  // Genuinely NEW changes after the memory → exactly one more nudge, then quiet.
  setUpdatedAt("2999-01-01T00:00:00.000Z");
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(true);
  setUpdatedAt("2999-01-01T00:05:00.000Z");
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);
});

test("quiet agent with no memory-worthy work ⇒ no nudge", async () => {
  const agent = await freshAgent();
  expect(memoryCheckpointStatus(agent, { ack: true }).shouldNudge).toBe(false);
});

test("unknown agent ⇒ no nudge", () => {
  expect(memoryCheckpointStatus("agent_does_not_exist", { ack: true }).shouldNudge).toBe(false);
});
