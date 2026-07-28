# NP-Bench — does the coordination plane actually work?

A research-spike evaluation of Nerveplane, framed as a paper: **hypothesis · experimental setup · metrics · baselines · threats**. Goal: prove (or falsify) that coordinating parallel coding agents with Nerveplane produces measurably better multi-agent outcomes than not — with numbers we can put in front of engineering leadership.

> This directory is a self-contained experiment. It is **not shipped** (excluded from the npm package) and the product never imports it; it imports the product's real primitives and measures them.

## Problem
As teams run many coding agents in parallel, the bottleneck shifts from code generation to **coordination**. Git worktrees prevent file-clobbering but not *logical drift*: agents break each other's contracts, duplicate/undo work, re-litigate decisions, and lose context across sessions. (~1 in 3 AI-generated PRs hit file-level merge conflicts alone.)

## Hypotheses
- **H1 (primary):** N parallel agents coordinated by Nerveplane finish multi-agent tasks with higher success and fewer conflicts + less wasted work than uncoordinated — at acceptable overhead, and with ≈0 harm on tasks needing no coordination.
- **H2** sensing+conflict → fewer collisions reach integration · **H3** contract routing → fewer cross-repo breakages · **H4** decisions+chat → less re-litigation/duplication · **H5** memory → better cross-session/CLI resume · **H6** overhead is net-positive · **H7** routing+JIT-injection beats context-dumping (lost-in-the-middle).

## What we evaluate (three layers)
- **L1 component** — each mechanism in isolation (detection P/R/noise, routing accuracy, recall hit-rate). Microbenchmarks; explain *why*. (`nerveplane eval` is the detector L1.)
- **L2 integration** — pipelines (sensing→conflict→routing→delivery; contract→service-graph→consumer). Catches wiring bugs; measures time-to-awareness.
- **L3 system** — full multi-agent task outcomes. **The headline.** Run in both fidelity tiers.

The headline is **L3 outcome lift vs a no-coordination baseline**; L1/L2 + ablation attribute the lift so it's explanatory, not a black box.

## Experimental setup
Independent variable = **the coordination layer only** (same model, task decomposition, prompts, seed repos, budget across conditions). Conditions: **C0** uncoordinated (null), **C1** Nerveplane, **Cserial** (one agent sequential — quality ceiling), **Cnaive** (shared notes / human PM), plus **ablations** (C1 minus one mechanism). Two fidelity tiers: **Tier A** deterministic (scripted agents, reproducible, CI-gated — `run.ts`/`bench.test.ts`) and **Tier B** real agents (`live.ts`, K≥5 seeds + CIs — external validity).

## Scenarios (coordination-dependency classes, from the conflict taxonomy)
shared-file · shared-package · producer→consumer contract · **microservice contract fan-out** (direct + transitive consumers) · delete/rename · decision-dependency · **continuity** (interrupt→resume, memory) · **independent control** (no dependency → measures harm). Tier-A MVP implements: shared-file, contract, microservice-fanout, independent-control. Continuity + lost-in-the-middle are Tier B.

## Metrics (objective, auto-harvested — no human labeling)
**Primary (L3):** **CTSR** = `#(clean merge ∧ acceptance suite green)/#scenarios`; **conflict incidence** = git + semantic (removed-symbol) + contract-breakage; **wasted work** = duplicate exported symbols + reverted/rewritten LOC (+ tokens, wall-clock).
**Secondary:** detection precision/recall/noise; **routing accuracy** = `#correct_consumers/#actual` incl. transitive, false-routing→0; **time-to-awareness**; **warning actionability**; continuity (resume-success, repeated-mistake).
**Overhead:** coordination tokens + latency + human interventions; **harm on independent control ≈ 0**. **H7:** critical-fact adherence vs. position + context-tokens delivered.
All reported as **Δ vs C0** with 95% CIs; Tier B adds seeds + significance.

## Baselines
C0 uncoordinated (the money comparison) · Cserial (correctness ceiling / speed floor) · Cnaive (prose/human — product-necessity) · external anchor: the ~1-in-3 AI-PR conflict stat; NP-Bench is the **multi-agent** axis SWE-bench doesn't cover.

## Threats to validity (anticipated leadership questions)
"Just your detector?" → headline is L3 vs C0; detector is L1. · "Real agents?" → Tier B. · "Cherry-picked?" → taxonomy-derived + independent control + report harm. · "Reproducible?" → Tier A deterministic; Tier B seeds+CIs. · "Baseline vs what?" → three. · "Pays for itself?" → overhead column. · "Hurts when unneeded?" → independent control. · "Just serialize?" → Cserial quantifies the speed cost. · "Gaming?" → co-report speed + waste.

## Running it
```bash
bun run experiments/coordination-evals/run.ts     # Tier A → results.md (C0 vs C1 table)
bun test experiments/coordination-evals/bench.test.ts   # CI gate: C1 ≥ C0, routing precise, no harm
bun run experiments/coordination-evals/live.ts    # Tier B (needs a real agent + key; prints a runbook otherwise)
```

## Results
See [`results.md`](./results.md). Tier-A headline (deterministic; `run.ts` regenerates this file): **CTSR 1/4 → 4/4**, merge conflicts **1 → 0**, wasted LOC **5 → 0**, routing **100% hit / 0% false**, independent control **no harm**.

**Tier-B (live, frontier Claude) — H7 "context-rescue" NOT supported (honest):**
- **Positional lost-in-the-middle: null** (100% at every position).
- **Superseded decision: RETRACTED** — the earlier 70% was a scorer artifact (regex false-flagged correct replies); Haiku=100% + a structured re-check contradict it.
- **Context dilution — fair size sweep (10k/50k/100k/200k tokens, contract buried ~50% among 4 hard negatives, K=5):**
  - *Accuracy dilution NOT observed* — frontier correct at every size (incl. ~280k real tokens); Haiku correct at 10k/50k/100k.
  - *Capacity ceiling IS real* — the single-agent prompt (~280k tokens) **overflows Haiku's 200k window (0/5, can't run)**; Nerveplane's routed context is ~155 tokens, always in-window.
  - *Cost win is large & always-true* — routed ~155 tok vs 10k–200k dumped = **68×–1296×** less context per task.
- **H8 — hard compositional retrieval (`HARD-RETRIEVAL.md`):** removed every crutch (3-fact join, low lexical overlap, rule-based disambiguation, 3 traps, per-seed-randomised answers). Frontier **and** Haiku scored **100% both-correct at 10k/50k/100k, 0 trap-falls, oracle 1.0** → accuracy dilution still not observed. A well-tested negative.
- **Conclusion:** frontier *and cheap* models resist these context stressors at the scales tested, so per-repo scoping + routing is a **cost + capacity/feasibility** win, **not an accuracy-rescue** win. Present the **Tier-A** results + this cost/capacity framing, not an accuracy slide. See the sweeps + CORRECTION in `results.md`.
