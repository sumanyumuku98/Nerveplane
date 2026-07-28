import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { nerveplaneMcpCommand, readJsonIfExists, readTextIfExists, AGENTS_INSTRUCTIONS } from "./shared.ts";
import type { AgentProvider, HeadlessOptions, InstallResult, ProviderInstallOptions } from "./types.ts";

/**
 * opencode (sst/opencode) adapter. MCP config is JSON — `opencode.json`'s `mcp`
 * key (local stdio server); headless via `opencode run … --format json`.
 * NOTE: opencode's exact run flags / output shape / tool-approval are
 * version-dependent — validate with `nerveplane doctor --agent opencode --run`.
 * Nerveplane wires MCP + AGENTS.md only (opencode has no lifecycle hooks).
 */
const CONFIG = (global?: boolean) =>
  global ? join(homedir(), ".config", "opencode", "opencode.json") : join(process.cwd(), "opencode.json");

export function opencodeHeadlessArgs(prompt: string, opts: HeadlessOptions): string[] {
  const args = ["run", prompt, "--format", "json"];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

/** opencode `run --format json` emits a JSONL event stream; the assistant reply
 *  is the last event whose `part.type === "text"` (`part.text`), and the session
 *  id is top-level `sessionID`. Falls back to flat result/text/message/parts
 *  fields (older/single-object shapes), then raw stdout. */
export function opencodeParseResult(stdout: string): { result?: string; sessionId?: string } {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
  let text: string | undefined; // preferred: part.type === "text"
  let flat: string | undefined; // fallback: flat result/text/message/parts
  let sessionId: string | undefined;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t) as Record<string, any>;
      sessionId = str(ev.sessionID) ?? str(ev.sessionId) ?? str(ev.session_id) ?? sessionId;
      const part = ev.part as Record<string, unknown> | undefined;
      if (part && part.type === "text") {
        const x = str(part.text);
        if (x) text = x;
      }
      const f =
        str(ev.result) ??
        str(ev.text) ??
        str(ev.message) ??
        (Array.isArray(ev.parts) ? str((ev.parts as { text?: string }[]).map((p) => p.text ?? "").join("")) : undefined);
      if (f) flat = f;
    } catch {
      /* skip non-JSON lines */
    }
  }
  const result = text ?? flat ?? (stdout.trim() || undefined);
  return { result, sessionId };
}

export const opencode: AgentProvider = {
  id: "opencode",
  label: "opencode",
  bin: "opencode",
  instructionsFilename: "AGENTS.md",
  capabilities: { hooks: false, resume: false, inlineMcpConfig: false },

  detect: () => Bun.which("opencode") != null,
  headlessArgs: opencodeHeadlessArgs,
  parseResult: opencodeParseResult,

  install(projectDir, opts: ProviderInstallOptions): InstallResult {
    const files: string[] = [];
    const notes: string[] = [];
    const cmd = nerveplaneMcpCommand();

    const cfgPath = opts.global ? join(homedir(), ".config", "opencode", "opencode.json") : join(projectDir, "opencode.json");
    const cfg = readJsonIfExists(cfgPath);
    const mcp = (cfg.mcp as Record<string, unknown>) ?? {};
    if (!("nerveplane" in mcp)) {
      mcp.nerveplane = { type: "local", command: [cmd.command, ...cmd.args], enabled: true };
      cfg.mcp = mcp;
      if (!opts.print) {
        mkdirSync(join(cfgPath, ".."), { recursive: true });
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
      }
      files.push(cfgPath);
    } else {
      notes.push(`nerveplane MCP server already present in ${cfgPath}`);
    }

    const agentsMd = join(opts.global ? homedir() : projectDir, "AGENTS.md");
    const md = readTextIfExists(agentsMd);
    if (!md.includes("## Nerveplane coordination")) {
      if (!opts.print) appendFileSync(agentsMd, (md && !md.endsWith("\n") ? "\n" : "") + "\n" + AGENTS_INSTRUCTIONS);
      files.push(agentsMd);
    }

    notes.push("opencode reads MCP from opencode.json and instructions from AGENTS.md.");
    notes.push("Verify with: nerveplane doctor --agent opencode --run");
    return { files, notes, mcpRegistered: true };
  },

  mcpConfigStatus(o) {
    const cfgPath = CONFIG(o?.global);
    const mcp = (readJsonIfExists(cfgPath).mcp as Record<string, unknown>) ?? {};
    return { path: cfgPath, registered: "nerveplane" in mcp };
  },
};
