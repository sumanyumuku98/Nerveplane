#!/usr/bin/env node
/**
 * Nerveplane mem0 sidecar — runs on **Node** (not Bun).
 *
 * Why a separate process: mem0's OSS SDK depends on the native `better-sqlite3`,
 * whose ABI doesn't load under Bun. The Bun daemon spawns this Node sidecar and
 * talks to it over 127.0.0.1 HTTP. We keep the authoritative memory records +
 * FTS in the daemon's SQLite; mem0 here is purely the vector index (we store our
 * memory id in `metadata.npId` and hand ranked ids back to the daemon).
 *
 * Config comes from env (set by the daemon's supervisor):
 *   NERVEPLANE_HOME          - dir for the lockfile + mem0's vector_store.db (cwd)
 *   NP_SIDECAR_PORT          - port to bind (0 = ephemeral; the daemon reads the lock)
 *   NERVEPLANE_EMBEDDER      - "openai" | "ollama"
 *   OPENAI_API_KEY           - for the openai embedder
 *   NERVEPLANE_OLLAMA_URL    - ollama base url (default http://127.0.0.1:11434)
 *   NERVEPLANE_EMBEDDER_MODEL- optional model override
 *
 * All writes use `infer:false` so mem0 stores our exact text (no LLM extraction),
 * which is why the LLM config is effectively unused. Local & durable: the
 * "memory" vector store persists to vector_store.db in cwd (NERVEPLANE_HOME).
 */
import http from "node:http";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = process.env.NERVEPLANE_HOME || join(homedir(), ".nerveplane");
const LOCK = join(HOME, "sidecar.lock");
const PORT = Number(process.env.NP_SIDECAR_PORT || 0);
const EMBEDDER = process.env.NERVEPLANE_EMBEDDER === "ollama" ? "ollama" : "openai";

mkdirSync(HOME, { recursive: true });
// mem0's "memory" store persists to a SQLite file (memory.db) in process.cwd(),
// so anchor cwd to NERVEPLANE_HOME to keep the index under our home dir. Verified
// live: the index survives a restart (no re-embed).
try {
  process.chdir(HOME);
} catch {
  /* non-fatal */
}

function embedderConfig() {
  if (EMBEDDER === "ollama") {
    return {
      provider: "ollama",
      config: { model: process.env.NERVEPLANE_EMBEDDER_MODEL || "nomic-embed-text", ...(process.env.NERVEPLANE_OLLAMA_URL ? { baseURL: process.env.NERVEPLANE_OLLAMA_URL } : {}) },
    };
  }
  return { provider: "openai", config: { model: process.env.NERVEPLANE_EMBEDDER_MODEL || "text-embedding-3-small", apiKey: process.env.OPENAI_API_KEY } };
}

// mem0 requires an llm in config even though infer:false never calls it; mirror
// the embedder's provider so no extra credential/service is required.
function llmConfig() {
  if (EMBEDDER === "ollama") return { provider: "ollama", config: { model: process.env.NERVEPLANE_LLM_MODEL || "llama3.2", ...(process.env.NERVEPLANE_OLLAMA_URL ? { baseURL: process.env.NERVEPLANE_OLLAMA_URL } : {}) } };
  return { provider: "openai", config: { model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY } };
}

let memory = null;
async function getMemory() {
  if (memory) return memory;
  const mod = await import("mem0ai/oss");
  const Memory = mod.Memory ?? mod.default?.Memory ?? mod.default;
  const cfg = { vectorStore: { provider: "memory", config: {} }, embedder: embedderConfig(), llm: llmConfig() };
  // Some versions expose an async factory; prefer it when present.
  memory = typeof Memory.create === "function" ? await Memory.create(cfg) : new Memory(cfg);
  return memory;
}

// add() takes camelCase top-level scope; search() takes snake_case under `filters` (mem0 3.x).
const scopeOpts = (scope = {}) => ({ userId: scope.repoId || "global", ...(scope.taskId ? { runId: scope.taskId } : {}), ...(scope.agentId ? { agentId: scope.agentId } : {}) });
const scopeFilters = (scope = {}) => ({ user_id: scope.repoId || "global", ...(scope.taskId ? { run_id: scope.taskId } : {}), ...(scope.agentId ? { agent_id: scope.agentId } : {}) });

/** Map a mem0 search response (varied shapes) → [{ npId, rank }]. Exported shape
 *  the daemon relies on; unknown/id-less results are dropped. */
export function mapSearch(res) {
  const results = Array.isArray(res) ? res : (res?.results ?? []);
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const npId = r?.metadata?.npId ?? r?.payload?.metadata?.npId;
    if (npId && !seen.has(npId)) {
      seen.add(npId); // mem0 can return the same memory multiple times — dedup, contiguous rank
      out.push({ npId, rank: out.length });
    }
  }
  return out;
}

async function handle(method, path, body) {
  if (method === "GET" && path === "/health") return { ok: true, embedder: EMBEDDER };
  const mem = await getMemory();
  if (method === "POST" && path === "/add") {
    const content = body.text;
    await mem.add([{ role: "user", content }], { ...scopeOpts(body.scope), metadata: { npId: body.npId, ...(body.scope?.kind ? { kind: body.scope.kind } : {}) }, infer: false });
    return { ok: true };
  }
  if (method === "POST" && path === "/search") {
    // mem0 3.x: scope goes under `filters`, not as top-level params.
    const res = await mem.search(body.query, { filters: scopeFilters(body.scope), limit: body.limit ?? 20 });
    return { results: mapSearch(res) };
  }
  if (method === "POST" && path === "/delete") {
    // Best-effort: our SQLite is the source of truth, so a stray vector is
    // harmless (recall drops npIds with no local record). Try a precise delete.
    try {
      const all = await mem.getAll(scopeOpts(body.scope));
      const items = Array.isArray(all) ? all : (all?.results ?? []);
      for (const it of items) {
        if (it?.metadata?.npId === body.npId && it?.id) await mem.delete(it.id);
      }
    } catch {
      /* best-effort */
    }
    return { ok: true };
  }
  return { error: "not found", _status: 404 };
}

// Only start the server when run directly (so tests can import mapSearch).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      let body = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        /* empty/invalid body */
      }
      try {
        const out = await handle(req.method, req.url?.split("?")[0] ?? "", body);
        const status = out._status ?? 200;
        delete out._status;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    const port = server.address().port;
    writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port }));
    process.stdout.write(`nerveplane mem0 sidecar listening on 127.0.0.1:${port} (embedder=${EMBEDDER})\n`);
  });

  const shutdown = () => {
    try {
      rmSync(LOCK, { force: true });
    } catch {
      /* ignore */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
