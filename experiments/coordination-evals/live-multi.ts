/**
 * Tier-B live MULTI-AGENT coordination eval (SUM-148) — the pivotal evidence.
 *
 *   NP_EVAL_AGENT=claude bun run experiments/coordination-evals/live-multi.ts
 *
 * Real coding agents concurrently edit a real temp repo under three arms:
 *   C0        — each agent gets only its task (no coordination).
 *   C1-detect — each agent additionally gets a reactive, late/vague warning that
 *               a teammate may be touching the same file.
 *   C1-plan   — each agent gets an explicit planner assignment from buildPlan()
 *               ("you own X; do NOT edit Y; put new work in Z"), decided up front.
 *
 * We then integrate the agents' real branches and score CTSR / merge conflicts /
 * wasted LOC, plus the make-or-break metric: SCOPE-LEAKAGE — did a C1-plan agent
 * edit outside its assigned scope? (If agents leak, the planner degrades to a
 * detector; if they respect scopes, the structural win is real.)
 *
 * Nondeterministic + costs money → env-gated, K seeds, mean ± CI, NOT a CI gate.
 * Agents run headless with `--dangerously-skip-permissions` in an isolated temp
 * git repo (throwaway sandbox) so they can freely edit files.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { getProvider } from "../../src/agents/index.ts";
import { buildPlan, type WorkItem } from "../../src/core/planner.ts";

const REPLY_LOG = process.env.NP_EVAL_LOG ?? "/tmp/np-eval-multi.log";
type Arm = "C0" | "C1-detect" | "C1-plan";
const ARMS: Arm[] = ["C0", "C1-detect", "C1-plan"];

// --- git + fs helpers (local; mirror harness.ts) ---
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

// --- scenario: two agents extend the same report module (same-file contention) ---
interface LiveAgent {
  name: string;
  scope: string[]; // predicted files (σ) — feeds the planner
  task: string; // what the agent is asked to do
}
interface LiveScenario {
  name: string;
  base: Record<string, string>;
  agents: LiveAgent[];
  /** merged tree passes iff both capabilities landed. */
  accept: (repo: string) => boolean;
}

const REPORT_BASE = "export function report(): string {\n  return 'base';\n}\n";
const sharedFile: LiveScenario = {
  name: "shared-file-live",
  base: { "src/report.ts": REPORT_BASE },
  agents: [
    { name: "csv", scope: ["src/report.ts"], task: "Add a CSV export capability to the report module in src/report.ts (export a `csv()` function and have report() be able to use it)." },
    { name: "pdf", scope: ["src/report.ts"], task: "Add a PDF export capability for the report (export a `pdf()` function)." },
  ],
  // pass = both csv and pdf capabilities exist somewhere in src/, tree merged cleanly
  accept: (repo) => {
    const files = ["src/report.ts", "src/report_pdf.ts", "src/pdf.ts", "src/report_csv.ts", "src/csv.ts"];
    const blob = files.map((f) => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), "utf8") : "")).join("\n");
    return /csv/i.test(blob) && /pdf/i.test(blob);
  },
};

/** Per-arm prompt for one agent. C1-plan gets the planner's assignment. */
function promptFor(arm: Arm, agent: LiveAgent, scn: LiveScenario, assignment: { own: string[]; forbidden: string[]; reassigned: boolean } | null): string {
  const preamble = `You are one of several coding agents working concurrently in this repo. Make ONLY the change described, using the smallest edit. Do not run git. Do not touch unrelated files. When done, reply with the file(s) you changed.\n\nTask: ${agent.task}`;
  if (arm === "C0") return preamble;
  if (arm === "C1-detect") {
    const other = scn.agents.find((a) => a.name !== agent.name)!;
    return `${preamble}\n\n⚠️ Nerveplane notice (reactive): another agent (${other.name}) may also be modifying ${agent.scope.join(", ")}. Heads up — coordinate to avoid a conflict if you can.`;
  }
  // C1-plan
  const a = assignment!;
  const ownLine = a.own.length ? `You OWN: ${a.own.join(", ")}.` : "You have no exclusively-owned files.";
  const forbid = a.forbidden.length ? ` Do NOT edit: ${a.forbidden.join(", ")} (another agent owns it). Put your addition in a NEW file instead.` : "";
  return `${preamble}\n\n📋 Coordination plan (assigned up front): ${ownLine}${forbid}`;
}

