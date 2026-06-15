import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { agents, capabilities, type AgentStatus } from "../storage/schema.ts";
import { upsertRepoByPath } from "./repos.ts";
import { newId, nowIso } from "./util.ts";

export type Agent = typeof agents.$inferSelect;

export interface RegisterInput {
  name: string;
  displayName?: string;
  capabilities?: string[];
  repoPath?: string;
  serviceName?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  cwd?: string;
  task?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentWithCaps extends Agent {
  capabilities: string[];
}

/**
 * Registers an agent, or resumes an existing one. Durable identity is the
 * (name, worktreePath) natural key (plan Part C.6) so a reconnecting stdio MCP
 * session re-attaches to the same row instead of creating a duplicate.
 */
export async function registerAgent(input: RegisterInput): Promise<AgentWithCaps> {
  const db = getDb();
  const now = nowIso();

  const repo = input.repoPath ? await upsertRepoByPath(input.repoPath) : null;
  const worktreePath = input.worktreePath ?? input.repoPath ?? input.cwd ?? null;

  // One agent per worktree: when a worktree is known, dedup on it (any name) so a
  // SessionStart auto-register and a later `register` tool call (richer name/caps)
  // reconcile to ONE row. Without a worktree, fall back to the (name) key.
  const existing = worktreePath
    ? db.select().from(agents).where(eq(agents.worktreePath, worktreePath)).get()
    : db.select().from(agents).where(eq(agents.name, input.name)).get();

  let id: string;
  if (existing) {
    id = existing.id;
    db.update(agents)
      .set({
        name: input.name, // a tool `register` may rename the auto-registered row
        displayName: input.displayName ?? existing.displayName,
        status: "available",
        repoId: repo?.id ?? existing.repoId,
        branch: input.branch ?? existing.branch,
        baseBranch: input.baseBranch ?? existing.baseBranch,
        cwd: input.cwd ?? existing.cwd,
        metadata: input.metadata ?? existing.metadata,
        lastSeenAt: now,
      })
      .where(eq(agents.id, id))
      .run();
  } else {
    id = newId("agent");
    db.insert(agents)
      .values({
        id,
        name: input.name,
        displayName: input.displayName ?? null,
        status: "available",
        currentTaskId: null,
        repoId: repo?.id ?? null,
        serviceId: null,
        worktreePath,
        branch: input.branch ?? null,
        baseBranch: input.baseBranch ?? null,
        cwd: input.cwd ?? null,
        metadata: input.metadata ?? null,
        registeredAt: now,
        lastSeenAt: now,
      })
      .run();
  }

  // Replace capability set.
  if (input.capabilities) {
    db.delete(capabilities).where(eq(capabilities.agentId, id)).run();
    for (const cap of new Set(input.capabilities)) {
      db.insert(capabilities).values({ agentId: id, capability: cap }).run();
    }
  }

  return getAgent(id)!;
}

export function heartbeat(agentId: string, status?: AgentStatus): boolean {
  const db = getDb();
  const set: Partial<Agent> = { lastSeenAt: nowIso() };
  if (status) set.status = status;
  const res = db.update(agents).set(set).where(eq(agents.id, agentId)).returning({ id: agents.id }).all();
  return res.length > 0;
}

export function setStatus(agentId: string, status: AgentStatus): boolean {
  return heartbeat(agentId, status);
}

export function getAgent(id: string): AgentWithCaps | undefined {
  const db = getDb();
  const row = db.select().from(agents).where(eq(agents.id, id)).get();
  if (!row) return undefined;
  return { ...row, capabilities: capsOf(id) };
}

export function capsOf(agentId: string): string[] {
  return getDb()
    .select()
    .from(capabilities)
    .where(eq(capabilities.agentId, agentId))
    .all()
    .map((c) => c.capability);
}

export interface DiscoverFilter {
  capability?: string;
  repoId?: string;
  serviceId?: string;
  status?: AgentStatus;
  includeOffline?: boolean;
}

/** Lists agents, optionally filtered by capability / repo / service / status. */
export function discoverAgents(filter: DiscoverFilter = {}): AgentWithCaps[] {
  const db = getDb();
  let rows = db.select().from(agents).all();
  if (!filter.includeOffline) rows = rows.filter((a) => a.status !== "offline");
  if (filter.repoId) rows = rows.filter((a) => a.repoId === filter.repoId);
  if (filter.serviceId) rows = rows.filter((a) => a.serviceId === filter.serviceId);
  if (filter.status) rows = rows.filter((a) => a.status === filter.status);
  let withCaps = rows.map((a) => ({ ...a, capabilities: capsOf(a.id) }));
  if (filter.capability) withCaps = withCaps.filter((a) => a.capabilities.includes(filter.capability!));
  return withCaps;
}

/** Finds the most-recently-seen non-offline agent whose worktree matches a path
 *  (used by the last-mile hook to resolve "which agent is this shell"). */
export function agentByWorktree(path: string): AgentWithCaps | undefined {
  const db = getDb();
  const rows = db.select().from(agents).where(eq(agents.worktreePath, path)).all();
  const pick = rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
  return pick ? { ...pick, capabilities: capsOf(pick.id) } : undefined;
}

/** Active agents in a repo other than `exceptAgentId` — the core sensing-fanout set. */
export function activeAgentsInRepo(repoId: string, exceptAgentId?: string): AgentWithCaps[] {
  const db = getDb();
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.repoId, repoId), ne(agents.status, "offline")))
    .all()
    .filter((a) => a.id !== exceptAgentId)
    .map((a) => ({ ...a, capabilities: capsOf(a.id) }));
}
