import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { buildApp } from "../src/http/app.ts";
import { registerAgent } from "../src/core/registry.ts";
import { recordDecision } from "../src/core/decisions.ts";
import { emitEvent, bus } from "../src/core/events.ts";
import { syncAgent } from "../src/core/inbox.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-dash-")), "test.db"));
runMigrations();
const app = buildApp();

test("dashboard snapshot returns all sections", async () => {
  const res = await app.request("/api/v1/dashboard");
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  for (const key of ["agents", "tasks", "events", "conflicts", "decisions", "services", "contracts"]) {
    expect(body).toHaveProperty(key);
  }
});

test("decision status action approves/rejects a decision", async () => {
  const d = recordDecision({ title: "use fluencyScore", createdBy: "human" });
  const res = await app.request(`/api/v1/decisions/${d.id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "rejected" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { decision: { status: string } };
  expect(body.decision.status).toBe("rejected");
});

test("announce broadcasts to all active agents", async () => {
  const a = await registerAgent({ name: "ann-a", repoPath: mkdtempSync(join(tmpdir(), "np-dash-a-")) });
  const b = await registerAgent({ name: "ann-b", repoPath: mkdtempSync(join(tmpdir(), "np-dash-b-")) });
  const res = await app.request("/api/v1/announce", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "deploy freeze", body: "no merges until 5pm", priority: "high" }),
  });
  const body = (await res.json()) as { sent: number };
  expect(body.sent).toBeGreaterThanOrEqual(2);
  expect(syncAgent(a.id).messages.some((m) => m.subject === "deploy freeze")).toBe(true);
  expect(syncAgent(b.id).messages.some((m) => m.subject === "deploy freeze")).toBe(true);
});

test("event bus notifies SSE subscribers on emit", () => {
  const got: string[] = [];
  const unsub = bus.subscribe((e) => got.push(e.type));
  emitEvent({ type: "decision_recorded", severity: "info", summary: "x" });
  unsub();
  expect(got).toContain("decision_recorded");
});
