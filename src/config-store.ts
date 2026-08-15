import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";

/** Canonicalize a repo path (resolves symlinks like macOS /tmp → /private/tmp) so
 *  enrollment, dedup, and `worker disable` (process.cwd()) all agree. Best-effort:
 *  a non-existent path is returned unchanged. */
function canonicalRepoPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Persisted machine config at ~/.nerveplane/config.json — lets `nerveplane
 * memory setup` remember the chosen memory backend across daemon restarts (env
 * vars don't survive a launchd relaunch). Resolution precedence is always
 * **env var › config.json › default**, so CI/scripts can still override with
 * NERVEPLANE_* env and the interactive picker's choice persists otherwise.
 *
 * Standalone/low-level: computes its own path (no import from config.ts) to
 * avoid an import cycle. Never stores secrets — API keys stay in the environment.
 */
/** Resolved at call time so NERVEPLANE_HOME set after import (e.g. in tests) is honored. */
const currentHome = () => process.env.NERVEPLANE_HOME ?? join(homedir(), ".nerveplane");
const configPath = () => join(currentHome(), "config.json");
/** Display path (resolved at import); reads/writes use `configPath()` at call time. */
export const CONFIG_JSON_PATH = configPath();

export type MemoryMode = "keyword" | "semantic" | "hybrid";
export type Embedder = "openai" | "ollama";

export interface EnrolledWorker {
  repoPath: string;
  agent?: string; // provider that worked the repo (claude|codex|opencode)
  model?: string;
  lastSeenAt?: string; // refreshed on each interactive registration; drives TTL prune
}

export interface NerveplaneConfig {
  memory?: {
    mode?: MemoryMode;
    embedder?: Embedder;
    embedderModel?: string;
    ollamaUrl?: string;
  };
  workers?: {
    autoEnroll?: boolean; // default true — enroll a repo on first agent registration
    maxConcurrent?: number; // cap on simultaneously-running pool workers (default 8)
    pruneDays?: number; // drop enrolled repos untouched for this many days (default 14)
    enrolled?: EnrolledWorker[];
  };
}

export const WORKER_DEFAULTS = { autoEnroll: true, maxConcurrent: 8, pruneDays: 14 } as const;

export function readConfig(): NerveplaneConfig {
  try {
    const p = configPath();
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as NerveplaneConfig) : {};
  } catch {
    return {};
  }
}

/** Shallow-merge a patch (with a nested merge of `memory` and `workers`) and persist.
 *  The `workers.enrolled` array is replaced wholesale by the patch when present — callers
 *  (enroll/unenroll) always pass the full recomputed array (read-modify-write). */
export function writeConfig(patch: NerveplaneConfig): NerveplaneConfig {
  const cur = readConfig();
  const next: NerveplaneConfig = {
    ...cur,
    ...patch,
    memory: { ...cur.memory, ...patch.memory },
    workers: { ...cur.workers, ...patch.workers },
  };
  mkdirSync(currentHome(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

// --- worker pool config (see src/daemon/worker-pool.ts) ---

export function readWorkersConfig(cfg: NerveplaneConfig = readConfig()) {
  const w = cfg.workers ?? {};
  return {
    autoEnroll: w.autoEnroll ?? WORKER_DEFAULTS.autoEnroll,
    maxConcurrent: w.maxConcurrent ?? WORKER_DEFAULTS.maxConcurrent,
    pruneDays: w.pruneDays ?? WORKER_DEFAULTS.pruneDays,
    enrolled: w.enrolled ?? [],
  };
}

export function readEnrolledWorkers(): EnrolledWorker[] {
  return readConfig().workers?.enrolled ?? [];
}

/** Idempotent upsert by `repoPath`; refreshes `lastSeenAt`. Read-modify-write of the
 *  whole array so it survives the shallow `workers` merge in writeConfig. */
export function enrollWorker(repoPath: string, opts: { agent?: string; model?: string } = {}): EnrolledWorker[] {
  repoPath = canonicalRepoPath(repoPath);
  const cur = readEnrolledWorkers();
  const now = new Date().toISOString();
  const existing = cur.find((e) => e.repoPath === repoPath);
  const merged: EnrolledWorker = {
    repoPath,
    agent: opts.agent ?? existing?.agent,
    model: opts.model ?? existing?.model,
    lastSeenAt: now,
  };
  const enrolled = existing ? cur.map((e) => (e.repoPath === repoPath ? merged : e)) : [...cur, merged];
  return writeConfig({ workers: { enrolled } }).workers?.enrolled ?? enrolled;
}

export function unenrollWorker(repoPath: string): EnrolledWorker[] {
  repoPath = canonicalRepoPath(repoPath);
  const enrolled = readEnrolledWorkers().filter((e) => e.repoPath !== repoPath);
  return writeConfig({ workers: { enrolled } }).workers?.enrolled ?? enrolled;
}

export function setAutoEnroll(on: boolean): void {
  writeConfig({ workers: { autoEnroll: on } });
}

const isMode = (v: unknown): v is MemoryMode => v === "keyword" || v === "semantic" || v === "hybrid";
const isEmbedder = (v: unknown): v is Embedder => v === "openai" || v === "ollama";

/** env `NERVEPLANE_MEMORY` › config.json `memory.mode` › `keyword`. */
export function resolveMemoryMode(cfg: NerveplaneConfig = readConfig()): MemoryMode {
  if (isMode(process.env.NERVEPLANE_MEMORY)) return process.env.NERVEPLANE_MEMORY;
  if (isMode(cfg.memory?.mode)) return cfg.memory!.mode!;
  return "keyword";
}

/** env `NERVEPLANE_EMBEDDER` › config.json `memory.embedder` › `none`. */
export function resolveEmbedder(cfg: NerveplaneConfig = readConfig()): Embedder | "none" {
  if (isEmbedder(process.env.NERVEPLANE_EMBEDDER)) return process.env.NERVEPLANE_EMBEDDER;
  if (isEmbedder(cfg.memory?.embedder)) return cfg.memory!.embedder!;
  return "none";
}

export function resolveOllamaUrl(cfg: NerveplaneConfig = readConfig()): string {
  return process.env.NERVEPLANE_OLLAMA_URL ?? cfg.memory?.ollamaUrl ?? "http://127.0.0.1:11434";
}

export function resolveEmbedderModel(cfg: NerveplaneConfig = readConfig()): string | undefined {
  return process.env.NERVEPLANE_EMBEDDER_MODEL ?? cfg.memory?.embedderModel;
}
