import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { runEval } from "../src/eval/harness.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-evaltest-")), "test.db"));
runMigrations();

test("M2 gate: conflict-detection eval meets precision/recall thresholds", async () => {
  const report = await runEval();

  // Per-scenario diagnostics surface on failure.
  for (const r of report.scenarios) {
    expect({ scenario: r.name, detail: r.detail, pass: r.pass }).toEqual({ scenario: r.name, detail: [], pass: true });
  }

  expect(report.precision).toBeGreaterThanOrEqual(0.9);
  expect(report.recall).toBe(1);
  expect(report.noiseRate).toBe(0);
  expect(report.pass).toBe(true);
});
