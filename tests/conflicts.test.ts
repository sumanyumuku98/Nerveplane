import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { agentWorktreeState, conflictWarnings } from "../src/storage/schema.ts";
import { registerAgent } from "../src/core/registry.ts";
import { detectConflictsForRepo } from "../src/conflicts/detect.ts";
import { dismissConflict, listConflicts } from "../src/core/conflicts.ts";
import { nowIso } from "../src/core/util.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-cfl-")), "test.db"));
runMigrations();

function setState(agentId: string, repoId: string, files: string[]) {
  const db = getDb();
  db.insert(agentWorktreeState)
    .values({ agentId, repoId, changedFiles: files, branch: "feat", headSha: null, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: agentWorktreeState.agentId, set: { changedFiles: files, repoId, updatedAt: nowIso() } })
    .run();
}

async function pair(repoSlug: string) {
  const REPO = join(mkdtempSync(join(tmpdir(), "np-cfl-repo-")), repoSlug);
  const a = await registerAgent({ name: "a-" + repoSlug, repoPath: REPO, worktreePath: REPO + "/wt-a" });
  const b = await registerAgent({ name: "b-" + repoSlug, repoPath: REPO, worktreePath: REPO + "/wt-b" });
  return { a, b, repoId: a.repoId! };
}

test("same-file overlap → one high warning routed to both agents", async () => {
  const { a, b, repoId } = await pair("sf");
  setState(a.id, repoId, ["src/x.ts"]);
  setState(b.id, repoId, ["src/x.ts", "src/other.ts"]);

  const created = detectConflictsForRepo(repoId);
  expect(created.length).toBe(1);
  expect(created[0]!.type).toBe("same_file");
  expect(created[0]!.severity).toBe("high");
  expect(new Set(created[0]!.agentIds ?? [])).toEqual(new Set([a.id, b.id]));
  expect((created[0]!.evidence as { shared_files: string[] }).shared_files).toEqual(["src/x.ts"]);
});

test("dedup: a second pass with the same overlap creates nothing new", async () => {
  const { a, b, repoId } = await pair("dd");
  setState(a.id, repoId, ["src/y.ts"]);
  setState(b.id, repoId, ["src/y.ts"]);
  expect(detectConflictsForRepo(repoId).length).toBe(1);
  expect(detectConflictsForRepo(repoId).length).toBe(0); // already open → no re-warn
});

test("dismiss suppresses future re-raises of the same overlap", async () => {
  const { a, b, repoId } = await pair("dm");
  setState(a.id, repoId, ["src/z.ts"]);
  setState(b.id, repoId, ["src/z.ts"]);
  const created = detectConflictsForRepo(repoId);
  expect(dismissConflict(created[0]!.id)).toBe(true);
  // Overlap still present, but it's suppressed → no new warning.
  expect(detectConflictsForRepo(repoId).length).toBe(0);
  expect(listConflicts({ status: "open", repoId }).length).toBe(0);
});

test("auto-resolve: overlap disappearing flips the warning to resolved", async () => {
  const { a, b, repoId } = await pair("ar");
  setState(a.id, repoId, ["src/w.ts"]);
  setState(b.id, repoId, ["src/w.ts"]);
  const created = detectConflictsForRepo(repoId);
  expect(created.length).toBe(1);

  // b moves off the shared file → next pass should resolve the open warning.
  setState(b.id, repoId, ["src/elsewhere.ts"]);
  detectConflictsForRepo(repoId);
  const w = getDb().select().from(conflictWarnings).where(eq(conflictWarnings.id, created[0]!.id)).get();
  expect(w?.status).toBe("resolved");
});
