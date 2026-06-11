import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent } from "../src/core/registry.ts";
import { emitEvent } from "../src/core/events.ts";
import { syncAgent, sendMessage } from "../src/core/inbox.ts";
import { claimTask, handoffTask } from "../src/core/tasks.ts";
import { recordDecision, queryDecisions } from "../src/core/decisions.ts";
import { buildJoinPacket } from "../src/core/join.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-coord-")), "test.db"));
runMigrations();

// Two agents sharing one (non-git) repo path → same repoId.
const REPO = mkdtempSync(join(tmpdir(), "np-repo-"));

async function setup() {
  const a = await registerAgent({ name: "backend", capabilities: ["backend", "openapi"], repoPath: REPO, worktreePath: REPO + "/wt-a", branch: "feat/a", baseBranch: "main" });
  const b = await registerAgent({ name: "frontend", capabilities: ["frontend"], repoPath: REPO, worktreePath: REPO + "/wt-b", branch: "feat/b", baseBranch: "main" });
  expect(a.repoId).toBe(b.repoId);
  return { a, b };
}

test("same-repo event routes to peers but not the producer", async () => {
  const { a, b } = await setup();
  const { recipients } = emitEvent({
    type: "files_changed",
    producerAgentId: a.id,
    severity: "info",
    summary: "backend changed src/api/report.ts",
    repoScope: [a.repoId!],
    affectedFiles: ["src/api/report.ts"],
  });
  expect(recipients).toBe(1); // b only, not a

  const syncB = syncAgent(b.id);
  expect(syncB.updates.length).toBe(1);
  expect(syncB.updates[0]!.summary).toContain("report.ts");
  expect(syncB.updates[0]!.reason).toContain("same repository");

  // Producer sees nothing routed to itself.
  expect(syncAgent(a.id).updates.length).toBe(0);

  // sync acks: a second sync is empty.
  expect(syncAgent(b.id).updates.length).toBe(0);
});

test("durable identity: re-register resumes the same agent row", async () => {
  const first = await registerAgent({ name: "stable", repoPath: REPO, worktreePath: REPO + "/wt-stable" });
  const again = await registerAgent({ name: "stable", repoPath: REPO, worktreePath: REPO + "/wt-stable", capabilities: ["docs"] });
  expect(again.id).toBe(first.id);
  expect(again.capabilities).toContain("docs");
});

test("direct messages arrive via sync", async () => {
  const { a, b } = await setup();
  sendMessage({ senderAgentId: a.id, recipientAgentId: b.id, subject: "heads up", body: "API changing", priority: "high" });
  const s = syncAgent(b.id);
  expect(s.messages.some((m) => m.subject === "heads up")).toBe(true);
});

test("handoff routes to agents with the required capability", async () => {
  const { a } = await setup();
  // a reviewer with the 'frontend' capability already exists (agent b).
  const task = claimTask({ agentId: a.id, title: "build report UI", requiredCapabilities: ["frontend"] });
  handoffTask({ agentId: a.id, taskId: task.id, requiredCapabilities: ["frontend"] });
  // The frontend agent should have a routed handoff request.
  const agents = (await import("../src/core/registry.ts")).discoverAgents({ capability: "frontend" });
  const frontend = agents[0]!;
  const s = syncAgent(frontend.id);
  expect(s.updates.some((u) => u.type === "task_handoff_requested")).toBe(true);
});

test("decision ledger records and queries by scope", async () => {
  recordDecision({ title: "Report API v2 uses fluencyScore", scope: { files: ["src/api/report.ts"] }, createdBy: "backend" });
  const hits = queryDecisions({ file: "src/api/report.ts" });
  expect(hits.some((d) => d.title.includes("fluencyScore"))).toBe(true);
});

test("join packet summarizes active agents and open tasks", async () => {
  const { b } = await setup();
  const packet = buildJoinPacket(b.id);
  expect(packet.active_agents.length).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(packet.open_tasks)).toBe(true);
  expect(Array.isArray(packet.suggested_next_actions)).toBe(true);
});
