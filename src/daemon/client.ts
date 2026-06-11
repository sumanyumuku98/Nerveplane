import { spawn } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readLiveLock } from "./lock.ts";
import { HEARTBEAT_TTL_MS } from "../config.ts";

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));

function baseUrl(): string | null {
  const lock = readLiveLock();
  return lock ? `http://${lock.host}:${lock.port}` : null;
}

/** Spawn the daemon. Prefers a `nerveplane` on PATH (installed binary / npm
 *  global), else re-execs self via `bun run <entry>` (dev) or the compiled binary. */
function spawnDaemon(): void {
  const onPath = Bun.which("nerveplane");
  let command: string;
  let args: string[];
  if (onPath) {
    command = onPath;
    args = ["daemon"];
  } else {
    const isBunRuntime = /bun(\.exe)?$/.test(basename(process.execPath));
    command = process.execPath;
    args = isBunRuntime ? ["run", ENTRY, "daemon"] : ["daemon"];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/** Ensures a daemon is running and reachable, spawning one if needed. */
export async function ensureDaemon(timeoutMs = 10_000): Promise<string> {
  let url = baseUrl();
  if (url && (await ping(url))) return url;

  spawnDaemon();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(150);
    url = baseUrl();
    if (url && (await ping(url))) return url;
  }
  throw new Error("nerveplane: daemon failed to start within timeout");
}

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

/** Makes a request to the daemon's REST API, auto-starting the daemon. */
export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const url = await ensureDaemon();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(HEARTBEAT_TTL_MS),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export { baseUrl };
