import { desc, eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { decisions, type Artifact } from "../storage/schema.ts";
import { emitEvent } from "./events.ts";
import { newId, nowIso } from "./util.ts";

export type Decision = typeof decisions.$inferSelect;

export interface RecordDecisionInput {
  title: string;
  description?: string;
  scope?: Record<string, unknown>;
  createdBy?: string;
  supersedes?: string;
  relatedArtifacts?: Artifact[];
  repoScope?: string[];
}

/**
 * Append a durable decision to the ledger — durable project truth stored
 * separately from message history (spec §20). Superseding marks the prior
 * decision and emits a `decision_recorded` event for fanout.
 */
export function recordDecision(input: RecordDecisionInput): Decision {
  const db = getDb();
  const now = nowIso();
  const id = newId("dec");

  if (input.supersedes) {
    db.update(decisions).set({ status: "superseded" }).where(eq(decisions.id, input.supersedes)).run();
  }

  const row: Decision = {
    id,
    title: input.title,
    description: input.description ?? null,
    scope: input.scope ?? null,
    status: "active",
    createdBy: input.createdBy ?? null,
    supersedes: input.supersedes ?? null,
    relatedArtifacts: input.relatedArtifacts ?? null,
    createdAt: now,
  };
  db.insert(decisions).values(row).run();

  emitEvent({
    type: "decision_recorded",
    producerAgentId: input.createdBy ?? null,
    severity: "info",
    summary: `decision: ${input.title}`,
    body: input.description,
    repoScope: input.repoScope,
  });
  return row;
}

export interface DecisionQuery {
  repoId?: string;
  file?: string;
  serviceId?: string;
  taskId?: string;
  status?: Decision["status"];
  limit?: number;
}

/**
 * Returns decisions relevant to a scope. M1 supports status + free scope
 * matching against the JSON scope blob; file/repo/service/task precision is
 * refined in M4 once scope shapes are standardized.
 */
export function queryDecisions(q: DecisionQuery = {}): Decision[] {
  const db = getDb();
  let rows = db.select().from(decisions).orderBy(desc(decisions.createdAt)).all();
  if (q.status) rows = rows.filter((d) => d.status === q.status);

  const needles = [q.repoId, q.file, q.serviceId, q.taskId].filter(Boolean) as string[];
  if (needles.length) {
    rows = rows.filter((d) => {
      const blob = JSON.stringify(d.scope ?? {});
      return needles.some((n) => blob.includes(n));
    });
  }
  return rows.slice(0, q.limit ?? 50);
}

export function recentDecisions(limit = 20): Decision[] {
  return getDb()
    .select()
    .from(decisions)
    .where(eq(decisions.status, "active"))
    .orderBy(desc(decisions.createdAt))
    .limit(limit)
    .all();
}
