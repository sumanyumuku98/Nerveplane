# NP-Bench — Tier-A results (deterministic)

C0 = uncoordinated (no Nerveplane) · C1 = Nerveplane on. Higher CTSR / lower conflicts+waste is better.

| scenario | dep class | CTSR C0→C1 | merge conflicts C0→C1 | wasted LOC C0→C1 | routing hit (C1) | false routing (C1) |
|---|---|---|---|---|---|---|
| shared-file | same-file overlap | ❌→✅ | 1→0 | 5→0 | 100% | 0% |
| contract | producer→consumer contract | ❌→✅ | 0→0 | 0→0 | 100% | 0% |
| microservice-fanout | cross-repo contract fan-out | ❌→✅ | 0→0 | 0→0 | 100% | 0% |
| independent-control | no dependency (control) | ✅→✅ | 0→0 | 0→0 | — | 0% |

**Aggregate:**

- CTSR: **1/4 → 4/4** (uncoordinated → Nerveplane)
- Merge conflicts: **1 → 0**
- Wasted LOC: **5 → 0**

_Tier A is a deterministic simulation of agent reaction (coordinated edit iff Nerveplane warned in time), driving the product's real sensing/detection/routing. Tier B (live agents) validates externally — see `live.ts` + `results.md` appends._

---

## Tier-B — lost-in-the-middle (H7): NULL RESULT (honest)

Live run — agent=claude (Claude Code 2.1.170), K=5 seeds, 200-note dump (~10–12k tokens):

| condition | critical-fact adherence |
|---|---|
| dump, fact at **start** | 100% |
| dump, fact at **middle** | 100% |
| dump, fact at **end** | 100% |
| Nerveplane **routed** | 100% |

**H7 is NOT supported by this run.** No U-shaped dip: a frontier model recalled the buried fact regardless of position, and routing showed no adherence advantage at this scale. The classic lost-in-the-middle effect requires much larger contexts (100k+ tokens) and/or weaker/cheaper models (e.g. Haiku) and a less-salient fact; do **not** present a lost-in-the-middle slide on this evidence.

**What routing genuinely buys (reframed):** context *efficiency*, not attention rescue — the dump spent ~10–12k tokens to deliver one fact vs. ~60 tokens routed (~150× less cost/latency) for the same outcome. Routing's proven value remains the Tier-A results (conflict avoidance, precise cross-repo consumer routing), not H7.

**Follow-ups to actually test H7 (labeled, not cherry-picked):** re-run with `NP_EVAL_AGENT` on a cheaper/weaker model, `NP_EVAL_DISTRACTORS` ≫ (100k+-token context), and a lower-salience fact; report the curve whatever it shows.

---

## Tier-B (frontier) — recreating the failure via a SUPERSEDED decision

> ⚠️ **RETRACTED — see the CORRECTION section below.** The 70% figure here was a **scorer artifact** (a regex that false-flagged correct replies). Do not cite it.

The pure positional dip doesn't appear on frontier models, so we tested the realistic failure they *do* exhibit: a **superseded decision under distraction + recency**. The current decision is buried mid-history; a stale decision sits early and a plausible distractor reinforcing it sits at the recency edge; hard-negative auth notes add interference. Live — agent=claude (frontier):

| experiment | dump (history in context) | Nerveplane routed | n |
|---|---|---|---|
| positional recall (start/mid/end) | 100% / 100% / 100% | 100% | K=5 |
| **superseded decision** | **70%** | **100%** | **K=20** |

**Finding (frontier, K=20):** with the current decision buried and a stale+recent distractor pulling the other way, frontier Claude picked the **wrong (deprecated) auth in 6/20 runs (70% adherence)**; routing the *current* decision fixed it (**20/20, 100%**). ≈30% absolute lift; Fisher exact 14/20 vs 20/20 ≈ **p≈0.02** — directionally strong and significant at this n. The model isn't rescued from *position*; it's handed the authoritative current fact instead of a history where the update is buried and a wrong note is recent — exactly Nerveplane's decision-ledger(supersede) + JIT-routing value.

**Honest framing:** reframe H7 from "lost-in-the-middle" (which frontier models resist — 100% positional recall above) to **"current-decision adherence under stale/recency distraction."** That's the claim that survives on frontier models. Expect the gap to widen further on cheaper models (`NP_EVAL_MODEL`) and larger contexts; a bigger n + a model sweep would harden it further.

---

## CORRECTION — consolidated H7 findings (integrity)

After more runs (incl. a structured-output scorer + raw-reply logging), the H7 "context-rescue" claims do **not** hold up on frontier models at the scales tested. Correcting the record:

| variant | finding (frontier Claude) | status |
|---|---|---|
| positional lost-in-the-middle | 100% at every position | null (frontier resists) |
| **superseded decision** | earlier "70% dump" was a **scorer artifact** (`!/express-session/` false-flagged *correct* "use authClient, NOT express-session" replies); Haiku=100% + structured re-check contradict it | **RETRACTED** |
| context dilution (single agent, all repos vs scoped+routed) | both 100% correct (raw replies: `["total","currency"]`) at 6-repo scale | null at this scale |

