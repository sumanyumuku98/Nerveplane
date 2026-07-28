# H8 — hard compositional retrieval under dilution (does context engineering rescue *accuracy*?)

> **Result (K=5, frontier Claude + `claude-haiku-4-5`, sizes 10k/50k/100k): H8 NOT supported.** Both models scored **100% both-correct at every size, 0 trap-falls, oracle 1.0**; raw replies match ground truth and vary per seed (genuine multi-hop reasoning). Even a cheap model does correct 3-hop disambiguation over 100k tokens of dilution with three traps. Honest conclusion: routing's value is **cost + capacity/feasibility, not accuracy rescue**. Full table in `results.md`.


**Motivation.** The fair dilution sweep (`results.md`) showed that a *single-lookup* fact ("find the CURRENT payments contract → `total`,`currency`") is retrieved correctly by frontier **and** cheap models at every size that fits the window — so scoping/routing was a **cost + capacity** win, not an **accuracy** win. That single-lookup task is too easy: the needle is lexically salient (the query words sit next to the answer), so it's a solved needle-in-a-haystack. This spike removes the three crutches that made retrieval easy and asks whether an *accuracy* gap opens.

## Hypothesis
**H8:** On a retrieval task that is **compositional** (answer = join of ≥3 facts at different depths), has **low lexical overlap** (query shares no keywords with the needles → can't be grepped), and requires **disambiguation-by-reasoning** (the authoritative fact is selected by a rule, not a "CURRENT" label), single-agent end-to-end accuracy **degrades as the diluted context grows** (and degrades earlier/worse on smaller-window models), while Nerveplane's **pre-joined, routed facts** keep accuracy ~flat-high at ~constant, tiny context.

The mechanism claim (the "context engineering" thesis in its strong form): the coordination layer's value is not "search a bigger haystack better" — it's that it **pre-resolves and delivers the already-joined, disambiguated answer-relevant facts**, so the agent never performs fragile multi-hop retrieval over a diluted context.

## The task (one worked instance)
> In `orders-svc`, render the invoice amount in the customer's billing currency for account `acct_<ID>`. Reply with ONLY `{"field":"…","currency":"…"}` where `field` is the monetary field on the **authoritative live** invoice contract and `currency` is the ISO code that account is billed in.

To answer, the agent must chain (each fact buried at a different depth, none adjacent to the query words):

- **Hop A — which invoice contract is authoritative?** Several `@contract` blocks exist across repos. Authority is **not** labelled; a rule stated once (buried) says: *"the live contract is the `@contract` with the highest `rev` whose `state` is `active`; ignore `retired`."* The agent must find all contracts, read each `rev`/`state`, and compare. → gives the monetary **field** name.
- **Hop B — which region does the account bill in?** `users-svc` lists many accounts; only `acct_<ID>` (from the task) has the right `billingRegion`. Wrong account → wrong region.
- **Hop C — which currency for that region?** An `fx-config` maps region→currency (current), plus a **deprecated** older map with a *different* currency for the same region (trap).

**Correct = {field: authoritative-contract's field, currency: fx[region(account)]}.** All three hops must succeed.

### Traps (one per hop — failure modes we can name)
- **A-trap:** a `retired` contract with a *higher* `rev` and a different field (`amount`) — punishes "pick the biggest number / pick the labelled one".
- **B-trap:** other accounts with other regions — punishes reading the wrong account.
- **C-trap:** a deprecated fx map giving a stale currency for the target region — punishes reading the wrong table.

### Anti-shortcut design (integrity)
- **Per-seed randomization.** field, region, and currency are drawn from pools each seed, so the model can't win on priors/memorization (no fixed "EUR/`total`" answer).
- **Low lexical overlap.** The query says "monetary field / billing currency"; the needles never repeat those words next to the values.
- **Structured scoring + raw-reply logging** (as in `live.ts`). Parse `{field,currency}`; score `field_correct`, `currency_correct`, `both_correct`, and per-trap fall rates.

## Conditions
- **C_single(size)** — one agent given the whole diluted world at target sizes **10k / 50k / 100k / 150k** tokens (sizes chosen to *fit* both models' windows, so an accuracy gap isn't confounded by overflow — overflow is already characterised separately in `results.md`).
- **C_routed (≡ oracle / Nerveplane)** — the three pre-joined facts delivered as short routed notes (~a few hundred tokens), size-invariant.
- **C_routed doubles as the solvability control.** If C_routed is not ~100%, the task is intrinsically too hard (a *reasoning* failure, not a *retrieval/dilution* failure) and any C_single drop is confounded — so **C_routed ≈ 100% is a required gate before interpreting C_single**.
- Both conditions allow the model to think (no forced one-liner) so we test *retrieval*, not output formatting.

## Secondary axis (isolate compositionality from size)
At a fixed ~100k context, vary what must be joined: **field-only**, **currency-only** (single hop-chain each), **both** (full compositional). If accuracy falls with the number of required hops at constant size, the failure is compositionality, not raw length.

## Metrics
- **`both_correct`** — end-to-end (headline), Δ vs C_routed, per size, K seeds + CI.
- **`field_correct` / `currency_correct`** — per-hop-chain, to localise *where* the big context fails.
- **trap-fall rates** (`chose_retired`, `wrong_region`, `stale_fx`) — names the failure mode.
- **context tokens** delivered (C_single grows with size; C_routed constant) + any overflow.

## Models
Frontier Claude (default) + `claude-haiku-4-5` (cheap arm — expected to degrade earlier).

## What each outcome means (pre-registered, so we can't spin it)
- **C_single degrades with size while C_routed stays flat-high** → H8 supported: context engineering *does* rescue accuracy on hard compositional retrieval; the multi-agent-per-repo + routing story is an accuracy win, not just cost/capacity.
- **C_single stays flat-high (like the single-lookup sweep)** → H8 not supported even here → the honest conclusion stands: routing's value is cost + capacity, and frontier retrieval is robust even for hard multi-hop joins at these scales. (Still a useful, publishable negative — and the cost/capacity numbers remain.)
- **C_routed < ~100%** → task too hard intrinsically; fix the task before drawing dilution conclusions.

## Threats
- *"You made single fail by making the task unsolvable."* → C_routed/oracle gate proves solvability.
- *"Cherry-picked values."* → per-seed randomization; report all seeds + CIs.
- *"Prompt-format artifact."* → both conditions same format/scorer; raw replies logged and audited (the lesson from the retracted supersede scorer).
- *"Just needle-in-haystack again."* → low lexical overlap + multi-hop + disambiguation-by-rule specifically defeat lexical retrieval.

## Runbook
```bash
# deterministic self-check (sizes, needles present, task derivable, randomization) — no agent/keys
bun run experiments/coordination-evals/hard-retrieval.ts --selftest
# live sweep (needs a real agent + key); K≥5; append results to results.md
NP_EVAL_AGENT=claude NP_EVAL_SEEDS=5 bun run experiments/coordination-evals/hard-retrieval.ts
NP_EVAL_AGENT=claude NP_EVAL_MODEL=claude-haiku-4-5 NP_EVAL_SEEDS=5 bun run experiments/coordination-evals/hard-retrieval.ts
```
Tier B is not a CI gate (costs money, nondeterministic). No new dependencies.
