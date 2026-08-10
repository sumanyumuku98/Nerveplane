# SUM-150 — Sweeps: effect-by-N and effect-by-model

Two axes the paper's scaling/robustness claims rest on. The **N axis** is proven
deterministically (free, reproducible, `sweep.ts`); the **model axis** is the live
Tier-B result (`live-multi.ts`). Live effect-by-N (a fan-out with N consumers) is a
scoped follow-up — see "Remaining" below.

## Effect-by-N (deterministic contention, `bun run .../sweep.ts`)

N agents concurrently rewrite one hot file. Under concurrency the reactive warning
is always too late, so **C1-detect tracks C0**; the planner partitions scopes up
front and holds at zero. **The advantage grows with N.**

| N agents | wasted LOC (C0 / C1-detect / C1-plan) | merge conflicts (C0 / C1-detect / C1-plan) | CTSR (C0 / C1-detect / C1-plan) |
|---|---|---|---|
| 2 | 4 / 4 / **0** | 1 / 1 / **0** | ❌ / ❌ / **✅** |
| 4 | 12 / 12 / **0** | 3 / 3 / **0** | ❌ / ❌ / **✅** |
| 8 | 28 / 28 / **0** | 7 / 7 / **0** | ❌ / ❌ / **✅** |
| 16 | 60 / 60 / **0** | 15 / 15 / **0** | ❌ / ❌ / **✅** |
| 32 | 124 / 124 / **0** | 31 / 31 / **0** | ❌ / ❌ / **✅** |

Conflicts scale as `n−1` for C0 / C1-detect and stay 0 for C1-plan; wasted LOC grows
`≈ 4(n−1)`. Effect size is monotonically increasing in N.

## Effect-by-model (live Tier-B, contract-semantic scenario, K=5)

Real agents; a breaking `amount`→`amountCents` contract migration. CTSR:

| model | C0 | C1-detect | C1-plan |
|---|---|---|---|
| Claude frontier | 0.00 | 0.00 | **1.00** |
| Claude Haiku | 0.00 | 0.00 | **0.60** |

The coordination *signal* is capability-independent (both models 0.00 without it);
*acting on* the plan is partly capability-dependent (frontier 1.00 > Haiku 0.60).

## Remaining (scoped, expensive — greenlight before running)

1. **Live effect-by-N** = a **1-producer → N-consumer fan-out** where each consumer
   must adapt to the same contract change; report per-consumer adaptation rate vs N
   (C0 breaks more consumers as N grows; C1-plan holds). Contention-on-one-file is a
   poor live N probe because real agents make *additive* edits that git merges (see
   the shared-file pilot), so use fan-out. Cost ≈ (1+N) agents × 3 arms × K seeds ×
   models.
2. **Second model family** (codex / opencode) on the contract scenario. Access is
   **confirmed** — `codex exec` is authenticated and responds. The remaining work is
   a provider-aware edit invocation in `live-multi.ts` (codex needs
   `--dangerously-bypass-approvals-and-sandbox` and a different output parse than
   Claude's `--output-format json`), validated the same way as the Claude path. A
   bounded follow-up; adds a non-Claude point to the model axis.
3. **Wider K + 95% CIs** on the live contract result (currently K=5; bump to K≥10).
