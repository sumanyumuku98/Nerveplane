import { test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installClaudeCode } from "../src/install/claude-code.ts";

function tmp() {
  return mkdtempSync(join(tmpdir(), "np-install-"));
}

test("default install: hook + instructions + CLAUDE.md import, no .mcp.json", () => {
  const dir = tmp();
  installClaudeCode(dir);

  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  expect(settings.hooks.PreToolUse[0].matcher).toContain("Edit");
  expect(existsSync(join(dir, ".claude", "nerveplane-instructions.md"))).toBe(true);
  expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("@.claude/nerveplane-instructions.md");
  expect(existsSync(join(dir, ".mcp.json"))).toBe(false); // MCP is registered via `claude mcp add`
});

test("CLAUDE.md import is idempotent across re-runs", () => {
  const dir = tmp();
  installClaudeCode(dir);
  installClaudeCode(dir);
  const matches = readFileSync(join(dir, "CLAUDE.md"), "utf8").match(/nerveplane-instructions\.md/g) ?? [];
  expect(matches.length).toBe(1);
});

test("--with-mcp writes a project .mcp.json with the nerveplane server", () => {
  const dir = tmp();
  const res = installClaudeCode(dir, { withMcp: true });
  expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
  const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
  expect(mcp.mcpServers.nerveplane).toBeDefined();
  expect(res.mcpRegistered).toBe(true);
});

test("--print is a dry run that writes nothing", () => {
  const dir = tmp();
  const res = installClaudeCode(dir, { print: true });
  expect(res.files.length).toBeGreaterThan(0); // reports intended files
  expect(readdirSync(dir).length).toBe(0); // but writes none
});
