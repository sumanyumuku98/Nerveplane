# Claude Code Integration

**Fastest path — once per machine:**

```bash
nerveplane setup                                          # global hooks + login service + register this repo
claude mcp add --scope user nerveplane -- nerveplane mcp  # MCP server for all projects
# restart Claude Code
```

This installs the hooks at user scope (`~/.claude`), so there's **no per-repo setup** — every agent you launch auto-registers, and warnings/DMs are injected before edits.

If you'd rather wire a single repo (project scope):

```bash
claude mcp add nerveplane -- nerveplane mcp   # register the MCP server
nerveplane install claude-code                # project-scoped hooks + instructions
# restart Claude Code
```

## 1. The MCP server (`claude mcp add`)

`claude mcp add nerveplane -- nerveplane mcp` registers Nerveplane's [seven MCP tools](/reference/mcp-tools) the idiomatic way. The spawned stdio server is a thin bridge that proxies to the daemon's REST API, keeping the daemon the single writer.

- Scope: add `--scope user` (all your projects) or `--scope project` (commit a shared `.mcp.json`); default is local to you.
- HTTP transport (no stdio bridge): `claude mcp add --transport http nerveplane http://127.0.0.1:7734/mcp` — the same seven tools are served over both transports from one definition.

## 2. The hooks (`nerveplane install claude-code`)

This is the piece `claude mcp add` can't do. Two hooks:

- **`SessionStart`** → runs `nerveplane session-start`, which **auto-registers** the agent for the current worktree the moment a session begins — so registration never depends on the model remembering to call `register`. It also seeds the session with a short coordination summary (active peers + "call `sync`").
- **`PreToolUse`** → routing puts a warning in an agent's inbox, but **routed ≠ read** — MCP has no reliable server→agent push. Before the agent runs `Edit`/`Write`/`MultiEdit`, this hook resolves the agent for the current worktree and injects any unread **high-severity** warnings and **direct messages** straight into its context. Both hooks always exit 0 and never block — coordination must never break the host tool.

`nerveplane install claude-code` writes (under `.claude/` for the project, or `~/.claude/` with `--global`):
- `settings.json` — the `SessionStart` + `PreToolUse` hooks.
- `nerveplane-instructions.md` — the agent protocol (below).
- appends the instructions `@import` to `CLAUDE.md` (idempotent) so they load automatically — no copy-paste.

Flags: `--global` (user scope — install once, applies to all repos), `--with-mcp` (also write a project `.mcp.json` — use this if you don't have the `claude` CLI), `--print` (dry-run).

## 3. The agent protocol (auto-imported into `CLAUDE.md`)

1. You're **auto-registered** at session start; call `register` to add your capabilities/task and read the join packet.
2. **Periodically and before finalizing**, call `sync`.
3. Before changing API contracts, DB schemas, or shared types, call `publish`.
4. Record durable decisions with `decision`.
5. To talk to a specific agent, use `chat` (and `chat action='wait'` to block for a reply).

## Other clients

The Streamable HTTP endpoint (`http://127.0.0.1:7734/mcp`) works with any HTTP-MCP client (Cursor, Codex, custom agents) — register it the same way with `claude mcp add --transport http …` or your client's MCP config.
