import { test, expect } from "bun:test";
import { initBenchDb, runScenarioAllConditions } from "./harness.ts";
import { SCENARIOS } from "./scenarios.ts";

// Deterministic Tier-A gate (CI-safe, runs in `bun test`). Three arms:
//   C0 = uncoordinated · C1 = reactive detect · C1-plan = proactive planner.
// The reactive arm must not regress vs C0 and must lift the sequential
// dependency scenarios; the planner arm must additionally win the concurrent /
// N-scale scenarios where a reactive warning arrives too late.
initBenchDb();

const results = new Map<string, Awaited<ReturnType<typeof runScenarioAllConditions>>>();
for (const s of SCENARIOS) results.set(s.name, await runScenarioAllConditions(s));

const CONCURRENT = ["shared-file-concurrent", "contention-n2", "contention-n4", "contention-n8"];

test("no regression: C1-detect and C1-plan are never worse than C0", () => {
  for (const [, { c0, c1, c1plan }] of results) {
    for (const arm of [c1, c1plan]) {
      expect(arm.mergeConflicts).toBeLessThanOrEqual(c0.mergeConflicts);
      expect(arm.wastedLoc).toBeLessThanOrEqual(c0.wastedLoc);
      if (c0.ctsr) expect(arm.ctsr).toBe(true); // never turn a pass into a fail
    }
  }
});

test("coordination lifts CTSR on the sequential dependency scenarios (detect and plan)", () => {
  for (const name of ["shared-file", "contract", "microservice-fanout"]) {
    const { c0, c1, c1plan } = results.get(name)!;
    expect(c0.ctsr).toBe(false); // uncoordinated fails
    expect(c1.ctsr).toBe(true); // reactive succeeds (warned in time)
    expect(c1plan.ctsr).toBe(true); // planner succeeds
  }
});

test("routing is precise: exactly the real consumers are warned (incl. fan-out), no false positives", () => {
  const fan = results.get("microservice-fanout")!.c1;
  expect(fan.routingHit).toBe(1); // orders + notifications warned
  expect(fan.routingFalse).toBe(0); // unrelated search-svc NOT warned
  expect(fan.warnedAgents.sort()).toEqual(["notifications", "orders"]);
});

test("independent control: Nerveplane does zero harm (C0 == C1 == C1-plan, no warnings)", () => {
  const { c0, c1, c1plan } = results.get("independent-control")!;
  expect(c0.ctsr).toBe(true);
  expect(c1.ctsr).toBe(true);
  expect(c1plan.ctsr).toBe(true);
  expect(c1.warnedAgents).toEqual([]);
  expect(c1plan.warnedAgents).toEqual([]);
});

// The paper's core claim: when edits are concurrent, the reactive warning is too
// late (C1-detect degrades to C0), but the planner prevents the collision up
// front — so C1-plan strictly beats C1-detect on wasted work and lands CTSR.
test("planner beats reactive detection under concurrency (wasted LOC + CTSR)", () => {
  for (const name of CONCURRENT) {
    const { c0, c1, c1plan } = results.get(name)!;
    expect(c1.wastedLoc).toBe(c0.wastedLoc); // reactive can't help — warning too late
    expect(c1plan.wastedLoc).toBeLessThan(c1.wastedLoc); // planner avoids the rework
    expect(c1.ctsr).toBe(false);
    expect(c1plan.ctsr).toBe(true);
  }
});

test("planner effect grows with N (contention scenarios)", () => {
  const w = (n: number) => results.get(`contention-n${n}`)!.c1.wastedLoc;
  expect(w(2)).toBeLessThan(w(4));
  expect(w(4)).toBeLessThan(w(8)); // more contenders → more wasted work the planner saves
  for (const n of [2, 4, 8]) expect(results.get(`contention-n${n}`)!.c1plan.wastedLoc).toBe(0);
});

test("planner produces a valid producer→consumer merge order on contract scenarios", () => {
  for (const name of ["contract", "microservice-fanout", "contract-concurrent"]) {
    expect(results.get(name)!.c1plan.mergeOrderCorrect).toBe(true);
  }
});
