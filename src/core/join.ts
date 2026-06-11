import { getAgent, discoverAgents } from "./registry.ts";
import { openTasks } from "./tasks.ts";
import { recentDecisions } from "./decisions.ts";
import { unreadUpdates } from "./inbox.ts";

export interface JoinPacket {
  active_agents: { id: string; name: string; status: string; capabilities: string[]; branch: string | null }[];
  open_tasks: { id: string; title: string; status: string; owner: string | null }[];
  recent_decisions: { id: string; title: string; createdAt: string }[];
  open_blockers: { taskId: string; title: string; blockers: string[] }[];
  relevant_conflicts: unknown[];
  suggested_next_actions: string[];
}

/**
 * Onboarding state handed to an agent at registration (spec §13.1/§19): who is
 * active, what's open, recent durable decisions, current blockers, and any
 * updates already routed to it — so a late-joining agent gets project state
 * without reading the whole event history.
 */
export function buildJoinPacket(agentId: string): JoinPacket {
  const me = getAgent(agentId);
  const active = discoverAgents().filter((a) => a.id !== agentId);
  const tasks = openTasks();
  const myUpdates = unreadUpdates(agentId);

  const blockers = tasks
    .filter((t) => t.status === "blocked" && (t.blockers?.length ?? 0) > 0)
    .map((t) => ({ taskId: t.id, title: t.title, blockers: t.blockers ?? [] }));

  const suggested: string[] = [];
  if (myUpdates.some((u) => u.priority === "high" || u.priority === "blocking")) {
    suggested.push("You have high-priority routed updates — call `sync` and address them before editing.");
  }
  if (me?.currentTaskId == null) suggested.push("No task claimed — call `task` with action=claim to register your work.");
  if (tasks.length === 0) suggested.push("No open tasks yet — you're likely the first agent in.");

  return {
    active_agents: active.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      capabilities: a.capabilities,
      branch: a.branch,
    })),
    open_tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, owner: t.ownerAgentId })),
    recent_decisions: recentDecisions().map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt })),
    open_blockers: blockers,
    relevant_conflicts: [],
    suggested_next_actions: suggested,
  };
}
