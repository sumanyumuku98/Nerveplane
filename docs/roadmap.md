# Roadmap & Future Work

This document is written so **any agent (or contributor) can pick up the next phase** without prior context. It captures the unbuilt phases (M8, M9) in implementation-ready detail, plus the conventions the project follows.

## Where things stand (shipped)

| Phase | Status |
|---|---|
| M0 Scaffold — Bun/TS, SQLite (WAL) via Drizzle, user-level daemon, CLI | ✅ |
| M1 Substrate + **passive sensing** — registry, typed events, inbox/sync, decision ledger, 6 MCP tools (stdio), join packets, Claude Code installer + hook | ✅ |
| M2 **Intra-repo conflict detection** + eval harness — same-file/same-package, dedup/suppression/auto-resolve | ✅ |
| M3 **Contract-aware cross-repo routing** — service graph, OpenAPI/GraphQL diff, consumer routing, `service_contract_conflict` | ✅ |
| M4 Dashboard (Svelte) + SSE + human actions + **Streamable HTTP MCP** | ✅ |
| M5 Packaging — npm (`nerveplane`), standalone binaries, `install.sh`, release workflow, service unit, embedded migrations + dashboard | ✅ |
| M6 Distribution — Homebrew tap, Windows/linux-arm64 binaries, install matrix | ✅ |
| M7 Hardening — AsyncAPI + protobuf diff, runnable demos, hook test, dogfooding | ✅ |
| **M8 Deeper repo intelligence** | ⬜ future |
| **M9 Team / distributed mode + security** | ⬜ future |

The shipped product already delivers the full thesis: keep parallel coding agents aligned across repos/branches/worktrees/services/contracts. M8/M9 deepen the moat and extend beyond a single laptop.

## How to pick up a phase (conventions)

- **One branch + PR per phase** (`m8-intelligence`, `m9-distributed`); merge before the next.
- **`main` is branch-protected** — PRs only; CI (`typecheck · test · build`) must pass.
- **Dependency policy:** never add/upgrade to a version released < 7 days ago (npm, GitHub Actions, etc.); commit `bun.lock`. Pin GitHub Actions to releases > 7 days old (`actions/checkout@v6.0.2`, `oven-sh/setup-bun@v2.2.0`).
- **Eval gate is the regression guard:** `nerveplane eval` (precision/recall on seeded conflict scenarios) must not regress as detectors are added. Extend `src/eval/harness.ts` with new scenarios per phase.
- **Compiled-binary smoke:** any new embedded asset (e.g. tree-sitter WASM) must be bundled via a static `with { type: "text" | "file" }` import (see `src/storage/migrate.ts` and the dashboard import in `src/http/app.ts`); verify the binary works from a dir with no source files beside it.
- Tag a minor release (`v0.x.0`) after each phase; the release workflow publishes npm + binaries + bumps the Homebrew formula.

---

## M8 — Deeper repo intelligence (spec Phase 4 / V2 signals)

**Goal:** detect conflicts that file-overlap can't see — semantic, symbol-level, cross-branch.

**Work**
- **Symbol graph** — `src/repo/symbols.ts` using `web-tree-sitter` + `tree-sitter-typescript` / `tree-sitter-python` WASM grammars (no native compile). Per changed file, extract exported symbols (defs) and imports/references. Cache per `(repoId, headSha)`. Embed the WASM grammars for the binary via `with { type: "file" }`.
- **Deleted-/renamed-symbol-usage detection** — `src/conflicts/semantic.ts`: when agent A removes/renames an exported symbol that agent B's branch imports/references, raise a `semantic_conflict_detected` (high) with evidence (symbol, definer branch, referencing files). Plug into the sensing→detect loop next to M2's detector (`src/conflicts/detect.ts`); reuse the fingerprint dedup + auto-resolve.
- **Generated-type staleness & test-impact (lighter)** — flag stale generated types in a consumer when a contract changes; map changed files → owning tests via the import graph for a "tests likely affected" hint on `branch_ready`.
- **Merge-readiness score** — per active branch, 0–100 from open conflicts (file/package/semantic/contract); surface on the dashboard + `nerveplane status`.
- **Contract inference from code (best-effort)** — `src/services/infer.ts`: detect routes/handlers from common frameworks (Hono/Express, FastAPI) via tree-sitter to synthesize contracts when no explicit spec file exists; mark `inferred`. Lifts the current "spec file must be in-repo" limit.

**Deps:** `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-python` (WASM grammars).

