# Nerveplane

Local-first, MCP-compatible **coordination plane for autonomous coding agents** working in parallel across repos, branches, git worktrees, services, and microservice contracts.

> As developers run multiple coding agents in parallel, the bottleneck shifts from code generation to coordination. Nerveplane is the missing coordination layer.

See [`docs/nerveplane_spec.md`](docs/nerveplane_spec.md) for the full product & technical spec.

## Status

Early development. Building toward the MVP in milestones (see the build plan):

- **M0 — Scaffold** ✅ — Bun + TypeScript project, SQLite (WAL) storage via Drizzle, user-level daemon with lockfile / graceful shutdown / presence sweeper, CLI dispatch over a local REST API.
- **M1 — Substrate + passive sensing** ✅ — agent registry (durable `(name, worktree)` identity), typed event log, inbox/`sync`, task state machine, decision ledger, join packets; routing engine (direct / task-owner / same-repo fanout / capability match); the **passive sensing engine** — a repo watcher that emits `files_changed` events from git state *without* requiring agents to report them; the **6 consolidated MCP tools** (`register`/`sync`/`publish`/`task`/`decision`/`discover`) over stdio; `nerveplane install claude-code` (writes `.mcp.json` + a PreToolUse warning-injection hook). _Streamable HTTP MCP transport is sequenced as a near-term follow-up; stdio ships now._
- **M2 — Repo-aware conflict detection + eval harness** ✅ — pair-wise **same-file** (high) / **same-package** (medium) conflict detection across active agents, routed to exactly the colliding pair; conservative noise budget (fingerprint dedup, dismiss→suppress, auto-resolve when overlap clears); `nerveplane conflicts` to list/resolve/dismiss; a deterministic **eval harness** (`nerveplane eval`) reporting precision/recall/noise (currently 1.0/1.0/0.0 on the seeded scenarios).
- **M3 — Contract-aware cross-repo routing** — OpenAPI/GraphQL/protobuf/AsyncAPI breaking-change detection routed to consumer-repo agents (the thesis-proving demo).
- **M4 — Dashboard + coordination intelligence**.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2

## Quickstart

```bash
bun install
bun run daemon                      # run the coordination daemon (127.0.0.1:7734)

# in your repo (another shell) — the daemon auto-starts if not running:
bun run src/index.ts init           # register this repo with the daemon
bun run src/index.ts install claude-code   # write .mcp.json + the PreToolUse hook
bun run src/index.ts agents         # list active agents
bun run src/index.ts events         # show recent coordination events
bun run src/index.ts status         # daemon status / health
bun run src/index.ts stop           # stop the daemon
```

Once installed, agents (Claude Code/Cursor/Codex) call the MCP tools `register` → `sync` → `publish`/`task`/`decision`/`discover`. The daemon also **passively senses** git changes in registered worktrees, so agents are warned about each other's edits even if they never call `publish`.

All durable state lives under `~/.nerveplane/` (override with `NERVEPLANE_HOME`). A single user-level daemon spans all projects — cross-repo coordination is impossible with per-repo daemons.

## Development

```bash
bun test                # unit + integration tests
bun run typecheck       # tsc --noEmit (strict)
bun run build           # single-binary via bun build --compile
```

## Architecture

```
CLI / Claude Code / Cursor / Codex   (MCP stdio+HTTP · REST · SSE · A2A later)
        │
        ▼
  Nerveplane daemon (127.0.0.1:7734, ~/.nerveplane/)
   ├─ Integration  MCP tools · Hono REST · SSE · hooks installer
   ├─ Core         Agent Registry · Presence(TTL) · Tasks · Event Log · Decisions · Artifacts
   ├─ Sensing      repo watcher (git poll + FS watch) · diff analyzer   ← passive, no agent compliance
   ├─ Service      service-graph (YAML) · contract parsers / diff
   ├─ Routing      recipient selection · severity · dedup/suppression · conflict detection
   └─ Storage      SQLite WAL via Drizzle → optional Postgres later
```
