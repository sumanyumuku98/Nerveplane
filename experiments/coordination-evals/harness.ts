/**
 * Tier-A deterministic coordination eval harness (research spike).
 *
 * Measures OUTCOMES (not just detection) of parallel agents WITH vs WITHOUT
 * Nerveplane, on scripted multi-agent scenarios. Two conditions:
 *   C0 = uncoordinated: agents make their naive edits blind to each other.
 *   C1 = Nerveplane on: the real sensing/detection surfaces a prior agent's
 *        change, and an agent that is warned before it edits takes its
 *        *coordinated* edit instead — modeling agent reaction deterministically.
 *
 * It drives the product's REAL primitives (registerAgent, senseAgent,
 * detectConflictsForRepo, recentEvents) on real temp git repos/worktrees, then
 * integrates the branches (git merge) and scores conflicts / wasted-work / CTSR.
 * Deterministic + CI-safe; Tier B (live agents) validates externally.
 *
 * NOTE: lives under experiments/ — never shipped (not in package.json files);
 * imports the product's core but the product never imports it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { getDb } from "../../src/storage/db.ts";
import { runMigrations } from "../../src/storage/migrate.ts";
import { registerAgent } from "../../src/core/registry.ts";
import { senseAgent, resetSensing } from "../../src/repo/sensing.ts";
import { detectConflictsForRepo } from "../../src/conflicts/detect.ts";
import { recentEvents } from "../../src/core/events.ts";
import { resetPackageCache } from "../../src/repo/packages.ts";

export type Condition = "C0" | "C1";
export type FileMap = Record<string, string>;

export interface ScenarioAgent {
  name: string;
  /** files this agent will touch (used to model the coordination signal) */
  touches: string[];
  /** contract files this agent depends on being current (for contract scenarios) */
  consumes?: string[];
  /** the edit when the agent is unaware of teammates (C0, or C1-but-not-warned) */
  naive: FileMap;
  /** the edit when Nerveplane warned the agent in time (C1) */
  coordinated: FileMap;
}

export interface Scenario {
  name: string;
  dependencyClass: string;
  /** files committed to the base repo before agents fork worktrees */
  base?: FileMap;
  manifests?: string[];
  agents: ScenarioAgent[];
  /** which agent names SHOULD be warned in C1 (for routing-accuracy) */
  expectWarned?: string[];
  /**
   * Post-integration acceptance check on the merged tree. Return true = pass.
   * Used for semantic/contract correctness the git merge alone can't see.
   */
  accept?: (mergedRepo: string) => boolean;
}

export interface Outcome {
  scenario: string;
  condition: Condition;
  ctsr: boolean; // clean merge AND accept()
  mergeConflicts: number;
  acceptPass: boolean;
  wastedLoc: number; // edits thrown away (naive edit that had to be redone)
  warnedAgents: string[]; // agents Nerveplane warned before they edited (C1)
  routingHit: number; // |warned ∩ expectWarned| / |expectWarned|  (NaN if none expected)
  routingFalse: number; // |warned \ expectWarned| / |warned|
}

