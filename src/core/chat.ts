import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { messages, type Severity } from "../storage/schema.ts";
import { sendMessage, toInboxMessage, type InboxMessage } from "./inbox.ts";
import { bus, type ChatMessage } from "./events.ts";
import { heartbeat } from "./registry.ts";
import { newId, nowIso } from "./util.ts";

/**
 * Direct agent-to-agent chat. Built on the `messages` table + the bus message
 * channel (see inbox.sendMessage → bus.emitMessage), this adds the conversation
 * layer: deterministic threads, replies, history, and a real-time long-poll
 * (`waitForChat`) so an agent can block for an answer instead of polling `sync`.
 */

const DEFAULT_WAIT_MS = 25_000;
// Must stay under the daemon client's request abort (HEARTBEAT_TTL_MS = 60s).
const MAX_WAIT_MS = 50_000;

/** Deterministic 1:1 thread id so every DM between a pair lands in one thread. */
export function threadKey(a: string, b: string): string {
  return "thr_" + [a, b].sort().join("__");
}

export interface SendChatInput {
  senderAgentId: string;
  recipientAgentId?: string | null;
  recipientGroup?: string | null;
  threadId?: string;
  subject?: string;
  body: string;
  priority?: Severity;
}

export function sendChat(input: SendChatInput): { id: string; threadId: string } {
  const threadId =
    input.threadId ??
    (input.recipientAgentId ? threadKey(input.senderAgentId, input.recipientAgentId) : newId("thr"));
  const { id } = sendMessage({
    senderAgentId: input.senderAgentId,
    recipientAgentId: input.recipientAgentId ?? null,
    recipientGroup: input.recipientGroup ?? null,
    threadId,
    subject: input.subject,
    body: input.body,
    priority: input.priority,
  });
  return { id, threadId };
}

/** Reply in a thread — recipients are the thread's other participants. */
export function replyChat(input: {
  agentId: string;
  threadId: string;
  body: string;
  subject?: string;
  priority?: Severity;
}): { ids: string[]; threadId: string; recipients: string[] } {
  const rows = threadMessages(input.threadId);
  const others = new Set<string>();
  for (const m of rows) {
    if (m.senderAgentId && m.senderAgentId !== input.agentId) others.add(m.senderAgentId);
    if (m.recipientAgentId && m.recipientAgentId !== input.agentId) others.add(m.recipientAgentId);
  }
  const recipients = [...others];
  const ids: string[] = [];
  if (recipients.length === 0) {
    // No known peer yet — still record the message in the thread.
    ids.push(sendMessage({ senderAgentId: input.agentId, threadId: input.threadId, subject: input.subject, body: input.body, priority: input.priority }).id);
  } else {
    for (const r of recipients) {
      ids.push(
        sendMessage({ senderAgentId: input.agentId, recipientAgentId: r, threadId: input.threadId, subject: input.subject, body: input.body, priority: input.priority }).id,
      );
    }
  }
  return { ids, threadId: input.threadId, recipients };
}

/** Ordered conversation history for a thread (independent of read state). */
export function threadMessages(threadId: string, opts: { limit?: number } = {}): ChatMessage[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    // rowid (monotonic with insertion) breaks same-millisecond createdAt ties.
    .orderBy(messages.createdAt, sql`rowid`)
    .limit(opts.limit ?? 200)
    .all();
}

export interface ThreadSummary {
  threadId: string;
  participants: string[];
  lastMessage: InboxMessage;
  unread: number;
  messageCount: number;
}

function summarize(rowsNewestFirst: ChatMessage[], agentId?: string): ThreadSummary[] {
  const byThread = new Map<string, ChatMessage[]>();
  for (const m of rowsNewestFirst) {
    const t = m.threadId ?? (m.senderAgentId && m.recipientAgentId ? threadKey(m.senderAgentId, m.recipientAgentId) : m.id);
    const list = byThread.get(t);
    if (list) list.push(m);
    else byThread.set(t, [m]);
  }
  const out: ThreadSummary[] = [];
  for (const [threadId, msgs] of byThread) {
    const participants = new Set<string>();
    let unread = 0;
    for (const m of msgs) {
      if (m.senderAgentId) participants.add(m.senderAgentId);
      if (m.recipientAgentId) participants.add(m.recipientAgentId);
      if (m.readAt === null && (agentId === undefined || m.recipientAgentId === agentId)) unread++;
    }
    out.push({ threadId, participants: [...participants], lastMessage: toInboxMessage(msgs[0]!), unread, messageCount: msgs.length });
  }
  return out.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
}

/** Threads an agent participates in (sender or recipient), newest first. */
export function listThreads(agentId: string): ThreadSummary[] {
  const rows = getDb()
    .select()
    .from(messages)
    .where(or(eq(messages.senderAgentId, agentId), eq(messages.recipientAgentId, agentId)))
    .orderBy(desc(messages.createdAt), desc(sql`rowid`))
    .all();
  return summarize(rows, agentId);
}

/** All threads across all agents — the dashboard's global chat view. */
export function allThreads(): ThreadSummary[] {
  const rows = getDb().select().from(messages).orderBy(desc(messages.createdAt), desc(sql`rowid`)).all();
  return summarize(rows);
}

function takeUnread(agentId: string, threadId?: string): InboxMessage[] {
  const db = getDb();
  const where = threadId
    ? and(eq(messages.recipientAgentId, agentId), isNull(messages.readAt), eq(messages.threadId, threadId))
    : and(eq(messages.recipientAgentId, agentId), isNull(messages.readAt));
  const rows = db.select().from(messages).where(where).orderBy(messages.createdAt, sql`rowid`).all();
  if (rows.length) {
    db.update(messages)
      .set({ readAt: nowIso() })
      .where(
        inArray(
          messages.id,
          rows.map((r) => r.id),
        ),
      )
      .run();
  }
  return rows.map(toInboxMessage);
}

export interface WaitResult {
  messages: InboxMessage[];
  timedOut: boolean;
}

/**
 * Real-time long-poll: resolve as soon as a new (or already-unread) direct
 * message for `agentId` is available, else after `timeoutMs`. Marks returned
 * messages read and keeps the waiting agent present. Always cleans up.
 */
export function waitForChat(agentId: string, opts: { threadId?: string; timeoutMs?: number } = {}): Promise<WaitResult> {
  heartbeat(agentId);
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_WAIT_MS, 1_000), MAX_WAIT_MS);

  const immediate = takeUnread(agentId, opts.threadId);
  if (immediate.length) return Promise.resolve({ messages: immediate, timedOut: false });

  return new Promise<WaitResult>((resolve) => {
    let done = false;
    const finish = (msgs: InboxMessage[], timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve({ messages: msgs, timedOut });
    };
    const unsub = bus.onMessage((m) => {
      if (m.recipientAgentId !== agentId) return;
      if (opts.threadId && m.threadId !== opts.threadId) return;
      const msgs = takeUnread(agentId, opts.threadId);
      if (msgs.length) finish(msgs, false);
    });
    const timer = setTimeout(() => finish([], true), timeoutMs);
  });
}
