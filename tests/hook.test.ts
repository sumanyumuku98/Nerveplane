import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent, agentByWorktree } from "../src/core/registry.ts";
import { emitEvent } from "../src/core/events.ts";
import { peek } from "../src/core/inbox.ts";
import { formatHookContext } from "../src/cli/hook.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-hook-")), "test.db"));
runMigrations();

test("formatHookContext renders priority, summary, required action and reason", () => {
  const ctx = formatHookContext([
    { eventId: "e1", type: "semantic_conflict_detected", severity: "high", priority: "high", summary: "X and Y both edit src/a.ts", body: null, affectedFiles: ["src/a.ts"], affectedContracts: null, reason: "active in the same repository", requiredAction: "coordinate before editing", createdAt: "now" },
  ]);
  expect(ctx).toContain("high-priority coordination warning");
  expect(ctx).toContain("X and Y both edit src/a.ts");
  expect(ctx).toContain("required: coordinate before editing");
  expect(ctx).toContain("why: active in the same repository");
});

test("hook data path: resolve agent by worktree → peek high → inject", async () => {
  const wt = mkdtempSync(join(tmpdir(), "np-hook-wt-"));
  const agent = await registerAgent({ name: "frontend", repoPath: wt, worktreePath: wt });

  // A high-severity warning is routed to this agent (as conflict detection would).
  emitEvent(
    {
      type: "semantic_conflict_detected",
      severity: "high",
      summary: "billing-service changed POST /invoices",
      requiredAction: "update consumer before merge",
    },
    { explicitRecipientIds: [agent.id] },
  );

  // The hook resolves the agent from the worktree path…
  const resolved = agentByWorktree(wt);
  expect(resolved?.id).toBe(agent.id);

  // …peeks high-severity unread (acking) and injects.
  const updates = peek(resolved!.id, "high", true);
  expect(updates.length).toBe(1);
  const ctx = formatHookContext(updates);
  expect(ctx).toContain("billing-service changed POST /invoices");

  // Acked → a second peek is empty (no repeat-injection on every tool call).
  expect(peek(resolved!.id, "high", true).length).toBe(0);
});
