import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { services, contracts } from "../storage/schema.ts";
import { getRepo, repoByRemote } from "../core/repos.ts";
import { activeAgentsInRepo, type AgentWithCaps } from "../core/registry.ts";
import { ServiceGraph, parseServiceGraph, type ServiceNode, type ContractType, type ResolvedConsumer } from "./graph.ts";
import { nowIso } from "../core/util.ts";

let cached: ServiceGraph | null = null;

/** Parse a services.yaml and persist services + contracts; resets the cache. */
export function scanServiceGraph(yamlPath: string): { services: number; contracts: number } {
  const graph = parseServiceGraph(readFileSync(yamlPath, "utf8"));
  const db = getDb();
  const now = nowIso();

  let contractCount = 0;
  for (const node of graph.services.values()) {
    db.insert(services)
      .values({ id: node.name, name: node.name, repoId: null, owners: null, deploymentUnit: null, metadata: { node } })
      .onConflictDoUpdate({ target: services.id, set: { metadata: { node } } })
      .run();

    for (const p of node.provides) {
      if (!p.path) continue; // only file-backed contracts are diffable in M3
      const consumerNames = graph.resolveConsumers(node.name).map((c) => c.service);
      const id = `contract_${node.name}_${p.name}`;
      db.insert(contracts)
        .values({
          id,
          type: p.type,
          name: p.name,
          serviceId: node.name,
          path: p.path,
          version: null,
          providerServiceId: node.name,
          consumerServiceIds: consumerNames,
          schemaHash: null,
          lastChangedAt: now,
        })
        .onConflictDoUpdate({ target: contracts.id, set: { path: p.path, consumerServiceIds: consumerNames } })
        .run();
      contractCount++;
    }
  }

  cached = graph;
  return { services: graph.services.size, contracts: contractCount };
}

/** Build (and cache) the service graph from persisted rows. Null if none scanned. */
export function getServiceGraph(): ServiceGraph | null {
  if (cached) return cached;
  const rows = getDb().select().from(services).all();
  if (rows.length === 0) return null;
  const map = new Map<string, ServiceNode>();
  for (const r of rows) {
    const node = (r.metadata as { node?: ServiceNode } | null)?.node;
    if (node) map.set(node.name, node);
  }
  cached = new ServiceGraph(map);
  return cached;
}

export function invalidateGraphCache(): void {
  cached = null;
}

export interface MatchedContract {
  contractId: string;
  type: ContractType;
  name: string;
  path: string;
  providerService: string;
}

/**
 * Map a changed file in a repo back to a provided contract, so sensing knows an
 * edit touched a contract. Resolves the repo's service via its git remote
 * (falls back to a path match when the repo has no remote).
 */
export function contractForChangedFile(repoId: string, file: string): MatchedContract | null {
  const graph = getServiceGraph();
  if (!graph) return null;
  const repo = getRepo(repoId);
  if (!repo) return null;

  const service = graph.byRepoRemote(repo.remoteUrl);
  const candidates: ServiceNode[] = service ? [service] : repo.remoteUrl ? [] : [...graph.services.values()];

  for (const node of candidates) {
    for (const p of node.provides) {
      if (p.path && fileMatches(file, p.path)) {
        return { contractId: `contract_${node.name}_${p.name}`, type: p.type, name: p.name, path: p.path, providerService: node.name };
      }
    }
  }
  return null;
}

function fileMatches(changed: string, contractPath: string): boolean {
  return changed === contractPath || changed.endsWith("/" + contractPath) || contractPath.endsWith("/" + changed);
}

export interface ConsumerAgent {
  agent: AgentWithCaps;
  consumer: ResolvedConsumer;
}

/**
 * Active agents working in repos that consume `providerService` — the cross-repo
 * recipients of a contract change. Maps each consumer service → its git remote →
 * a registered repo → active agents there. Shared by routing (deliveries) and
 * sensing (service_contract_conflict warnings).
 */
export function consumerAgentsFor(providerService: string, excludeAgentId?: string): ConsumerAgent[] {
  const graph = getServiceGraph();
  if (!graph) return [];
  const out: ConsumerAgent[] = [];
  for (const consumer of graph.resolveConsumers(providerService)) {
    const repo = repoByRemote(consumer.repo);
    if (!repo) continue;
    for (const agent of activeAgentsInRepo(repo.id, excludeAgentId)) {
      out.push({ agent, consumer });
    }
  }
  return out;
}

export function listContracts() {
  return getDb().select().from(contracts).all();
}

export function listServices() {
  return getDb().select().from(services).all();
}

export function getContract(id: string) {
  return getDb().select().from(contracts).where(eq(contracts.id, id)).get();
}
