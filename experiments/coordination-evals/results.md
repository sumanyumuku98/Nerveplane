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
