import { getRawSqlite } from "../storage/db.ts";
import { newId, nowIso } from "./util.ts";
import { MEMORY_MODE } from "../config.ts";
import { keywordBackend, semanticBackend } from "../memory/backend.ts";
import type { MemoryBackend, MemoryHit, MemoryKind, MemoryRecord, MemoryScope, RecallOptions } from "../memory/backend.ts";

export type { MemoryHit, MemoryKind, MemoryRecord, MemoryScope } from "../memory/backend.ts";

/**
 * Universal, cross-agent/cross-CLI memory. Agents write with `remember` and read
 * with `recall`; the daemon also injects recalled memories at SessionStart and
 * into worker turns. Retrieval engine is chosen by NERVEPLANE_MEMORY (keyword
 * default; hybrid/semantic is a later pass). Records are owned in our SQLite, so
 * switching engines never migrates data.
 */
function backend(): MemoryBackend {
  return MEMORY_MODE === "hybrid" ? semanticBackend : keywordBackend;
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

export function remember(input: RememberInput): MemoryRecord {
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
  backend().write(rec);
  return rec;
}

export function recall(query: string | undefined, scope: MemoryScope = {}, opts?: RecallOptions): MemoryHit[] {
  return backend().recall(query, scope, opts);
}

/** Scoped list (no query) — newest + pinned first. */
export function listMemories(scope: MemoryScope = {}, opts?: RecallOptions): MemoryHit[] {
  return backend().recall(undefined, scope, opts);
}

export function forget(id: string): boolean {
  const res = getRawSqlite().query("DELETE FROM memories WHERE id = ?").run(id);
  return res.changes > 0;
}
