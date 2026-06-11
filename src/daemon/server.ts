import { buildApp } from "../http/app.ts";
import { runMigrations } from "../storage/migrate.ts";
import { startPresenceSweeper } from "../core/presence.ts";
import { startSensing } from "../repo/sensing.ts";
import { ensureHome, writeLock, clearLock, readLiveLock } from "./lock.ts";
import { HOST, DEFAULT_PORT } from "../config.ts";
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

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    stopSweeper();
    stopSensing();
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
