import { desc, eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import {
  events,
  deliveries,
  messages,
  type Severity,
  type EventType,
  type Artifact,
  type RoutingReason,
} from "../storage/schema.ts";
import { routeEvent, type RoutingHints } from "../routing/engine.ts";
import { newId, nowIso } from "./util.ts";

export type Event = typeof events.$inferSelect;
export type ChatMessage = typeof messages.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;

export interface EmitEventInput {
  type: EventType;
  producerAgentId?: string | null;
  severity?: Severity;
  summary: string;
  body?: string;
  repoScope?: string[];
  serviceScope?: string[];
  affectedFiles?: string[];
  affectedContracts?: string[];
  artifacts?: Artifact[];
  requiredAction?: string;
}

export interface EmitResult {
  event: Event;
  recipients: number;
}

/**
 * Append a typed coordination event and fan it out to recipients via the
 * routing engine. This is the single write path for everything that ends up in
 * an agent's `sync` — whether produced by an agent (`publish`) or by the
 * passive sensing engine (plan Part C.1).
 */
export function emitEvent(input: EmitEventInput, hints: RoutingHints = {}): EmitResult {
  const db = getDb();
  const now = nowIso();
  const severity = input.severity ?? "info";

  const recipients = routeEvent(
    {
      id: "pending",
      type: input.type,
      producerAgentId: input.producerAgentId ?? null,
      severity,
      repoScope: input.repoScope ?? null,
      requiredAction: input.requiredAction ?? null,
    },
    hints,
  );

  const routingReasons: RoutingReason[] = recipients.map((r) => ({
    rule: r.reason,
    detail: `${r.recipientAgentId}: ${r.priority}`,
  }));

  const event: Event = {
    id: newId("evt"),
    type: input.type,
    producerAgentId: input.producerAgentId ?? null,
    severity,
    summary: input.summary,
    body: input.body ?? null,
    repoScope: input.repoScope ?? null,
    serviceScope: input.serviceScope ?? null,
    affectedFiles: input.affectedFiles ?? null,
    affectedContracts: input.affectedContracts ?? null,
    artifacts: input.artifacts ?? null,
    requiredAction: input.requiredAction ?? null,
    routingReasons,
    createdAt: now,
  };

  db.insert(events).values(event).run();

  for (const r of recipients) {
    db.insert(deliveries)
      .values({
        id: newId("dlv"),
        eventId: event.id,
        recipientAgentId: r.recipientAgentId,
        priority: r.priority,
        reason: r.reason,
        requiredAction: r.requiredAction,
        readAt: null,
        createdAt: now,
      })
      .run();
  }

  bus.emit(event, recipients.map((r) => r.recipientAgentId));
  return { event, recipients: recipients.length };
}

export function getEvent(id: string): Event | undefined {
  return getDb().select().from(events).where(eq(events.id, id)).get();
}

export function recentEvents(limit = 50): Event[] {
  return getDb().select().from(events).orderBy(desc(events.createdAt)).limit(limit).all();
}

/** Minimal in-process event bus — SSE/dashboard subscribers and the chat
 *  long-poll attach here. Two channels: typed events and direct messages (kept
 *  separate so a message delivery never masquerades as an `Event`). */
type BusListener = (event: Event, recipientIds: string[]) => void;
type MessageListener = (msg: ChatMessage) => void;
class EventBus {
  private listeners = new Set<BusListener>();
  private messageListeners = new Set<MessageListener>();
  emit(event: Event, recipientIds: string[]): void {
    for (const l of this.listeners) {
      try {
        l(event, recipientIds);
      } catch (err) {
        console.error("nerveplane: event bus listener failed:", err);
      }
    }
  }
  subscribe(l: BusListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  /** Notify subscribers of a freshly-stored direct message (real-time chat). */
  emitMessage(msg: ChatMessage): void {
    for (const l of this.messageListeners) {
      try {
        l(msg);
      } catch (err) {
        console.error("nerveplane: message bus listener failed:", err);
      }
    }
  }
  onMessage(l: MessageListener): () => void {
    this.messageListeners.add(l);
    return () => this.messageListeners.delete(l);
  }
}
export const bus = new EventBus();
