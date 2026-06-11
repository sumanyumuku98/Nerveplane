<div align="center">

<img src="assets/logo.svg" alt="Nerveplane" width="120" height="120" />

# Nerveplane

**The coordination plane for autonomous coding agents** — local-first, MCP-compatible, repo- and service-aware.

[![CI](https://github.com/sumanyumuku98/Nerveplane/actions/workflows/ci.yml/badge.svg)](https://github.com/sumanyumuku98/Nerveplane/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-online-22c55e?logo=readthedocs&logoColor=white)](https://sumanyumuku98.github.io/Nerveplane/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.2-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e.svg)](https://github.com/sumanyumuku98/Nerveplane/pulls)

</div>

Nerveplane keeps parallel coding agents aligned across **repos, branches, git worktrees, services, and microservice contracts** — passively sensing git state, detecting conflicts, and routing breaking API/contract changes to the agents in *consumer* repos, before merge.

> As developers run multiple coding agents in parallel, the bottleneck shifts from code generation to coordination. Nerveplane is the missing coordination layer.

📖 **[Documentation](https://sumanyumuku98.github.io/Nerveplane/)** · [Getting Started](https://sumanyumuku98.github.io/Nerveplane/guide/getting-started) · [Concepts](https://sumanyumuku98.github.io/Nerveplane/guide/concepts) · [full spec](docs/nerveplane_spec.md)

## Status

Early development. Building toward the MVP in milestones (see the build plan):

- **M0 — Scaffold** ✅ — Bun + TypeScript project, SQLite (WAL) storage via Drizzle, user-level daemon with lockfile / graceful shutdown / presence sweeper, CLI dispatch over a local REST API.
- **M1 — Substrate + passive sensing** ✅ — agent registry (durable `(name, worktree)` identity), typed event log, inbox/`sync`, task state machine, decision ledger, join packets; routing engine (direct / task-owner / same-repo fanout / capability match); the **passive sensing engine** — a repo watcher that emits `files_changed` events from git state *without* requiring agents to report them; the **6 consolidated MCP tools** (`register`/`sync`/`publish`/`task`/`decision`/`discover`) over stdio; `nerveplane install claude-code` (writes `.mcp.json` + a PreToolUse warning-injection hook). _Streamable HTTP MCP transport is sequenced as a near-term follow-up; stdio ships now._
- **M2 — Repo-aware conflict detection + eval harness** ✅ — pair-wise **same-file** (high) / **same-package** (medium) conflict detection across active agents, routed to exactly the colliding pair; conservative noise budget (fingerprint dedup, dismiss→suppress, auto-resolve when overlap clears); `nerveplane conflicts` to list/resolve/dismiss; a deterministic **eval harness** (`nerveplane eval`) reporting precision/recall/noise (currently 1.0/1.0/0.0 on the seeded scenarios).
- **M3 — Contract-aware cross-repo routing** ✅ — the differentiation wedge. A **service graph** (`services.yaml`) + in-process **OpenAPI** / **GraphQL** breaking-change diffing (vs the merge-base baseline) + **cross-repo routing**: when an agent changes a provided contract, the daemon senses it and routes high-severity warnings to active agents in **consumer** repos (direct + transitive + test owners), raising `service_contract_conflict` warnings with changed-field evidence. Verified live against spec §29 (billing → checkout/frontend/e2e; unrelated untouched). AsyncAPI/protobuf are pluggable behind the same interface (deferred).
- **M4 — Dashboard + human-in-the-loop** ✅ — a live **Svelte 5 dashboard** (served at `/dashboard`, `nerveplane dashboard` to open) with SSE-driven Agents / Tasks / Event-timeline / Conflicts / Decisions / Service-graph views and human actions (resolve/dismiss conflicts, approve/reject decisions, broadcast announcements); a `/events` SSE stream and `/api/v1/dashboard` snapshot; and the **Streamable HTTP MCP** endpoint (`/mcp`) sharing the 6 tools with the stdio server.

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
bun run build:dashboard # build the Svelte dashboard → dashboard/dist (served at /dashboard)
bun run dev:dashboard   # dashboard dev server (proxies /api + /events to :7734)
```

The dashboard is served from `dashboard/dist`; run `bun run build:dashboard` once before `nerveplane dashboard` (embedding it into the single binary is a planned follow-up).

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

## Contributing

PRs welcome. CI (typecheck · tests · conflict-detection eval gate · dashboard + binary build) runs on every push and pull request via [GitHub Actions](.github/workflows/ci.yml). Before opening a PR: `bun test && bun run typecheck`.

## License

[MIT](LICENSE) © 2026 Sumanyu Muku
