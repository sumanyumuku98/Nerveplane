/** Shared primitives: ids and ISO timestamps (stored as TEXT, spec §12). */

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** ISO string for `ms` milliseconds before now — used for TTL comparisons. */
export function isoMsAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
