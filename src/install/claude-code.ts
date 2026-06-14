import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
const CLAUDE_MD_IMPORT = "@.claude/nerveplane-instructions.md";

/** How to launch `nerveplane <sub>` from generated config / printed commands.
 *  Prefers a `nerveplane` on PATH (installed binary / npm global); falls back to
 *  the dev `bun run <entry>` form. */
function invocation(sub: string): { command: string; args: string[] } {
  const onPath = Bun.which("nerveplane");
  if (onPath) return { command: "nerveplane", args: [sub] };
  const isBun = /bun(\.exe)?$/.test(basename(process.execPath));
  return isBun
    ? { command: process.execPath, args: ["run", ENTRY, sub] }
    : { command: process.execPath, args: [sub] };
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const AGENT_INSTRUCTIONS = `## Nerveplane coordination

You are working alongside other autonomous coding agents. Nerveplane keeps you aligned.

1. **At startup**, call the \`register\` tool with your name, capabilities, repo path, and branch. Read the returned join packet before editing.
2. **Periodically and before finalizing**, call \`sync\` to see file changes, contract changes, and conflicts from other agents working in related code.
3. Before changing API contracts, DB schemas, or shared types, call \`publish\` so affected agents are warned.
4. Record durable decisions with \`decision\`.

High-priority warnings are also injected automatically before you edit files.`;

export interface InstallOptions {
  withMcp?: boolean; // also write a project .mcp.json (fallback when the `claude` CLI isn't used)
  print?: boolean; // dry-run: report intended actions without writing
}

export interface InstallResult {
  files: string[];
  notes: string[];
  mcpRegistered: boolean;
}

/** Does a project `.mcp.json` already define the nerveplane server? (Cheap,
 *  deterministic. We deliberately don't shell out to `claude mcp list` — recent
 *  Claude Code pings servers on list, which can hang an installer.) */
function hasProjectMcpEntry(projectDir: string): boolean {
  const servers = (readJson(join(projectDir, ".mcp.json")).mcpServers as Record<string, unknown>) ?? {};
  return "nerveplane" in servers;
}

/**
 * Wires the parts of Claude Code that the native `claude mcp add` can't do: the
 * PreToolUse hook (proactive last-mile warning injection) and the agent
 * instructions (imported into CLAUDE.md). The MCP *server* is registered
 * separately via `claude mcp add nerveplane -- nerveplane mcp` (printed below);
 * pass `withMcp` to instead write a project `.mcp.json` for no-CLI setups.
 */
export function installClaudeCode(projectDir: string, opts: InstallOptions = {}): InstallResult {
  const files: string[] = [];
  const notes: string[] = [];
  const claudeDir = join(projectDir, ".claude");
  const write = (path: string, content: string) => {
    if (!opts.print) writeFileSync(path, content);
    files.push(path);
  };

  if (!opts.print) mkdirSync(claudeDir, { recursive: true });

  // 1) PreToolUse hook — injects high-severity warnings before edits.
  const settingsPath = join(claudeDir, "settings.json");
  const settings = readJson(settingsPath);
  const hooks = (settings.hooks as Record<string, unknown>) ?? {};
  const hook = invocation("hook");
  const hookCmd = [hook.command, ...hook.args].map((s) => (s.includes(" ") ? `"${s}"` : s)).join(" ");
  hooks.PreToolUse = [{ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: hookCmd }] }];
  settings.hooks = hooks;
  write(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  // 2) Agent-instructions file.
  write(join(claudeDir, "nerveplane-instructions.md"), AGENT_INSTRUCTIONS + "\n");

  // 3) Auto-wire CLAUDE.md via an idempotent @import (no manual copy-paste).
  const claudeMd = join(projectDir, "CLAUDE.md");
  const existing = existsSync(claudeMd) ? readFileSync(claudeMd, "utf8") : "";
  if (!existing.includes(CLAUDE_MD_IMPORT)) {
    if (!opts.print) {
      const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
      appendFileSync(claudeMd, `${prefix}\n${CLAUDE_MD_IMPORT}\n`);
    }
    files.push(claudeMd);
  }

  // 4) Optional file-based MCP registration (fallback for no `claude` CLI).
  let registered = hasProjectMcpEntry(projectDir);
  if (opts.withMcp) {
    const mcpPath = join(projectDir, ".mcp.json");
    const mcp = readJson(mcpPath);
    const servers = (mcp.mcpServers as Record<string, unknown>) ?? {};
    servers.nerveplane = invocation("mcp");
    mcp.mcpServers = servers;
    write(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
    registered = true;
  }

  // 5) Next-step notes.
  if (!registered) {
    const run = [invocation("mcp").command, ...invocation("mcp").args].join(" ");
    notes.push(`Register the MCP server:  claude mcp add nerveplane -- ${run}`);
  }
  notes.push("Agent instructions auto-imported into CLAUDE.md (via @import).");
  notes.push("Restart Claude Code in this directory so it picks up the hook" + (opts.withMcp ? " and .mcp.json." : "."));

  return { files, notes, mcpRegistered: registered };
}
