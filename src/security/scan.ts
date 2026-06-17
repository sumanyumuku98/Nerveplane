import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NERVEPLANE_HOME } from "../config.ts";

/**
 * Sensitive-content scanning for the coordination channel. Messages and events
 * are persisted and visible to other agents + the dashboard, so an over-eager
 * agent pasting a credential there is a real leak. We scan outbound text for
 * high-signal secret patterns (and an optional local deny-list). In-process
 * regex — no dependencies. This guards Nerveplane's channel; it can't stop an
 * agent that reads secrets from disk and acts outside the plane.
 */

export type Severity = "high" | "medium";
export interface Finding {
  kind: string;
  severity: Severity;
}

interface Pattern {
  kind: string;
  severity: Severity;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { kind: "private-key-block", severity: "high", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { kind: "aws-access-key", severity: "high", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "github-token", severity: "high", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { kind: "npm-token", severity: "high", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: "slack-token", severity: "high", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "anthropic-key", severity: "high", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "openai-key", severity: "high", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: "google-api-key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "jwt", severity: "medium", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// Long high-entropy token heuristic (catches generic secrets not matched above).
const ENTROPY_RE = /\b[A-Za-z0-9+/_=-]{40,}\b/g;
function shannon(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

let denyCache: { mtime: number; words: string[] } | null = null;
function denyList(): string[] {
  const path = join(NERVEPLANE_HOME, "deny.txt");
  if (!existsSync(path)) return [];
  try {
    const words = readFileSync(path, "utf8")
      .split("\n")
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !w.startsWith("#"));
    return words;
  } catch {
    return [];
  }
}

/** Scan text for secrets / denied content. Empty array = clean. */
export function scanSecrets(text: string | null | undefined): Finding[] {
  if (!text) return [];
  const findings: Finding[] = [];
  for (const p of PATTERNS) if (p.re.test(text)) findings.push({ kind: p.kind, severity: p.severity });

  for (const m of text.matchAll(ENTROPY_RE)) {
    if (m[0].length >= 40 && shannon(m[0]) >= 3.5) {
      findings.push({ kind: "high-entropy-string", severity: "medium" });
      break; // one is enough to flag
    }
  }

  const lower = text.toLowerCase();
  for (const w of denyList()) {
    if (lower.includes(w)) {
      findings.push({ kind: `denied:${w}`, severity: "high" });
      break;
    }
  }
  return findings;
}

export const hasHigh = (f: Finding[]): boolean => f.some((x) => x.severity === "high");
