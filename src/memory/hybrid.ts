import type { MemoryBackend, MemoryHit } from "./backend.ts";
import { keywordBackend } from "./backend.ts";
import { mem0Backend } from "./mem0-backend.ts";

/**
 * Reciprocal-rank fusion of ranked lists, keyed by our memory id. Rank-based (not
 * score-based) so it's robust to backends with unreliable scores (e.g. mem0's
 * score bug). k=60 is the standard RRF constant.
 */
export function rrf(lists: MemoryHit[][], k = 60): MemoryHit[] {
  const score = new Map<string, number>();
  const rec = new Map<string, MemoryHit>();
  for (const list of lists) {
    list.forEach((h, i) => {
      score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + i));
      if (!rec.has(h.id)) rec.set(h.id, h);
    });
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => rec.get(id)!);
}

/** Hybrid recall: FTS5 keyword ⊕ mem0 semantic, RRF-fused, pinned boosted. */
export const hybridBackend: MemoryBackend = {
  write: mem0Backend.write, // core also writes the SQLite record via keyword; this only indexes
  async recall(query, scope, opts) {
    const [kw, sem] = await Promise.all([keywordBackend.recall(query, scope, opts), mem0Backend.recall(query, scope, opts)]);
    const fused = rrf([kw, sem]);
    // pinned boost: stable sort keeps RRF order within each pinned group
    fused.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return fused.slice(0, opts?.limit ?? 20);
  },
};
