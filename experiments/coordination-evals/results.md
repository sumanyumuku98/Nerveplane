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
