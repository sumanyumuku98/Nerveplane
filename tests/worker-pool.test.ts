import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate config + DB to temp dirs BEFORE the modules resolve them. config-store
// resolves NERVEPLANE_HOME at call time, so setting it here is enough.
const HOME = mkdtempSync(join(tmpdir(), "np-workers-home-"));
process.env.NERVEPLANE_HOME = HOME;

import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent, setAutoEnrollHook } from "../src/core/registry.ts";
import {
  readConfig,
  writeConfig,
  readWorkersConfig,
  readEnrolledWorkers,
  enrollWorker,
  unenrollWorker,
  setAutoEnroll,
  WORKER_DEFAULTS,
} from "../src/config-store.ts";
import { workerPoolStatus } from "../src/daemon/worker-pool.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-workers-db-")), "test.db"));
runMigrations();

// Start each test from a clean config.
beforeEach(() => writeConfig({ workers: { enrolled: [], autoEnroll: true } }));

test("readWorkersConfig applies defaults", () => {
  writeConfig({ workers: {} });
  const w = readWorkersConfig();
  expect(w.autoEnroll).toBe(WORKER_DEFAULTS.autoEnroll);
  expect(w.maxConcurrent).toBe(WORKER_DEFAULTS.maxConcurrent);
  expect(w.pruneDays).toBe(WORKER_DEFAULTS.pruneDays);
  expect(w.enrolled).toEqual([]);
});

test("enrollWorker is idempotent (upsert by repoPath) and refreshes lastSeenAt", async () => {
  enrollWorker("/tmp/repoA", { agent: "claude" });
  enrollWorker("/tmp/repoB", { agent: "codex" });
  const first = readEnrolledWorkers().find((e) => e.repoPath === "/tmp/repoA")!;
  expect(readEnrolledWorkers().length).toBe(2);

  await Bun.sleep(3);
  enrollWorker("/tmp/repoA"); // re-enroll: no dup, refreshes lastSeenAt, keeps agent
  const after = readEnrolledWorkers();
  expect(after.length).toBe(2);
  const a = after.find((e) => e.repoPath === "/tmp/repoA")!;
  expect(a.agent).toBe("claude"); // preserved
  expect(a.lastSeenAt! > first.lastSeenAt!).toBe(true); // refreshed
});

test("unenrollWorker removes just that repo", () => {
  enrollWorker("/tmp/repoA");
  enrollWorker("/tmp/repoB");
  unenrollWorker("/tmp/repoA");
  expect(readEnrolledWorkers().map((e) => e.repoPath)).toEqual(["/tmp/repoB"]);
});

test("writing workers does not clobber memory config or autoEnroll (nested merge + array RMW)", () => {
  writeConfig({ memory: { mode: "hybrid" } });
  setAutoEnroll(false);
  enrollWorker("/tmp/repoA"); // writes only workers.enrolled
  const cfg = readConfig();
  expect(cfg.memory?.mode).toBe("hybrid"); // preserved
  expect(cfg.workers?.autoEnroll).toBe(false); // preserved through the enroll write
  expect(cfg.workers?.enrolled?.map((e) => e.repoPath)).toEqual(["/tmp/repoA"]);
});

test("registerAgent auto-enrolls a repo ONLY when the pool hook is wired", async () => {
  const reconciled: string[] = [];

  // No hook (CLI/test default) → no enroll, no config writes.
  setAutoEnrollHook(null);
  await registerAgent({ name: "solo", repoPath: "/tmp/np-repo-x", worktreePath: "/tmp/np-repo-x" });
  expect(readEnrolledWorkers().some((e) => e.repoPath === "/tmp/np-repo-x")).toBe(false);

  // Hook wired (daemon) → interactive registration enrolls + reconciles.
  setAutoEnrollHook((p) => reconciled.push(p));
  await registerAgent({ name: "claude-sess", repoPath: "/tmp/np-repo-y", worktreePath: "/tmp/np-repo-y" });
  expect(readEnrolledWorkers().some((e) => e.repoPath === "/tmp/np-repo-y")).toBe(true);
  expect(reconciled).toContain("/tmp/np-repo-y");

  // A worker's OWN registration (role='worker') must NOT enroll.
  await registerAgent({ name: "wkr", repoPath: "/tmp/np-repo-z", worktreePath: "/tmp/np-repo-z", role: "worker" });
  expect(readEnrolledWorkers().some((e) => e.repoPath === "/tmp/np-repo-z")).toBe(false);

  // autoEnroll off → no enroll even with the hook wired.
  setAutoEnroll(false);
  await registerAgent({ name: "claude2", repoPath: "/tmp/np-repo-off", worktreePath: "/tmp/np-repo-off" });
  expect(readEnrolledWorkers().some((e) => e.repoPath === "/tmp/np-repo-off")).toBe(false);

  setAutoEnrollHook(null); // reset for other tests
});

test("workerPoolStatus reflects enrolled repos as pending when nothing is spawned", () => {
  enrollWorker("/tmp/repoA", { agent: "codex" });
  const s = workerPoolStatus();
  expect(s.autoEnroll).toBe(true);
  expect(s.maxConcurrent).toBe(WORKER_DEFAULTS.maxConcurrent);
  const a = s.workers.find((w) => w.repoPath === "/tmp/repoA")!;
  expect(a.agent).toBe("codex");
  expect(a.status).toBe("pending"); // no live child in this unit test
});
