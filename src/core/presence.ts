import { eq, ne } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { agents } from "../storage/schema.ts";
import { HEARTBEAT_TTL_MS, MAX_SESSION_MS, PRESENCE_SWEEP_INTERVAL_MS } from "../config.ts";
import { isoMsAgo } from "./util.ts";
import { isProcessAlive } from "../daemon/lock.ts";

type AgentRow = typeof agents.$inferSelect;

/**
 * Is an agent's session actually alive? Primary signal is its stdio-bridge
 * process (same host as the daemon): alive ⇔ the process is alive — independent
 * of how recently it called a tool. `lastSeenAt` only bounds PID reuse. Agents
 * without a connection PID (HTTP-MCP / remote / pre-first-call) fall back to the
 * heartbeat TTL. This is the single source of truth for presence (sweeper +
 * discover both use it), so it stays correct between sweeps.
 */
export function isAgentLive(a: Pick<AgentRow, "connectionPid" | "lastSeenAt">): boolean {
  if (a.connectionPid != null) {
    return isProcessAlive(a.connectionPid) && a.lastSeenAt >= isoMsAgo(MAX_SESSION_MS);
  }
  return a.lastSeenAt >= isoMsAgo(HEARTBEAT_TTL_MS);
}

/**
 * Agents crash without deregistering (plan Part C.6). The sweeper marks any
 * agent that is no longer live (dead bridge process, or — for PID-less clients —
 * past the heartbeat TTL) as `offline`. Returns the number of agents swept.
 */
export function sweepPresence(): number {
  const db = getDb();
  const candidates = db.select().from(agents).where(ne(agents.status, "offline")).all();
  let swept = 0;
  for (const a of candidates) {
    if (isAgentLive(a)) continue;
    db.update(agents).set({ status: "offline" }).where(eq(agents.id, a.id)).run();
    swept++;
  }
  return swept;
}

export function startPresenceSweeper(): () => void {
  const timer = setInterval(() => {
    try {
      sweepPresence();
    } catch (err) {
      console.error("nerveplane: presence sweep failed:", err);
    }
  }, PRESENCE_SWEEP_INTERVAL_MS);
  // don't keep the event loop alive solely for the sweeper
  timer.unref?.();
  return () => clearInterval(timer);
}
