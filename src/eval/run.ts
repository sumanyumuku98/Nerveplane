import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../storage/db.ts";
import { runMigrations } from "../storage/migrate.ts";
import { runEval } from "./harness.ts";

/**
 * `nerveplane eval` — runs the deterministic conflict-detection eval against an
 * isolated throwaway DB and prints precision / recall / noise. Exits non-zero if
 * the M2 gate (precision ≥ 0.9, recall = 1.0, no spurious/duplicate) fails.
 */
export async function runEvalCli(): Promise<number> {
  getDb(join(mkdtempSync(join(tmpdir(), "np-eval-db-")), "eval.db"));
  runMigrations();

  const report = await runEval();

  process.stdout.write("\nNerveplane conflict-detection eval\n==================================\n");
  for (const r of report.scenarios) {
    const mark = r.pass ? "✅" : "❌";
    process.stdout.write(`${mark} ${r.name}\n     tp=${r.tp} fp=${r.fp} fn=${r.fn} produced=${r.produced}\n`);
    for (const d of r.detail) process.stdout.write(`        ${d}\n`);
  }
  process.stdout.write(
    `\nprecision=${report.precision.toFixed(3)}  recall=${report.recall.toFixed(3)}  noise=${report.noiseRate.toFixed(3)}\n`,
  );

  const gatePass = report.pass && report.precision >= 0.9 && report.recall >= 1.0;
  process.stdout.write(gatePass ? "\nGATE: PASS\n" : "\nGATE: FAIL\n");
  return gatePass ? 0 : 1;
}
