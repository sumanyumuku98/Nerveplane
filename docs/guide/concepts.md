# Concepts

## The four graphs

Nerveplane's routing decisions are grounded in four interlocking graphs:

| Graph | Tracks |
|---|---|
| **Agent graph** | agents, capabilities, status, current task, ownership, presence |
| **Repo graph** | repos, branches, worktrees, changed files, diffs |
| **Service graph** | services, contracts, providers, consumers, events |
| **Decision graph** | durable decisions, blockers, contracts, dependencies |

The routing engine uses these to decide **which agents should receive which updates** — and, just as importantly, which should not.

## Passive sensing vs. publish

The core design choice (and the thing most mailbox-style tools get wrong): **coordination must not depend on agents reporting their work.** LLM agents are unreliable at protocol obligations, so an event log fed only by an explicit `publish` call starves.

Instead, the daemon **passively senses** each registered worktree on a poll: branch, changed files vs. the merge-base, diffs, and contract changes — and emits the coordination events itself. `publish` is reserved for things sensing can't infer (intent, a heads-up, a test failure), not the lifeblood.

## Durable agent identity & presence

An agent's identity is the natural key **(name, worktree path)**, so a reconnecting stdio MCP session re-attaches to the same row instead of duplicating. Presence is heartbeat-based; a sweeper marks agents `offline` past a TTL (agents crash without deregistering).

## Routing rules

When an event is emitted, the engine selects recipients (never the producer):

1. **Explicit recipients** always receive.
2. **Task owner** receives task events.
3. **Same-repo fan-out** — active agents in the affected repo get repo events.
4. **Capability match** — review/handoff requests go to agents with the required capability.
5. **Contract change → consumer repos** — a changed provider contract routes to active agents in *consumer* repos (direct + transitive + test owners), high priority. This is the cross-repo wedge.

## Conflict detection & the noise budget

**Precision is the binding constraint.** A noisy warning stream gets muted, and a muted tool is dead. So:

- **same-file** overlap between two agents → **high** (unambiguous; always warned).
- **same-package** overlap → **medium**, deduped to one warning per (pair, package), and **dismissible** (a dismissal writes a suppression so it won't re-raise).
- **different packages** → no warning.

Warnings are deduped by a stable fingerprint (no re-warning every poll) and **auto-resolve** when the overlapping edits go away. The [`eval`](/reference/cli) harness measures precision/recall/noise on seeded scenarios as a gate.

## Contract-aware routing

When a sensed change touches a registered contract spec, Nerveplane diffs the working tree against its **merge-base** baseline (`git show <merge-base>:<path>`). Breaking changes (removed/renamed/retyped response fields, removed endpoints, newly-required request fields for OpenAPI; `BREAKING` criticality for GraphQL) emit a high-severity `api_contract_changed` event and raise `service_contract_conflict` warnings for active consumers — each tagged direct / indirect / test-owner. (AsyncAPI and protobuf are pluggable behind the same interface.)

## The decision ledger

Durable project truth ("Report API v2 returns `fluencyScore`") lives in a ledger separate from message history, with a lifecycle (`draft` → `active` → `superseded`/`rejected`) and queries by file, repo, service, or task — so a late-joining agent gets current decisions without replaying every message.