async function runAgent(agentId: string, prompt: string, cwd: string, label: string): Promise<string> {
  const provider = getProvider(agentId);
  const model = process.env.NP_EVAL_MODEL;
  // Editing-enabled headless argv (sandboxed temp repo): skip permission prompts so
  // the agent can actually write files. NOTE: intentionally bypasses the default
  // `--allowedTools mcp__nerveplane` (which blocks file edits).
  const args = ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"];
  if (model) args.push("--model", model);
  const proc = Bun.spawn([provider.bin, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const reply = provider.parseResult(out).result ?? "";
  try {
    appendFileSync(REPLY_LOG, `\n[${label}] ${JSON.stringify(reply).slice(0, 300)}\n`);
  } catch {
    /* best-effort */
  }
  return reply;
}

interface Outcome {
  ctsr: boolean;
  mergeConflicts: number;
  wastedLoc: number;
  scopeLeaks: number; // # of C1-plan agents that edited a forbidden file (NaN for other arms)
  leakDenom: number; // # of agents with a forbidden set (for a rate)
}

async function runArm(scn: LiveScenario, arm: Arm, agentId: string): Promise<Outcome> {
  // Build a fresh base repo.
  const repo = mkdtempSync(join(tmpdir(), "np-live-"));
  gitOk(repo, "init", "-q", "-b", "main");
  gitOk(repo, "config", "user.email", "b@np.dev");
  gitOk(repo, "config", "user.name", "b");
  for (const [f, c] of Object.entries(scn.base)) writeFileMk(join(repo, f), c);
  gitOk(repo, "add", "-A");
  gitOk(repo, "commit", "-q", "-m", "base");

  // Plan (only used by C1-plan): owner keeps the contested file; others are told
  // to work in a new module.
  const items: WorkItem[] = scn.agents.map((a) => ({ id: a.name, scope: a.scope }));
  const plan = buildPlan(items);

  const root = mkdtempSync(join(tmpdir(), "np-live-wt-"));
  const branches: string[] = [];
  const changedByAgent = new Map<string, string[]>();
  let scopeLeaks = 0;
  let leakDenom = 0;

  for (const a of scn.agents) {
    const wt = join(root, a.name);
    const branch = `feat-${a.name}`;
    gitOk(repo, "worktree", "add", "-q", "-b", branch, wt);

    let assignment: { own: string[]; forbidden: string[]; reassigned: boolean } | null = null;
    if (arm === "C1-plan") {
      const reassigned = plan.reassigned.has(a.name);
      // owner's scope minus this agent's = files this agent must not touch
      const forbidden = reassigned ? a.scope.slice() : [];
      const own = reassigned ? [] : a.scope.slice();
      assignment = { own, forbidden, reassigned };
      if (forbidden.length) leakDenom++;
    }

    const reply = await runAgent(agentId, promptFor(arm, a, scn, assignment), wt, `${scn.name}-${arm}-${a.name}`);
    void reply;

    // What did the agent actually change?
    const changed = git(wt, "status", "--porcelain")
      .out.split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    changedByAgent.set(a.name, changed);

    // Scope-leakage: did a reassigned C1-plan agent edit a forbidden (owned) file?
    if (assignment && assignment.forbidden.length && changed.some((f) => assignment!.forbidden.includes(f))) scopeLeaks++;

    gitOk(wt, "add", "-A");
    gitOk(wt, "commit", "-q", "--allow-empty", "-m", a.name);
    branches.push(branch);
  }

  // Integrate.
  const intg = mkdtempSync(join(tmpdir(), "np-live-intg-"));
  gitOk(repo, "worktree", "add", "-q", "-b", "integration", intg);
  let mergeConflicts = 0;
  let wastedLoc = 0;
  for (const b of branches) {
    const m = git(intg, "merge", "--no-edit", b);
    if (!m.ok) {
      mergeConflicts++;
      const name = b.replace(/^feat-/, "");
      const changed = changedByAgent.get(name) ?? [];
      wastedLoc += changed.reduce((n, f) => n + (existsSync(join(root, name, f)) ? readFileSync(join(root, name, f), "utf8").split("\n").length : 0), 0);
      gitOk(intg, "merge", "--abort");
    }
  }
  const ctsr = mergeConflicts === 0 && scn.accept(intg);
  return { ctsr, mergeConflicts, wastedLoc, scopeLeaks: arm === "C1-plan" ? scopeLeaks : NaN, leakDenom };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function ci95(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  return 1.96 * (sd / Math.sqrt(xs.length));
}

async function main() {
  const agent = process.env.NP_EVAL_AGENT ?? "";
  if (!agent || !getProvider(agent)?.detect()) {
    process.stdout.write(
      [
        "Tier-B live MULTI-AGENT eval requires a real agent CLI + key.",
        "  export NP_EVAL_AGENT=claude   # (codex|opencode also work)",
        "  [export NP_EVAL_MODEL=haiku]  # optional model override",
        "  [export NP_EVAL_SEEDS=5]      # K seeds (default 5)",
        "  bun run experiments/coordination-evals/live-multi.ts",
        "",
        "Runs 3 arms (C0 / C1-detect / C1-plan) on the shared-file scenario with real",
        "agents editing a throwaway repo; reports CTSR, conflicts, wasted LOC, and",
        "scope-leakage (C1-plan). Nondeterministic, costs money — not a CI gate.",
      ].join("\n") + "\n",
    );
    return;
  }
  const K = Number(process.env.NP_EVAL_SEEDS ?? 5);
  const scn = sharedFile;
  const rows: Record<Arm, Outcome[]> = { C0: [], "C1-detect": [], "C1-plan": [] };
  for (let k = 0; k < K; k++) {
    for (const arm of ARMS) rows[arm].push(await runArm(scn, arm, agent));
  }

  const summary = ARMS.map((arm) => {
    const os = rows[arm];
    const leaks = os.map((o) => o.scopeLeaks).filter((x) => !Number.isNaN(x));
    const denom = os.reduce((n, o) => n + o.leakDenom, 0);
    const leakCount = leaks.reduce((a, b) => a + b, 0);
    return {
      arm,
      ctsr_rate: mean(os.map((o) => (o.ctsr ? 1 : 0))),
      merge_conflicts_mean: mean(os.map((o) => o.mergeConflicts)),
      merge_conflicts_ci95: ci95(os.map((o) => o.mergeConflicts)),
      wasted_loc_mean: mean(os.map((o) => o.wastedLoc)),
      scope_leakage_rate: arm === "C1-plan" ? (denom ? leakCount / denom : 0) : null,
    };
  });

  process.stdout.write(
    `\n## Tier-B live multi-agent (agent=${agent}${process.env.NP_EVAL_MODEL ? `, model=${process.env.NP_EVAL_MODEL}` : ""}, scenario=${scn.name}, K=${K}) — raw replies in ${REPLY_LOG}\n` +
      JSON.stringify(summary, null, 2) +
      "\n\nHypothesis: CTSR C1-plan > C1-detect ≥ C0; scope_leakage_rate near 0 means agents RESPECT the planner's assignment (the structural win is real). High leakage ⇒ planner degrades to a detector.\n",
  );
}

if (import.meta.main) await main();
