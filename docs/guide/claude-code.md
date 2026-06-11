# Claude Code Integration

```bash
bun run src/index.ts install claude-code
```

This writes three things into the current project and targets a **two-minute setup**:

## 1. `.mcp.json`

Registers the Nerveplane stdio MCP server so Claude Code can call the [six tools](/reference/mcp-tools). The stdio server is a thin bridge that proxies to the daemon's REST API, keeping the daemon the single writer.

## 2. A `PreToolUse` hook (`.claude/settings.json`)

Routing puts a warning in an agent's inbox, but **routed ≠ read** — MCP has no reliable server→agent push. The hook closes that last mile: before the agent runs `Edit`/`Write`/`MultiEdit`, it resolves the agent for the current worktree and injects any unread **high-severity** warnings straight into the agent's context. It always exits 0 and never blocks the edit — coordination must never break the host tool.

## 3. Agent instructions (`.claude/nerveplane-instructions.md`)

A snippet to fold into your repo's `CLAUDE.md` so agents follow the protocol:

1. **At startup**, call `register` and read the join packet before editing.
2. **Periodically and before finalizing**, call `sync`.
3. Before changing API contracts, DB schemas, or shared types, call `publish`.
4. Record durable decisions with `decision`.

## Other clients

The daemon also exposes a **Streamable HTTP MCP** endpoint at `http://127.0.0.1:7734/mcp`, so any HTTP-MCP-capable client (Cursor, Codex, custom agents) can connect without the stdio bridge. The same six tools are served over both transports from one definition.
