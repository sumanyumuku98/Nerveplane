import { eq } from "drizzle-orm";
import { REPO_POLL_INTERVAL_MS } from "../config.ts";
import { discoverAgents } from "../core/registry.ts";
import { emitEvent } from "../core/events.ts";
import { getWorktreeState } from "./git.ts";
import { getDb } from "../storage/db.ts";
import { agentWorktreeState } from "../storage/schema.ts";
import { nowIso } from "../core/util.ts";
import { detectConflictsForRepo } from "../conflicts/detect.ts";
import { detectContractChanges, resetContractDetection } from "../services/detect.ts";

/**
 * Passive sensing engine (plan Part C.1 — the core of M1's differentiation).
 * The daemon polls each registered agent's worktree for git changes and emits
 * `files_changed` events ITSELF, so coordination doesn't depend on agents
 * remembering to call `publish`. Routing then fans those events out to other
 * active agents in the same repo.
 */

interface Snapshot {
  changed: Set<string>;
  branch: string | null;
  headSha: string | null;
  /** Wall-clock time the changed-file SET (or branch/head) last actually changed. */
  changedAt: string;
}

const snapshots = new Map<string, Snapshot>();

/** True when the two sets differ in membership (catches both additions and removals). */
function setsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

/** Senses one agent's worktree once. Returns the number of events emitted (0 or 1). */
export async function senseAgent(agentId: string, worktreePath: string, repoId: string, baseBranch: string | null, agentName: string): Promise<number> {
  const state = await getWorktreeState(worktreePath, baseBranch);
  const current = new Set(state.changedFiles);
  const prev = snapshots.get(agentId);
  const now = nowIso();

  // `updatedAt` must mean "last time the changed-file set actually changed", not
  // "last time we polled" — the memory-checkpoint nudge (core/checkpoint.ts) gates
  // on it, and bumping it every tick made a dirty worktree re-nudge every turn.
  //
  // On the first observation this daemon lifetime (no in-memory snapshot), seed
  // the comparison baseline from the persisted row so a daemon RESTART doesn't
  // look like a fresh change — otherwise every restart (we restart on each update)
  // would re-arm one nudge for every dirty agent.
  let baseline = prev;
  if (!baseline) {
    const row = getDb().select().from(agentWorktreeState).where(eq(agentWorktreeState.agentId, agentId)).get();
    if (row) baseline = { changed: new Set(row.changedFiles ?? []), branch: row.branch, headSha: row.headSha, changedAt: row.updatedAt };
  }
  const realChange =
    !baseline || setsDiffer(current, baseline.changed) || state.branch !== baseline.branch || state.headSha !== baseline.headSha;
  const changedAt = realChange ? now : baseline!.changedAt;

  // Persist the latest sensed state every tick so the cross-agent conflict
  // detector always has each agent's current changed-file set (plan M2.1), but
  // only advance `updatedAt` when something genuinely changed.
  getDb()
    .insert(agentWorktreeState)
    .values({
      agentId,
      repoId,
      changedFiles: [...current].sort(),
      branch: state.branch,
      headSha: state.headSha,
      updatedAt: changedAt,
    })
    .onConflictDoUpdate({
      target: agentWorktreeState.agentId,
      set: { repoId, changedFiles: [...current].sort(), branch: state.branch, headSha: state.headSha, updatedAt: changedAt },
    })
    .run();

  // Contract-aware detection runs every tick (even on baseline): an agent may
  // register with a contract edit already present (plan M3.4).
  await detectContractChanges(agentId, worktreePath, repoId, state.mergeBase, [...current]);

  // First observation establishes a baseline — no files_changed event.
  if (!prev) {
    snapshots.set(agentId, { changed: current, branch: state.branch, headSha: state.headSha, changedAt });
    return 0;
  }

  const added = [...current].filter((f) => !prev.changed.has(f));
  const branchChanged = state.branch !== prev.branch;
  snapshots.set(agentId, { changed: current, branch: state.branch, headSha: state.headSha, changedAt });

  if (added.length === 0 && !branchChanged) return 0;
  if (added.length === 0) return 0; // branch-only changes are not actionable in M1

  const preview = added.slice(0, 5).join(", ") + (added.length > 5 ? `, +${added.length - 5} more` : "");
  emitEvent({
    type: "files_changed",
    producerAgentId: agentId,
    severity: "info",
    summary: `${agentName} changed ${added.length} file(s) on ${state.branch ?? "?"}: ${preview}`,
    repoScope: [repoId],
    affectedFiles: [...current].sort(),
    artifacts: [
      { type: "branch", ref: state.branch ?? undefined },
      { type: "diff", summary: `${current.size} changed file(s) vs ${state.baseBranch ?? "base"}` },
    ],
  });
  return 1;
}

/** One sensing pass across all active agents that have a worktree + repo,
 *  followed by cross-agent conflict detection for any repo with ≥2 agents. */
export async function senseTick(): Promise<number> {
  const agents = discoverAgents().filter((a) => a.worktreePath && a.repoId);
  let emitted = 0;
  for (const a of agents) {
    try {
      emitted += await senseAgent(a.id, a.worktreePath!, a.repoId!, a.baseBranch, a.name);
    } catch (err) {
      console.error(`nerveplane: sensing failed for agent ${a.id}:`, err);
    }
  }

  // Run conflict detection once per repo that has ≥2 active agents.
  const repoCounts = new Map<string, number>();
  for (const a of agents) repoCounts.set(a.repoId!, (repoCounts.get(a.repoId!) ?? 0) + 1);
  for (const [repoId, count] of repoCounts) {
    if (count < 2) continue;
    try {
      detectConflictsForRepo(repoId);
    } catch (err) {
      console.error(`nerveplane: conflict detection failed for repo ${repoId}:`, err);
    }
  }
  return emitted;
}

export function startSensing(): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // skip overlapping passes
    running = true;
    void senseTick().finally(() => {
      running = false;
    });
  }, REPO_POLL_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Test helper: clear in-memory snapshots. */
export function resetSensing(): void {
  snapshots.clear();
  resetContractDetection();
}
