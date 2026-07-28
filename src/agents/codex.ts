import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { nerveplaneMcpCommand, readTextIfExists, AGENTS_INSTRUCTIONS } from "./shared.ts";
import type { AgentProvider, HeadlessOptions, InstallResult, ProviderInstallOptions } from "./types.ts";

/**
 * OpenAI Codex CLI adapter. MCP config is TOML at `~/.codex/config.toml`
 * (`[mcp_servers.<name>]`), headless via
 * `codex exec … --json --dangerously-bypass-approvals-and-sandbox`.
 *
 * Why the bypass flag: in `codex exec` (non-interactive), every MCP tool call
 * raises an approval *elicitation*. With no interactive channel, Codex
 * auto-resolves it with `decision: Cancel` — even under `approval_policy=never`
 * — so the nerveplane tools silently no-op and the model fabricates a reply.
 * `--dangerously-bypass-approvals-and-sandbox` is Codex's documented escape
 * hatch for externally-sandboxed automation (the worker runs on the user's own
 * machine, same trust level as an interactive Codex session). It is the moral
 * equivalent of Claude's `--permission-mode dontAsk --allowedTools mcp__nerveplane`.
 * Validated live via `nerveplane doctor --agent codex --run`. Codex supports
 * hooks, but Nerveplane doesn't wire them this pass (MCP + AGENTS.md only).
 */
// Codex reads its config from $CODEX_HOME (default ~/.codex) — honoring it keeps
// us aligned with codex's own resolution and lets tests point at a temp dir.
const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");
const CONFIG = () => join(codexHome(), "config.toml");

export function codexHeadlessArgs(prompt: string, opts: HeadlessOptions): string[] {
  const args = ["exec", prompt, "--json", "--dangerously-bypass-approvals-and-sandbox"];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

/** Codex `exec --json` emits a JSONL stream of typed event envelopes. The final
 *  assistant text is `item.completed` → `item.type === "agent_message"` →
 *  `item.text`; the session id is `thread_id` on the `thread.started` event.
 *  Tolerant of shape drift (flat fields, then raw stdout). */
export function codexParseResult(stdout: string): { result?: string; sessionId?: string } {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
  let agentMsg: string | undefined;
  let flatMsg: string | undefined;
  let sessionId: string | undefined;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t) as Record<string, unknown>;
      sessionId = str(ev.thread_id) ?? str(ev.session_id) ?? str(ev.conversation_id) ?? sessionId;
      const item = ev.item as Record<string, unknown> | undefined;
      if (item && item.type === "agent_message") {
        const text = str(item.text);
        if (text) agentMsg = text;
      }
      const flat = str(ev.text) ?? str(ev.message) ?? str(ev.content);
      if (flat) flatMsg = flat;
    } catch {
      /* skip non-JSON lines */
    }
  }
  const result = agentMsg ?? flatMsg ?? (stdout.trim() || undefined);
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
        mkdirSync(codexHome(), { recursive: true });
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
