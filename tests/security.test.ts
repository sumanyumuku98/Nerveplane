import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { recordDecision } from "../src/core/decisions.ts";
import { scanSecrets, hasHigh } from "../src/security/scan.ts";
import { isOwnerToken } from "../src/security/owner.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-sec-")), "test.db"));
runMigrations();

// --- owner token ---
const prev = process.env.NERVEPLANE_OWNER_TOKEN;
beforeEach(() => {
  process.env.NERVEPLANE_OWNER_TOKEN = "s3cret-owner-token";
});
afterEach(() => {
  if (prev === undefined) delete process.env.NERVEPLANE_OWNER_TOKEN;
  else process.env.NERVEPLANE_OWNER_TOKEN = prev;
});

test("isOwnerToken matches the configured secret (constant-time), rejects others", () => {
  expect(isOwnerToken("s3cret-owner-token")).toBe(true);
  expect(isOwnerToken("wrong")).toBe(false);
  expect(isOwnerToken("")).toBe(false);
  expect(isOwnerToken(undefined)).toBe(false);
});

// --- secret scanning ---
test("scanSecrets flags common credential patterns", () => {
  expect(hasHigh(scanSecrets("token ghp_" + "a".repeat(36)))).toBe(true);
  expect(hasHigh(scanSecrets("AKIA" + "ABCDEFGHIJ123456"))).toBe(true);
  expect(hasHigh(scanSecrets("-----BEGIN OPENSSH PRIVATE KEY-----"))).toBe(true);
  expect(hasHigh(scanSecrets("key sk-ant-" + "x".repeat(24)))).toBe(true);
  expect(hasHigh(scanSecrets("npm_" + "y".repeat(36)))).toBe(true);
  // a JWT-ish string is flagged (medium) but present
  expect(scanSecrets("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij").length).toBeGreaterThan(0);
});

test("scanSecrets passes benign coordination text", () => {
  expect(scanSecrets("Heads up: I changed the /invoices response shape, please update the consumer.")).toEqual([]);
  expect(scanSecrets("")).toEqual([]);
  expect(scanSecrets(null)).toEqual([]);
});

// --- owner-verified decisions ---
test("recordDecision persists owner_verified (default false)", () => {
  const plain = recordDecision({ title: "agent note" });
  expect(plain.ownerVerified).toBe(false);
  const verified = recordDecision({ title: "owner authorizes writeup", ownerVerified: true });
  expect(verified.ownerVerified).toBe(true);
});
