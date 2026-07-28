import { test, expect } from "bun:test";
import { initBenchDb, runScenarioBothConditions } from "./harness.ts";
import { SCENARIOS } from "./scenarios.ts";

// Deterministic Tier-A gate: Nerveplane (C1) must not regress vs uncoordinated
// (C0), must lift the dependency scenarios, must route precisely, and must do
// no harm on the independent control. Runs in `bun test` (CI-safe).
initBenchDb();

const results = new Map<string, Awaited<ReturnType<typeof runScenarioBothConditions>>>();
for (const s of SCENARIOS) results.set(s.name, await runScenarioBothConditions(s));

test("every C1 outcome is ≥ its C0 outcome (no regression)", () => {
  for (const [, { c0, c1 }] of results) {
    expect(c1.mergeConflicts).toBeLessThanOrEqual(c0.mergeConflicts);
    expect(c1.wastedLoc).toBeLessThanOrEqual(c0.wastedLoc);
    if (c0.ctsr) expect(c1.ctsr).toBe(true); // never turn a pass into a fail
  }
});

test("coordination lifts CTSR on the dependency scenarios", () => {
  for (const name of ["shared-file", "contract", "microservice-fanout"]) {
    const { c0, c1 } = results.get(name)!;
    expect(c0.ctsr).toBe(false); // uncoordinated fails
    expect(c1.ctsr).toBe(true); // Nerveplane succeeds
  }
});

test("routing is precise: exactly the real consumers are warned (incl. fan-out), no false positives", () => {
  const fan = results.get("microservice-fanout")!.c1;
  expect(fan.routingHit).toBe(1); // orders + notifications warned
  expect(fan.routingFalse).toBe(0); // unrelated search-svc NOT warned
  expect(fan.warnedAgents.sort()).toEqual(["notifications", "orders"]);
});

test("independent control: Nerveplane does zero harm (C0 == C1, no warnings)", () => {
  const { c0, c1 } = results.get("independent-control")!;
  expect(c0.ctsr).toBe(true);
  expect(c1.ctsr).toBe(true);
  expect(c1.warnedAgents).toEqual([]);
});
