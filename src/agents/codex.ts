import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { nerveplaneMcpCommand, readTextIfExists, AGENTS_INSTRUCTIONS } from "./shared.ts";
import type { AgentProvider, HeadlessOptions, InstallResult, ProviderInstallOptions } from "./types.ts";

/**
 * OpenAI Codex CLI adapter. MCP config is TOML at `~/.codex/config.toml`
 * (`[mcp_servers.<name>]`), headless via `codex exec … --json --full-auto`.
 * NOTE: Codex's exact `exec` flags/output are version-dependent — validate with
 * `nerveplane doctor --agent codex --run` before relying on it. Codex supports
 * hooks, but Nerveplane doesn't wire them this pass (MCP + AGENTS.md only).
 */
const CONFIG = () => join(homedir(), ".codex", "config.toml");

export function codexHeadlessArgs(prompt: string, opts: HeadlessOptions): string[] {
  // `--full-auto` = run non-interactively (auto-approve within the sandbox).
  const args = ["exec", prompt, "--json", "--full-auto"];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

/** Codex `exec --json` emits a JSONL event stream; take the last event that
 *  carries assistant text. Tolerant of shape drift (falls back to raw stdout). */
export function codexParseResult(stdout: string): { result?: string; sessionId?: string } {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
  let result: string | undefined;
  let sessionId: string | undefined;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t) as Record<string, unknown>;
      sessionId = str(ev.session_id) ?? str(ev.thread_id) ?? str(ev.conversation_id) ?? sessionId;
      const text = str(ev.text) ?? str(ev.message) ?? str(ev.content);
      if (text) result = text;
    } catch {
      /* skip non-JSON lines */
    }
  }
  if (!result && stdout.trim()) result = stdout.trim();
  return { result, sessionId };
}

export const codex: AgentProvider = {
  id: "codex",
  label: "OpenAI Codex CLI",
  bin: "codex",
  instructionsFilename: "AGENTS.md",
  capabilities: { hooks: false, resume: false, inlineMcpConfig: false },

  detect: () => Bun.which("codex") != null,
  headlessArgs: codexHeadlessArgs,
  parseResult: codexParseResult,

  install(projectDir, opts: ProviderInstallOptions): InstallResult {
    const files: string[] = [];
    const notes: string[] = [];
    const cmd = nerveplaneMcpCommand();
    const argsToml = cmd.args.map((a) => `"${a}"`).join(", ");
    const block = `\n[mcp_servers.nerveplane]\ncommand = "${cmd.command}"\nargs = [${argsToml}]\n`;

    const cfg = CONFIG();
    const existing = readTextIfExists(cfg);
    if (!existing.includes("[mcp_servers.nerveplane]")) {
      if (!opts.print) {
        mkdirSync(join(homedir(), ".codex"), { recursive: true });
        appendFileSync(cfg, block);
      }
      files.push(cfg);
    } else {
      notes.push("nerveplane MCP server already present in ~/.codex/config.toml");
    }

    const agentsMd = join(opts.global ? homedir() : projectDir, "AGENTS.md");
    const md = readTextIfExists(agentsMd);
    if (!md.includes("## Nerveplane coordination")) {
      if (!opts.print) appendFileSync(agentsMd, (md && !md.endsWith("\n") ? "\n" : "") + "\n" + AGENTS_INSTRUCTIONS);
      files.push(agentsMd);
    }

    notes.push("Codex reads MCP servers from ~/.codex/config.toml and instructions from AGENTS.md.");
    notes.push("Verify with: nerveplane doctor --agent codex --run");
    return { files, notes, mcpRegistered: true };
  },

  mcpConfigStatus() {
    const cfg = CONFIG();
    return { path: cfg, registered: readTextIfExists(cfg).includes("[mcp_servers.nerveplane]") };
  },
};
