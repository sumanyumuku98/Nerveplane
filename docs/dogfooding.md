# Dogfooding Nerveplane

Nerveplane is developed with `dmux` git worktrees (`.dmux/worktrees/*`), i.e. multiple
coding agents in parallel across branches of this repo — exactly its target use
case. We run Nerveplane on itself.

## Setup (once)

```bash
bun install && bun run build:dashboard
bun run src/index.ts daemon &          # coordination daemon
bun run src/index.ts init              # register this repo
bun run src/index.ts install claude-code   # .mcp.json + PreToolUse hook
```

Add the snippet from `.claude/nerveplane-instructions.md` to `CLAUDE.md` so each
agent calls `register` at startup and `sync` before finalizing.

## What it catches here

- **Same-file collisions** — two agents editing `src/routing/engine.ts` on
  different branches → high warning to both.
- **Same-package overlap** — edits under `src/services/` from two agents → a
  deduped medium warning.
- **Contract changes** — editing the REST surface in `src/http/api.ts` or the
  MCP tool schemas surfaces to agents working against them.

## Watch it live

```bash
bun run src/index.ts dashboard   # agents, timeline, conflicts, decisions
bun run src/index.ts conflicts   # open warnings
bun run src/index.ts events      # recent coordination events
```

## Try the canned demos

```bash
sh examples/demo-passive-sensing.sh     # B sees A's edit, no publish needed
sh examples/demo-contract-routing.sh    # cross-repo breaking-change routing (spec §29)
sh examples/hook-check.sh               # the PreToolUse hook injects a warning
```

## Friction log

Track rough edges found while dogfooding here (e.g. noisy same-package warnings
in large dirs → tune severity/suppression; sensing latency vs poll interval).
This list feeds the backlog.
