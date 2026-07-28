import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { NERVEPLANE_HOME } from "../config.ts";
import { resolveEmbedder, resolveEmbedderModel, resolveOllamaUrl } from "../config-store.ts";

/**
 * Supervises the mem0 **Node** sidecar (the daemon runs on Bun, which can't load
 * mem0's native better-sqlite3). Lazily spawns `node sidecar/mem0-sidecar.mjs`,
 * discovers its port via ~/.nerveplane/sidecar.lock, health-checks it, and
 * proxies /add /search /delete over 127.0.0.1. If Node/embedder/mem0 is missing
 * or it won't come up, every call returns null so callers fall back to keyword —
 * recall must never break.
 */
const SIDECAR_SCRIPT = fileURLToPath(new URL("../../sidecar/mem0-sidecar.mjs", import.meta.url));
const LOCK = join(NERVEPLANE_HOME, "sidecar.lock");

let port: number | null = null;
let child: ChildProcess | null = null;
let starting: Promise<number | null> | null = null;
const warned = new Set<string>();
const warnOnce = (msg: string) => {
  if (!warned.has(msg)) {
    warned.add(msg);
    console.warn(`nerveplane memory: ${msg}`);
  }
};

async function ping(p: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function lockPort(): number | null {
  try {
    return existsSync(LOCK) ? ((JSON.parse(readFileSync(LOCK, "utf8")) as { port?: number }).port ?? null) : null;
  } catch {
    return null;
  }
}

/** Ensure the sidecar is up; return its port, or null (→ caller falls back to keyword). */
export async function ensureSidecar(): Promise<number | null> {
  if (port && (await ping(port))) return port;
  const existing = lockPort(); // a sidecar from a prior run may still be alive
  if (existing && (await ping(existing))) {
    port = existing;
    return port;
  }
  if (starting) return starting;
  starting = (async () => {
    const node = Bun.which("node");
    if (!node) return warnOnce("Node not found on PATH — semantic memory needs Node; using keyword."), null;
    if (resolveEmbedder() === "none") return warnOnce("no embedder set — run `nerveplane memory setup`; using keyword."), null;
    if (!existsSync(SIDECAR_SCRIPT)) return warnOnce("mem0 sidecar script missing; using keyword."), null;
    try {
      // Propagate the RESOLVED embedder config (env › config.json) into the
      // sidecar's environment — the choice made via `nerveplane memory setup`
      // lives in config.json, which the standalone sidecar can't read itself.
      const model = resolveEmbedderModel();
      child = spawn(node, [SIDECAR_SCRIPT], {
        env: {
          ...process.env,
          NP_SIDECAR_PORT: "0",
          NERVEPLANE_HOME,
          NERVEPLANE_EMBEDDER: resolveEmbedder(),
          NERVEPLANE_OLLAMA_URL: resolveOllamaUrl(),
          ...(model ? { NERVEPLANE_EMBEDDER_MODEL: model } : {}),
        },
        stdio: "ignore",
      });
      child.on("exit", () => {
        port = null;
        child = null;
      });
    } catch {
      return warnOnce("could not spawn mem0 sidecar; using keyword."), null;
    }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await Bun.sleep(200);
      const p = lockPort();
      if (p && (await ping(p))) {
        port = p;
        return port;
      }
    }
    return warnOnce("mem0 sidecar did not become healthy in time; using keyword."), null;
  })();
  const result = await starting;
  starting = null;
  return result;
}

/** POST to the sidecar; null on any failure (caller falls back). */
export async function sidecarFetch<T = unknown>(path: string, body: unknown): Promise<T | null> {
  const p = await ensureSidecar();
  if (!p) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${p}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function stopSidecar(): void {
  try {
    child?.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  child = null;
  port = null;
}
