# Architecture

A single user-level Bun daemon exposes four surfaces over one local HTTP server, backed by SQLite (WAL).

```
CLI / Claude Code / Cursor / Codex   (MCP stdio + Streamable HTTP · REST · SSE · A2A later)
        │
        ▼
  Nerveplane daemon (127.0.0.1:7734, ~/.nerveplane/)
   ├─ Integration  MCP (6 tools) · Hono REST (/api/v1) · SSE (/events) · hooks installer · dashboard (/dashboard)
   ├─ Core         Agent Registry · Presence (TTL) · Task SM · Typed Event Log · Inbox · Decision Ledger · Artifacts
   ├─ Sensing      repo watcher (git poll) · diff analyzer · contract-change detector   ← passive, no agent compliance
   ├─ Service      service graph (YAML) · contract registry · OpenAPI/GraphQL diff
   ├─ Routing      recipient selection · severity scoring · dedup/suppression · conflict detection
   └─ Storage      SQLite WAL via Drizzle → optional Postgres later
```

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun (single-binary via `bun build --compile`) |
| MCP | `@modelcontextprotocol/sdk` — stdio + Web-standard Streamable HTTP |
| HTTP | Hono |
| Storage | `bun:sqlite` (WAL) via Drizzle ORM |
| Git | `simple-git` (shell-out; full worktree support) |
| Contract diff | in-process OpenAPI detector + `@graphql-inspector/core` |
| Dashboard | Svelte 5 + Vite (served at `/dashboard`) |

## Data model (SQLite)

Core tables: `agents`, `capabilities`, `tasks`, `events`, `deliveries` (per-recipient inbox), `messages`, `decisions`, `repos`, `services`, `contracts`, `conflict_warnings`, plus `agent_worktree_state` (latest sensed git state per agent), `sync_markers` (per-agent read cursor), and `suppressions` (dismissed-warning fingerprints).

## Write path

Everything that ends up in an agent's `sync` flows through a single `emitEvent`: it appends a typed event, runs the **routing engine** to compute per-recipient `deliveries`, and notifies the in-process **event bus** (which the `/events` SSE stream and dashboard subscribe to). Whether the event originated from an agent's `publish` or from the passive sensing loop, it takes the same path.

For the complete entity definitions, event taxonomy, and roadmap, see the [full specification](/nerveplane_spec).
