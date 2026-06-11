import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));

/** How to invoke nerveplane subcommands from generated config (dev vs compiled). */
function invocation(sub: string): { command: string; args: string[] } {
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

export interface InstallResult {
  files: string[];
  notes: string[];
}

/**
 * Wires Claude Code into Nerveplane in the given project dir: an MCP server
 * entry (.mcp.json), a PreToolUse hook that injects high-severity warnings
 * before edits (.claude/settings.json), and an agent-instructions snippet.
 * Idempotent and merge-safe. (plan Part C.2 / C.8)
 */
export function installClaudeCode(projectDir: string): InstallResult {
  const files: string[] = [];
  const notes: string[] = [];

  // 1) .mcp.json — register the stdio MCP server.
  const mcpPath = join(projectDir, ".mcp.json");
  const mcp = readJson(mcpPath);
  const servers = (mcp.mcpServers as Record<string, unknown>) ?? {};
  servers.nerveplane = invocation("mcp");
  mcp.mcpServers = servers;
  writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
  files.push(mcpPath);

  // 2) .claude/settings.json — PreToolUse hook for last-mile warning injection.
  const claudeDir = join(projectDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.json");
  const settings = readJson(settingsPath);
  const hooks = (settings.hooks as Record<string, unknown>) ?? {};
  const hook = invocation("hook");
  const hookCmd = [hook.command, ...hook.args].map((s) => (s.includes(" ") ? `"${s}"` : s)).join(" ");
  hooks.PreToolUse = [
    {
      matcher: "Edit|Write|MultiEdit",
      hooks: [{ type: "command", command: hookCmd }],
    },
  ];
  settings.hooks = hooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  files.push(settingsPath);

  // 3) Agent-instructions snippet.
  const instrPath = join(claudeDir, "nerveplane-instructions.md");
  writeFileSync(instrPath, AGENT_INSTRUCTIONS + "\n");
  files.push(instrPath);
  notes.push(`Add the contents of ${instrPath} to this repo's CLAUDE.md so agents follow the protocol.`);
  notes.push("Restart Claude Code in this directory so it picks up .mcp.json and the hook.");

  return { files, notes };
}
