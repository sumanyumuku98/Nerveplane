# NP-Bench — consolidated results (paper master table)

_Single source of truth for the "coordination-as-scheduling" paper (Linear SUM-149).
Pulls every experiment into one place. Per-experiment detail + provenance live in
`results.md`, `SWEEP-RESULTS.md`, and `GO-NO-GO.md`; harness in `harness.ts`,
`live-multi.ts`, `sweep.ts`, `planner.ts`._

Arms: **C0** uncoordinated · **C1-detect** reactive Nerveplane (vague, late) ·
**C1-plan** proactive planner (disjoint scopes + merge order, up front).

## Headline

| # | Experiment | Metric | C0 | C1-detect | C1-plan | Tier |
|---|---|---|---|---|---|---|
| 1 | Deterministic 3-arm (9 scenarios) | CTSR | 1/9 | 4/9 | **9/9** | A |
| 1 | " | merge conflicts (total) | 13 | 12 | **0** | A |
| 1 | " | wasted LOC (total) | 54 | 49 | **0** | A |
| 2 | Effect-by-N contention (N=8) | wasted LOC | 28 | 28 | **0** | A |
| 3 | Live contract-semantic — frontier | CTSR | 0.00 | 0.00 | **1.00** | B |
| 3 | Live contract-semantic — Haiku | CTSR | 0.00 | 0.00 | **0.60** | B |
| 4 | Live fan-out effect-by-N (N=2/4/8) | consumer adaptation | 0.00 | 0.00 | **1.00** | B |
| 5 | Same-file assignment (frontier) | scope-leakage | — | — | **0.00** | B |
| 6 | Memory continuity — frontier & Haiku | repeated-mistake | 1.00 | — | **0.00** | B |

**One-line takeaway:** across deterministic *and* live agents, a proactive plan
(C1-plan) strictly dominates both no-coordination and reactive detection; **C1-detect
≈ C0 on every live metric** — a vague heads-up without the specifics + merge order
buys nothing. Agents *respect* assigned scopes (0 leakage), so the win is structural,
not a tautology.

## Detail

### 1. Deterministic 3-arm (`run.ts`, `bench.test.ts` — CI-gated)
Planner == detector on *sequential* dependency scenarios (both fix them) but strictly
better on *concurrent / N-scale* ones, where the reactive warning is too late.

### 2. Effect-by-N — deterministic contention (`sweep.ts`)
| N | wasted LOC (C0 / detect / plan) | conflicts (C0 / detect / plan) |
|---|---|---|
| 2 | 4 / 4 / **0** | 1 / 1 / **0** |
| 4 | 12 / 12 / **0** | 3 / 3 / **0** |
| 8 | 28 / 28 / **0** | 7 / 7 / **0** |
| 16 | 60 / 60 / **0** | 15 / 15 / **0** |
| 32 | 124 / 124 / **0** | 31 / 31 / **0** |

C1-plan holds at 0; C0 and C1-detect degrade linearly (`n−1` conflicts). Gap monotonic in N.

### 3. Live contract-semantic — effect-by-model (`live-multi.ts`, K=5)
A breaking `amount`→`amountCents` migration; consumer breaks unless it adapts.

| model | C0 | C1-detect | C1-plan |
|---|---|---|---|
| Claude frontier | 0.00 | 0.00 | **1.00** |
| Claude Haiku | 0.00 | 0.00 | **0.60** |

Coordination *signal* is capability-independent (both 0.00 without it); *acting* on
the plan is partly capability-dependent (frontier 1.00 > Haiku 0.60).

### 4. Live effect-by-N — contract fan-out (`live-multi.ts`, frontier, K=3)
1 producer, N consumers; metric = per-consumer adaptation rate.

| N consumers | C0 | C1-detect | C1-plan |
|---|---|---|---|
| 2 | 0.00 | 0.00 | **1.00** |
| 4 | 0.00 | 0.00 | **1.00** |
| 8 | 0.00 | 0.00 | **1.00** |

Effect holds and does not decay with N; absolute broken-consumer count under C0 grows
linearly while the planner holds all.

### 5. Scope-leakage (the make-or-break metric; `live-multi.ts` shared-file, frontier, K=5)
**0.00** — every C1-plan agent respected its assignment (put new work in a separate
file, left the owned file untouched). The planner's disjoint-scope partition is not a
tautology defeated by leakage.

### 6. Memory continuity — capability-independent insurance (`live.ts`, K=5)
Repeated-mistake rate **1.00 → 0.00 on both frontier and Haiku** — a prior session's
recorded decision, recalled cross-session, closes an *information* gap no model
strength can substitute for.

## Metrics defined
- **CTSR** — clean-tree-success rate: branches merge with no conflict AND the
  post-integration acceptance check passes.
- **merge conflicts / wasted LOC** — git conflicts on integration; LOC in conflicting
  edits that must be reworked.
- **scope-leakage** — fraction of reassigned C1-plan agents that edited a file they
  were told not to (0 = full compliance).
- **consumer adaptation rate** — fraction of fan-out consumers whose merged code uses
  the new contract field.
- **repeated-mistake rate** — 1 − adherence to a prior session's recorded decision.
- **merge-order correctness** — C1-plan orders every producer before its consumers
  (holds on all contract scenarios).

## Reproduce
```
bun test experiments/coordination-evals/bench.test.ts            # Tier-A gates
bun run experiments/coordination-evals/run.ts                    # 3-arm table
bun run experiments/coordination-evals/sweep.ts                  # effect-by-N (deterministic)
NP_EVAL_AGENT=claude [NP_EVAL_MODEL=haiku] NP_EVAL_SCENARIO=contract NP_EVAL_SEEDS=5 \
  bun run experiments/coordination-evals/live-multi.ts           # live contract
NP_EVAL_AGENT=claude NP_EVAL_SCENARIO=fanout NP_SWEEP_NS=2,4,8 NP_EVAL_SEEDS=3 \
  bun run experiments/coordination-evals/live-multi.ts           # live effect-by-N
NP_EVAL_AGENT=claude NP_EVAL_MODE=continuity NP_EVAL_SEEDS=5 \
  bun run experiments/coordination-evals/live.ts                 # memory continuity
```
Tier-B is env-gated, nondeterministic, and not a CI gate.