**Honest takeaways:**
1. Frontier models are robust to these context stressors at modest scale → **do not present an H7 "context-rescue" slide.** The earlier 70%→100% supersede number is retracted (measurement artifact).
2. Lesson: **score structured output + log raw replies** — regex-on-prose negation caused a false effect. `live.ts` now does both.
3. The **defensible** claims remain: (a) **context efficiency** — scoping/routing delivers far fewer tokens than dumping N repos (magnitude only becomes compelling with realistic large-repo fixtures); (b) the **Tier-A coordination outcomes** (CTSR 1/4→4/4, conflicts 1→0, routing 100%/0%) which don't rely on context effects.
4. To properly test dilution/degradation: realistic large-repo fixtures (tens of thousands of tokens) and/or weaker/cheaper models, pre-registered scale — future work, not to be reverse-engineered into a win.

---

## Context dilution — the FAIR test (size sweep, both models)

The earlier 6-repo dilution (~hundreds of tokens) was **not a fair test** — it can't dilute a 200k–1M window. Rebuilt as a size-swept generator: a single agent must retrieve the **CURRENT** payments invoice contract (`total`,`currency`), buried at **~50% depth** among **4 hard-negative money shapes** (`amount` / `grossValue`+`tax` / `subtotal`+`vat` / `netAmount`+`fx`) in a codebase filled to a target token budget. Nerveplane's condition = its own repo + **one routed fact** (~155 tokens, size-invariant). Structured JSON scoring, K=5, raw replies logged. `agent=claude` (frontier = default 1M-window model; Haiku = `claude-haiku-4-5`).

| single-agent context | frontier Claude | Haiku (200k window) | Nerveplane routed | single-agent size vs routed |
|---|---|---|---|---|
| ~10k tok | 100% correct | 100% correct | 100% | 68× |
| ~50k tok | 100% correct | 100% correct | 100% | 326× |
| ~100k tok | 100% correct | 100% correct | 100% | 650× |
| ~200k tok (≈280k real) | 100% correct | **OVERFLOW — 0/5, can't run** | 100% | 1296× |

**Honest findings:**
1. **Accuracy dilution NOT observed.** While the diluted context *fits*, both frontier and the cheap model pick the CURRENT contract over 4 hard negatives — up to 100k for both, up to ~280k real tokens for the frontier model. The "context rot degrades correctness" hypothesis is **not supported** at these scales/this task. Do not claim an accuracy rescue.
2. **Capacity ceiling IS real for smaller-window models.** The single-agent "hold the whole microservices world" prompt is ~280k real tokens; Haiku's 200k window **rejects it outright (5/5 overflow)** — single-agent is simply *infeasible*. Per-repo scoping keeps every agent ~155 tokens → always in-window. (Harness now counts overflow separately from wrong answers.)
3. **Cost/efficiency is the large, always-true win.** Routing delivers the one needed fact in **~155 tokens vs 10k–200k dumped = 68×–1296× less context per task**, per agent, every task — even when the big-context model succeeds, it burned ~280k input tokens to answer what routing answered in ~155.

**Honest reframe of the "context engineering" thesis (the leadership line):** at current frontier scales, per-repo scoping + routing is a **cost + capacity/feasibility** win, **not an accuracy-rescue** win. The multi-agent-per-repo argument is *not* "a frontier model can't find the fact in a big context" (it can) — it's "each agent stays cheap and within-window, while a single agent carrying everything is 2–3 orders of magnitude more expensive and, on smaller-window models, eventually **cannot fit at all**." Quantified, reproducible, and honest about what we did not find.

---

## H8 — HARD compositional retrieval under dilution (does routing rescue *accuracy*?)

The single-lookup task above was too easy (lexically salient needle). H8 removes the crutches (design: `HARD-RETRIEVAL.md`): the answer is a **join of 3 facts** at different depths, with **low lexical overlap** to the query, where the authoritative contract is chosen by a **rule** (highest `rev` with `state: active`), not a "CURRENT" label. Per-seed randomised answers (no priors), 3 named traps (retired-but-higher-rev contract / wrong region / deprecated fx map). Structured scoring + raw-reply audit; K=5; sizes chosen to fit both windows. `C_routed` (pre-joined facts) is the solvability gate.

| single-agent context | frontier Claude | Haiku (`claude-haiku-4-5`) | routed/oracle |
|---|---|---|---|
| ~10k tok | 100% both-correct | 100% both-correct | 100% |
| ~50k tok | 100% both-correct | 100% both-correct | 100% |
| ~100k tok | 100% both-correct | 100% both-correct | 100% |

Trap-fall rate = 0 across the board; parse-fail = 0; oracle = 1.0 (task is genuinely solvable). Raw replies confirm answers **match ground truth and vary per seed** (e.g. Haiku@100k: `netPayable/BRL`, `netPayable/SGD`, `balanceOwed/JPY`, `netPayable/EUR`) — genuine multi-hop reasoning, not a prior.

**Finding: H8 NOT supported — a robust, well-tested negative.** Even a *cheap* model does correct 3-hop disambiguation-by-rule over 100k tokens of dilution with three traps. We removed every crutch and modern models still don't lose *accuracy* to dilution at window-fitting scales. This strengthens (does not weaken) the honest thesis: **the value of per-repo scoping + routing is cost + capacity/feasibility, not accuracy rescue.** Presenting the cost/capacity numbers + the proven Tier-A coordination outcomes is the credible pitch — precisely because we tried hard to find an accuracy win and reported that we couldn't.

*(Where an accuracy gap would plausibly appear: contexts beyond the reliable window (≫200k, where overflow/capacity already bites), tasks needing aggregation over *many* buried instances rather than a fixed-arity join, or much weaker/older models. Out of scope here; flagged as honest future work, not reverse-engineered into a win.)*