**Verify:** eval scenarios — A deletes `export foo`, B imports `foo` → exactly one high semantic warning, none when unrelated (precision); inference produces a contract for a sample Hono route file; merge-readiness reflects open conflicts.

---

## M9 — Team / distributed mode + security (spec Phase 5 / §22)

**Goal:** beyond one laptop — remote agents, real identity, durable team storage. The biggest, most speculative phase; only worth it once teams use it.

**Work**
- **A2A endpoint** — `src/a2a/`: serve `/.well-known/agent-card.json` + the A2A JSON-RPC surface (`message/send`, `message/stream` SSE, `tasks/get`, `tasks/cancel`) mapping onto the existing agent/task/event model (the task model was deliberately kept A2A-shaped). Consider `@a2a-js/sdk` if it integrates cleanly with Hono/Bun; else a thin hand-rolled handler.
- **Signed identities** (spec §22 V1) — `src/security/identity.ts`: per-agent Ed25519 keypair via Web Crypto (no dep) generated at register; sign events/messages; daemon verifies; public key in agent `metadata`. Per-agent capabilities/permissions; human-approval gate for `blocking`-severity events before they route.
- **Postgres / networked server mode** — swap to `drizzle-orm/postgres-js` behind `NERVEPLANE_DB=postgres://…` (the DB layer in `src/storage/db.ts` was designed for this swap); a `nerveplane serve --remote` mode with bearer-token auth middleware on `/api` + `/mcp`; RBAC (human vs agent roles). Driver: `postgres` (postgres-js).
- **Security hardening** (spec §22) — tamper-evident audit log (hash-chained `events`), secret scanning of message/artifact bodies (regex + entropy) blocking high-risk publishes, data-retention/pruning controls, optional dashboard auth (token; SSO deferred).

**Deps:** `@a2a-js/sdk` (or none), `postgres`. Signing via Web Crypto (no dep).

**Verify:** external A2A client fetches the agent card and drives a task; signed-message tamper test (modified body fails verification); Postgres mode passes the full `bun test` against a CI Postgres service container; audit-chain verification test; secret-scanner blocks a planted token.

---

## M10 — Autonomous workers / always-on agents

**Goal:** true real-time autonomous agent-to-agent coordination — an incoming message wakes a recipient that has
no human driving it. **Why it's needed:** a Claude Code agent is turn-based with no background loop, and nothing
external can wake a parked/idle interactive session (hooks only fire on the agent's own activity). The shipped
`chat wait` (block for a reply) and the **`Stop` hook** (handle teammate DMs before going idle) make *concurrently
active* agents responsive, but neither can wake a fully-parked agent. A real background run-loop can.

**Work**
- **`nerveplane worker`** (`src/cli/worker.ts`) — a long-lived loop that, per iteration, **blocks on Nerveplane
  for actionable work** (a new `/agents/:id/next` long-poll returning unread DMs / routed high-severity events /
  task assignments, built on `waitForChat`'s in-process bus), then **invokes a headless agent turn**:
  `claude -p "<context>" --output-format json --append-system-prompt "<role + nerveplane protocol>"` with the
  Nerveplane MCP server configured (so the agent can `chat`/`publish` to reply), or the **Claude Agent SDK** for
  persistent context (`--resume` / session id). Loop. An incoming DM thus triggers a real agent turn with no human.
- **Concerns to design through:** one worker per worktree (locking via the agent row); **cost control** — only wake
  on actionable items (DMs, high/blocking severity, task assignments), never every `info` event; context continuity
  (Agent SDK vs `claude -p --resume`); supervision (the worker itself as a login service, reusing `installService`);
  tool allow-list / sandboxing; stop conditions + backoff to avoid runaway loops.
- **A2A tie-in:** this worker model + the reserved `/.well-known/agent-card.json` (see M9) is the natural place to
  expose Google **A2A** endpoints so *external* A2A agents can message Nerveplane-managed workers. Note this is a
  distinct goal (cross-framework interop) from "wake an idle Claude agent" — don't conflate them.

**Verify:** with two `nerveplane worker`s running (no humans), agent A's `chat send` to B causes B to wake, reply,
and the exchange to complete autonomously; an `info`-only event does **not** wake a worker (cost guard).

---

## Smaller follow-ups

- Branch-protection `enforce_admins` is on — there's no direct-push escape hatch for the owner; relax if that becomes inconvenient.
- The Homebrew formula auto-bumps on tagged releases only if a `HOMEBREW_TAP_TOKEN` secret is present.
- Linux-arm64 / Windows binaries are built and released; only macOS + linux-x64 are covered by the initial brew formula until a release includes the others.
