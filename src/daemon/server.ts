import { buildApp } from "../http/app.ts";
import { runMigrations } from "../storage/migrate.ts";
import { startPresenceSweeper } from "../core/presence.ts";
import { startSensing } from "../repo/sensing.ts";
import { ensureHome, writeLock, clearLock, readLiveLock } from "./lock.ts";
import { ensureSidecar, stopSidecar } from "../memory/sidecar.ts";
import { startWorkerPool } from "./worker-pool.ts";
import { HOST, DEFAULT_PORT, MEMORY_MODE } from "../config.ts";
import pkg from "../../package.json" with { type: "json" };

export interface DaemonHandle {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Boots the single user-level daemon: applies migrations, binds the HTTP
 * surface, records the lockfile, and starts the presence sweeper. Refuses to
 * start a second instance if a live daemon already holds the lock.
 */
export async function startDaemon(port: number = DEFAULT_PORT): Promise<DaemonHandle> {
  ensureHome();

  const existing = readLiveLock();
  if (existing) {
    throw new Error(`nerveplane daemon already running (pid ${existing.pid}, port ${existing.port})`);
  }

  runMigrations();

  const app = buildApp();
  const server = Bun.serve({ hostname: HOST, port, fetch: app.fetch });
  const boundPort = server.port ?? port;

  writeLock({
    pid: process.pid,
    port: boundPort,
    host: HOST,
    startedAt: new Date().toISOString(),
    version: pkg.version,
  });

  const stopSweeper = startPresenceSweeper();
  const stopSensing = startSensing();
  // Supervise a headless worker per enrolled repo (auto-enroll happens in
  // registerAgent); never block boot if this throws.
  let stopWorkers = () => {};
  try {
    stopWorkers = startWorkerPool();
  } catch (err) {
    console.error("nerveplane: worker pool failed to start:", err);
  }

  // Warm the mem0 sidecar when semantic/hybrid memory is configured (lazy anyway,
  // but this surfaces config issues at boot). Fire-and-forget; failures fall back
  // to keyword and never block daemon startup.
  if (MEMORY_MODE !== "keyword") void ensureSidecar();

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    stopSweeper();
    stopSensing();
    stopWorkers();
    stopSidecar();
    await server.stop();
    clearLock();
  };

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      void stop().then(() => process.exit(0));
    });
  }

  console.log(`nerveplane daemon listening on http://${HOST}:${boundPort} (pid ${process.pid})`);
  return { server, port: boundPort, stop };
}
