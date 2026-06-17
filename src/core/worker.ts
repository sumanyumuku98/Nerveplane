import { bus } from "./events.ts";
import { heartbeat } from "./registry.ts";
import { unreadUpdates, peekMessages, SEVERITY_RANK, type UpdateItem, type InboxMessage } from "./inbox.ts";

/**
 * The daemon side of `nerveplane worker`. `waitForWork` is the long-poll an
 * always-on worker blocks on: it resolves the moment there's *actionable* work
 * for the agent — an unread direct message, or an unread routed update at/above
 * `high` severity — else after `timeoutMs`. Cost guard: `info`/`low`/`medium`
 * events never wake a worker (only DMs + high/blocking), so idle workers don't
 * spin up a Claude turn for routine chatter. Read-only: nothing is acked here;
 * the spawned agent's turn consumes/acks via `sync`.
 */

const DEFAULT_WAIT_MS = 45_000;
const MIN_WAIT_MS = 1_000;
// Must stay under the daemon client's request abort (HEARTBEAT_TTL_MS = 60s).
const MAX_WAIT_MS = 50_000;
const WAKE_MIN = SEVERITY_RANK.high;

export interface WorkResult {
  messages: InboxMessage[];
  updates: UpdateItem[];
  timedOut: boolean;
}

/** Current actionable snapshot for an agent (unread DMs + high-severity updates). */
function snapshot(agentId: string): { messages: InboxMessage[]; updates: UpdateItem[] } {
  const messages = peekMessages(agentId, { ack: false, limit: 50 });
  const updates = unreadUpdates(agentId, "high");
  return { messages, updates };
}

const hasWork = (s: { messages: unknown[]; updates: unknown[] }) => s.messages.length > 0 || s.updates.length > 0;

export function waitForWork(agentId: string, opts: { timeoutMs?: number } = {}): Promise<WorkResult> {
  heartbeat(agentId);
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_WAIT_MS, MIN_WAIT_MS), MAX_WAIT_MS);

  const initial = snapshot(agentId);
  if (hasWork(initial)) return Promise.resolve({ ...initial, timedOut: false });

  return new Promise<WorkResult>((resolve) => {
    let done = false;
    const settle = (timedOut: boolean) => {
      if (done) return;
      const s = snapshot(agentId);
      // On a wake, only resolve once there's real work; otherwise keep waiting.
      if (!timedOut && !hasWork(s)) return;
      done = true;
      clearTimeout(timer);
      unsubMsg();
      unsubEvt();
      resolve({ ...s, timedOut: timedOut && !hasWork(s) });
    };
    const unsubMsg = bus.onMessage((m) => {
      if (m.recipientAgentId === agentId) settle(false);
    });
    const unsubEvt = bus.subscribe((event, recipientIds) => {
      // Cost guard: only high/blocking events routed to this agent wake it.
      if (recipientIds.includes(agentId) && SEVERITY_RANK[event.severity] >= WAKE_MIN) settle(false);
    });
    const timer = setTimeout(() => settle(true), timeoutMs);
  });
}
