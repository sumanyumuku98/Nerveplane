import { test, expect } from "bun:test";
import { parseSSE, applyFrame, appendCapped, ago, initialState, renderLines } from "../src/cli/watch.ts";
import { resolveAgent } from "../src/cli/prompt.ts";
import { colorEnabled, stripAnsi, severityColor, truncate } from "../src/tui/ansi.ts";
import { DEFAULT_AGENT } from "../src/agents/index.ts";

// --- SSE frame parser ---
test("parseSSE splits complete frames and carries the remainder", () => {
  const { frames, rest } = parseSSE('data: {"a":1}\n\nevent: chat\ndata: {"b":2}\n\ndata: {"c"');
  expect(frames).toEqual([
    { event: undefined, data: '{"a":1}' },
    { event: "chat", data: '{"b":2}' },
  ]);
  expect(rest).toBe('data: {"c"'); // incomplete frame held back
});

test("parseSSE ignores comment/id lines and blank blocks", () => {
  const { frames } = parseSSE(":keepalive\n\nid: 7\ndata: {\"x\":1}\n\n");
  expect(frames).toEqual([{ event: undefined, data: '{"x":1}' }]);
});

// --- reducer: applyFrame ---
test("applyFrame appends typed events, chat, and ignores heartbeats", () => {
  const s = initialState("http://127.0.0.1:7734");
  applyFrame(s, { event: "heartbeat", data: "{}" });
  expect(s.events.length).toBe(0);
  applyFrame(s, { event: undefined, data: JSON.stringify({ type: "agent_joined", severity: "info", summary: "x joined", createdAt: "2026-07-28T00:00:00Z" }) });
  expect(s.events.at(-1)).toEqual({ type: "agent_joined", severity: "info", summary: "x joined", createdAt: "2026-07-28T00:00:00Z" });
  applyFrame(s, { event: "chat", data: JSON.stringify({ fromAgentId: "a", toAgentId: "b", body: "hi" }) });
  expect(s.chat.at(-1)).toEqual({ from: "a", to: "b", body: "hi" });
  // malformed JSON is dropped, not thrown
  applyFrame(s, { event: undefined, data: "not json" });
  expect(s.events.length).toBe(1);
});

test("appendCapped keeps only the newest cap items", () => {
  const arr: number[] = [];
  for (let i = 0; i < 10; i++) appendCapped(arr, i, 3);
  expect(arr).toEqual([7, 8, 9]);
});

test("ago formats compact durations", () => {
  const now = Date.parse("2026-07-28T01:00:00Z");
  expect(ago("2026-07-28T00:59:30Z", now)).toBe("30s");
  expect(ago("2026-07-28T00:55:00Z", now)).toBe("5m");
  expect(ago("2026-07-28T00:00:00Z", now)).toBe("1h");
  expect(ago(undefined, now)).toBe("");
});

// --- renderLines (pure; color off in tests → plain text) ---
test("renderLines produces the expected plain-text layout", () => {
  const s = initialState("http://127.0.0.1:7734");
  s.version = "0.13.0";
  s.agents = [{ id: "a1", name: "alpha", status: "in_progress", branch: "feat/x", lastSeenAt: undefined }];
  s.conflicts = [{ id: "c1", type: "same_file_edit", severity: "high", summary: "both touch foo.ts" }];
  s.selected = 0;
  const out = stripAnsi(renderLines(s, Date.now()).join("\n"));
  expect(out).toContain("nerveplane watch");
  expect(out).toContain("AGENTS (1)");
  expect(out).toContain("alpha");
  expect(out).toContain("OPEN CONFLICTS (1)");
  expect(out).toContain("both touch foo.ts");
  expect(out).toContain("▸ "); // selected marker
  expect(out).toContain("q quit");
});

// --- resolveAgent: non-TTY + explicit paths (the regression-critical ones) ---
test("resolveAgent: non-TTY falls back to the default without prompting", async () => {
  let prompted = false;
  const agent = await resolveAgent(undefined, { isTTY: false, prompt: async () => ((prompted = true), "codex") });
  expect(agent).toBe(DEFAULT_AGENT);
  expect(prompted).toBe(false);
});

test("resolveAgent: explicit id skips the prompt and is validated", async () => {
  let prompted = false;
  expect(await resolveAgent("codex", { isTTY: true, prompt: async () => ((prompted = true), "claude") })).toBe("codex");
  expect(prompted).toBe(false);
  expect(resolveAgent("bogus", { isTTY: false })).rejects.toThrow(/unknown agent/);
});

test("resolveAgent: TTY with no explicit id uses the picker result", async () => {
  expect(await resolveAgent(undefined, { isTTY: true, prompt: async () => "opencode" })).toBe("opencode");
  // cancelled picker (undefined) → default
  expect(await resolveAgent(undefined, { isTTY: true, prompt: async () => undefined })).toBe(DEFAULT_AGENT);
});

// --- ansi helper is a no-op off a TTY (protects existing plain-text output) ---
test("ansi color is disabled off a TTY, truncate respects width", () => {
  expect(colorEnabled()).toBe(false); // test runner is non-TTY
  expect(severityColor("blocking", "X")).toBe("X"); // no escape codes added
  expect(truncate("abcdefgh", 5)).toBe("abcd…");
  expect(truncate("abc", 5)).toBe("abc");
});
