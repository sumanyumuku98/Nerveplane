# Paper outline (skeleton) — "Coordination-as-Scheduling for Parallel Coding Agents"

_Working title. NeurIPS 2026 "Who Verifies the Agents?" workshop, full paper (≤9pg).
Draft skeleton for author review (SUM-154). Results are final and live in
`experiments/coordination-evals/NP-BENCH-RESULTS.md`; prose is TODO. Double-blind →
no author/affiliation/tool-name-that-deanonymizes until camera-ready (SUM-155)._

## Thesis (one sentence)
Multi-agent coding coordination is better framed as **scheduling** — a proactive
planner that partitions work into disjoint scopes and orders merges — than as
**reactive detection**; on a new benchmark (NP-Bench) the planner strictly dominates
both no-coordination and reactive detection, deterministically and with live agents,
and the win is *structural* (survives strong models).

## Section map

**Abstract** — problem (parallel agents collide on shared files/contracts), gap
(existing systems detect conflicts reactively, after wasted work), contribution
(coordination-as-scheduling + NP-Bench + 3-arm results), headline numbers
(deterministic CTSR 1/9→9/9; live contract 0.00→1.00; effect-by-N holds; 0 scope
leakage; memory-continuity 1.00→0.00 model-independent).

**1. Introduction**
- Parallel coding agents are here (worktree multiplexers, CI of agents); coordination
  is the bottleneck, not single-agent skill.
- The reactive status quo: warn an agent once a teammate's change is *observed*.
  Problem: under concurrency the warning arrives *after* the agent has acted.
- Our reframing: **coordination as scheduling** — predict scopes, partition into
  disjoint work, order merges by the producer→consumer DAG, up front.
- The non-tautology crux: this only helps if (a) scopes are predictable and (b) agents
  *respect* them; we measure both.
- Contributions (bulleted): (i) the coordination-as-scheduling formalization + a static
  planner; (ii) **NP-Bench**, a 3-arm coordination benchmark (deterministic + live);
  (iii) empirical results incl. an honest capability-dependence analysis; (iv) a
  capability-independent memory-continuity result.

**2. Problem formulation** _(from `GO-NO-GO.md` Part 1 / `planner.ts`)_
- Work items W, predicted scope σ(w), producer→consumer deps D. Conflict iff scopes
  overlap. A plan = disjoint-scope partition + topological merge order.
- Claim (assumption-scoped): accurate scopes + DAG ⇒ 0 structural conflicts by
  construction; the empirical questions are scope-prediction accuracy + agent
  compliance (leakage).

**3. The planner** _(`src/core/planner.ts`)_
- DAG build (reuse a service graph / consumes edges) → greedy disjoint-scope partition
  (graph coloring) → Kahn topological merge order → deliver assignment to each agent.
- Deterministic; cycle handling; complexity note.

**4. NP-Bench** _(the benchmark contribution — `harness.ts`, `live-multi.ts`)_
- Three arms: C0 / C1-detect / C1-plan.
- Tier A (deterministic, CI-gated): scripted scenarios, real sensing/detection/planner,
  git integration scoring. Timing model (`concurrent`) — why it matters.
- Tier B (live agents): real CLIs edit sandboxed repos; scenarios = shared-file
  (scope-leakage), contract-semantic (outcome), fan-out (effect-by-N).
- Metrics: CTSR, conflicts, wasted LOC, **scope-leakage**, consumer-adaptation rate,
  merge-order correctness, repeated-mistake rate. (§ table from NP-BENCH-RESULTS.md.)
- Positioning: NP-Bench measures the *coordination* axis SWE-bench et al. don't (§7).

**5. Results** _(all from `NP-BENCH-RESULTS.md`)_
- 5.1 Deterministic 3-arm: 1/9→4/9→9/9; planner==detector on sequential, dominates on
  concurrent/N-scale; effect-by-N monotonic (sweep table).
- 5.2 Live outcome-lift (contract): frontier 0/0/1.00, Haiku 0/0/0.60.
- 5.3 Live effect-by-N (fan-out): 0/0/1.00 flat across N=2/4/8.
- 5.4 Do agents respect the plan? scope-leakage 0.00.
- 5.5 Memory-continuity (capability-independent insurance): 1.00→0.00 both models.
- Cross-cutting: **C1-detect ≈ C0 on every live metric** — specificity + up-front
  ordering is what matters, not a mere heads-up.

**6. Analysis / discussion**
- Two layers of capability-dependence: the coordination *signal* is
  capability-independent (info gap); *acting* on the plan is partly
  capability-dependent (frontier 1.00 > Haiku 0.60). Reasoning gap vs information gap.
- Why reactive detection underperforms (timing; missing specifics).
- Structural ⇒ robust to the frontier-robustness effect that nulls accuracy-rescue
  claims (cite our own honest H7/H8/dilution nulls as motivation).

**7. Related work** _(SUM-153 — drafted in `related-work.md`)_

**8. Threats to validity** _(from `GO-NO-GO.md`)_
- Single model family (Claude frontier+Haiku); scripted/limited scenarios; K modest;
  scope-leakage measured on the simple case; harness uses `--dangerously-skip-
  permissions`; C1-detect prompt is deliberately vague (a *realistic* reactive warning
  — argue not a strawman; note the specificity-vs-timing ablation as future work).

**9. Responsible use** _(SUM-155; Meta-Agents requires this)_ — a planner that assigns
agent work is an oversight/governance lever; risks (over-automation, mis-scoping);
human-in-the-loop framing.

**10. Conclusion + future work** — dynamic re-planning; more model families; larger N;
enforcement (claim-leases) beyond advisory.

**Appendix** — repro commands (from NP-BENCH-RESULTS.md), scenario definitions, raw
provenance, planner pseudocode.

## Open authoring decisions (need you)
- Title + framing emphasis (scheduling vs benchmark vs oversight).
- Venue-specific spin: Verify (measurement/benchmark) vs Meta-Agents (oversight) — the
  intro + §9 shift accordingly.
- Format: markdown draft now → NeurIPS LaTeX template later.
- Which results are figures vs tables (effect-by-N is a natural line plot).
