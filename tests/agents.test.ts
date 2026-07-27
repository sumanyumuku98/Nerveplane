import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProvider, listProviders, DEFAULT_AGENT } from "../src/agents/index.ts";
import { claudeHeadlessArgs } from "../src/agents/claude.ts";

// --- registry ---
test("registry resolves providers, defaults to claude, rejects unknown", () => {
  expect(getProvider().id).toBe("claude");
  expect(DEFAULT_AGENT).toBe("claude");
  expect(listProviders().map((p) => p.id).sort()).toEqual(["claude", "codex", "opencode"]);
  expect(getProvider("codex").id).toBe("codex");
  expect(() => getProvider("bogus")).toThrow(/unknown agent/);
});

// --- Claude regression lock (byte-identical argv) ---
test("claude headlessArgs is byte-identical to the shipped invocation (regression lock)", () => {
  const args = getProvider("claude").headlessArgs("PROMPT", {});
  expect(args).toEqual([
    "-p",
    "PROMPT",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "mcp__nerveplane",
    "--mcp-config",
    JSON.stringify({ mcpServers: { nerveplane: { command: "nerveplane", args: ["mcp"] } } }),
  ]);
  // with a session id + overrides
  const resumed = claudeHeadlessArgs("P", { sessionId: "s1", permissionMode: "acceptEdits", allowedTools: "Read", model: "m", mcpConfig: "{}" });
  expect(resumed).toEqual(["-p", "P", "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", "Read", "--model", "m", "--mcp-config", "{}", "--resume", "s1"]);
});

// --- per-adapter headless argv ---
test("codex + opencode headlessArgs use each CLI's documented form", () => {
  // codex exec needs --dangerously-bypass-approvals-and-sandbox: otherwise the
  // MCP tool-call elicitation is auto-cancelled in headless mode (validated live).
  expect(getProvider("codex").headlessArgs("P", {})).toEqual(["exec", "P", "--json", "--dangerously-bypass-approvals-and-sandbox"]);
  expect(getProvider("codex").headlessArgs("P", { model: "gpt" })).toEqual(["exec", "P", "--json", "--dangerously-bypass-approvals-and-sandbox", "--model", "gpt"]);
  expect(getProvider("opencode").headlessArgs("P", {})).toEqual(["run", "P", "--format", "json"]);
  // non-claude providers ignore resume/inline-mcp (not supported)
  expect(getProvider("codex").capabilities.resume).toBe(false);
  expect(getProvider("codex").capabilities.inlineMcpConfig).toBe(false);
});

// --- parseResult per provider ---
test("parseResult extracts result + sessionId per provider", () => {
  expect(getProvider("claude").parseResult('{"session_id":"s1","result":"pong"}')).toEqual({ result: "pong", sessionId: "s1" });
  // codex exec --json: typed event envelopes; text nested in item.completed →
  // item.type "agent_message" → item.text; session id from thread.started.
  const codexStream =
    '{"type":"thread.started","thread_id":"c1"}\n' +
    '{"type":"turn.started"}\n' +
    '{"type":"item.completed","item":{"id":"item_0","type":"mcp_tool_call","tool":"discover","status":"completed"}}\n' +
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"FOUND 2"}}\n';
  expect(getProvider("codex").parseResult(codexStream)).toEqual({ result: "FOUND 2", sessionId: "c1" });
  expect(getProvider("opencode").parseResult('{"result":"pong","sessionId":"o1"}')).toEqual({ result: "pong", sessionId: "o1" });
  // tolerant fallbacks
  expect(getProvider("claude").parseResult("not json").result).toBeUndefined();
  expect(getProvider("codex").parseResult("plain text out").result).toBe("plain text out");
  // a stream with no agent_message falls back to raw stdout (never silently empty)
  expect(getProvider("codex").parseResult('{"type":"turn.completed"}').result).toBe('{"type":"turn.completed"}');
});

// --- capabilities matrix (guards accidental drift) ---
test("capabilities matrix: hooks only for claude", () => {
  expect(getProvider("claude").capabilities.hooks).toBe(true);
  expect(getProvider("codex").capabilities.hooks).toBe(false);
  expect(getProvider("opencode").capabilities.hooks).toBe(false);
  expect(getProvider("claude").instructionsFilename).toBe("CLAUDE.md");
  expect(getProvider("codex").instructionsFilename).toBe("AGENTS.md");
  expect(getProvider("opencode").instructionsFilename).toBe("AGENTS.md");
});

// --- opencode install writes the expected config into a project dir (hermetic) ---
test("opencode install registers the MCP server + writes AGENTS.md", () => {
  const dir = mkdtempSync(join(tmpdir(), "np-oc-"));
  const res = getProvider("opencode").install(dir, {});
  const cfg = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8"));
  expect(cfg.mcp.nerveplane).toBeDefined();
  expect(cfg.mcp.nerveplane.command[0]).toMatch(/nerveplane|bun/);
  expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("## Nerveplane coordination");
  expect(res.mcpRegistered).toBe(true);
});

// --- codex install writes the TOML MCP block + AGENTS.md (hermetic via $CODEX_HOME) ---
test("codex install registers the MCP server in config.toml + writes AGENTS.md", () => {
  const dir = mkdtempSync(join(tmpdir(), "np-cx-"));
  const codexHome = mkdtempSync(join(tmpdir(), "np-cxhome-"));
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const res = getProvider("codex").install(dir, {});
    const toml = readFileSync(join(codexHome, "config.toml"), "utf8");
    expect(toml).toContain("[mcp_servers.nerveplane]");
    expect(toml).toMatch(/command = "(nerveplane|bun)"/);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("## Nerveplane coordination");
    expect(res.mcpRegistered).toBe(true);
    // idempotent: a second install detects the existing block (no dup)
    const again = getProvider("codex").install(dir, {});
    expect(again.files.some((f) => f.endsWith(join("config.toml")))).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});
