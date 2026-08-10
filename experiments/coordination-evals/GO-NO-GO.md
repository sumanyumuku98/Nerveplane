# S1.6 — Go/No-Go memo: NP-Bench coordination-as-scheduling paper

_Date: 2026-08-10 · Author: research agent · Linear: SUM-151 (E1 gate) · Target: NeurIPS 2026 workshops, deadline Aug 29 2026 (AoE)._

## Decision

**GO — full paper, submitted to the "Who Verifies the Agents?" (Verify Agents) workshop as the primary venue**, with Meta-Agents as the fallback framing.

**UPDATE (2026-08-10, SUM-177): the primary contingency is now RESOLVED.** The live effect-by-N fan-out sweep (frontier, K=3, N∈{2,4,8}) holds flat: C0 and C1-detect adapt **0%** of consumers at every N, C1-plan adapts **100%** — so the absolute count of broken consumers under no-coordination grows linearly with N while the planner holds every one. Combined with the deterministic N-scaling and the contract-semantic live result, the full-paper claim is well-supported. Remaining strengtheners (a second model family, wider K/CIs; SUM-177 items 2-3) are *nice-to-have generality*, not load-bearing — their absence would not by itself downgrade the paper. The GO is **affirmed**; downgrade to short/findings only if a second model family were to overturn the effect (not indicated).

## Evidence on the table

Three mutually-reinforcing results, all in `experiments/coordination-evals/` + `results.md`:

1. **Tier-A deterministic 3-arm (mechanism).** C0 → C1-detect → C1-plan: CTSR **1/9 → 4/9 → 9/9**, wasted LOC **54 → 49 → 0**. Planner == detector on *sequential* scenarios but strictly better on *concurrent / N-scale* ones, and the gap **grows with N** (contention n=2/4/8). CI-gated, reproducible.

2. **Tier-B live 3-arm (pivotal, the reviewer-facing result).** Real Claude Code agents editing sandboxed repos, K=5. On the **contract-semantic** scenario (a breaking `amount`→`amountCents` migration), CTSR:
   - frontier: C0 **0.00** / C1-detect **0.00** / C1-plan **1.00**
   - Haiku: C0 **0.00** / C1-detect **0.00** / C1-plan **0.60**
   - **Scope-leakage = 0.00** (frontier, shared-file): agents *respect* the planner's assignment — the non-tautology crux passes.

3. **Memory-continuity (capability-independent insurance).** Repeated-mistake rate **1.00 → 0.00 on both frontier and Haiku** — a second result that holds regardless of model strength.

## Why this clears the bar for a full paper

- **A real, non-obvious empirical claim, not a tautology.** "Disjoint scopes don't conflict" would be trivial; the contribution is that (a) scopes can be *predicted* and (b) real agents *respect* them (0 leakage) *and* (c) that a *specific* plan beats a *vague* reactive warning — C1-detect = C0 = 0.00 while C1-plan lifts to 1.00. The detector→planner gap is the paper.
- **A clean, honest nuance reviewers will trust.** Two layers of capability-dependence: the coordination *signal* is capability-independent (both models fail at 0.00 without it — the info isn't in their context), while *acting on* the plan is partly capability-dependent (frontier 1.00, Haiku 0.60). This distinguishes "information gap" from "reasoning gap" and pre-empts the obvious "won't stronger models just do this?" objection.
- **Fits Verify Pillar 2** (multi-agent evaluation systems, observability/monitoring, benchmark/environment design). NP-Bench is a coordination-axis benchmark SWE-bench doesn't cover.
- **Robust to the frontier-robustness effect** that killed the earlier accuracy experiments (H7/H8/dilution nulls): the win is structural (work allocation), and we carry the memory-continuity result as insurance.

## Format & venue rationale

| option | verdict |
|---|---|
| **Full paper @ Verify** | **CHOSEN** — three results, a live pivotal effect, honest threats. Contingent on sweeps. |
| Short/findings @ Verify | Fallback if sweeps weaken the live effect (e.g. C1-plan collapses at N≥4 or on a 3rd model). |
| Demo @ Verify / Meta-Agents | Only if the live effect fails to replicate at all (not indicated by current data). |

## Threats to validity / what SUM-150 must shore up before submission

1. **Live N=2 only.** Tier-A shows the gap grows with N deterministically; the *live* arm must show it at **N∈{4,8}** or the scaling claim is deterministic-only. (Highest priority.)
2. **Single model family (Claude).** Add ≥1 non-Claude family (e.g. an OSS/Codex model) so "capability-independent signal" isn't Claude-specific.
3. **K=5 / few scenarios.** Widen K and report proper CIs; add scenario diversity (a second contract shape, a delete/rename, a 3-consumer fan-out) so the contract result isn't a single-instance artifact.
4. **Scope-leakage measured only on the easy shared-file case.** Measure leakage under N-scale contention and on the weak model (does Haiku leak more?).
5. **`--dangerously-skip-permissions` + prompt phrasing.** Document the harness faithfully; the C1-detect prompt is deliberately vague (a realistic reactive warning) — note this as a design choice, not a strawman, and consider a "C1-detect-specific" ablation that includes the specifics to isolate *what* in the plan matters (specificity vs timing).

## Next actions
- SUM-150 sweeps: N∈{2,4,8} × {frontier, Haiku, +1 family} × K≥10, live contract + N-scale, with CIs.
- Re-affirm or downgrade this memo after sweeps (this file is the living decision record).
- Then E3 (write-up): method + planner formalization, NP-Bench, 3-arm Tier-A + Tier-B, memory-continuity, honest threats.
