import { getRawSqlite } from "../storage/db.ts";

/**
 * Memory backend port (ports-and-adapters). The agent-facing `memory` tool and
 * the hook/worker recall injection only ever talk to this interface, so the
 * retrieval engine is swappable: keyword (FTS5, default, in-binary, zero-dep) now,
 * and a semantic/vector backend later behind `NERVEPLANE_MEMORY=hybrid` with no
 * rewrite — because the records live in Nerveplane's own SQLite either way.
 */

export type MemoryKind = "fact" | "episode" | "note";

export interface MemoryRecord {
  id: string;
  authorAgentId?: string;
  kind: MemoryKind;
  title?: string;
  body: string;
  repoId?: string;
  taskId?: string;
  branch?: string;
  serviceId?: string;
  file?: string;
  tags?: string[];
  pinned: boolean;
  supersedes?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

/** All-AND scope filter for recall/list (every field optional). */
export interface MemoryScope {
  repoId?: string;
  taskId?: string;
  authorAgentId?: string;
  kind?: MemoryKind;
  file?: string;
}

export interface RecallOptions {
  limit?: number;
}

export interface MemoryHit extends MemoryRecord {
  score?: number; // lower = better for BM25; undefined for plain list
}

export interface MemoryBackend {
  write(rec: MemoryRecord): Promise<void>;
  recall(query: string | undefined, scope: MemoryScope, opts?: RecallOptions): Promise<MemoryHit[]>;
}

interface Row {
  id: string;
  author_agent_id: string | null;
  kind: MemoryKind;
  title: string | null;
  body: string;
  repo_id: string | null;
  task_id: string | null;
  branch: string | null;
  service_id: string | null;
  file: string | null;
  tags_json: string | null;
  pinned: number;
  supersedes: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  score?: number;
}

function toHit(r: Row): MemoryHit {
  return {
    id: r.id,
    authorAgentId: r.author_agent_id ?? undefined,
    kind: r.kind,
    title: r.title ?? undefined,
    body: r.body,
    repoId: r.repo_id ?? undefined,
    taskId: r.task_id ?? undefined,
    branch: r.branch ?? undefined,
    serviceId: r.service_id ?? undefined,
    file: r.file ?? undefined,
    tags: r.tags_json ? (JSON.parse(r.tags_json) as string[]) : undefined,
    pinned: !!r.pinned,
    supersedes: r.supersedes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at ?? undefined,
    score: r.score,
  };
}

/** WHERE fragments + params for a scope filter, prefixed with the table alias. */
function scopeClause(scope: MemoryScope, alias: string): { sql: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  const add = (col: string, val: string | undefined) => {
    if (val != null) {
      parts.push(`${alias}.${col} = ?`);
      params.push(val);
    }
  };
  add("repo_id", scope.repoId);
  add("task_id", scope.taskId);
  add("author_agent_id", scope.authorAgentId);
  add("kind", scope.kind);
  add("file", scope.file);
  // never return expired memories
  parts.push(`(${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`);
  params.push(new Date().toISOString());
  return { sql: parts.join(" AND "), params };
}

/** Turn free text into a safe FTS5 MATCH expression: word tokens OR-ed, each
 *  quoted so nothing is interpreted as an FTS operator. Empty → no MATCH. */
export function toMatchExpr(query: string): string {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** Default backend: FTS5 keyword (BM25) over `memories_fts`, scope-filtered,
 *  pinned-boosted. Zero dependencies, ships in the compiled binary. */
/** Fetch memory records by id, returned as a Map for order-preserving resolution
 *  (used by the semantic/hybrid backends to turn ranked ids into full records). */
export function memoriesByIds(ids: string[]): Map<string, MemoryHit> {
  const map = new Map<string, MemoryHit>();
  if (ids.length === 0) return map;
  const db = getRawSqlite();
  const placeholders = ids.map(() => "?").join(",");
  const now = new Date().toISOString();
  const rows = db.query(`SELECT * FROM memories WHERE id IN (${placeholders}) AND (expires_at IS NULL OR expires_at > ?)`).all(...ids, now) as Row[];
  for (const r of rows) map.set(r.id, toHit(r));
  return map;
}

export const keywordBackend: MemoryBackend = {
  async write(rec) {
    const db = getRawSqlite();
    db.query(
      `INSERT INTO memories (id, author_agent_id, kind, title, body, repo_id, task_id, branch, service_id, file, tags_json, pinned, supersedes, created_at, updated_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      rec.id,
      rec.authorAgentId ?? null,
      rec.kind,
      rec.title ?? null,
      rec.body,
      rec.repoId ?? null,
      rec.taskId ?? null,
      rec.branch ?? null,
      rec.serviceId ?? null,
      rec.file ?? null,
      rec.tags ? JSON.stringify(rec.tags) : null,
      rec.pinned ? 1 : 0,
      rec.supersedes ?? null,
      rec.createdAt,
      rec.updatedAt,
      rec.expiresAt ?? null,
    );
    // mark a superseded memory expired so it stops surfacing
    if (rec.supersedes) {
      db.query(`UPDATE memories SET expires_at = ? WHERE id = ?`).run(rec.createdAt, rec.supersedes);
    }
  },

  async recall(query, scope, opts) {
    const db = getRawSqlite();
    const limit = Math.max(1, Math.min(opts?.limit ?? 20, 100));
    const { sql: scopeSql, params: scopeParams } = scopeClause(scope, "m");
    const match = query ? toMatchExpr(query) : "";
    if (match) {
      const rows = db
        .query(
          `SELECT m.*, bm25(memories_fts) AS score
           FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ? AND ${scopeSql}
           ORDER BY m.pinned DESC, score ASC, m.created_at DESC
           LIMIT ?`,
        )
        .all(match, ...scopeParams, limit) as Row[];
      return rows.map(toHit);
    }
    const rows = db
      .query(
        `SELECT m.* FROM memories m
         WHERE ${scopeSql}
         ORDER BY m.pinned DESC, m.created_at DESC
         LIMIT ?`,
      )
      .all(...scopeParams, limit) as Row[];
    return rows.map(toHit);
  },
};

// The semantic engine now lives in mem0-backend.ts (via the Node sidecar) and
// the fused engine in hybrid.ts; core/memory.ts selects among them by mode.
