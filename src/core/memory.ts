import { getRawSqlite } from "../storage/db.ts";
import { newId, nowIso } from "./util.ts";
import { MEMORY_MODE } from "../config.ts";
import { keywordBackend } from "../memory/backend.ts";
import { mem0Backend, mem0Forget } from "../memory/mem0-backend.ts";
import { hybridBackend } from "../memory/hybrid.ts";
import type { MemoryBackend, MemoryHit, MemoryKind, MemoryRecord, MemoryScope, RecallOptions } from "../memory/backend.ts";

export type { MemoryHit, MemoryKind, MemoryRecord, MemoryScope } from "../memory/backend.ts";

/**
 * Universal, cross-agent/cross-CLI memory. Agents `remember` and `recall`; the
 * daemon also injects recalls at SessionStart and into worker turns. The record
 * itself ALWAYS lives in our SQLite (keyword/FTS is the source of truth); when
 * NERVEPLANE_MEMORY is `semantic`/`hybrid`, writes are additionally indexed into
 * the mem0 sidecar. So switching engines never migrates or loses data, and recall
 * gracefully falls back to keyword if the sidecar is unavailable.
 */
function recallBackend(): MemoryBackend {
  if (MEMORY_MODE === "semantic") return mem0Backend;
  if (MEMORY_MODE === "hybrid") return hybridBackend;
  return keywordBackend;
}

export interface RememberInput {
  authorAgentId?: string;
  kind?: MemoryKind;
  title?: string;
  body: string;
  repoId?: string;
  taskId?: string;
  branch?: string;
  serviceId?: string;
  file?: string;
  tags?: string[];
  pinned?: boolean;
  supersedes?: string;
  expiresAt?: string;
}

export async function remember(input: RememberInput): Promise<MemoryRecord> {
  const body = (input.body ?? "").trim();
  if (!body) throw new Error("memory 'body' is required");
  const now = nowIso();
  const rec: MemoryRecord = {
    id: newId("mem"),
    authorAgentId: input.authorAgentId,
    kind: input.kind ?? "note",
    title: input.title?.trim() || undefined,
    body,
    repoId: input.repoId,
    taskId: input.taskId,
    branch: input.branch,
    serviceId: input.serviceId,
    file: input.file,
    tags: input.tags,
    pinned: input.pinned ?? false,
    supersedes: input.supersedes,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
  };
  await keywordBackend.write(rec); // always: SQLite record + FTS (source of truth)
  if (MEMORY_MODE !== "keyword") {
    try {
      await mem0Backend.write(rec); // additionally index for semantic/hybrid (best-effort)
    } catch {
      /* indexing is best-effort; the record is already durable in SQLite */
    }
  }
  return rec;
}

export function recall(query: string | undefined, scope: MemoryScope = {}, opts?: RecallOptions): Promise<MemoryHit[]> {
  return recallBackend().recall(query, scope, opts);
}

/** Scoped list (no query) — newest + pinned first. Always keyword (no vector query). */
export function listMemories(scope: MemoryScope = {}, opts?: RecallOptions): Promise<MemoryHit[]> {
  return keywordBackend.recall(undefined, scope, opts);
}

export async function forget(id: string): Promise<boolean> {
  const res = getRawSqlite().query("DELETE FROM memories WHERE id = ?").run(id);
  if (MEMORY_MODE !== "keyword") {
    try {
      await mem0Forget(id);
    } catch {
      /* best-effort */
    }
  }
  return res.changes > 0;
}
