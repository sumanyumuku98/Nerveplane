import { desc, eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { tasks, agents, type TaskStatus, type Artifact } from "../storage/schema.ts";
import { emitEvent } from "./events.ts";
import { newId, nowIso } from "./util.ts";

export type Task = typeof tasks.$inferSelect;

function repoScopeOf(agentId?: string | null): string[] | undefined {
  if (!agentId) return undefined;
  const repoId = getDb().select().from(agents).where(eq(agents.id, agentId)).get()?.repoId;
  return repoId ? [repoId] : undefined;
}

export interface ClaimInput {
  agentId: string;
  taskId?: string; // claim an existing planned task; otherwise create+claim
  title?: string;
  description?: string;
  requiredCapabilities?: string[];
  repoScope?: string[];
  serviceScope?: string[];
}

export function claimTask(input: ClaimInput): Task {
  const db = getDb();
  const now = nowIso();

  let task: Task;
  if (input.taskId) {
    const existing = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
    if (!existing) throw new Error(`task not found: ${input.taskId}`);
    db.update(tasks)
      .set({ ownerAgentId: input.agentId, status: "claimed", updatedAt: now })
      .where(eq(tasks.id, input.taskId))
      .run();
    task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()!;
  } else {
    if (!input.title) throw new Error("title required to create a task");
    const id = newId("task");
    const row: Task = {
      id,
      title: input.title,
      description: input.description ?? null,
      ownerAgentId: input.agentId,
      requesterAgentId: input.agentId,
      status: "claimed",
      requiredCapabilities: input.requiredCapabilities ?? null,
      repoScope: input.repoScope ?? repoScopeOf(input.agentId) ?? null,
      serviceScope: input.serviceScope ?? null,
      dependencies: null,
      blockers: null,
      inputArtifacts: null,
      outputArtifacts: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(tasks).values(row).run();
    task = row;
  }

  db.update(agents).set({ currentTaskId: task.id, status: "in_progress" }).where(eq(agents.id, input.agentId)).run();
  emitEvent(
    {
      type: "task_claimed",
      producerAgentId: input.agentId,
      severity: "info",
      summary: `claimed task: ${task.title}`,
      repoScope: task.repoScope ?? undefined,
    },
    { taskId: task.id },
  );
  return task;
}

export interface UpdateInput {
  agentId: string;
  taskId: string;
  status?: TaskStatus;
  blockers?: string[];
  outputArtifacts?: Artifact[];
  requiredCapabilities?: string[];
}

export function updateTask(input: UpdateInput): Task {
  const db = getDb();
  const now = nowIso();
  const existing = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
  if (!existing) throw new Error(`task not found: ${input.taskId}`);

  db.update(tasks)
    .set({
      status: input.status ?? existing.status,
      blockers: input.blockers ?? existing.blockers,
      outputArtifacts: input.outputArtifacts ?? existing.outputArtifacts,
      requiredCapabilities: input.requiredCapabilities ?? existing.requiredCapabilities,
      updatedAt: now,
    })
    .where(eq(tasks.id, input.taskId))
    .run();
  const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()!;

  if (input.status === "blocked") {
    emitEvent(
      {
        type: "task_blocked",
        producerAgentId: input.agentId,
        severity: "medium",
        summary: `task blocked: ${task.title}`,
        body: (input.blockers ?? []).join("; ") || undefined,
        repoScope: task.repoScope ?? undefined,
        requiredAction: "resolve blocker",
      },
      { taskId: task.id },
    );
  } else if (input.status === "needs_review") {
    requestReview({ agentId: input.agentId, taskId: task.id, requiredCapabilities: task.requiredCapabilities ?? [] });
  } else if (input.status === "ready_to_merge") {
    emitEvent(
      { type: "branch_ready", producerAgentId: input.agentId, severity: "info", summary: `ready to merge: ${task.title}`, repoScope: task.repoScope ?? undefined },
      { taskId: task.id },
    );
  }
  return task;
}

export function handoffTask(input: { agentId: string; taskId: string; requiredCapabilities: string[] }): Task {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
  if (!task) throw new Error(`task not found: ${input.taskId}`);
  emitEvent(
    {
      type: "task_handoff_requested",
      producerAgentId: input.agentId,
      severity: "medium",
      summary: `handoff requested: ${task.title}`,
      repoScope: task.repoScope ?? undefined,
      requiredAction: "pick up handed-off task",
    },
    { taskId: task.id, requiredCapabilities: input.requiredCapabilities },
  );
  return task;
}

export function requestReview(input: { agentId: string; taskId: string; requiredCapabilities: string[] }): Task {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
  if (!task) throw new Error(`task not found: ${input.taskId}`);
  emitEvent(
    {
      type: "review_requested",
      producerAgentId: input.agentId,
      severity: "medium",
      summary: `review requested: ${task.title}`,
      repoScope: task.repoScope ?? undefined,
      requiredAction: "review the branch",
    },
    { taskId: task.id, requiredCapabilities: input.requiredCapabilities },
  );
  return task;
}

export function getTask(id: string): Task | undefined {
  return getDb().select().from(tasks).where(eq(tasks.id, id)).get();
}

export function openTasks(limit = 100): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .orderBy(desc(tasks.updatedAt))
    .limit(limit)
    .all()
    .filter((t) => !["merged", "abandoned"].includes(t.status));
}
