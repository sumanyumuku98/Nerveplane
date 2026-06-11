import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { senseAgent, resetSensing } from "../src/repo/sensing.ts";
import { recentEvents } from "../src/core/events.ts";
import { getWorktreeState, getRepoInfo } from "../src/repo/git.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-sense-")), "test.db"));
runMigrations();

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "np-gitrepo-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.dev");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "# base\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}

test("git helpers read worktree state and canonical repo root", async () => {
  const dir = makeRepo();
  const info = await getRepoInfo(dir);
  expect(info?.root).toBeTruthy();
  expect(info?.defaultBranch).toBe("main");

  writeFileSync(join(dir, "new.ts"), "export const x = 1;\n");
  const state = await getWorktreeState(dir, "main");
  expect(state.changedFiles).toContain("new.ts");
});

test("sensing emits a files_changed event only after a change appears", async () => {
  const dir = makeRepo();
  resetSensing();

  // Baseline: clean tree → no event.
  const first = await senseAgent("agent_sense", dir, "repo_sense", "main", "tester");
  expect(first).toBe(0);

  // Agent edits a file → next sense emits exactly one event.
  writeFileSync(join(dir, "feature.ts"), "export const feature = true;\n");
  const second = await senseAgent("agent_sense", dir, "repo_sense", "main", "tester");
  expect(second).toBe(1);

  const evt = recentEvents(10).find((e) => e.type === "files_changed" && e.producerAgentId === "agent_sense");
  expect(evt).toBeTruthy();
  expect(evt!.affectedFiles).toContain("feature.ts");
  expect(evt!.summary).toContain("tester changed");

  // No further change → no new event.
  const third = await senseAgent("agent_sense", dir, "repo_sense", "main", "tester");
  expect(third).toBe(0);
});
