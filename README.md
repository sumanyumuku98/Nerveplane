# Nerveplane

Local-first, MCP-compatible **coordination plane for autonomous coding agents** working in parallel across repos, branches, git worktrees, services, and microservice contracts.

> As developers run multiple coding agents in parallel, the bottleneck shifts from code generation to coordination. Nerveplane is the missing coordination layer.

See [`docs/nerveplane_spec.md`](docs/nerveplane_spec.md) for the full product & technical spec.

## Status

Early development. Building toward the MVP in milestones (see the build plan):

- **M0 — Scaffold** ✅ — Bun + TypeScript project, SQLite (WAL) storage via Drizzle, user-level daemon with lockfile / graceful shutdown / presence sweeper, CLI dispatch over a local REST API.
- **M1 — Substrate + passive sensing** — agent registry, typed event log, decision ledger, 6 consolidated MCP tools, repo watcher that senses git changes *without* requiring agents to report them.
- **M2 — Repo-aware conflict detection + eval harness** — same-file / same-package conflict routing with precision-focused severity + suppression.
- **M3 — Contract-aware cross-repo routing** — OpenAPI/GraphQL/protobuf/AsyncAPI breaking-change detection routed to consumer-repo agents (the thesis-proving demo).
- **M4 — Dashboard + coordination intelligence**.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2

## Quickstart

```bash
bun install
bun run db:generate     # regenerate SQL migrations after schema changes
bun run daemon          # run the coordination daemon (127.0.0.1:7734)

# in another shell:
bun run src/index.ts status
bun run src/index.ts stop
```

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
