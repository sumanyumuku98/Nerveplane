import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent } from "../src/core/registry.ts";
import { remember, recall, listMemories, forget } from "../src/core/memory.ts";
import { toMatchExpr } from "../src/memory/backend.ts";
import { coreCtx } from "../src/mcp/core-ctx.ts";
import { formatSessionContext } from "../src/cli/session-start.ts";
import { buildWorkerPrompt } from "../src/cli/worker.ts";

// Real temp DB + migrations — the codebase's integration harness (see coordination.test.ts).
getDb(join(mkdtempSync(join(tmpdir(), "np-mem-")), "test.db"));
runMigrations();

// ---------------- Unit (pure) ----------------
test("toMatchExpr tokenizes to a safe OR-of-quoted-terms and drops operators", () => {
  expect(toMatchExpr("payment retries")).toBe('"payment" OR "retries"');
  expect(toMatchExpr('AuthClient "OR" *')).toBe('"authclient" OR "or"'); // lowercased, quotes/stars stripped
  expect(toMatchExpr("   ")).toBe("");
});

test("formatSessionContext is byte-identical with no memories (golden guard)", () => {
  const legacy = formatSessionContext("alpha", [{ name: "beta" }]);
  expect(legacy).toBe(
    '🧠 Nerveplane: auto-registered as "alpha". Call the `register` tool to add your capabilities and current task. 1 other agent(s) active: beta — call `sync` before editing.',
  );
  expect(legacy).not.toContain("📓");
  // with memories → adds the recall + resume block
  const withMem = formatSessionContext("alpha", [], [{ kind: "episode", title: null, body: "done webhook; next: idempotency keys" }]);
  expect(withMem).toContain("📓");
  expect(withMem).toContain("▶ Resume: done webhook; next: idempotency keys");
});

test("buildWorkerPrompt injects memory only when present", () => {
  const work = { messages: [], updates: [], timedOut: false };
  expect(buildWorkerPrompt(work, "ag_1")).not.toContain("📓 Relevant memory");
  const withMem = buildWorkerPrompt(work, "ag_1", [{ kind: "fact", title: "auth", body: "use src/lib/authClient" }]);
  expect(withMem).toContain("📓 Relevant memory");
  expect(withMem).toContain("[fact] auth: use src/lib/authClient");
});

// ---------------- Integration (through core + storage + FTS) ----------------
test("round-trip: remember → recall (FTS) → forget", async () => {
  const rec = await remember({ authorAgentId: "ag_a", kind: "fact", title: "auth pattern", body: "auth goes through src/lib/authClient, do not roll your own", repoId: "repoRT" });
  const hits = await recall("auth", { repoId: "repoRT" });
  expect(hits.map((h) => h.id)).toContain(rec.id);
  // a non-matching query in-scope returns nothing for this term
  expect((await recall("kubernetes", { repoId: "repoRT" })).length).toBe(0);
  expect(await forget(rec.id)).toBe(true);
  expect((await recall("auth", { repoId: "repoRT" })).length).toBe(0);
});

test("FTS ranks the keyword hit above a non-match, scoped", async () => {
  await remember({ body: "the deploy pipeline tags a release and publishes to npm", repoId: "repoRank" });
  await remember({ body: "auth tokens use a 15 minute JWT expiry", repoId: "repoRank" });
  const hits = await recall("deploy release", { repoId: "repoRank" });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]!.body).toContain("deploy");
});

test("multi-agent scope isolation: repo-scoped memory recalls for same-repo agents only", async () => {
  const REPO_AB = mkdtempSync(join(tmpdir(), "np-repoab-"));
  const REPO_C = mkdtempSync(join(tmpdir(), "np-repoc-"));
  const a = await registerAgent({ name: "a", repoPath: REPO_AB, worktreePath: REPO_AB + "/wt-a" });
  const b = await registerAgent({ name: "b", repoPath: REPO_AB, worktreePath: REPO_AB + "/wt-b" });
  const c = await registerAgent({ name: "c", repoPath: REPO_C, worktreePath: REPO_C + "/wt-c" });
  expect(a.repoId).toBe(b.repoId);
  expect(a.repoId).not.toBe(c.repoId);

  await remember({ authorAgentId: a.id, kind: "fact", body: "shared: main is in feature freeze this week", repoId: a.repoId! });
  // B (same repo) sees it; C (different repo) does not
  expect((await listMemories({ repoId: b.repoId! })).some((m) => m.body.includes("feature freeze"))).toBe(true);
  expect((await listMemories({ repoId: c.repoId! })).some((m) => m.body.includes("feature freeze"))).toBe(false);
});

test("kind + task scoping filters recall", async () => {
  await remember({ kind: "episode", body: "progress: finished handler", repoId: "repoK", taskId: "T1" });
  await remember({ kind: "fact", body: "fact: retries double-fire on 500", repoId: "repoK", taskId: "T1" });
  expect((await listMemories({ repoId: "repoK", kind: "episode" })).every((m) => m.kind === "episode")).toBe(true);
  expect((await listMemories({ repoId: "repoK", taskId: "T2" })).length).toBe(0);
});

test("memory MCP tool round-trips through coreCtx (real daemon tool path)", async () => {
  await coreCtx.memory({ action: "remember", agent_id: "ag_tool", body: "tool-path memory about caching", repo_id: "repoTool" });
  const out = (await coreCtx.memory({ action: "recall", query: "caching", repo_id: "repoTool" })) as { memories: { body: string }[] };
  expect(out.memories.some((m) => m.body.includes("caching"))).toBe(true);
});

test("cross-CLI continuity: an episode written by one agent resumes another (any CLI)", async () => {
  const REPO = mkdtempSync(join(tmpdir(), "np-cont-"));
  const claude = await registerAgent({ name: "claude", repoPath: REPO, worktreePath: REPO + "/wt" });
  await remember({
    authorAgentId: claude.id,
    kind: "episode",
    taskId: "payments",
    repoId: claude.repoId!,
    body: "done: webhook handler; next: idempotency keys; gotcha: Stripe retries double-fire on 500",
  });

  // A fresh agent's SessionStart recall (author/CLI-agnostic — read by repo).
  const recalled = await recall(undefined, { repoId: claude.repoId! });
  const ctx = formatSessionContext("codex-worker", [], recalled);
  expect(ctx).toContain("▶ Resume:");
  expect(ctx).toContain("idempotency keys");

  // And the worker prompt carries the gotcha.
  const prompt = buildWorkerPrompt({ messages: [], updates: [], timedOut: false }, "codex-worker", recalled);
  expect(prompt).toContain("Stripe retries double-fire");
});

test("pinned memories are boosted in recall order", async () => {
  await remember({ body: "ordinary note one", repoId: "repoPin" });
  await remember({ body: "ordinary note two", repoId: "repoPin" });
  await remember({ body: "pinned convention: use vitest in web", repoId: "repoPin", pinned: true });
  expect((await listMemories({ repoId: "repoPin" }))[0]!.body).toContain("pinned convention");
});