// --- git + fs helpers (local; mirror src/eval/harness.ts) ---
function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
}
function gitOk(cwd: string, ...args: string[]): void {
  const r = git(cwd, ...args);
  if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.out}`);
}
function writeFileMk(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
function applyEdits(root: string, edits: FileMap): void {
  for (const [f, c] of Object.entries(edits)) writeFileMk(join(root, f), c);
}
function loc(edits: FileMap): number {
  return Object.values(edits).reduce((n, c) => n + c.split("\n").length, 0);
}

/**
 * Did Nerveplane surface, before `agent` edits, a change that affects it?
 * Uses the REAL routed signal: a prior agent's `files_changed` event touching a
 * file this agent will `touch` (same-file) or a contract it `consumes`.
 */
function warnedBeforeEditing(agent: ScenarioAgent, repoId: string): boolean {
  const relevant = new Set([...agent.touches, ...(agent.consumes ?? [])]);
  for (const e of recentEvents(200)) {
    if (e.type !== "files_changed") continue;
    if (!(e.repoScope ?? []).includes(repoId)) continue; // scope to this scenario's repo
    for (const f of e.affectedFiles ?? []) if (relevant.has(f)) return true;
  }
  return false;
}

async function runOne(spec: Scenario, condition: Condition): Promise<Outcome> {
  const db = getDb();
  void db;
  resetSensing();
  resetPackageCache();

  const repo = mkdtempSync(join(tmpdir(), "np-bench-"));
  gitOk(repo, "init", "-q", "-b", "main");
  gitOk(repo, "config", "user.email", "bench@np.dev");
  gitOk(repo, "config", "user.name", "bench");
  writeFileMk(join(repo, "README.md"), "# bench\n");
  applyEdits(repo, spec.base ?? {});
  for (const dir of spec.manifests ?? []) writeFileMk(join(repo, dir, "package.json"), JSON.stringify({ name: dir.replace(/\W/g, "-") }) + "\n");
  gitOk(repo, "add", "-A");
  gitOk(repo, "commit", "-q", "-m", "base");

  const root = mkdtempSync(join(tmpdir(), "np-bench-wt-"));
  const branches: string[] = [];
  let repoId = "";
  let wastedLoc = 0;
  const warned: string[] = [];

  // Agents act in order. In C1, an agent that was warned by a prior agent's
  // sensed change takes its coordinated (non-conflicting) edit.
  for (const a of spec.agents) {
    const wt = join(root, a.name);
    const branch = `feat-${a.name}`;
    gitOk(repo, "worktree", "add", "-q", "-b", branch, wt);
    const agent = await registerAgent({ name: `${spec.name}-${a.name}`, repoPath: wt, worktreePath: wt, branch, baseBranch: "main" });
    repoId = agent.repoId!;

    // senseAgent treats the FIRST observation as a baseline (no event); the real
    // daemon polls repeatedly. So establish a clean baseline, decide, edit, then
    // sense again so the post-edit change emits a files_changed event.
    if (condition === "C1") await senseAgent(agent.id, wt, repoId, "main", a.name); // baseline (clean → no event)

    const isWarned = condition === "C1" && warnedBeforeEditing(a, repoId);
    if (isWarned) warned.push(a.name);
    const edits = isWarned ? a.coordinated : a.naive;
    applyEdits(wt, edits);
    gitOk(wt, "add", "-A");
    gitOk(wt, "commit", "-q", "--allow-empty", "-m", `${a.name}`); // a no-op naive edit still forms a branch
    branches.push(branch);

    if (condition === "C1") await senseAgent(agent.id, wt, repoId, "main", a.name); // post-edit → emits files_changed
  }

  if (condition === "C1") detectConflictsForRepo(repoId); // materialize warnings (routing)

  // Integrate: merge each branch into a fresh integration branch off main.
  const intg = mkdtempSync(join(tmpdir(), "np-bench-intg-"));
  gitOk(repo, "worktree", "add", "-q", "-b", "integration", intg);
  let mergeConflicts = 0;
  for (const b of branches) {
    const m = git(intg, "merge", "--no-edit", b);
    if (!m.ok) {
      mergeConflicts++;
      // count wasted LOC = the conflicting side's edit that must be reworked
      const a = spec.agents.find((x) => `feat-${x.name}` === b);
      if (a) wastedLoc += loc(a.naive);
      gitOk(intg, "merge", "--abort");
    }
  }
  const acceptPass = spec.accept ? spec.accept(intg) : true;
  const ctsr = mergeConflicts === 0 && acceptPass;

  const expected = new Set(spec.expectWarned ?? []);
  const routingHit = expected.size ? warned.filter((w) => expected.has(w)).length / expected.size : NaN;
  const routingFalse = warned.length ? warned.filter((w) => !expected.has(w)).length / warned.length : 0;

  return { scenario: spec.name, condition, ctsr, mergeConflicts, acceptPass, wastedLoc, warnedAgents: warned, routingHit, routingFalse };
}

export async function runScenarioBothConditions(spec: Scenario): Promise<{ c0: Outcome; c1: Outcome }> {
  const c0 = await runOne(spec, "C0");
  const c1 = await runOne(spec, "C1");
  return { c0, c1 };
}

/** Read a merged file (for accept() checks). */
export function readMerged(repo: string, file: string): string {
  const p = join(repo, file);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/** One-time DB init for a run. */
export function initBenchDb(): void {
  getDb(join(mkdtempSync(join(tmpdir(), "np-bench-db-")), "bench.db"));
  runMigrations();
}
