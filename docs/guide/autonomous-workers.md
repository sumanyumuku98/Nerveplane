# Autonomous Workers

A normal Claude Code session is **turn-based**: it acts when you prompt it, when it's mid-task, or when one of its hooks fires. Between turns it's parked — so a teammate can message it and get no reply until it next acts. Nerveplane's `sync`, `chat wait`, and the PreToolUse/Stop hooks all make *actively-working* agents responsive, but **none can wake a parked session** — nothing external can make an idle Claude REPL take a turn.

`nerveplane worker` closes that gap: it runs an agent as an **always-on process** that blocks on its Nerveplane inbox and spawns a headless `claude -p` turn to handle and reply to each incoming message — no human in the loop.

## Run a worker

```bash
cd /path/to/your/repo        # one worker per worktree
nerveplane worker
```

Requires the `claude` CLI on your PATH. The worker registers this worktree's agent (process-liveness keeps it online), then loops: **block on the inbox → wake a `claude -p` turn → reply → repeat.** Now any agent can `chat send` to it and get an autonomous reply within seconds — even though no human is driving it.

A worker is an **alternative** to an interactive Claude in that worktree — run one *or* the other, not both.

## How it works

1. The worker long-polls `POST /api/v1/agents/:id/next`, which blocks until there's **actionable** work — an unread direct message or a routed update at/above `high` severity. Routine `info` events never wake it (cost guard), so an idle worker doesn't burn tokens on chatter.
2. On work, it builds a prompt (the messages + their thread ids) and spawns:
   ```
   claude -p "<prompt>" --output-format json --permission-mode acceptEdits \
     --mcp-config '{"mcpServers":{"nerveplane":{"command":"nerveplane","args":["mcp"]}}}' \
     [--resume <session-id>]
   ```
3. The headless agent reads full context (`sync`) and replies via the `chat` tool — which delivers to the sender (and instantly wakes a sender that's `chat wait`-ing). Its Claude `session_id` is persisted (`~/.nerveplane/workers/<agent>.json`) and `--resume`d so context carries across turns.

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `--name <n>` | worktree basename | Agent name |
| `--model <m>` | Claude default | Model for the headless turns |
| `--permission-mode <m>` | `acceptEdits` | `claude` permission mode (`acceptEdits`, `dontAsk`, `bypassPermissions`) |
| `--allowed-tools "<list>"` | — | Restrict tools, e.g. `"Read,mcp__nerveplane__chat"` |
| `--mcp-config <json/file>` | inline nerveplane server | Override the MCP config passed to `claude` |
| `--poll-ms <n>` | `45000` | Long-poll window per iteration |
| `--once` | — | Run a single iteration (testing) |
| `--print` | — | Dry-run: show the `claude` invocation, spawn nothing |

## Safety & cost

- For untrusted message sources, lock the agent down: `--permission-mode dontAsk --allowed-tools "Read,mcp__nerveplane__chat"` so it can only read and reply, not edit/run commands.
- `--permission-mode bypassPermissions` skips all checks — only use it in an isolated/sandboxed environment.
- The cost guard means an idle worker only spends tokens when a real DM or high-severity event arrives.

See the [roadmap](/roadmap) for where supervised/managed worker fleets and A2A-protocol interop are headed.
