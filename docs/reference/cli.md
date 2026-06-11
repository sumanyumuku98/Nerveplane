# CLI Reference

All commands talk to the user-level daemon over its local REST API and auto-start it if needed.

## Daemon

| Command | Description |
|---|---|
| `nerveplane daemon` | Run the coordination daemon in the foreground (`127.0.0.1:7734`). |
| `nerveplane status` | Show daemon status and health. |
| `nerveplane stop` | Stop the running daemon. |

## Project

| Command | Description |
|---|---|
| `nerveplane init` | Register the current repo with the daemon. |
| `nerveplane install claude-code` | Wire Claude Code in (`.mcp.json` + PreToolUse hook + instructions). |
| `nerveplane agents` | List active agents (status, branch, capabilities). |
| `nerveplane events` | Show recent coordination events. |
| `nerveplane conflicts` | List open conflict warnings. |
| `nerveplane conflicts resolve <id>` | Mark a conflict resolved. |
| `nerveplane conflicts dismiss <id>` | Dismiss a conflict and suppress its re-raise. |

## Services & contracts

| Command | Description |
|---|---|
| `nerveplane service scan [path]` | Load a `services.yaml` into the service graph (defaults to `./services.yaml`). |
| `nerveplane services` | List registered services and contracts. |

## Dashboard & evaluation

| Command | Description |
|---|---|
| `nerveplane dashboard` | Open the live web dashboard in your browser. |
| `nerveplane eval` | Run the deterministic conflict-detection eval (prints precision/recall/noise). |

## Integration entrypoints

Usually invoked by tools, not humans:

| Command | Description |
|---|---|
| `nerveplane mcp` | Run the stdio MCP server (spawned by Claude Code / Cursor / Codex). |
| `nerveplane hook` | `PreToolUse` hook entrypoint (reads JSON on stdin). |

> During development, prefix with `bun run src/index.ts` (e.g. `bun run src/index.ts agents`). A compiled binary (`bun run build`) exposes them directly as `nerveplane <command>`.

State lives under `~/.nerveplane/` — override with the `NERVEPLANE_HOME` environment variable.
