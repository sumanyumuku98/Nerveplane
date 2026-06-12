import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Nerveplane runs as a single user-level daemon spanning all projects
 * (cross-repo routing is impossible with per-repo daemons — see plan Part C.5).
 * All durable state lives under ~/.nerveplane/.
 */
export const NERVEPLANE_HOME =
  process.env.NERVEPLANE_HOME ?? join(homedir(), ".nerveplane");

export const DB_PATH = join(NERVEPLANE_HOME, "nerveplane.db");
export const LOCK_PATH = join(NERVEPLANE_HOME, "daemon.lock");
export const LOG_PATH = join(NERVEPLANE_HOME, "daemon.log");

export const HOST = "127.0.0.1";
export const DEFAULT_PORT = Number(process.env.NERVEPLANE_PORT ?? 7734);

/** Presence: agents heartbeat; the sweeper marks them offline past this TTL. */
export const HEARTBEAT_TTL_MS = 60_000;
export const PRESENCE_SWEEP_INTERVAL_MS = 15_000;

/** How often the sensing engine polls registered repos for git changes. */
export const REPO_POLL_INTERVAL_MS = 5_000;

export interface DaemonLock {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
  version: string;
}
