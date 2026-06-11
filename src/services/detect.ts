import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { conflictWarnings, suppressions } from "../storage/schema.ts";
import { showFileAtRef } from "../repo/git.ts";
import { emitEvent } from "../core/events.ts";
import { newId, nowIso } from "../core/util.ts";
import { contractForChangedFile, consumerAgentsFor } from "./contracts.ts";
import { diffContract, breakingOnly, type BreakingChange } from "./diff/index.ts";

/**
 * Contract-change detection (plan M3.4). For each sensed change to a registered
 * contract spec, diff it against its merge-base baseline; if there are breaking
 * changes, emit a high-severity contract event (routed cross-repo to consumer
 * agents) and raise `service_contract_conflict` warnings for active consumers.
 *
 * Content-hash dedup per (agent, file) so we diff once per actual edit, not
 * every 5s poll.
 */

const reported = new Map<string, Map<string, string>>(); // agentId -> file -> contentHash

export function resetContractDetection(): void {
  reported.clear();
}

export async function detectContractChanges(
  agentId: string,
  worktreePath: string,
  repoId: string,
  mergeBase: string | null,
  changedFiles: string[],
): Promise<number> {
  let emitted = 0;
  let perAgent = reported.get(agentId);
  if (!perAgent) {
    perAgent = new Map();
    reported.set(agentId, perAgent);
  }

  for (const file of changedFiles) {
    const match = contractForChangedFile(repoId, file);
    if (!match) continue;

    let newText: string;
    try {
      newText = readFileSync(join(worktreePath, file), "utf8");
    } catch {
      continue;
    }
    const hash = Bun.hash(newText).toString();
    if (perAgent.get(file) === hash) continue; // unchanged since last diff
    perAgent.set(file, hash);

    if (!mergeBase) continue; // no baseline to diff against (likely a brand-new contract)
    const oldText = await showFileAtRef(worktreePath, mergeBase, match.path);
    if (oldText == null) continue; // contract didn't exist at base → not a breaking change

    const breaking = breakingOnly(await diffContract(match.type, oldText, newText));
    if (breaking.length === 0) continue;

    emitContractChange(agentId, repoId, match, breaking);
    raiseConsumerConflicts(agentId, match, breaking);
    emitted++;
  }
  return emitted;
}

function emitContractChange(
  agentId: string,
  repoId: string,
  match: { contractId: string; type: string; name: string; path: string; providerService: string },
  breaking: BreakingChange[],
): void {
  const fields = breaking.map((b) => b.detail).slice(0, 8);
  emitEvent(
    {
      type: match.type === "event" ? "event_schema_changed" : "api_contract_changed",
      producerAgentId: agentId,
      severity: "high",
      summary: `${match.providerService} changed ${match.name}: ${breaking.length} breaking change(s)`,
      body: fields.join("\n"),
      repoScope: [repoId],
      affectedContracts: [match.contractId],
      requiredAction: `Update consumers of ${match.providerService} before merge.`,
      artifacts: [
        { type: match.type === "graphql" ? "graphql_schema" : "openapi_schema", ref: match.path, data: { changed_fields: breaking } },
      ],
    },
    { providerService: match.providerService },
  );
}

function raiseConsumerConflicts(
  providerAgentId: string,
  match: { contractId: string; name: string; providerService: string },
  breaking: BreakingChange[],
): void {
  const db = getDb();
  for (const { agent, consumer } of consumerAgentsFor(match.providerService, providerAgentId)) {
    const fp = `service_contract|${match.contractId}|${agent.id}`;
    const open = db
      .select()
      .from(conflictWarnings)
      .where(and(eq(conflictWarnings.fingerprint, fp), eq(conflictWarnings.status, "open")))
      .get();
    if (open) continue;
    if (db.select().from(suppressions).where(eq(suppressions.fingerprint, fp)).get()) continue;

    db.insert(conflictWarnings)
      .values({
        id: newId("cfl"),
        type: "service_contract_conflict",
        severity: "high",
        summary: `${match.providerService} changed ${match.name}; ${agent.name} (${consumer.kind} consumer) is affected`,
        fingerprint: fp,
        agentIds: [providerAgentId, agent.id],
        repoScope: agent.repoId ? [agent.repoId] : null,
        serviceScope: [match.providerService],
        evidence: { contract: match.name, provider: match.providerService, consumer_kind: consumer.kind, changed_fields: breaking },
        suggestedAction: `Update the ${match.providerService} client/consumer before merge.`,
        status: "open",
        createdAt: nowIso(),
      })
      .run();
  }
}
