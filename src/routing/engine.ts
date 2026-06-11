import { eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { agents, tasks, type Severity, type EventType } from "../storage/schema.ts";
import { activeAgentsInRepo, discoverAgents } from "../core/registry.ts";

export interface RoutableEvent {
  id: string;
  type: EventType;
  producerAgentId: string | null;
  severity: Severity;
  repoScope: string[] | null;
  requiredAction: string | null;
}

export interface RoutingHints {
  taskId?: string;
  requiredCapabilities?: string[];
  explicitRecipientIds?: string[];
}

export interface Recipient {
  recipientAgentId: string;
  priority: Severity;
  reason: string;
  requiredAction: string | null;
}

const CAPABILITY_EVENTS: ReadonlySet<EventType> = new Set([
  "review_requested",
  "task_handoff_requested",
]);

/**
 * MVP routing (spec §17.3, scoped for M1): explicit recipients, task owner,
 * same-repo fanout, and capability match for review/handoff. Dedup of
 * recipients here; severity calibration + suppression land in M2.
 */
export function routeEvent(event: RoutableEvent, hints: RoutingHints = {}): Recipient[] {
  const db = getDb();
  const byId = new Map<string, Recipient>();

  const add = (agentId: string, reason: string, priority: Severity = event.severity) => {
    if (!agentId || agentId === event.producerAgentId) return; // never route to the producer
    if (!byId.has(agentId)) {
      byId.set(agentId, { recipientAgentId: agentId, priority, reason, requiredAction: event.requiredAction });
    }
  };

  // Rule 1: explicit recipients always receive.
  for (const id of hints.explicitRecipientIds ?? []) add(id, "explicit recipient");

  // Rule 2: the owner of the referenced task receives task events.
  if (hints.taskId) {
    const task = db.select().from(tasks).where(eq(tasks.id, hints.taskId)).get();
    if (task?.ownerAgentId) add(task.ownerAgentId, `owns task "${task.title}"`);
  }

  // Rule 3: same-repo fanout — active agents in the affected repos get the update.
  for (const repoId of event.repoScope ?? []) {
    for (const a of activeAgentsInRepo(repoId, event.producerAgentId ?? undefined)) {
      add(a.id, "active in the same repository");
    }
  }

  // Rule 4: capability match for review / handoff requests.
  if (CAPABILITY_EVENTS.has(event.type) && hints.requiredCapabilities?.length) {
    for (const cap of hints.requiredCapabilities) {
      for (const a of discoverAgents({ capability: cap })) {
        add(a.id, `has required capability "${cap}"`);
      }
    }
  }

  return [...byId.values()];
}

/** Resolves an agent's repoId (used by callers building event repoScope). */
export function agentRepoId(agentId: string): string | null {
  return getDb().select().from(agents).where(eq(agents.id, agentId)).get()?.repoId ?? null;
}
