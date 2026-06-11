import { and, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import {
  deliveries,
  events,
  messages,
  conflictWarnings,
  syncMarkers,
  type Severity,
} from "../storage/schema.ts";
import { newId, nowIso } from "./util.ts";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocking: 4,
};

export interface SendMessageInput {
  senderAgentId?: string | null;
  recipientAgentId?: string | null;
  recipientGroup?: string | null;
  subject?: string;
  body: string;
  priority?: Severity;
  threadId?: string;
  relatedEventId?: string;
}

export function sendMessage(input: SendMessageInput): { id: string } {
  const db = getDb();
  const id = newId("msg");
  db.insert(messages)
    .values({
      id,
      threadId: input.threadId ?? null,
      senderAgentId: input.senderAgentId ?? null,
      recipientAgentId: input.recipientAgentId ?? null,
      recipientGroup: input.recipientGroup ?? null,
      subject: input.subject ?? null,
      body: input.body,
      relatedEventId: input.relatedEventId ?? null,
      priority: input.priority ?? "info",
      readAt: null,
      createdAt: nowIso(),
    })
    .run();
  return { id };
}

export interface UpdateItem {
  eventId: string;
  type: string;
  severity: Severity;
  priority: Severity;
  summary: string;
  body: string | null;
  affectedFiles: string[] | null;
  affectedContracts: string[] | null;
  reason: string | null;
  requiredAction: string | null;
  createdAt: string;
}

export interface InboxMessage {
  id: string;
  from: string | null;
  subject: string | null;
  body: string;
  priority: Severity;
  createdAt: string;
}

export interface SyncResult {
  agentId: string;
  since: string | null;
  now: string;
  updates: UpdateItem[];
  messages: InboxMessage[];
  conflicts: (typeof conflictWarnings.$inferSelect)[];
}

/** Read-only peek at unread routed updates at/above a severity (used by the hook). */
export function unreadUpdates(agentId: string, minSeverity: Severity = "info"): UpdateItem[] {
  const db = getDb();
  const rows = db
    .select({ d: deliveries, e: events })
    .from(deliveries)
    .innerJoin(events, eq(deliveries.eventId, events.id))
    .where(and(eq(deliveries.recipientAgentId, agentId), isNull(deliveries.readAt)))
    .orderBy(desc(deliveries.createdAt))
    .all();
  const min = SEVERITY_RANK[minSeverity];
  return rows
    .filter((r) => SEVERITY_RANK[r.d.priority] >= min)
    .map((r) => ({
      eventId: r.e.id,
      type: r.e.type,
      severity: r.e.severity,
      priority: r.d.priority,
      summary: r.e.summary,
      body: r.e.body,
      affectedFiles: r.e.affectedFiles,
      affectedContracts: r.e.affectedContracts,
      reason: r.d.reason,
      requiredAction: r.d.requiredAction,
      createdAt: r.e.createdAt,
    }));
}

/**
 * Peek at unread updates at/above a severity, optionally acking just those
 * (used by the last-mile Claude Code hook so injected warnings don't repeat on
 * every tool call, while `sync` still owns the full inbox).
 */
export function peek(agentId: string, minSeverity: Severity, ack: boolean): UpdateItem[] {
  const items = unreadUpdates(agentId, minSeverity);
  if (ack && items.length) {
    getDb()
      .update(deliveries)
      .set({ readAt: nowIso() })
      .where(
        and(
          eq(deliveries.recipientAgentId, agentId),
          inArray(
            deliveries.eventId,
            items.map((i) => i.eventId),
          ),
        ),
      )
      .run();
  }
  return items;
}

/**
 * Returns everything new for an agent since its last sync — routed updates,
 * direct messages, and open conflict warnings involving it — then (by default)
 * marks them read and advances the agent's sync marker.
 */
export function syncAgent(agentId: string, opts: { ack?: boolean } = { ack: true }): SyncResult {
  const db = getDb();
  const now = nowIso();
  const marker = db.select().from(syncMarkers).where(eq(syncMarkers.agentId, agentId)).get();

  const updates = unreadUpdates(agentId);

  const msgRows = db
    .select()
    .from(messages)
    .where(and(eq(messages.recipientAgentId, agentId), isNull(messages.readAt)))
    .orderBy(desc(messages.createdAt))
    .all();
  const inboxMessages: InboxMessage[] = msgRows.map((m) => ({
    id: m.id,
    from: m.senderAgentId,
    subject: m.subject,
    body: m.body,
    priority: m.priority,
    createdAt: m.createdAt,
  }));

  // Open conflict warnings whose agent set includes this agent.
  const conflicts = db
    .select()
    .from(conflictWarnings)
    .where(
      and(
        eq(conflictWarnings.status, "open"),
        sql`${conflictWarnings.agentIds} LIKE ${"%" + agentId + "%"}`,
      ),
    )
    .orderBy(desc(conflictWarnings.createdAt))
    .all();

  if (opts.ack ?? true) {
    if (updates.length) {
      db.update(deliveries)
        .set({ readAt: now })
        .where(and(eq(deliveries.recipientAgentId, agentId), isNull(deliveries.readAt)))
        .run();
    }
    if (msgRows.length) {
      db.update(messages)
        .set({ readAt: now })
        .where(
          inArray(
            messages.id,
            msgRows.map((m) => m.id),
          ),
        )
        .run();
    }
    db.insert(syncMarkers)
      .values({ agentId, lastSyncAt: now })
      .onConflictDoUpdate({ target: syncMarkers.agentId, set: { lastSyncAt: now } })
      .run();
  }

  return { agentId, since: marker?.lastSyncAt ?? null, now, updates, messages: inboxMessages, conflicts };
}
