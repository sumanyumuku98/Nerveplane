import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent } from "../src/core/registry.ts";
import { sendMessage, peekMessages } from "../src/core/inbox.ts";
import { formatStopReason } from "../src/cli/stop-check.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-stop-")), "test.db"));
runMigrations();

test("formatStopReason renders sender, body, and the reply instruction", () => {
  const reason = formatStopReason([
    { id: "m1", threadId: "t1", from: "backend-agent", subject: "API change", body: "I changed /invoices", priority: "high", createdAt: "now" },
  ]);
  expect(reason).toContain("1 new message(s) from teammates");
  expect(reason).toContain("backend-agent");
  expect(reason).toContain("I changed /invoices");
  expect(reason).toContain("chat"); // tells the agent how to reply
});

test("decision path: unread DM ⇒ block, then acked so it won't re-block", async () => {
  const a = await registerAgent({ name: "sender", repoPath: "/tmp/r", worktreePath: "/tmp/r/wt-a" });
  const b = await registerAgent({ name: "recipient", repoPath: "/tmp/r", worktreePath: "/tmp/r/wt-b" });

  sendMessage({ senderAgentId: a.id, recipientAgentId: b.id, subject: "heads up", body: "ping" });

  // The Stop hook's core query: unread DMs for the agent (acking them).
  const first = peekMessages(b.id, { ack: true });
  expect(first.some((m) => m.body === "ping")).toBe(true);
  const reason = formatStopReason(first);
  expect(reason).toContain("ping"); // would be injected as the block reason

  // Acked → a second check returns nothing, so a follow-up Stop allows idling.
  expect(peekMessages(b.id, { ack: true }).some((m) => m.body === "ping")).toBe(false);
});

test("no unread DMs ⇒ nothing to block on (agent may stop)", async () => {
  const c = await registerAgent({ name: "quiet", repoPath: "/tmp/r", worktreePath: "/tmp/r/wt-c" });
  expect(peekMessages(c.id, { ack: true }).length).toBe(0);
});
