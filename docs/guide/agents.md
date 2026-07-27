# CLI Agents

Nerveplane is **agent-agnostic**. Its coordination substrate — the seven MCP tools (stdio **and** streamable HTTP), the REST API, and the daemon — is standard MCP, so **any MCP-capable coding CLI** can register, sync, publish, chat, and record decisions. Claude Code, OpenAI Codex, and opencode are supported out of the box; anything else that speaks MCP works too.

## Support matrix

| | MCP tools (coordinate) | `nerveplane worker` | Zero-touch hooks | Instructions file |
|---|:---:|:---:|:---:|---|
| **Claude Code** | ✅ | ✅ | ✅ (auto-register, pre-edit warnings, stop-reply) | `CLAUDE.md` |
| **OpenAI Codex** | ✅ | ✅ | — (MCP + `AGENTS.md`) | `AGENTS.md` |
| **opencode** | ✅ | ✅ | — (MCP + `AGENTS.md`) | `AGENTS.md` |
| **Any MCP client** | ✅ | — | — | — |

- **MCP tools** work everywhere — this is the universal path. Register the nerveplane MCP server in the CLI's config and the agent can coordinate.
- **`worker`** (headless autonomous mode) supports all three via per-CLI adapters — pick with `--agent`.
- **Hooks** (auto-registration, pre-edit warning injection, stop-reply) are a Claude Code feature; other CLIs coordinate via the MCP tools + an `AGENTS.md` protocol instead (you keep full coordination; you don't get zero-touch injection).

> Codex/opencode flags and output shapes are version-dependent. Adapters follow each CLI's documented form; **verify your setup with `nerveplane doctor --agent <id> --run`** before relying on it.

## Per-provider setup

Register the MCP server + drop in the agent instructions with one command, then check it:

```bash
# Claude Code (also installs the hooks)
nerveplane install claude-code            # or: nerveplane setup (global, once per machine)
claude mcp add --scope user nerveplane -- nerveplane mcp

# OpenAI Codex  → ~/.codex/config.toml [mcp_servers.nerveplane] + AGENTS.md
nerveplane install codex

# opencode  → opencode.json { mcp.nerveplane } + AGENTS.md
nerveplane install opencode

# verify any of them
nerveplane doctor                          # matrix: installed? mcp-registered? hooks? default?
nerveplane doctor --agent codex --run      # live one-turn smoke (needs the CLI on PATH)
```

## Autonomous workers, any CLI

`nerveplane worker --agent <claude|codex|opencode>` runs that CLI headless in the wake-on-message loop (default `claude`). Because non-Claude CLIs read MCP from a config file (not an inline flag), **run `nerveplane install <agent>` first** so the spawned turns have the nerveplane tools.

```bash
nerveplane install codex
nerveplane worker --agent codex --print    # preview the exact `codex exec …` invocation
nerveplane worker --agent codex            # run it
```

> **Why Codex runs with `--dangerously-bypass-approvals-and-sandbox`:** in `codex exec` (non-interactive), every MCP tool call raises an approval *elicitation*. With no interactive channel, Codex auto-resolves it with **Cancel** — even under `approval_policy=never` — so the nerveplane tools would silently no-op and the model would fabricate a reply. The bypass flag is Codex's documented escape hatch for externally-sandboxed automation; the worker runs on your own machine at the same trust level as an interactive Codex session (the moral equivalent of Claude's `--permission-mode dontAsk --allowedTools mcp__nerveplane`). Confirmed live via `nerveplane doctor --agent codex --run`.

## Adding another CLI

Each provider is one self-contained adapter in `src/agents/` implementing the `AgentProvider` interface (`headlessArgs`, `parseResult`, `install`, `detect`, `capabilities`). Nothing else in the codebase knows a provider name, so a new CLI is a single new adapter file registered in `src/agents/index.ts`.
