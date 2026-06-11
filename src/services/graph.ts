import { parse as parseYaml } from "yaml";

/**
 * Service graph (spec §16.1). Maps services → repo + provided/consumed
 * contracts, and derives who consumes whom so a provider-side contract change
 * can be routed to consumer-side agents across repos (the M3 wedge).
 */

export type ContractType = "openapi" | "graphql" | "protobuf" | "asyncapi" | "json_schema" | "event";

export interface ProvidedContract {
  type: ContractType;
  name: string; // contract name (event name, or derived from the spec path)
  path?: string; // in-repo spec file path (for file-backed contracts)
}

export interface ServiceNode {
  name: string;
  repo: string | null; // git remote URL
  provides: ProvidedContract[];
  consumes: { service?: string; api?: string; event?: string }[];
  consumedBy: string[]; // explicit reverse edges from `consumed_by`
  ownsTestsFor: string[];
}

export type ConsumerKind = "direct" | "indirect" | "test_owner";
export interface ResolvedConsumer {
  service: string;
  repo: string | null;
  kind: ConsumerKind;
  reason: string;
}

export class ServiceGraph {
  constructor(readonly services: Map<string, ServiceNode>) {}

  byName(name: string): ServiceNode | undefined {
    return this.services.get(name);
  }

  /** Service whose repo remote matches `remoteUrl` (normalized). */
  byRepoRemote(remoteUrl: string | null): ServiceNode | undefined {
    if (!remoteUrl) return undefined;
    const want = normalizeRemote(remoteUrl);
    for (const s of this.services.values()) {
      if (s.repo && normalizeRemote(s.repo) === want) return s;
    }
    return undefined;
  }

  /** Direct consumers of a service (union of their `consumes` and the provider's `consumed_by`). */
  private directConsumers(serviceName: string): Set<string> {
    const out = new Set<string>();
    const provider = this.services.get(serviceName);
    for (const c of provider?.consumedBy ?? []) out.add(c);
    for (const s of this.services.values()) {
      if (s.consumes.some((c) => c.service === serviceName)) out.add(s.name);
    }
    out.delete(serviceName);
    return out;
  }

  /**
   * All services affected by a change to `providerService`: direct consumers,
   * transitive (indirect) consumers, and integration-test owners — each tagged
   * with the reason it was selected (spec §16.4).
   */
  resolveConsumers(providerService: string): ResolvedConsumer[] {
    const result = new Map<string, ResolvedConsumer>();
    const direct = this.directConsumers(providerService);

    for (const name of direct) {
      result.set(name, { service: name, repo: this.repoOf(name), kind: "direct", reason: `directly consumes ${providerService}` });
    }

    // BFS for transitive consumers.
    const queue = [...direct];
    const visited = new Set<string>([providerService, ...direct]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of this.directConsumers(cur)) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
        if (!result.has(next)) {
          result.set(next, { service: next, repo: this.repoOf(next), kind: "indirect", reason: `transitively consumes ${providerService} via ${cur}` });
        }
      }
    }

    // Integration-test owners for the provider or any affected consumer.
    const affected = new Set<string>([providerService, ...result.keys()]);
    for (const s of this.services.values()) {
      const owns = s.ownsTestsFor.filter((t) => affected.has(t));
      if (owns.length && !result.has(s.name)) {
        result.set(s.name, { service: s.name, repo: this.repoOf(s.name), kind: "test_owner", reason: `owns integration tests for ${owns.join(", ")}` });
      }
    }

    return [...result.values()];
  }

  private repoOf(name: string): string | null {
    return this.services.get(name)?.repo ?? null;
  }
}

/** Normalize a git remote so ssh/https forms of the same repo compare equal. */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .toLowerCase();
}

function contractNameFromPath(path: string): string {
  return path.split("/").pop()!.replace(/\.(ya?ml|json|graphql|gql|proto)$/i, "");
}

/** Parse a services.yaml (spec §16.1) into a ServiceGraph. */
export function parseServiceGraph(yamlText: string): ServiceGraph {
  const doc = (parseYaml(yamlText) ?? {}) as { services?: Record<string, RawService> };
  const services = new Map<string, ServiceNode>();

  for (const [name, raw] of Object.entries(doc.services ?? {})) {
    const provides: ProvidedContract[] = [];
    for (const p of raw.provides ?? []) {
      if (p.openapi) provides.push({ type: "openapi", name: contractNameFromPath(p.openapi), path: p.openapi });
      else if (p.graphql) provides.push({ type: "graphql", name: contractNameFromPath(p.graphql), path: p.graphql });
      else if (p.protobuf) provides.push({ type: "protobuf", name: contractNameFromPath(p.protobuf), path: p.protobuf });
      else if (p.asyncapi) provides.push({ type: "asyncapi", name: contractNameFromPath(p.asyncapi), path: p.asyncapi });
      else if (p.event) provides.push({ type: "event", name: p.event });
    }
    services.set(name, {
      name,
      repo: raw.repo ?? null,
      provides,
      consumes: (raw.consumes ?? []).map((c) => ({ service: c.service, api: c.api, event: c.event })),
      consumedBy: raw.consumed_by ?? [],
      ownsTestsFor: raw.owns_integration_tests_for ?? [],
    });
  }
  return new ServiceGraph(services);
}

interface RawService {
  repo?: string;
  provides?: { openapi?: string; graphql?: string; protobuf?: string; asyncapi?: string; event?: string }[];
  consumes?: { service?: string; api?: string; event?: string }[];
  consumed_by?: string[];
  owns_integration_tests_for?: string[];
}
