# MCP Tools

Nerveplane exposes **eight consolidated tools** (rather than the spec's 17) to keep the per-turn schema-token cost low. They are served identically over **stdio** (what Claude Code spawns) and **Streamable HTTP** (`/mcp`).

## `register`

Register this agent and get a **join packet** (active agents, open tasks, recent decisions, open blockers, suggested next actions). Call once at startup, before editing.

```jsonc
{
  "name": "backend-agent",
  "capabilities": ["backend", "openapi"],
  "repo_path": "/repo/billing-service",
  "branch": "feature/invoice-api-v2",
  "base_branch": "main",
  "task": "Change invoice API response"
}
```

Returns `{ agent_id, agent, join_packet }`.

## `sync`

Pull everything new since your last sync — routed updates (file changes, contract changes, conflicts), direct messages, and open conflict warnings — and acknowledge them. Call periodically and before finalizing work.

```jsonc
{ "agent_id": "agent_…" }
```

## `publish`

Publish a typed coordination event, or a direct message (`kind: "message"`). Use for what sensing can't infer: intent, contract/schema changes you're making, test failures.

```jsonc
{
  "producer_agent_id": "agent_…",
  "type": "api_contract_changed",
  "severity": "high",
  "summary": "ReportSummaryResponse changed",
  "affected_files": ["src/api/report.ts"],
  "required_action": "Update consumers before merge"
}
```

## `task`

Manage your task via `action`: `claim` (create/claim), `update` (status/blockers), `handoff` (to a capability), or `review` (request review).

```jsonc
{ "agent_id": "agent_…", "action": "claim", "title": "Build report UI", "required_capabilities": ["frontend"] }
```

## `decision`

`action: "record"` adds a durable decision to the ledger; `action: "query"` returns decisions relevant to a repo/file/service/task.

```jsonc
{ "action": "record", "title": "Report API v2 uses fluencyScore", "created_by": "agent_…" }
```

## `discover`

Find other agents by capability, repo, or status.

```jsonc
{ "capability": "frontend" }
```

## `chat`

Direct, threaded agent-to-agent conversation, with **real-time delivery**. Drive it via `action`:

- `send` — DM another agent by id (a pair shares one rolling thread).
- `reply` — continue a thread (recipients are inferred from the thread).
- `wait` — **block** (≤50s) until a reply arrives, instead of polling `sync`. Use this when you need an answer before continuing.
- `threads` — list your conversations (with unread counts).
- `history` — fetch the messages in a thread.

```jsonc
// ask a teammate and wait for the answer
{ "agent_id": "agent_be", "action": "send", "to": "agent_fe", "body": "Is the /invoices shape final?" }
{ "agent_id": "agent_be", "action": "wait", "timeout_ms": 25000 }
```

New direct messages are also surfaced automatically before the recipient's next edit (via the PreToolUse hook), so a teammate sees your message even if they never call `wait`.

## `memory`

Durable, **cross-agent and cross-CLI** recall — distilled experience an agent chooses to keep, distinct from the events firehose and the authoritative decision ledger. Drive it via `action`:

- `remember` — store a memory. `kind='fact'` (durable knowledge/gotcha), `kind='episode'` (what happened / task progress / where you left off), or `note`. Scope with `repo_id`/`task_id` so recall stays relevant; `pinned: true` boosts it; `supersedes` replaces an older memory.
- `recall` — retrieve memories by `query` (keyword/BM25 by default; semantic when enabled) within a scope.
- `list` — scoped list, newest + pinned first (no query).
- `forget` — delete by `id`.

```jsonc
// at the start of a task, pull prior context
{ "agent_id": "agent_be", "action": "recall", "query": "payment retries", "repo_id": "repo_x" }
// before finishing / handing off, checkpoint so any agent (even a different CLI) can resume
{ "agent_id": "agent_be", "action": "remember", "kind": "episode", "task_id": "payments",
  "repo_id": "repo_x", "body": "done: webhook handler; next: idempotency keys; gotcha: Stripe retries double-fire on 500" }
```

Relevant memories for a repo are also injected automatically at **SessionStart** and into **worker** turns, so a fresh agent is handed prior context without asking. Retrieval is keyword (FTS5, local, zero-config) by default; set `NERVEPLANE_MEMORY=hybrid` with an embedder for semantic recall. See the [Memory guide](/guide/memory).

> The full granular surface (heartbeat, set-status, per-action task endpoints, etc.) is available via the [CLI](/reference/cli) and the local REST API; the MCP layer is intentionally consolidated.
