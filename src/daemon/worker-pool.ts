import { spawn, type ChildProcess } from "node:child_process";
import { readWorkersConfig, unenrollWorker, type EnrolledWorker } from "../config-store.ts";
import { setAutoEnrollHook } from "../core/registry.ts";
import { getProvider, DEFAULT_AGENT } from "../agents/index.ts";
import { nervePlaneCommand, servicePath } from "../install/service.ts";

/**
 * Daemon-managed worker pool. Keeps one supervised `nerveplane worker` process
 * alive per enrolled repo (see config-store `workers.enrolled`), so a repo never
 * needs a manual `nerveplane worker` launch and coverage survives daemon restarts.
 *
 * Enrollment is agent-agnostic and happens in core (`registerAgent` →
 * `enrollWorker`); this module only spawns/monitors/restarts the child processes
 * and prunes stale repos. It mirrors the sidecar supervisor pattern
 * (`src/memory/sidecar.ts`): lazy, crash-restart with backoff, best-effort.
 */

export type WorkerStatus = "pending" | "running" | "crashed" | "stopped";

interface PoolEntry {
  repoPath: string;
  agent: string;
  child: ChildProcess | null;
  status: WorkerStatus;
  pid?: number;
  restarts: number;
  lastExit?: { code: number | null; at: string };
  backoff?: ReturnType<typeof setTimeout>;
}

const pool = new Map<string, PoolEntry>(); // key = repoPath
let sweep: ReturnType<typeof setInterval> | null = null;
let running = false; // is the pool active (daemon up)?
const SWEEP_MS = 60 * 60_000; // hourly TTL sweep

function daysBetween(iso: string | undefined, now: number): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (now - t) / 86_400_000;
}

/** Ensure a non-Claude provider's config-file MCP entry exists for this repo, so a
 *  spawned codex/opencode worker actually has the nerveplane tools. Claude takes an
 *  inline `--mcp-config`, so it needs nothing here. Best-effort. */
function ensureProviderMcp(agent: string, repoPath: string): void {
  try {
    const p = getProvider(agent);
    if (!p.capabilities.inlineMcpConfig) p.install(repoPath, { withMcp: true });
  } catch {
    /* provider may be unknown/uninstalled — the worker will surface that itself */
  }
}

function spawnWorker(entry: PoolEntry): void {
  ensureProviderMcp(entry.agent, entry.repoPath);
  const { program, args } = nervePlaneCommand(["worker", "--agent", entry.agent]);
  // The daemon runs under launchd with a minimal PATH; front-load the runtime + bin
  // dirs so the child can find `nerveplane` and the agent CLI (claude/codex/...).
  const env = { ...process.env, PATH: servicePath(program) };
  const child = spawn(program, args, { cwd: entry.repoPath, env, stdio: "ignore" });
  entry.child = child;
  entry.pid = child.pid ?? undefined;
  entry.status = "running";
  entry.child.on("exit", (code) => {
    entry.child = null;
    entry.pid = undefined;
    entry.lastExit = { code, at: new Date().toISOString() };
    if (!running || !isEnrolled(entry.repoPath)) {
      entry.status = "stopped";
      return;
    }
    entry.status = "crashed";
    entry.restarts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(entry.restarts, 5));
    entry.backoff = setTimeout(() => {
      if (running && isEnrolled(entry.repoPath)) spawnWorker(entry);
    }, delay);
  });
}

function stopEntry(entry: PoolEntry): void {
  if (entry.backoff) clearTimeout(entry.backoff);
  entry.backoff = undefined;
  try {
    entry.child?.kill("SIGTERM");
  } catch {
    /* best-effort */
  }
  entry.child = null;
  entry.pid = undefined;
  entry.status = "stopped";
}

let currentEnrolled = new Set<string>();
const isEnrolled = (repoPath: string) => currentEnrolled.has(repoPath);

/**
 * Diff desired (enrolled, TTL-pruned, capped) vs running and converge. Idempotent;
 * safe to call on every auto-enroll and on the periodic sweep.
 */
export function reconcileWorkers(): void {
  if (!running) return;
  const cfg = readWorkersConfig();
  const now = Date.now();

  // TTL prune: drop repos untouched beyond pruneDays (persist the removal).
  const kept: EnrolledWorker[] = [];
  for (const e of cfg.enrolled) {
    if (daysBetween(e.lastSeenAt, now) > cfg.pruneDays) unenrollWorker(e.repoPath);
    else kept.push(e);
  }

  // Cap: most-recently-seen repos win a slot; the rest stay pending (no spawn).
  const ranked = [...kept].sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
  const toRun = new Set(ranked.slice(0, cfg.maxConcurrent).map((e) => e.repoPath));
  currentEnrolled = new Set(kept.map((e) => e.repoPath));

  // Stop workers whose repo is gone or now over the cap.
  for (const [repoPath, entry] of pool) {
    if (!toRun.has(repoPath)) {
      stopEntry(entry);
      if (!currentEnrolled.has(repoPath)) pool.delete(repoPath);
      else entry.status = "pending";
    }
  }

  // Start workers for slotted repos that aren't running.
  for (const e of ranked) {
    if (!toRun.has(e.repoPath)) continue;
    const agent = e.agent ?? DEFAULT_AGENT;
    let entry = pool.get(e.repoPath);
    if (!entry) {
      entry = { repoPath: e.repoPath, agent, child: null, status: "pending", restarts: 0 };
      pool.set(e.repoPath, entry);
    }
    entry.agent = agent;
    if (!entry.child) spawnWorker(entry);
  }
}

/** Start the pool (called from daemon boot). Wires the core reconcile hook, does an
 *  initial reconcile, and arms the hourly TTL sweep. Returns a stopper. */
export function startWorkerPool(): () => void {
  running = true;
  setAutoEnrollHook(() => reconcileWorkers());
  reconcileWorkers();
  sweep = setInterval(() => reconcileWorkers(), SWEEP_MS);
  sweep.unref?.();
  return stopWorkerPool;
}

export function stopWorkerPool(): void {
  running = false;
  setAutoEnrollHook(null);
  if (sweep) clearInterval(sweep);
  sweep = null;
  for (const entry of pool.values()) stopEntry(entry);
  pool.clear();
}

export interface WorkerPoolStatusItem {
  repoPath: string;
  agent: string;
  status: WorkerStatus;
  pid?: number;
  restarts: number;
  lastExit?: { code: number | null; at: string };
}

/** Snapshot for `nerveplane workers` (merges enrolled config with live process state). */
export function workerPoolStatus(): { autoEnroll: boolean; maxConcurrent: number; workers: WorkerPoolStatusItem[] } {
  const cfg = readWorkersConfig();
  const byPath = new Map(pool);
  const workers: WorkerPoolStatusItem[] = cfg.enrolled.map((e) => {
    const live = byPath.get(e.repoPath);
    return {
      repoPath: e.repoPath,
      agent: e.agent ?? DEFAULT_AGENT,
      status: live?.status ?? "pending",
      pid: live?.pid,
      restarts: live?.restarts ?? 0,
      lastExit: live?.lastExit,
    };
  });
  return { autoEnroll: cfg.autoEnroll, maxConcurrent: cfg.maxConcurrent, workers };
}
