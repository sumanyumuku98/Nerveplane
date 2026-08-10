import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { agentWorktreeState, events, memories, syncMarkers, type EventType } from "../storage/schema.ts";
import { getAgent } from "./registry.ts";
import { nowIso } from "./util.ts";
import { MEMORY_CHECKPOINT_MIN_FILES } from "../config.ts";

/**
 * Memory-checkpoint nudge (Stop-hook counterpart to peekMessages). Recall is
 * already autonomous (SessionStart/PreToolUse inject memories); this closes the
 * gap on the write side: when an agent finishes a turn after doing memory-worthy
 * work but saved no durable memory, the Stop hook nudges it to `remember`.
 *
 * "Memory-worthy since the agent's last memory write" means any of:
 *   1. a decision it recorded            (event type `decision_recorded`)
 *   2. a task handoff / review / done    (event types below)
 *   3. substantial file changes          (>= MEMORY_CHECKPOINT_MIN_FILES changed)
 *
 * The nudge is self-limiting: writing a memory advances `lastMemoryAt` and clears
 * the signal at the source. A second `lastMemoryNudgeAt` cursor prevents nagging
 * when the agent deliberately ignores a nudge — only new work re-triggers.
 *
 * File changes are a live snapshot (the sensing engine keeps `updatedAt` at the
 * last time the changed-file SET actually changed), so they are capped to at most
 * ONE nudge per memory cycle: once we've nudged since the last memory write, the
 * file-change signal stays suppressed until a memory is saved. Discrete events
 * (decisions/handoffs) still re-nudge because they're rare and cursor-deduped.
 */

/** Event types (emitted in core/tasks.ts) that represent a task boundary worth remembering. */
const HANDOFF_EVENT_TYPES = ["task_handoff_requested", "review_requested", "branch_ready"] as const;
const DECISION_EVENT_TYPE: EventType = "decision_recorded";
const WORTHY_EVENT_TYPES: EventType[] = [DECISION_EVENT_TYPE, ...HANDOFF_EVENT_TYPES];

export interface CheckpointStatus {
  shouldNudge: boolean;
  /** decisions recorded by this agent since the cursor */
  decisions: number;
  /** task handoffs/reviews/branch-ready by this agent since the cursor */
  handoffs: number;
  /** changed files in the agent's worktree (0 if unknown) */
  changedFiles: number;
  /** short human-readable descriptions of the triggering signals */
  signals: string[];
}

const NONE: CheckpointStatus = { shouldNudge: false, decisions: 0, handoffs: 0, changedFiles: 0, signals: [] };

/**
 * Compute whether `agentId` should be nudged to save a memory before going idle.
 * When `opts.ack` and the result is a nudge, advances the per-agent nudge cursor
 * so the same batch of work is nudged at most once.
 */
export function memoryCheckpointStatus(agentId: string, opts: { ack?: boolean } = {}): CheckpointStatus {
  const agent = getAgent(agentId);
  if (!agent) return NONE;
  const db = getDb();

  const lastMem = db
    .select({ createdAt: memories.createdAt })
    .from(memories)
    .where(eq(memories.authorAgentId, agentId))
    .orderBy(desc(memories.createdAt))
    .limit(1)
    .get();
  const marker = db.select().from(syncMarkers).where(eq(syncMarkers.agentId, agentId)).get();
  const lastMemoryAt = lastMem?.createdAt ?? "";
  const lastNudgeAt = marker?.lastMemoryNudgeAt ?? "";
  // Event cursor = the later of the last memory write and the last nudge, so a
  // discrete event already captured (or already nudged for) never re-triggers.
  const eventsCursor = [lastMemoryAt, lastNudgeAt].filter(Boolean).sort().at(-1) ?? "";

  // Memory-worthy events this agent produced after the cursor.
  const worthyEvents = db
    .select({ type: events.type })
    .from(events)
    .where(
      and(
        eq(events.producerAgentId, agentId),
        eventsCursor ? gt(events.createdAt, eventsCursor) : undefined,
        inArray(events.type, WORTHY_EVENT_TYPES),
      ),
    )
    .all();
  const decisions = worthyEvents.filter((e) => e.type === DECISION_EVENT_TYPE).length;
  const handoffs = worthyEvents.length - decisions;

  // Substantial uncommitted work. `updatedAt` is the last time the changed-file
  // SET actually changed (see sensing.ts), so require changes NEWER than the last
  // memory, and cap to one nudge per memory cycle: if we've already nudged since
  // that memory, stay silent until a memory is saved. This is what stops the
  // per-turn nagging for a persistently dirty worktree.
  const wt = db.select().from(agentWorktreeState).where(eq(agentWorktreeState.agentId, agentId)).get();
  const changedFiles = wt?.changedFiles?.length ?? 0;
  const changedSinceMemory = (wt?.updatedAt ?? "") > lastMemoryAt;
  const nudgedSinceMemory = lastNudgeAt !== "" && lastNudgeAt >= lastMemoryAt;
  const substantialChanges = changedFiles >= MEMORY_CHECKPOINT_MIN_FILES && changedSinceMemory && !nudgedSinceMemory;

  const shouldNudge = decisions + handoffs > 0 || substantialChanges;
  if (!shouldNudge) return { ...NONE, changedFiles };

  const signals: string[] = [];
  if (decisions) signals.push(`${decisions} decision(s) recorded`);
  if (handoffs) signals.push(`${handoffs} task update(s) (handoff/review/ready)`);
  if (substantialChanges) signals.push(`${changedFiles} changed file(s)`);

  if (opts.ack) {
    const now = nowIso();
    db.insert(syncMarkers)
      .values({ agentId, lastSyncAt: now, lastMemoryNudgeAt: now })
      .onConflictDoUpdate({ target: syncMarkers.agentId, set: { lastMemoryNudgeAt: now } })
      .run();
  }

  return { shouldNudge, decisions, handoffs, changedFiles, signals };
}
