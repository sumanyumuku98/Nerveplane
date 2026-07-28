import type { MemoryBackend, MemoryHit, MemoryRecord } from "./backend.ts";
import { keywordBackend, memoriesByIds } from "./backend.ts";
import { sidecarFetch } from "./sidecar.ts";

/**
 * Semantic backend: indexes/searches via the mem0 Node sidecar. We only send the
 * text + our memory id (metadata.npId); the sidecar returns ranked npIds, which
 * we resolve back to authoritative records in our SQLite. Any sidecar failure
 * falls back to keyword so recall never breaks. Note: the SQLite record itself is
 * written by core/memory (keyword) on every remember — this backend only adds the
 * vector index, so switching modes never loses data.
 */
export const mem0Backend: MemoryBackend = {
  async write(rec: MemoryRecord) {
    await sidecarFetch("/add", {
      npId: rec.id,
      text: rec.title ? `${rec.title}\n${rec.body}` : rec.body,
      scope: { repoId: rec.repoId, taskId: rec.taskId, agentId: rec.authorAgentId, kind: rec.kind },
    });
  },

  async recall(query, scope, opts) {
    // No query → nothing for vectors to match; a scoped list is the keyword job.
    if (!query) return keywordBackend.recall(undefined, scope, opts);
    const res = await sidecarFetch<{ results: { npId: string; rank: number }[] }>("/search", { query, scope, limit: opts?.limit ?? 20 });
    if (!res) return keywordBackend.recall(query, scope, opts); // sidecar unavailable → fall back
    const ids = res.results.map((r) => r.npId);
    const byId = memoriesByIds(ids);
    return ids.map((id) => byId.get(id)).filter((h): h is MemoryHit => !!h);
  },
};

/** Best-effort remove from the mem0 index (our SQLite delete is authoritative). */
export async function mem0Forget(id: string, scope: { repoId?: string; taskId?: string } = {}): Promise<void> {
  await sidecarFetch("/delete", { npId: id, scope });
}
