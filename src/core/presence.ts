import { and, lt, ne } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { agents } from "../storage/schema.ts";
import { HEARTBEAT_TTL_MS, PRESENCE_SWEEP_INTERVAL_MS } from "../config.ts";
import { isoMsAgo } from "./util.ts";

/**
 * Agents crash without deregistering (plan Part C.6). The sweeper marks any
 * agent whose last heartbeat is older than HEARTBEAT_TTL_MS as `offline`.
 * Returns the number of agents swept.
 */
export function sweepPresence(): number {
  const db = getDb();
  const cutoff = isoMsAgo(HEARTBEAT_TTL_MS);
  const swept = db
    .update(agents)
    .set({ status: "offline" })
    .where(and(lt(agents.lastSeenAt, cutoff), ne(agents.status, "offline")))
    .returning({ id: agents.id })
    .all();
  return swept.length;
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
