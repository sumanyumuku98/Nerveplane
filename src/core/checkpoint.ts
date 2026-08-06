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

  // Cursor = the later of the agent's last memory write and its last nudge, so
  // work already captured (or already nudged) never re-triggers.
  const lastMem = db
    .select({ createdAt: memories.createdAt })
    .from(memories)
    .where(eq(memories.authorAgentId, agentId))
    .orderBy(desc(memories.createdAt))
    .limit(1)
    .get();
  const marker = db.select().from(syncMarkers).where(eq(syncMarkers.agentId, agentId)).get();
  const cursor = [lastMem?.createdAt, marker?.lastMemoryNudgeAt].filter(Boolean).sort().at(-1) ?? "";

  // Memory-worthy events this agent produced after the cursor.
  const worthyEvents = db
    .select({ type: events.type })
    .from(events)
    .where(
      and(
        eq(events.producerAgentId, agentId),
        cursor ? gt(events.createdAt, cursor) : undefined,
        inArray(events.type, WORTHY_EVENT_TYPES),
      ),
    )
    .all();
  const decisions = worthyEvents.filter((e) => e.type === DECISION_EVENT_TYPE).length;
  const handoffs = worthyEvents.length - decisions;

  // Substantial uncommitted work in the worktree. This is a live snapshot, so we
  // only count it as a fresh signal when the set was (re)sensed after the cursor
  // — otherwise persistent uncommitted files would re-nudge every turn even after
  // a memory is written.
  const wt = db.select().from(agentWorktreeState).where(eq(agentWorktreeState.agentId, agentId)).get();
  const changedFiles = wt?.changedFiles?.length ?? 0;
  const changedSinceCursor = !cursor || (wt?.updatedAt ?? "") > cursor;
  const substantialChanges = changedFiles >= MEMORY_CHECKPOINT_MIN_FILES && changedSinceCursor;

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
