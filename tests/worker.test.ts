import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent } from "../src/core/registry.ts";
import { sendMessage, markMessagesRead } from "../src/core/inbox.ts";
import { emitEvent } from "../src/core/events.ts";
import { waitForWork } from "../src/core/worker.ts";
import { buildWorkerPrompt, buildClaudeArgs } from "../src/cli/worker.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-worker-")), "test.db"));
runMigrations();

const REPO = mkdtempSync(join(tmpdir(), "np-worker-repo-"));
async function pair(s: string) {
  const a = await registerAgent({ name: "a" + s, repoPath: REPO, worktreePath: REPO + "/wt-a-" + s });
  const b = await registerAgent({ name: "b" + s, repoPath: REPO, worktreePath: REPO + "/wt-b-" + s });
  return { a, b };
}

test("buildWorkerPrompt includes the agent id, message bodies, and thread ids", () => {
  const p = buildWorkerPrompt(
    {
      messages: [{ id: "m1", threadId: "thr_x", from: "backend", subject: "API", body: "bump the version", priority: "high", createdAt: "now" }],
      updates: [{ eventId: "e1", type: "semantic_conflict_detected", severity: "high", priority: "high", summary: "X and Y edit a.ts", body: null, affectedFiles: null, affectedContracts: null, reason: null, requiredAction: "coordinate", createdAt: "now" }],
      timedOut: false,
    },
    "agent_self",
  );
  expect(p).toContain("agent_self");
  expect(p).toContain("bump the version");
  expect(p).toContain("thr_x");
  expect(p).toContain("coordinate");
  expect(p).toContain("chat"); // tells it how to reply
});

test("buildClaudeArgs defaults grant the nerveplane MCP tools non-interactively", () => {
  // The fix: without these defaults, headless claude blocks MCP tool calls
  // ("pending permission") and the worker can never reply.
  const def = buildClaudeArgs("hi", undefined, {});
  expect(def[def.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  expect(def[def.indexOf("--allowedTools") + 1]).toBe("mcp__nerveplane");
});

test("buildClaudeArgs sets permission mode, mcp-config, allowed tools, and resume", () => {
  const args = buildClaudeArgs("hi", "sess-123", { permissionMode: "dontAsk", allowedTools: "Read", mcpConfig: "{}" });
  expect(args[0]).toBe("-p");
  expect(args).toContain("--output-format");
  expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
  expect(args[args.indexOf("--resume") + 1]).toBe("sess-123");
  // no --resume when there's no session id
  expect(buildClaudeArgs("hi", undefined, {}).includes("--resume")).toBe(false);
});

test("waitForWork returns immediately on an unread DM", async () => {
  const { a, b } = await pair("1");
  sendMessage({ senderAgentId: a.id, recipientAgentId: b.id, body: "ping" });
  const r = await waitForWork(b.id, { timeoutMs: 2000 });
  expect(r.timedOut).toBe(false);
  expect(r.messages.some((m) => m.body === "ping")).toBe(true);
});

test("waitForWork wakes on a DM that arrives mid-wait", async () => {
  const { a, b } = await pair("2");
  const waiting = waitForWork(b.id, { timeoutMs: 3000 });
  setTimeout(() => sendMessage({ senderAgentId: a.id, recipientAgentId: b.id, body: "live" }), 50);
  const r = await waiting;
  expect(r.timedOut).toBe(false);
  expect(r.messages.some((m) => m.body === "live")).toBe(true);
});

test("waitForWork wakes on a HIGH-severity routed event", async () => {
  const { a, b } = await pair("3");
  const waiting = waitForWork(b.id, { timeoutMs: 3000 });
  setTimeout(
    () =>
      emitEvent(
        { type: "semantic_conflict_detected", producerAgentId: a.id, severity: "high", summary: "conflict on a.ts", requiredAction: "coordinate" },
        { explicitRecipientIds: [b.id] },
      ),
    50,
  );
  const r = await waiting;
  expect(r.timedOut).toBe(false);
  expect(r.updates.some((u) => u.summary.includes("conflict on a.ts"))).toBe(true);
});

test("cost guard: an info event does NOT wake a worker (times out)", async () => {
  const { a, b } = await pair("4");
  const waiting = waitForWork(b.id, { timeoutMs: 1200 });
  setTimeout(
    () => emitEvent({ type: "files_changed", producerAgentId: a.id, severity: "info", summary: "routine edit" }, { explicitRecipientIds: [b.id] }),
    50,
  );
  const r = await waiting;
  expect(r.timedOut).toBe(true);
  expect(r.messages.length + r.updates.length).toBe(0);
});

test("markMessagesRead acks specific DMs so waitForWork won't re-return them", async () => {
  const { a, b } = await pair("ack");
  const { id } = sendMessage({ senderAgentId: a.id, recipientAgentId: b.id, body: "handle me" });
  let r = await waitForWork(b.id, { timeoutMs: 1000 });
  expect(r.messages.some((m) => m.id === id)).toBe(true); // present before ack
  expect(markMessagesRead([id])).toBe(1);
  r = await waitForWork(b.id, { timeoutMs: 1000 });
  expect(r.messages.some((m) => m.id === id)).toBe(false); // acked → gone
});
