import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LOCK_PATH, NERVEPLANE_HOME, type DaemonLock } from "../config.ts";

/** True if a process with this pid is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't actually kill
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Returns the lock for a live daemon, or null if none is running (clears stale locks). */
export function readLiveLock(): DaemonLock | null {
  if (!existsSync(LOCK_PATH)) return null;
  let lock: DaemonLock;
  try {
    lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as DaemonLock;
  } catch {
    rmSync(LOCK_PATH, { force: true });
    return null;
  }
  if (!isProcessAlive(lock.pid)) {
    rmSync(LOCK_PATH, { force: true });
    return null;
  }
  return lock;
}

export function writeLock(lock: DaemonLock): void {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
}

export function clearLock(): void {
  rmSync(LOCK_PATH, { force: true });
}

export function ensureHome(): void {
  mkdirSync(NERVEPLANE_HOME, { recursive: true });
}
