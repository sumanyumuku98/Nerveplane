# Getting Started

Nerveplane runs as a single **user-level daemon** (`~/.nerveplane/`, port `7734`) spanning all your projects. Agents register into it; it senses your repos and routes coordination signals to the agents that are actually affected.

## Install

No Bun required for the binary installs (the runtime is bundled).

```bash
# Homebrew (macOS / Linux)
brew install sumanyumuku98/nerveplane/nerveplane

# Shell (macOS / Linux, arm64 & x64)
curl -fsSL https://raw.githubusercontent.com/sumanyumuku98/Nerveplane/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/sumanyumuku98/Nerveplane/main/install.ps1 | iex

# npm (requires Bun ≥ 1.2)
npm i -g nerveplane
```

**From source** (requires Bun ≥ 1.2 and `git`):

```bash
git clone https://github.com/sumanyumuku98/Nerveplane.git && cd Nerveplane
bun install && bun run build:dashboard
```

## Run

```bash
nerveplane daemon        # coordination daemon on 127.0.0.1:7734
```

The CLI auto-starts the daemon if it isn't running, so in day-to-day use you rarely start it by hand. To keep it running at login: `nerveplane service install`. (From source, prefix commands with `bun run src/index.ts`.)

## One-time setup (recommended)

Run this **once per machine** — it installs the Claude Code hooks at user scope (`~/.claude`, so they apply to every repo), installs a login service so the daemon is always-on, and registers the current repo:

```bash
nerveplane setup                                          # global hooks + login service + repo
claude mcp add --scope user nerveplane -- nerveplane mcp  # register the MCP server for all projects
# restart Claude Code
```

After this there is **no per-repo setup**: every agent you launch is **auto-registered** by a `SessionStart` hook, and the `PreToolUse` hook injects coordination warnings + direct messages before edits. Add `--no-service` to skip the login service, or `--print` for a dry run.

## Manual / per-repo setup

If you'd rather not install globally:

```bash
nerveplane init                              # (optional) pre-register this repo — agents register themselves anyway
claude mcp add nerveplane -- nerveplane mcp  # register the MCP server (HTTP: --transport http http://127.0.0.1:7734/mcp)
nerveplane install claude-code               # project-scoped hooks in ./.claude (no `claude` CLI? add --with-mcp)
# restart Claude Code in this directory
```

`init` is optional — an agent's `register` tool (and the SessionStart hook) register the repo automatically. See [Claude Code Integration](/guide/claude-code) for details.

## See it work

Run two agents in two worktrees of the same repo and have one edit a file. Without the first agent publishing anything, the daemon senses the change and the second agent's next `sync` surfaces it:

```bash
bun run src/index.ts agents     # who's active
bun run src/index.ts events     # recent coordination events
bun run src/index.ts conflicts  # open conflict warnings
bun run src/index.ts dashboard  # open the live web dashboard
```

## Verify the conflict engine

A deterministic evaluation harness builds throwaway git worktrees with seeded conflicts and reports precision/recall:

```bash
bun run src/index.ts eval
```

## Next steps

- [Concepts](/guide/concepts) — how sensing, routing, and conflict detection work
- [CLI Reference](/reference/cli) · [MCP Tools](/reference/mcp-tools) · [Architecture](/reference/architecture)
