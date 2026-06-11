import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { conflictWarnings, suppressions } from "../storage/schema.ts";
import { newId, nowIso } from "./util.ts";

export type ConflictWarning = typeof conflictWarnings.$inferSelect;

export function listConflicts(opts: { status?: "open" | "resolved" | "dismissed"; repoId?: string; agentId?: string } = {}): ConflictWarning[] {
  const db = getDb();
  let rows = db
    .select()
    .from(conflictWarnings)
    .where(opts.status ? eq(conflictWarnings.status, opts.status) : sql`1=1`)
    .orderBy(desc(conflictWarnings.createdAt))
    .all();
  if (opts.repoId) rows = rows.filter((w) => (w.repoScope ?? []).includes(opts.repoId!));
  if (opts.agentId) rows = rows.filter((w) => (w.agentIds ?? []).includes(opts.agentId!));
  return rows;
}

export function resolveConflict(id: string): boolean {
  const res = getDb()
    .update(conflictWarnings)
    .set({ status: "resolved" })
    .where(eq(conflictWarnings.id, id))
    .returning({ id: conflictWarnings.id })
    .all();
  return res.length > 0;
}

/**
 * Dismiss a conflict and remember the dismissal: marks it `dismissed` and writes
 * a `suppressions` row keyed on its fingerprint, so detection won't re-raise the
 * same overlap. This is the user-facing precision lever (plan M2.3).
 */
export function dismissConflict(id: string, reason?: string): boolean {
  const db = getDb();
  const w = db.select().from(conflictWarnings).where(eq(conflictWarnings.id, id)).get();
  if (!w) return false;
  db.update(conflictWarnings).set({ status: "dismissed" }).where(eq(conflictWarnings.id, id)).run();
  if (w.fingerprint) {
    const exists = db.select().from(suppressions).where(eq(suppressions.fingerprint, w.fingerprint)).get();
    if (!exists) {
      db.insert(suppressions)
        .values({ id: newId("sup"), fingerprint: w.fingerprint, recipientAgentId: null, reason: reason ?? "dismissed", suppressedUntil: null, createdAt: nowIso() })
        .run();
    }
  }
  return true;
}
