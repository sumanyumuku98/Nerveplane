import { REPO_POLL_INTERVAL_MS } from "../config.ts";
import { discoverAgents } from "../core/registry.ts";
import { emitEvent } from "../core/events.ts";
import { getWorktreeState } from "./git.ts";

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
}

const snapshots = new Map<string, Snapshot>();

/** Senses one agent's worktree once. Returns the number of events emitted (0 or 1). */
export async function senseAgent(agentId: string, worktreePath: string, repoId: string, baseBranch: string | null, agentName: string): Promise<number> {
  const state = await getWorktreeState(worktreePath, baseBranch);
  const current = new Set(state.changedFiles);
  const prev = snapshots.get(agentId);

  // First observation establishes a baseline — no event (we only signal change).
  if (!prev) {
    snapshots.set(agentId, { changed: current, branch: state.branch });
    return 0;
  }

  const added = [...current].filter((f) => !prev.changed.has(f));
  const branchChanged = state.branch !== prev.branch;
  snapshots.set(agentId, { changed: current, branch: state.branch });

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

/** One sensing pass across all active agents that have a worktree + repo. */
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
}
