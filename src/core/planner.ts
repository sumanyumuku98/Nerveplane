/**
 * Coordination planner (S0.1) — the "coordination-as-scheduling" core.
 *
 * Turns a set of work items with PREDICTED scopes (files/symbols each will
 * touch) + producer→consumer dependencies into:
 *   1. a DISJOINT-SCOPE PARTITION — which items can run concurrently because
 *      their scopes don't overlap, and which must be scope-split/serialized;
 *   2. a TOPOLOGICAL MERGE ORDER — producers before the consumers that depend
 *      on their contract (Kahn); cycles are broken deterministically + flagged.
 *
 * The output `reassigned` set is the key research hook: an item is "reassigned"
 * when the planner decides — UP FRONT, independent of runtime timing — that its
 * naive scope would collide with a teammate (same-file contention) or that it
 * consumes a contract another item produces (so it must adapt). This is exactly
 * what a reactive detector can only tell an agent AFTER it has already edited.
 *
 * Pure logic: no DB, no I/O. Unit-tested; imported by the eval harness and the
 * (future) `plan` MCP tool. A real service graph can feed this via
 * `ServiceGraph.resolveConsumers()` (src/services/graph.ts); the eval harness
 * feeds it each agent's `touches` (scope) + `consumes` (dependency).
 */

export interface WorkItem {
  /** stable id (agent name, task id, …). */
  id: string;
  /** predicted scope σ: files/symbols this item will write. */
  scope: string[];
  /** scopes this item depends on being current (contract files it consumes). */
  consumes?: string[];
}

export interface Assignment {
  id: string;
  /** the item's own scope (unchanged by v1 static planning). */
  scope: string[];
  /** 0-based position in the topological merge order. */
  mergeOrder: number;
  /** parallel batch index: items sharing a batch have pairwise-disjoint scopes. */
  batch: number;
  /** true iff the planner moved this item off a contested scope or it must adapt
   *  to a consumed contract — i.e. it must NOT take its naive edit. */
  reassigned: boolean;
  /** why it was reassigned (for surfacing to the agent / the paper). */
  reason?: string;
}

export interface Plan {
  assignments: Record<string, Assignment>;
  /** item ids in a valid producer→consumer merge order. */
  order: string[];
  /** ids the planner reassigned (must take their coordinated, not naive, edit). */
  reassigned: Set<string>;
  /** batches of ids with pairwise-disjoint scopes (safe to run concurrently). */
  batches: string[][];
  hasCycle: boolean;
  /** dependency edges [producer, consumer] dropped to break a cycle. */
  brokenEdges: Array<[string, string]>;
}

function overlaps(a: string[], b: Iterable<string>): boolean {
  const set = a instanceof Set ? a : new Set(a);
  for (const x of b) if (set.has(x)) return true;
  return false;
}

/**
 * Compute the coordination plan for `items`.
 *
 * Determinism: all tie-breaks follow the input order, so a given input always
 * yields the same plan (required for reproducible experiments).
 */
