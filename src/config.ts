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

/** Sensitive-content scanning of outbound messages/events: block | warn | off. */
export const SCAN_MODE = ((m) => (m === "warn" || m === "off" ? m : "block"))(process.env.NERVEPLANE_SCAN);

/**
 * Presence. The primary liveness signal is the agent's stdio-bridge process
 * (see core/presence.isAgentLive). The heartbeat TTL is the *fallback* for
 * clients that can't report a connection PID (HTTP-MCP/remote), so it's
 * generous — coding agents act in bursts with long think/edit gaps.
 */
export const HEARTBEAT_TTL_MS = 15 * 60_000; // 15 min fallback liveness window
export const PRESENCE_SWEEP_INTERVAL_MS = 60_000;
/** Absolute cap guarding against connection-PID reuse: even a live PID is
 *  considered stale if the agent hasn't been seen within this window. */
export const MAX_SESSION_MS = 24 * 60 * 60_000; // 24h

/** How often the sensing engine polls registered repos for git changes. */
export const REPO_POLL_INTERVAL_MS = 5_000;

export interface DaemonLock {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
  version: string;
}
