import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { rrf } from "../src/memory/hybrid.ts";
import { mem0Backend } from "../src/memory/mem0-backend.ts";
import { keywordBackend } from "../src/memory/backend.ts";
import { resolveMemoryMode, resolveEmbedder } from "../src/config-store.ts";
// @ts-expect-error - the sidecar is an untyped Node .mjs; we only pull the pure mapSearch helper
import { mapSearch } from "../sidecar/mem0-sidecar.mjs";
import type { MemoryHit } from "../src/memory/backend.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-mem0-")), "test.db"));
runMigrations();

const hit = (id: string, pinned = false): MemoryHit => ({ id, kind: "note", body: id, pinned, createdAt: "2026-07-28T00:00:00Z", updatedAt: "2026-07-28T00:00:00Z" });

// --- RRF fusion (pure, deterministic) ---
test("rrf fuses ranked lists by id and rewards agreement", () => {
  const keyword = [hit("a"), hit("b"), hit("c")];
  const semantic = [hit("b"), hit("d")];
  const fused = rrf([keyword, semantic]).map((h) => h.id);
  // b appears in both (rank 1 + rank 0) → should top the fused list
  expect(fused[0]).toBe("b");
  expect(new Set(fused)).toEqual(new Set(["a", "b", "c", "d"]));
});

// --- sidecar result mapping (pure, no mem0) ---
test("sidecar mapSearch extracts npIds in rank order and drops id-less results", () => {
  const res = { results: [{ memory: "x", metadata: { npId: "mem_1" } }, { memory: "y", metadata: {} }, { memory: "z", metadata: { npId: "mem_2" } }, { memory: "x2", metadata: { npId: "mem_1" } }] };
  expect(mapSearch(res)).toEqual([
    { npId: "mem_1", rank: 0 },
    { npId: "mem_2", rank: 1 }, // id-less dropped; duplicate mem_1 deduped; ranks contiguous
  ]);
  expect(mapSearch([])).toEqual([]);
});

// --- graceful fallback: no embedder configured → mem0Backend falls back to keyword ---
test("mem0Backend.recall falls back to keyword when the sidecar is unavailable", async () => {
  // default env: no NERVEPLANE_EMBEDDER → ensureSidecar() returns null (no spawn),
  // so mem0Backend must return keyword results instead of throwing/empty.
  await keywordBackend.write({ id: "mem_fb1", kind: "fact", body: "fallback works via keyword FTS", pinned: false, repoId: "repoFB", createdAt: "2026-07-28T00:00:00Z", updatedAt: "2026-07-28T00:00:00Z" });
  const hits = await mem0Backend.recall("fallback keyword", { repoId: "repoFB" });
  expect(hits.some((h) => h.id === "mem_fb1")).toBe(true);
});

// --- config precedence: env › config.json › default ---
const savedMode = process.env.NERVEPLANE_MEMORY;
const savedEmb = process.env.NERVEPLANE_EMBEDDER;
beforeEach(() => {
  delete process.env.NERVEPLANE_MEMORY;
  delete process.env.NERVEPLANE_EMBEDDER;
});
afterEach(() => {
  if (savedMode === undefined) delete process.env.NERVEPLANE_MEMORY;
  else process.env.NERVEPLANE_MEMORY = savedMode;
  if (savedEmb === undefined) delete process.env.NERVEPLANE_EMBEDDER;
  else process.env.NERVEPLANE_EMBEDDER = savedEmb;
});

test("resolveMemoryMode: env wins, else config.json, else keyword", () => {
  expect(resolveMemoryMode({})).toBe("keyword");
  expect(resolveMemoryMode({ memory: { mode: "hybrid" } })).toBe("hybrid"); // config.json
  process.env.NERVEPLANE_MEMORY = "semantic";
  expect(resolveMemoryMode({ memory: { mode: "hybrid" } })).toBe("semantic"); // env overrides config
  process.env.NERVEPLANE_MEMORY = "bogus";
  expect(resolveMemoryMode({ memory: { mode: "hybrid" } })).toBe("hybrid"); // invalid env ignored → config
});

test("resolveEmbedder: env › config.json › none", () => {
  expect(resolveEmbedder({})).toBe("none");
  expect(resolveEmbedder({ memory: { embedder: "ollama" } })).toBe("ollama");
  process.env.NERVEPLANE_EMBEDDER = "openai";
  expect(resolveEmbedder({ memory: { embedder: "ollama" } })).toBe("openai");
});