export function buildPlan(items: WorkItem[]): Plan {
  const ids = items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));

  // --- 1. Dependency DAG: producer → consumer.
  // B depends on A (edge A→B) when B consumes a scope A produces.
  const producersOf = new Map<string, string[]>(); // consumer -> [producers]
  const consumersOf = new Map<string, string[]>(); // producer -> [consumers]
  for (const id of ids) {
    producersOf.set(id, []);
    consumersOf.set(id, []);
  }
  for (const consumer of items) {
    for (const producer of items) {
      if (producer.id === consumer.id) continue;
      if (overlaps(producer.scope, consumer.consumes ?? [])) {
        producersOf.get(consumer.id)!.push(producer.id);
        consumersOf.get(producer.id)!.push(consumer.id);
      }
    }
  }

  // --- 2. Same-file contention: the first item (input order) owns a contested
  // file; every later item touching it must be reassigned (scope-split).
  const ownerOf = new Map<string, string>(); // file -> owner id
  const reassigned = new Set<string>();
  const reasons = new Map<string, string>();
  for (const item of items) {
    for (const f of item.scope) {
      const owner = ownerOf.get(f);
      if (owner === undefined) {
        ownerOf.set(f, item.id);
      } else if (owner !== item.id) {
        reassigned.add(item.id);
        if (!reasons.has(item.id)) reasons.set(item.id, `scope "${f}" is owned by ${owner}; split to a disjoint scope`);
      }
    }
  }
  // Consumers of a produced contract must adapt to it → reassigned.
  for (const id of ids) {
    const producers = producersOf.get(id)!;
    if (producers.length && !reassigned.has(id)) {
      reassigned.add(id);
      reasons.set(id, `consumes a contract produced by ${producers.join(", ")}; adapt to the new shape`);
    }
  }

  // --- 3. Topological merge order (Kahn) over the dependency DAG.
  const indeg = new Map<string, number>(ids.map((id) => [id, producersOf.get(id)!.length]));
  const order: string[] = [];
  // Stable queue: input order among currently-zero-indegree nodes.
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const removed = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    removed.add(id);
    for (const c of consumersOf.get(id)!) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) {
        // insert preserving input order
        const pos = ids.indexOf(c);
        let i = 0;
        while (i < ready.length && ids.indexOf(ready[i]!) < pos) i++;
        ready.splice(i, 0, c);
      }
    }
  }

  // --- 3b. Cycle handling: any node not yet ordered is in a cycle. Break by
  // dropping the incoming edge from the producer with the fewest downstream
  // consumers, then continue — deterministic + flagged.
  const brokenEdges: Array<[string, string]> = [];
  const hasCycle = order.length < ids.length;
  if (hasCycle) {
    const remaining = ids.filter((id) => !removed.has(id));
    // Greedily order the remainder; each round, pick the node whose remaining
    // producers are fewest, break one edge into it.
    const remSet = new Set(remaining);
    while (remSet.size) {
      let pick = "";
      let best = Infinity;
      for (const id of remaining) {
        if (!remSet.has(id)) continue;
        const remProducers = producersOf.get(id)!.filter((p) => remSet.has(p));
        if (remProducers.length < best) {
          best = remProducers.length;
          pick = id;
        }
      }
      // break edges into `pick` from still-unresolved producers
      for (const p of producersOf.get(pick)!) {
        if (remSet.has(p)) brokenEdges.push([p, pick]);
      }
      order.push(pick);
      remSet.delete(pick);
    }
  }

  // --- 4. Disjoint-scope partition into parallel batches (greedy coloring on
  // the scope-overlap graph). Items in the same batch have disjoint scopes.
  const batchOf = new Map<string, number>();
  const batches: string[][] = [];
  for (const id of order) {
    const item = byId.get(id)!;
    let b = 0;
    for (; b < batches.length; b++) {
      const clash = batches[b]!.some((other) => overlaps(byId.get(other)!.scope, item.scope));
      if (!clash) break;
    }
    if (b === batches.length) batches.push([]);
    batches[b]!.push(id);
    batchOf.set(id, b);
  }

  // --- 5. Assemble assignments.
  const assignments: Record<string, Assignment> = {};
  order.forEach((id, idx) => {
    assignments[id] = {
      id,
      scope: byId.get(id)!.scope,
      mergeOrder: idx,
      batch: batchOf.get(id)!,
      reassigned: reassigned.has(id),
      reason: reasons.get(id),
    };
  });

  return { assignments, order, reassigned, batches, hasCycle, brokenEdges };
}

/** True iff `order` places every producer before each of its consumers. */
export function isValidMergeOrder(items: WorkItem[], order: string[]): boolean {
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const consumer of items) {
    for (const producer of items) {
      if (producer.id === consumer.id) continue;
      if (overlaps(producer.scope, consumer.consumes ?? [])) {
        const pp = pos.get(producer.id);
        const cp = pos.get(consumer.id);
        if (pp === undefined || cp === undefined || pp >= cp) return false;
      }
    }
  }
  return true;
}
