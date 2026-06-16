import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent, discoverAgents } from "../src/core/registry.ts";
import { formatSessionContext } from "../src/cli/session-start.ts";
import { serviceStatus, servicePath } from "../src/install/service.ts";
import { dirname } from "node:path";

getDb(join(mkdtempSync(join(tmpdir(), "np-setup-")), "test.db"));
runMigrations();

const REPO = mkdtempSync(join(tmpdir(), "np-setup-repo-"));

test("one agent per worktree: SessionStart auto-register then `register` tool enrich → one row", async () => {
  const wt = REPO + "/wt-dedup";
  // SessionStart hook would register by worktree with a derived name + no caps.
  const auto = await registerAgent({ name: "wt-dedup", repoPath: REPO, worktreePath: wt });
  // The agent's `register` tool later enriches with a better name + capabilities.
  const enriched = await registerAgent({ name: "backend-agent", repoPath: REPO, worktreePath: wt, capabilities: ["backend"] });

  expect(enriched.id).toBe(auto.id); // same row, reconciled on worktree
  expect(enriched.name).toBe("backend-agent"); // renamed
  expect(enriched.capabilities).toContain("backend");

  // Exactly one agent exists for this worktree.
  const here = discoverAgents({ includeOffline: true }).filter((a) => a.worktreePath === wt);
  expect(here.length).toBe(1);
});

test("distinct worktrees stay distinct agents", async () => {
  const a = await registerAgent({ name: "x", repoPath: REPO, worktreePath: REPO + "/wt-1" });
  const b = await registerAgent({ name: "x", repoPath: REPO, worktreePath: REPO + "/wt-2" });
  expect(b.id).not.toBe(a.id);
});

test("formatSessionContext announces registration and peers", () => {
  const solo = formatSessionContext("api", []);
  expect(solo).toContain("auto-registered as \"api\"");
  expect(solo).toContain("register");
  expect(solo).not.toContain("other agent");

  const withPeers = formatSessionContext("api", [{ name: "frontend" }, { name: "worker" }]);
  expect(withPeers).toContain("2 other agent(s) active: frontend, worker");
  expect(withPeers).toContain("sync");
});

test("serviceStatus reports installed=false with a platform path when no unit", () => {
  const s = serviceStatus();
  expect(typeof s.installed).toBe("boolean");
  expect(s.path).toMatch(/nerveplane|dev\.nerveplane\.daemon/);
});

test("servicePath front-loads the runtime dir so launchd/systemd can resolve the bun shim", () => {
  // The npm `nerveplane` is a `#!/usr/bin/env bun` shim; the service unit must
  // carry the Bun runtime dir on PATH or it fails with exit 127 under launchd.
  const p = servicePath("/opt/homebrew/bin/nerveplane");
  const parts = p.split(":");
  expect(parts[0]).toBe(dirname(process.execPath)); // bun/node runtime dir first
  expect(parts).toContain("/opt/homebrew/bin"); // the nerveplane bin dir
  expect(parts).toContain("/usr/bin");
  expect(new Set(parts).size).toBe(parts.length); // de-duplicated
});
