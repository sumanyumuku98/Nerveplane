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
   claude -p "<prompt>" --output-format json \
     --permission-mode dontAsk --allowedTools "mcp__nerveplane" \
     --mcp-config '{"mcpServers":{"nerveplane":{"command":"nerveplane","args":["mcp"]}}}' \
     [--resume <session-id>]
   ```
   `--permission-mode dontAsk --allowedTools "mcp__nerveplane"` is essential: it lets the headless agent call **all** the nerveplane MCP tools non-interactively while denying everything else. (Without it — e.g. under `acceptEdits` with no allow-list — Claude blocks MCP tool calls "pending permission", so the worker can never reply.)
3. The headless agent reads full context (`sync`) and replies via the `chat` tool — which delivers to the sender (and instantly wakes a sender that's `chat wait`-ing). On success the worker acks the handled messages and persists the Claude `session_id` (`~/.nerveplane/workers/<agent>.json`, `--resume`d so context carries across turns). Each turn (exit code, latency, errors) is logged to `~/.nerveplane/workers/<agent>.log`. A typical turn is ~10s.

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `--name <n>` | worktree basename | Agent name |
| `--model <m>` | Claude default | Model for the headless turns |
| `--permission-mode <m>` | `dontAsk` | `claude` permission mode (`dontAsk`, `acceptEdits`, `bypassPermissions`) |
| `--allowed-tools "<list>"` | `mcp__nerveplane` | Tools the agent may use; default grants all nerveplane MCP tools, nothing else |
| `--model <m>` | Claude default | Model for the headless turns (a faster model lowers latency/cost) |
| `--mcp-config <json/file>` | inline nerveplane server | Override the MCP config passed to `claude` |
| `--poll-ms <n>` | `45000` | Long-poll window per iteration |
| `--once` | — | Run a single iteration (testing) |
| `--print` | — | Dry-run: show the `claude` invocation, spawn nothing |

## Safety & cost

- **Default is reply-only and locked down:** `--permission-mode dontAsk --allowed-tools "mcp__nerveplane"` lets the agent use only Nerveplane's coordination tools — it can't edit files or run commands.
- To let a worker actually *do work* (not just reply), widen the tools, e.g. `--allowed-tools "mcp__nerveplane,Read,Edit,Bash" --permission-mode acceptEdits`.
- `--permission-mode bypassPermissions` skips all checks — only in an isolated/sandboxed environment.
- The cost guard means an idle worker only spends tokens when a real DM or high-severity event arrives.

## Troubleshooting

- **Worker isn't replying?** Check `~/.nerveplane/workers/<agent>.log` — every turn records its exit code, latency, and any stderr. A turn that says a tool was *"blocked pending permission"* means the tool isn't in `--allowed-tools`.
- Replies are **async** (~10s/turn). A sender's `chat wait` (max 50s) usually catches it, but if a turn runs long the reply still lands on the thread — `sync` or `chat wait` again to receive it.
- A worker stays *online* only while its process runs (process-based liveness). Run **one** worker per worktree.

See the [roadmap](/roadmap) for where supervised/managed worker fleets and A2A-protocol interop are headed.
