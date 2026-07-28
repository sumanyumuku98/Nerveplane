# Memory

Nerveplane gives agents a **universal, durable memory** that is shared across agents **and across CLIs** (Claude Code, Codex, opencode). It's the layer that lets one agent's hard-won context outlive its session — so a teammate, or the same task on a different CLI, can pick up where it left off.

## Why it's separate from what you already have

| Primitive | What it is |
|---|---|
| **events** | what happened — an episodic firehose, ephemeral attention |
| **chat** | point-to-point conversation, ephemeral |
| **decisions** | authoritative, verifiable rulings (owner-checkable) |
| **memory** | distilled, durable, retrievable *experience*, surfaced at the right moment |

Owner directives stay in the **decision ledger** (they're verifiable); memory is associative recall of experience, never a source of authority.

## The `memory` tool

- **`remember`** — store a memory. `kind='fact'` (durable knowledge/gotcha), `kind='episode'` (what happened / progress / where you left off), or `note`. Scope with `repo_id`/`task_id`; `pinned` boosts it; `supersedes` replaces an older one.
- **`recall`** — retrieve by `query` within a scope.
- **`list`** — scoped list, newest + pinned first.
- **`forget`** — delete by `id`.

Humans can inspect the store too: `nerveplane memory recall "<query>"` / `nerveplane memory list [--repo <id>] [--task <id>]`.

## When to remember (capture guidance)

Capture is **explicit and cheap** — you decide what's worth keeping. The agent instructions ask each agent to:

- **`recall` at the start of a task** for prior context (also injected automatically — see below).
- **`remember` (`kind='fact'`)** durable gotchas and decisions as you discover them.
- **`remember` (`kind='episode'`)** your progress and where you left off **before finishing or handing off**.

## Automatic recall injection

You don't have to call `recall` to benefit. Nerveplane injects a repo's relevant memories:

- at **SessionStart** — a fresh agent (any CLI) is handed prior context + a `▶ Resume:` line for the last task episode;
- into **worker** turns — an autonomous worker sees the repo's memories before it acts.

This is what makes cross-CLI continuity work with zero effort.

## Continuity example (outage / handoff)

**Before:** Claude is deep in `feat/payments`; an outage hits. You start a Codex worker in the same worktree — it knows nothing, re-reads the diff, re-derives the plan.

**After:** Claude had been calling `remember(kind=episode, task="payments", body="done: webhook handler; next: idempotency keys; gotcha: Stripe retries double-fire on 500")`. Codex's SessionStart recall surfaces that trail (keyed by repo + task, **CLI-agnostic**) → it resumes at "idempotency keys" with the gotcha in hand.

More coordination cases (duplicated work, repeated gotchas, onboarding, convention propagation) are in the [roadmap](/roadmap).

## Retrieval: keyword now, semantic later

- **Default — keyword (FTS5/BM25):** zero-config, in-process, ships in the single binary, no API keys, no data egress. Great for the technical vocabulary coding agents use (file paths, symbols, task ids).
- **Optional — semantic (`NERVEPLANE_MEMORY=hybrid`):** embeddings for fuzzy, cross-vocabulary recall, fused with keyword. Embedder is pluggable via `NERVEPLANE_EMBEDDER` (`ollama` = local, zero egress; `openai` = one key). Records are owned in Nerveplane's own SQLite either way, so enabling semantic never migrates your data.

## Privacy

Everything is local by default (SQLite under `~/.nerveplane/`). Nothing leaves your machine unless you opt into a cloud embedder. Outbound memory text is subject to the same [sensitive-content scanning](/guide/security) as chat/events.
