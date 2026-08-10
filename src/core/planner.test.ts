import { test, expect } from "bun:test";
import { buildPlan, isValidMergeOrder, type WorkItem } from "./planner.ts";

test("independent items: no reassignment, one parallel batch, identity order", () => {
  const items: WorkItem[] = [
    { id: "A", scope: ["src/alpha.ts"] },
    { id: "B", scope: ["src/beta.ts"] },
  ];
  const plan = buildPlan(items);
  expect([...plan.reassigned]).toEqual([]);
  expect(plan.hasCycle).toBe(false);
  expect(plan.batches.length).toBe(1); // fully disjoint → all concurrent
  expect(isValidMergeOrder(items, plan.order)).toBe(true);
});

test("same-file contention: first item owns the file, later contenders are reassigned + split into separate batches", () => {
  const items: WorkItem[] = [
    { id: "A", scope: ["src/report.ts"] },
    { id: "B", scope: ["src/report.ts"] },
    { id: "C", scope: ["src/report.ts"] },
  ];
  const plan = buildPlan(items);
  expect(plan.assignments.A!.reassigned).toBe(false); // owner keeps its scope
  expect(plan.reassigned.has("B")).toBe(true);
  expect(plan.reassigned.has("C")).toBe(true);
  expect(plan.batches.length).toBe(3); // all contend → must serialize into 3 batches
});

test("contract fan-out: exactly the real consumers are reassigned; producer merges first; unrelated untouched", () => {
  const items: WorkItem[] = [
    { id: "payments", scope: ["payments/openapi.json"] },
    { id: "orders", scope: ["orders/consume.ts"], consumes: ["payments/openapi.json"] },
    { id: "notifications", scope: ["notifications/consume.ts"], consumes: ["payments/openapi.json"] },
    { id: "search", scope: ["search/index.ts"] },
  ];
  const plan = buildPlan(items);
  expect([...plan.reassigned].sort()).toEqual(["notifications", "orders"]);
  expect(plan.assignments.search!.reassigned).toBe(false);
  // producer strictly before both consumers
  expect(plan.assignments.payments!.mergeOrder).toBeLessThan(plan.assignments.orders!.mergeOrder);
  expect(plan.assignments.payments!.mergeOrder).toBeLessThan(plan.assignments.notifications!.mergeOrder);
  expect(isValidMergeOrder(items, plan.order)).toBe(true);
  expect(plan.hasCycle).toBe(false);
});

test("cyclic dependency: flagged, all items still ordered, at least one edge broken", () => {
  const items: WorkItem[] = [
    { id: "A", scope: ["a.ts"], consumes: ["b.ts"] },
    { id: "B", scope: ["b.ts"], consumes: ["a.ts"] },
  ];
  const plan = buildPlan(items);
  expect(plan.hasCycle).toBe(true);
  expect(plan.order.length).toBe(2); // every node still gets a slot
  expect(plan.brokenEdges.length).toBeGreaterThan(0);
});

test("deterministic: same input yields identical plan", () => {
  const items: WorkItem[] = [
    { id: "A", scope: ["x.ts"] },
    { id: "B", scope: ["x.ts"], consumes: [] },
    { id: "C", scope: ["y.ts"], consumes: ["x.ts"] },
  ];
  const a = buildPlan(items);
  const b = buildPlan(items);
  expect(a.order).toEqual(b.order);
  expect([...a.reassigned].sort()).toEqual([...b.reassigned].sort());
});
