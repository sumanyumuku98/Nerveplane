import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { conflictWarnings, suppressions, agentWorktreeState, type Severity } from "../storage/schema.ts";
import { activeAgentsInRepo } from "../core/registry.ts";
import { emitEvent } from "../core/events.ts";
import { packageKeyFor } from "../repo/packages.ts";
import { newId, nowIso } from "../core/util.ts";

export type ConflictKind = "same_file" | "same_package";
export type ConflictWarning = typeof conflictWarnings.$inferSelect;

interface AgentState {
  id: string;
  name: string;
  worktreePath: string;
  branch: string | null;
  changed: string[];
}

/** sorted pair so (a,b) and (b,a) share one fingerprint */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Stable dedup key. same_file is scoped to the shared files; same_package is
 *  pair-level (conservative — one medium warning per pair, not per package, so a
 *  wide refactor can't fan out a storm). */
function fingerprint(kind: ConflictKind, a: string, b: string, sharedFiles: string[]): string {
  return kind === "same_file"
    ? `${pairKey(a, b)}|same_file|${[...sharedFiles].sort().join(",")}`
    : `${pairKey(a, b)}|same_package`;
}

function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/**
 * Detect git-level conflicts between active agents in a repo and route a warning
 * to each involved pair. same-file ⇒ high, same-package ⇒ medium; same-file
 * supersedes same-package for a pair. Deduped by fingerprint (no re-warn each
 * poll), respects user dismissals (`suppressions`), and auto-resolves open
 * warnings whose overlap no longer holds. (plan M2.3, conservative posture)
 */
export function detectConflictsForRepo(repoId: string): ConflictWarning[] {
  const db = getDb();

  const agents = activeAgentsInRepo(repoId);
  const states: AgentState[] = [];
  for (const a of agents) {
    if (!a.worktreePath) continue;
    const ws = db.select().from(agentWorktreeState).where(eq(agentWorktreeState.agentId, a.id)).get();
    const changed = ws?.changedFiles ?? [];
    if (changed.length === 0) continue;
    states.push({ id: a.id, name: a.name, worktreePath: a.worktreePath, branch: a.branch, changed });
  }

  const activeFingerprints = new Set<string>();
  const created: ConflictWarning[] = [];

  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i]!;
      const b = states[j]!;

      const sharedFiles = intersect(a.changed, b.changed);
      let warning: { kind: ConflictKind; severity: Severity; summary: string; evidence: Record<string, unknown>; action: string } | null = null;

      if (sharedFiles.length > 0) {
        warning = {
          kind: "same_file",
          severity: "high",
          summary: `${a.name} and ${b.name} are both editing ${sharedFiles.length === 1 ? sharedFiles[0] : `${sharedFiles.length} shared files`}`,
          evidence: { shared_files: sharedFiles, branches: { [a.name]: a.branch, [b.name]: b.branch } },
          action: `Coordinate before editing: ${sharedFiles.slice(0, 5).join(", ")}. One owner per file.`,
        };
      } else {
        const aPkgs = new Set(a.changed.map((f) => packageKeyFor(a.worktreePath, f)));
        const bPkgs = new Set(b.changed.map((f) => packageKeyFor(b.worktreePath, f)));
        const sharedPkgs = [...aPkgs].filter((p) => bPkgs.has(p));
        if (sharedPkgs.length > 0) {
          warning = {
            kind: "same_package",
            severity: "medium",
            summary: `${a.name} and ${b.name} are both changing package ${sharedPkgs.length === 1 ? sharedPkgs[0] : `${sharedPkgs.length} shared packages`}`,
            evidence: { shared_packages: sharedPkgs.slice(0, 10), branches: { [a.name]: a.branch, [b.name]: b.branch } },
            action: `Align on package ${sharedPkgs.slice(0, 3).join(", ")} before merge.`,
          };
        }
      }

      if (!warning) continue;

      const fp = fingerprint(warning.kind, a.id, b.id, sharedFiles);
      activeFingerprints.add(fp);

      // Already warned (open) for this fingerprint, or user dismissed it → skip.
      const existingOpen = db
        .select()
        .from(conflictWarnings)
        .where(and(eq(conflictWarnings.fingerprint, fp), eq(conflictWarnings.status, "open")))
        .get();
      if (existingOpen) continue;
      const dismissed = db.select().from(suppressions).where(eq(suppressions.fingerprint, fp)).get();
      if (dismissed) continue;

      const row: ConflictWarning = {
        id: newId("cfl"),
        type: warning.kind,
        severity: warning.severity,
        summary: warning.summary,
        fingerprint: fp,
        agentIds: [a.id, b.id],
        repoScope: [repoId],
        serviceScope: null,
        evidence: warning.evidence,
        suggestedAction: warning.action,
        status: "open",
        createdAt: nowIso(),
      };
      db.insert(conflictWarnings).values(row).run();
      created.push(row);

      // Route to exactly the two involved agents (reuses explicit-recipient routing).
      emitEvent(
        {
          type: "semantic_conflict_detected",
          producerAgentId: null,
          severity: warning.severity,
          summary: warning.summary,
          repoScope: [repoId],
          affectedFiles: sharedFiles.length ? sharedFiles : undefined,
          requiredAction: warning.action,
          artifacts: [{ type: "decision", summary: warning.action, data: warning.evidence }],
        },
        { explicitRecipientIds: [a.id, b.id] },
      );
    }
  }

  // Auto-resolve open warnings in this repo whose overlap no longer holds.
  const openInRepo = db.select().from(conflictWarnings).where(eq(conflictWarnings.status, "open")).all();
  const stale = openInRepo.filter(
    (w) => (w.repoScope ?? []).includes(repoId) && w.fingerprint && !activeFingerprints.has(w.fingerprint),
  );
  if (stale.length) {
    db.update(conflictWarnings)
      .set({ status: "resolved" })
      .where(inArray(conflictWarnings.id, stale.map((w) => w.id)))
      .run();
  }

  return created;
}
