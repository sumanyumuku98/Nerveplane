import { join } from "node:path";
import { homedir } from "node:os";
import { installClaudeCode } from "../install/claude-code.ts";
import { readJsonIfExists } from "./shared.ts";
import type { AgentProvider, HeadlessOptions } from "./types.ts";

/** Inline MCP config passed to `claude --mcp-config` (Claude supports inline).
 *  Stdio fallback used when no daemon URL is available (spawns `nerveplane mcp`). */
const DEFAULT_MCP = JSON.stringify({ mcpServers: { nerveplane: { command: "nerveplane", args: ["mcp"] } } });

/** Inline MCP config that points Claude at the daemon's already-running HTTP MCP
 *  endpoint instead of spawning a fresh `nerveplane mcp` stdio bridge each turn —
 *  the warm-MCP latency win. Claude requires an explicit `type`: an entry with a
 *  `url` but no `type` is a hard config error. */
export function httpMcpConfig(baseUrl: string): string {
  return JSON.stringify({ mcpServers: { nerveplane: { type: "http", url: `${baseUrl.replace(/\/$/, "")}/mcp` } } });
}

/** Canonical Claude headless argv — must stay byte-identical to the shipped worker
 *  behavior (locked by a golden test). Non-interactive via `--permission-mode
 *  dontAsk --allowedTools mcp__nerveplane`. */
export function claudeHeadlessArgs(prompt: string, opts: HeadlessOptions): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--permission-mode",
    opts.permissionMode ?? "dontAsk",
    "--allowedTools",
    opts.allowedTools ?? "mcp__nerveplane",
  ];
  if (opts.model) args.push("--model", opts.model);
  args.push("--mcp-config", opts.mcpConfig ?? DEFAULT_MCP);
  if (opts.sessionId) args.push("--resume", opts.sessionId);
  return args;
}

export const claude: AgentProvider = {
  id: "claude",
  label: "Claude Code",
  bin: "claude",
  instructionsFilename: "CLAUDE.md",
  capabilities: { hooks: true, resume: true, inlineMcpConfig: true },

  detect: () => Bun.which("claude") != null,

  headlessArgs: claudeHeadlessArgs,

  parseResult(stdout) {
    try {
      const j = JSON.parse(stdout) as { session_id?: string; result?: string };
      return { result: j.result, sessionId: j.session_id };
    } catch {
      return {};
    }
  },

  install(projectDir, opts) {
    return installClaudeCode(projectDir, opts);
  },

  mcpConfigStatus() {
    // Claude registers MCP via `claude mcp add` (~/.claude.json) or a project .mcp.json.
    const projectMcp = readJsonIfExists(join(process.cwd(), ".mcp.json"));
    const userMcp = readJsonIfExists(join(homedir(), ".claude.json"));
    const inProject = "nerveplane" in ((projectMcp.mcpServers as Record<string, unknown>) ?? {});
    const inUser = "nerveplane" in ((userMcp.mcpServers as Record<string, unknown>) ?? {});
    return { path: "./.mcp.json or ~/.claude.json (claude mcp add)", registered: inProject || inUser };
  },
};
