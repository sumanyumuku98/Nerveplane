import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { repos } from "../src/storage/schema.ts";
import { registerAgent } from "../src/core/registry.ts";
import { emitEvent } from "../src/core/events.ts";
import { syncAgent } from "../src/core/inbox.ts";
import { scanServiceGraph, getServiceGraph, consumerAgentsFor, invalidateGraphCache } from "../src/services/contracts.ts";
import { newId } from "../src/core/util.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-ctr-")), "test.db"));
runMigrations();

const SERVICES_YAML = `services:
  billing-service:
    repo: git@github.com:org/billing-service.git
    provides:
      - openapi: openapi/billing.yaml
    consumed_by: [checkout-service]
  checkout-service:
    repo: git@github.com:org/checkout-service.git
    consumes:
      - service: billing-service
        api: POST /invoices
  frontend-web:
    repo: git@github.com:org/frontend-web.git
    consumes:
      - service: checkout-service
        api: POST /checkout
  e2e-tests:
    repo: git@github.com:org/e2e-tests.git
    owns_integration_tests_for: [billing-service, checkout-service]
  unrelated-service:
    repo: git@github.com:org/unrelated.git
`;

function insertRepo(remote: string): string {
  const id = newId("repo");
  const path = mkdtempSync(join(tmpdir(), "np-ctr-repo-"));
  getDb().insert(repos).values({ id, name: remote, path, remoteUrl: remote, defaultBranch: "main", metadata: null }).run();
  return path;
}

test("service graph resolves direct, indirect, and test-owner consumers", () => {
  const yamlPath = join(mkdtempSync(join(tmpdir(), "np-ctr-yaml-")), "services.yaml");
  writeFileSync(yamlPath, SERVICES_YAML);
  invalidateGraphCache();
  const counts = scanServiceGraph(yamlPath);
  expect(counts.services).toBe(5);
  expect(counts.contracts).toBe(1); // only billing has a file-backed contract

  const consumers = getServiceGraph()!.resolveConsumers("billing-service");
  const byName = new Map(consumers.map((c) => [c.service, c.kind]));
  expect(byName.get("checkout-service")).toBe("direct");
  expect(byName.get("frontend-web")).toBe("indirect");
  expect(byName.get("e2e-tests")).toBe("test_owner");
  expect(byName.has("unrelated-service")).toBe(false);
});

test("a billing contract change routes to consumer-repo agents, not unrelated ones", async () => {
  // Register one agent per service repo (remote matches the graph).
  const billing = await registerAgent({ name: "billing-agent", repoPath: insertRepo("git@github.com:org/billing-service.git") });
  const checkout = await registerAgent({ name: "checkout-agent", repoPath: insertRepo("git@github.com:org/checkout-service.git") });
  const frontend = await registerAgent({ name: "frontend-agent", repoPath: insertRepo("git@github.com:org/frontend-web.git") });
  const e2e = await registerAgent({ name: "e2e-agent", repoPath: insertRepo("git@github.com:org/e2e-tests.git") });
  const unrelated = await registerAgent({ name: "unrelated-agent", repoPath: insertRepo("git@github.com:org/unrelated.git") });

  // Sanity: consumerAgentsFor maps the provider to the right agents.
  const consumerAgentIds = new Set(consumerAgentsFor("billing-service", billing.id).map((c) => c.agent.id));
  expect(consumerAgentIds).toEqual(new Set([checkout.id, frontend.id, e2e.id]));

  // Emit the contract change exactly as sensing would.
  const { recipients } = emitEvent(
    {
      type: "api_contract_changed",
      producerAgentId: billing.id,
      severity: "high",
      summary: "billing-service changed billing: 2 breaking change(s)",
      repoScope: [billing.repoId!],
      requiredAction: "Update consumers of billing-service before merge.",
    },
    { providerService: "billing-service" },
  );
  expect(recipients).toBe(3); // checkout + frontend + e2e

  for (const a of [checkout, frontend, e2e]) {
    const s = syncAgent(a.id);
    expect(s.updates.some((u) => u.type === "api_contract_changed" && u.priority === "high")).toBe(true);
  }
  // The unrelated repo's agent gets nothing.
  expect(syncAgent(unrelated.id).updates.length).toBe(0);
});
