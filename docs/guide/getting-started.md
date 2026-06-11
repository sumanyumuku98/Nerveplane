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

## Register a repo

From inside any git repo or worktree:

```bash
bun run src/index.ts init      # registers this repo with the daemon
```

## Wire up Claude Code

```bash
bun run src/index.ts install claude-code
```

This writes a project `.mcp.json` (the 6 Nerveplane MCP tools) and a `PreToolUse` hook that injects high-severity coordination warnings into the agent's context before it edits. Restart Claude Code in the directory so it picks both up. See [Claude Code Integration](/guide/claude-code) for details.

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
