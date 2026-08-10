/**
 * Tier-A runner: plays every scenario under three arms and prints + writes the
 * results table. Deterministic.
 *   C0       = uncoordinated (no Nerveplane)
 *   C1-detect = reactive Nerveplane (today): warns an agent only if a teammate's
 *               change was sensed in time
 *   C1-plan  = proactive planner: disjoint scopes + merge order decided up front
 *
 *   bun run experiments/coordination-evals/run.ts
 *
 * Preserves any hand-written findings below the first `---` (e.g. the Tier-B
 * live-agent sections) — only the auto-generated Tier-A block is regenerated.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initBenchDb, runScenarioAllConditions, type AllConditions, type Outcome } from "./harness.ts";
import { SCENARIOS } from "./scenarios.ts";

function pct(n: number): string {
  return Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
}
const tick = (b: boolean) => (b ? "✅" : "❌");

async function main() {
  initBenchDb();
  const rows: AllConditions[] = [];
  for (const s of SCENARIOS) rows.push(await runScenarioAllConditions(s));

  const arms: Array<["c0" | "c1" | "c1plan", string]> = [
    ["c0", "C0"],
    ["c1", "C1-detect"],
    ["c1plan", "C1-plan"],
  ];
  const sum = (sel: (o: Outcome) => number, arm: "c0" | "c1" | "c1plan") => rows.reduce((n, r) => n + sel(r[arm]), 0);
  const ctsr = (arm: "c0" | "c1" | "c1plan") => rows.filter((r) => r[arm].ctsr).length;

  const lines: string[] = [];
  lines.push("# NP-Bench — Tier-A results (deterministic)", "");
  lines.push("Three arms: **C0** uncoordinated · **C1-detect** reactive Nerveplane · **C1-plan** proactive planner. Higher CTSR / lower conflicts + wasted LOC is better. The planner's edge shows up on the `concurrent` / N-scale scenarios, where a reactive warning arrives too late.", "");
  lines.push("| scenario | dep class | CTSR (C0/detect/plan) | merge conflicts | wasted LOC | routing hit (plan) | merge-order ok |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const { c0, c1, c1plan } of rows) {
    const dep = SCENARIOS.find((s) => s.name === c0.scenario)!.dependencyClass;
    lines.push(
      `| ${c0.scenario} | ${dep} | ${tick(c0.ctsr)}/${tick(c1.ctsr)}/${tick(c1plan.ctsr)} | ${c0.mergeConflicts}/${c1.mergeConflicts}/${c1plan.mergeConflicts} | ${c0.wastedLoc}/${c1.wastedLoc}/${c1plan.wastedLoc} | ${pct(c1plan.routingHit)} | ${tick(c1plan.mergeOrderCorrect)} |`,
    );
  }
  lines.push("");
  lines.push("**Aggregate (C0 → C1-detect → C1-plan):**", "");
  lines.push(`- CTSR: **${arms.map(([a]) => `${ctsr(a)}/${rows.length}`).join(" → ")}**`);
  lines.push(`- Merge conflicts: **${arms.map(([a]) => sum((o) => o.mergeConflicts, a)).join(" → ")}**`);
  lines.push(`- Wasted LOC: **${arms.map(([a]) => sum((o) => o.wastedLoc, a)).join(" → ")}**`);
  lines.push("");
  lines.push("_Deterministic simulation of agent reaction: an agent takes its coordinated edit iff it was warned in time (C1-detect) or reassigned by the planner (C1-plan), driving the product's real sensing/detection/routing + the planner core (`src/core/planner.ts`). Tier B (live agents) validates externally — see `live.ts` + the sections below._");

  const generated = lines.join("\n") + "\n";
  process.stdout.write(generated);

  // Preserve hand-written content below the first `---` (Tier-B sections, etc.).
  const path = join(import.meta.dir, "results.md");
  let tail = "";
  if (existsSync(path)) {
    const prev = readFileSync(path, "utf8");
    const idx = prev.indexOf("\n---\n");
    if (idx !== -1) tail = prev.slice(idx); // includes the leading \n---\n
  }
  const out = tail ? generated + tail : generated + "\n---\n";
  writeFileSync(path, out);
  process.stdout.write(`\nwrote ${path} (preserved ${tail ? tail.length : 0} bytes of hand-written findings)\n`);
}

await main();
