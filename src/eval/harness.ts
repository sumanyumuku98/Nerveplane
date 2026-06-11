import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { registerAgent } from "../core/registry.ts";
import { senseAgent, resetSensing } from "../repo/sensing.ts";
import { resetPackageCache } from "../repo/packages.ts";
import { detectConflictsForRepo, type ConflictKind } from "../conflicts/detect.ts";

/**
 * Deterministic conflict-detection eval (plan M2.6). Builds a real git repo with
 * N worktrees, applies scripted edits with ground-truth labels, drives sensing +
 * detection directly (no timer, no live LLM), and scores precision / recall /
 * noise. This is the M2 quality gate; dmux dogfooding is the separate
 * qualitative check.
 */

export interface ScenarioAgent {
  name: string;
  edits: string[]; // repo-relative files this agent creates/edits
}
export interface ExpectedConflict {
  agents: [string, string];
  kind: ConflictKind;
}
export interface ScenarioSpec {
  name: string;
  manifests?: string[]; // dirs seeded with a package.json so they count as packages
  agents: ScenarioAgent[];
  expect: ExpectedConflict[];
  assertNoDuplicateOnRerun?: boolean;
}

export interface ScenarioResult {
  name: string;
  tp: number;
  fp: number;
  fn: number;
  produced: number;
  duplicateOnRerun: number;
  pass: boolean;
  detail: string[];
}

export interface EvalReport {
  scenarios: ScenarioResult[];
  precision: number;
  recall: number;
  noiseRate: number;
  pass: boolean;
}

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

function writeFileMk(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function normalizePair(a: string, b: string): string {
  return [a, b].sort().join("+");
}

export async function runScenario(spec: ScenarioSpec): Promise<ScenarioResult> {
  const repo = mkdtempSync(join(tmpdir(), "np-eval-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "eval@np.dev");
  git(repo, "config", "user.name", "eval");
  writeFileMk(join(repo, "README.md"), "# eval\n");
  for (const dir of spec.manifests ?? []) {
    writeFileMk(join(repo, dir, "package.json"), JSON.stringify({ name: dir.replace(/\W/g, "-") }) + "\n");
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");

  resetSensing();
  resetPackageCache();

  // Each agent gets its own worktree + branch; apply its edits there.
  const idByName = new Map<string, string>();
  let repoId = "";
  const root = mkdtempSync(join(tmpdir(), "np-eval-wt-"));
  for (const a of spec.agents) {
    const wt = join(root, a.name);
    git(repo, "worktree", "add", "-q", "-b", `feat-${a.name}`, wt);
    const agent = await registerAgent({ name: a.name, repoPath: wt, worktreePath: wt, branch: `feat-${a.name}`, baseBranch: "main" });
    idByName.set(a.name, agent.id);
    repoId = agent.repoId!;
    for (const f of a.edits) writeFileMk(join(wt, f), `// ${a.name} edit\n`);
    await senseAgent(agent.id, wt, agent.repoId!, "main", a.name); // persists changed-file state
  }

  const produced = detectConflictsForRepo(repoId);

  // Build the produced set as normalized (pair, kind) keys.
  const nameById = new Map([...idByName.entries()].map(([n, id]) => [id, n]));
  const producedKeys = new Set(
    produced.map((w) => {
      const [x, y] = (w.agentIds ?? []).map((id) => nameById.get(id) ?? id);
      return `${normalizePair(x!, y!)}|${w.type}`;
    }),
  );
  const expectedKeys = new Set(spec.expect.map((e) => `${normalizePair(e.agents[0], e.agents[1])}|${e.kind}`));

  let tp = 0;
  const detail: string[] = [];
  for (const k of expectedKeys) {
    if (producedKeys.has(k)) tp++;
    else detail.push(`MISSED ${k}`);
  }
  let fp = 0;
  for (const k of producedKeys) {
    if (!expectedKeys.has(k)) {
      fp++;
      detail.push(`SPURIOUS ${k}`);
    }
  }
  const fn = expectedKeys.size - tp;

  let duplicateOnRerun = 0;
  if (spec.assertNoDuplicateOnRerun) {
    duplicateOnRerun = detectConflictsForRepo(repoId).length;
    if (duplicateOnRerun > 0) detail.push(`DUPLICATES on rerun: ${duplicateOnRerun}`);
  }

  const pass = fp === 0 && fn === 0 && duplicateOnRerun === 0;
  return { name: spec.name, tp, fp, fn, produced: produced.length, duplicateOnRerun, pass, detail };
}

export const SCENARIOS: ScenarioSpec[] = [
  {
    name: "same-file → 1 high",
    agents: [
      { name: "alpha", edits: ["src/core/report.ts"] },
      { name: "beta", edits: ["src/core/report.ts"] },
    ],
    expect: [{ agents: ["alpha", "beta"], kind: "same_file" }],
    assertNoDuplicateOnRerun: true,
  },
  {
    name: "same-package, different files → 1 medium",
    manifests: ["src/billing"],
    agents: [
      { name: "alpha", edits: ["src/billing/invoice.ts"] },
      { name: "beta", edits: ["src/billing/tax.ts"] },
    ],
    expect: [{ agents: ["alpha", "beta"], kind: "same_package" }],
  },
  {
    name: "different packages → 0 (noise check)",
    manifests: ["src/billing", "src/checkout"],
    agents: [
      { name: "alpha", edits: ["src/billing/invoice.ts"] },
      { name: "beta", edits: ["src/checkout/cart.ts"] },
    ],
    expect: [],
  },
  {
    name: "refactor + one shared file → 1 high, not N",
    manifests: ["src/a", "src/b", "src/c"],
    agents: [
      { name: "alpha", edits: ["src/a/x.ts", "src/b/y.ts", "src/c/z.ts", "src/shared.ts"] },
      { name: "beta", edits: ["src/shared.ts"] },
    ],
    expect: [{ agents: ["alpha", "beta"], kind: "same_file" }],
  },
  {
    name: "3 agents, only A&B share a file",
    manifests: ["src/x", "src/z"],
    agents: [
      { name: "alpha", edits: ["src/x/a.ts"] },
      { name: "beta", edits: ["src/x/a.ts"] },
      { name: "gamma", edits: ["src/z/g.ts"] },
    ],
    expect: [{ agents: ["alpha", "beta"], kind: "same_file" }],
  },
];

export async function runEval(scenarios: ScenarioSpec[] = SCENARIOS): Promise<EvalReport> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) results.push(await runScenario(s));

  const tp = results.reduce((n, r) => n + r.tp, 0);
  const fp = results.reduce((n, r) => n + r.fp, 0);
  const fn = results.reduce((n, r) => n + r.fn, 0);
  const produced = results.reduce((n, r) => n + r.produced, 0);

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const noiseRate = produced === 0 ? 0 : fp / produced;
  const pass = results.every((r) => r.pass);
  return { scenarios: results, precision, recall, noiseRate, pass };
}
