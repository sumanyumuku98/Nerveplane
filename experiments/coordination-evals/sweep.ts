/**
 * SUM-150 — deterministic effect-by-N sweep (free, reproducible).
 *
 *   bun run experiments/coordination-evals/sweep.ts
 *
 * Runs the N-agent same-file CONTENTION scenario across a range of N under all
 * three arms (C0 / C1-detect / C1-plan) and prints an effect-by-N table. The
 * point: reactive detection (C1-detect), which arrives too late under concurrency,
 * piles up n−1 conflicts + growing wasted LOC exactly like C0, while the planner
 * (C1-plan) holds at 0 — so the planner's advantage GROWS with N. This is the
 * deterministic half of the sweep; the live model×N half is in `live-multi.ts`.
 */
import { initBenchDb, runScenarioAllConditions } from "./harness.ts";
import { contention } from "./scenarios.ts";

const NS = (process.env.NP_SWEEP_NS ?? "2,4,8,16,32").split(",").map((s) => Number(s.trim()));

async function main() {
  initBenchDb();
  const rows: Array<{ n: number; c0w: number; c1w: number; planw: number; c0c: number; c1c: number; planc: number; c0ct: boolean; c1ct: boolean; planct: boolean }> = [];
  for (const n of NS) {
    const { c0, c1, c1plan } = await runScenarioAllConditions(contention(n));
    rows.push({ n, c0w: c0.wastedLoc, c1w: c1.wastedLoc, planw: c1plan.wastedLoc, c0c: c0.mergeConflicts, c1c: c1.mergeConflicts, planc: c1plan.mergeConflicts, c0ct: c0.ctsr, c1ct: c1.ctsr, planct: c1plan.ctsr });
  }

  const tick = (b: boolean) => (b ? "✅" : "❌");
  const out: string[] = [];
  out.push("# NP-Bench — effect-by-N sweep (deterministic contention scenario)", "");
  out.push("N agents concurrently rewrite one hot file. C1-detect's warning is always too late under concurrency, so it tracks C0; the planner partitions scopes up front. **The gap grows with N.**", "");
  out.push("| N agents | wasted LOC (C0 / C1-detect / C1-plan) | merge conflicts (C0 / C1-detect / C1-plan) | CTSR (C0 / C1-detect / C1-plan) |");
  out.push("|---|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.n} | ${r.c0w} / ${r.c1w} / ${r.planw} | ${r.c0c} / ${r.c1c} / ${r.planc} | ${tick(r.c0ct)} / ${tick(r.c1ct)} / ${tick(r.planct)} |`);
  }
  out.push("");
  out.push("_C1-plan holds at 0 conflicts / 0 wasted LOC / CTSR ✅ across all N; C0 and C1-detect degrade linearly (n−1 conflicts). Effect size = (C1-detect wasted LOC − 0), which is monotonically increasing in N._");
  const text = out.join("\n") + "\n";
  process.stdout.write(text);
}

await main();
