/**
 * Tier-A runner: plays every scenario under C0 (uncoordinated) and C1
 * (Nerveplane) and prints + writes the C0-vs-C1 results table. Deterministic.
 *
 *   bun run experiments/coordination-evals/run.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initBenchDb, runScenarioBothConditions, type Outcome } from "./harness.ts";
import { SCENARIOS } from "./scenarios.ts";

function pct(n: number): string {
  return Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
}

async function main() {
  initBenchDb();
  const rows: { c0: Outcome; c1: Outcome }[] = [];
  for (const s of SCENARIOS) rows.push(await runScenarioBothConditions(s));

  const agg = (sel: (o: Outcome) => number, cond: "c0" | "c1") => rows.reduce((n, r) => n + sel(r[cond]), 0);
  const ctsr = (cond: "c0" | "c1") => rows.filter((r) => r[cond].ctsr).length;

  const lines: string[] = [];
  lines.push("# NP-Bench — Tier-A results (deterministic)", "");
  lines.push("C0 = uncoordinated (no Nerveplane) · C1 = Nerveplane on. Higher CTSR / lower conflicts+waste is better.", "");
  lines.push("| scenario | dep class | CTSR C0→C1 | merge conflicts C0→C1 | wasted LOC C0→C1 | routing hit (C1) | false routing (C1) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const { c0, c1 } of rows) {
    lines.push(
      `| ${c0.scenario} | ${SCENARIOS.find((s) => s.name === c0.scenario)!.dependencyClass} | ${c0.ctsr ? "✅" : "❌"}→${c1.ctsr ? "✅" : "❌"} | ${c0.mergeConflicts}→${c1.mergeConflicts} | ${c0.wastedLoc}→${c1.wastedLoc} | ${pct(c1.routingHit)} | ${pct(c1.routingFalse)} |`,
    );
  }
  lines.push("");
  lines.push("**Aggregate:**", "");
  lines.push(`- CTSR: **${ctsr("c0")}/${rows.length} → ${ctsr("c1")}/${rows.length}** (uncoordinated → Nerveplane)`);
  lines.push(`- Merge conflicts: **${agg((o) => o.mergeConflicts, "c0")} → ${agg((o) => o.mergeConflicts, "c1")}**`);
  lines.push(`- Wasted LOC: **${agg((o) => o.wastedLoc, "c0")} → ${agg((o) => o.wastedLoc, "c1")}**`);
  lines.push("");
  lines.push("_Tier A is a deterministic simulation of agent reaction (coordinated edit iff Nerveplane warned in time), driving the product's real sensing/detection/routing. Tier B (live agents) validates externally — see `live.ts` + `results.md` appends._");

  const out = lines.join("\n") + "\n";
  process.stdout.write(out);
  const path = join(import.meta.dir, "results.md");
  writeFileSync(path, out);
  process.stdout.write(`\nwrote ${path}\n`);
}

await main();
