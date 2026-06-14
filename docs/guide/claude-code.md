# Claude Code Integration

Two steps — register the MCP server with Claude Code's native CLI, then add Nerveplane's proactive hook:

```bash
# 1. register the MCP server
claude mcp add nerveplane -- nerveplane mcp

# 2. add the PreToolUse hook + agent instructions
nerveplane install claude-code

# 3. restart Claude Code
```

## 1. The MCP server (`claude mcp add`)

`claude mcp add nerveplane -- nerveplane mcp` registers Nerveplane's [six MCP tools](/reference/mcp-tools) the idiomatic way. The spawned stdio server is a thin bridge that proxies to the daemon's REST API, keeping the daemon the single writer.

- Scope: add `--scope user` (all your projects) or `--scope project` (commit a shared `.mcp.json`); default is local to you.
- HTTP transport (no stdio bridge): `claude mcp add --transport http nerveplane http://127.0.0.1:7734/mcp` — the same six tools are served over both transports from one definition.

## 2. The `PreToolUse` hook (`nerveplane install claude-code`)

This is the piece `claude mcp add` can't do. Routing puts a warning in an agent's inbox, but **routed ≠ read** — MCP has no reliable server→agent push. The hook closes that last mile: before the agent runs `Edit`/`Write`/`MultiEdit`, it resolves the agent for the current worktree and injects any unread **high-severity** warnings straight into the agent's context. It always exits 0 and never blocks the edit — coordination must never break the host tool.

`nerveplane install claude-code` writes:
- `.claude/settings.json` — the PreToolUse hook.
- `.claude/nerveplane-instructions.md` — the agent protocol (below).
- appends `@.claude/nerveplane-instructions.md` to `CLAUDE.md` (idempotent) so the instructions load automatically — no copy-paste.

Flags: `--with-mcp` (also write a project `.mcp.json` — use this if you don't have the `claude` CLI), `--print` (dry-run).

## 3. The agent protocol (auto-imported into `CLAUDE.md`)

1. **At startup**, call `register` and read the join packet before editing.
2. **Periodically and before finalizing**, call `sync`.
3. Before changing API contracts, DB schemas, or shared types, call `publish`.
4. Record durable decisions with `decision`.

## Other clients

The Streamable HTTP endpoint (`http://127.0.0.1:7734/mcp`) works with any HTTP-MCP client (Cursor, Codex, custom agents) — register it the same way with `claude mcp add --transport http …` or your client's MCP config.
