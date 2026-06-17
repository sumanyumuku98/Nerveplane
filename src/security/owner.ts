import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { NERVEPLANE_HOME } from "../config.ts";

/**
 * Owner identity (local single-user). The human holds a secret; the daemon
 * stamps records made with it as `owner_verified`, so agents/workers can trust
 * a genuine owner directive instead of an unverifiable "owner approved" chat
 * claim. The secret lives in `NERVEPLANE_OWNER_TOKEN` or a `0600` file under
 * `~/.nerveplane/` — both the daemon (to verify) and the CLI (to present it)
 * read the same source. This is a guardrail for the coordination channel, not
 * PKI: it raises the bar without defending against a process with raw FS access.
 */
const TOKEN_PATH = join(NERVEPLANE_HOME, "owner.token");

/** The configured owner secret, or null if owner verification isn't set up. */
export function ownerToken(): string | null {
  const env = process.env.NERVEPLANE_OWNER_TOKEN;
  if (env && env.trim()) return env.trim();
  if (existsSync(TOKEN_PATH)) {
    const t = readFileSync(TOKEN_PATH, "utf8").trim();
    return t || null;
  }
  return null;
}

export function ownerEnabled(): boolean {
  return ownerToken() !== null;
}

/** Constant-time check that `candidate` matches the configured owner secret. */
export function isOwnerToken(candidate: string | undefined | null): boolean {
  const secret = ownerToken();
  if (!secret || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}

/** Create the owner token if absent; returns { token, created }. */
export function ensureOwnerToken(): { token: string; path: string; created: boolean } {
  const existing = ownerToken();
  if (existing && process.env.NERVEPLANE_OWNER_TOKEN) return { token: existing, path: "(env NERVEPLANE_OWNER_TOKEN)", created: false };
  if (existsSync(TOKEN_PATH)) return { token: readFileSync(TOKEN_PATH, "utf8").trim(), path: TOKEN_PATH, created: false };
  mkdirSync(NERVEPLANE_HOME, { recursive: true });
  const token = randomBytes(24).toString("base64url");
  writeFileSync(TOKEN_PATH, token + "\n", { mode: 0o600 });
  return { token, path: TOKEN_PATH, created: true };
}
