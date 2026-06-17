import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

/**
 * Schema mirrors docs/nerveplane_spec.md §12, scoped to the MVP, with two
 * additions called out in the plan (Part C): `sync_markers` (per-agent read
 * cursors so `sync` returns only new routed items) and `suppressions`
 * (dedup / noise control — precision is the binding constraint, Part C.4).
 *
 * JSON-shaped fields are stored as TEXT in json mode for Postgres portability
 * (Drizzle swaps the adapter later). Timestamps are ISO-8601 strings, matching
 * the spec. We avoid AUTOINCREMENT; ids are application-generated (crypto.randomUUID).
 */

export type AgentStatus =
  | "available"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "idle"
  | "offline"
  | "error";

export type TaskStatus =
  | "planned"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "ready_to_merge"
  | "merged"
  | "abandoned";

export type Severity = "info" | "low" | "medium" | "high" | "blocking";

export type EventType =
  | "agent_joined"
  | "agent_left"
  | "agent_status_changed"
  | "task_claimed"
  | "task_blocked"
  | "task_handoff_requested"
  | "review_requested"
  | "api_contract_changed"
  | "event_schema_changed"
  | "db_migration_added"
  | "schema_changed"
  | "test_failure_reported"
  | "branch_ready"
  | "decision_recorded"
  | "semantic_conflict_detected"
  | "merge_risk_detected"
  | "deployment_risk_detected"
  // sensing-engine originated (passive observation, see plan Part C.1)
  | "files_changed";

export interface Artifact {
  type: string;
  ref?: string;
  summary?: string;
  data?: unknown;
}

export interface RoutingReason {
  rule: string;
  detail: string;
}

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    status: text("status").$type<AgentStatus>().notNull(),
    currentTaskId: text("current_task_id"),
    repoId: text("repo_id"),
    serviceId: text("service_id"),
    worktreePath: text("worktree_path"),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    cwd: text("cwd"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    // PID of the agent's stdio MCP bridge (same host as the daemon). Primary
    // liveness signal: alive ⇔ the session process is alive. Null for clients
    // that can't report one (HTTP-MCP/remote) → fall back to the heartbeat TTL.
    connectionPid: integer("connection_pid"),
    registeredAt: text("registered_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [
    // durable identity natural key (plan Part C.6): re-registration resumes the same row
    index("idx_agents_identity").on(t.name, t.worktreePath),
    index("idx_agents_status").on(t.status),
    index("idx_agents_repo").on(t.repoId),
  ],
);

export const capabilities = sqliteTable(
  "capabilities",
  {
    agentId: text("agent_id").notNull(),
    capability: text("capability").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.capability] })],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    ownerAgentId: text("owner_agent_id"),
    requesterAgentId: text("requester_agent_id"),
    status: text("status").$type<TaskStatus>().notNull(),
    requiredCapabilities: text("required_capabilities_json", { mode: "json" }).$type<string[]>(),
    repoScope: text("repo_scope_json", { mode: "json" }).$type<string[]>(),
    serviceScope: text("service_scope_json", { mode: "json" }).$type<string[]>(),
    dependencies: text("dependencies_json", { mode: "json" }).$type<string[]>(),
    blockers: text("blockers_json", { mode: "json" }).$type<string[]>(),
    inputArtifacts: text("input_artifacts_json", { mode: "json" }).$type<Artifact[]>(),
    outputArtifacts: text("output_artifacts_json", { mode: "json" }).$type<Artifact[]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_tasks_status").on(t.status), index("idx_tasks_owner").on(t.ownerAgentId)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").$type<EventType>().notNull(),
    producerAgentId: text("producer_agent_id"),
    severity: text("severity").$type<Severity>().notNull(),
    summary: text("summary").notNull(),
    body: text("body"),
    repoScope: text("repo_scope_json", { mode: "json" }).$type<string[]>(),
    serviceScope: text("service_scope_json", { mode: "json" }).$type<string[]>(),
    affectedFiles: text("affected_files_json", { mode: "json" }).$type<string[]>(),
    affectedContracts: text("affected_contracts_json", { mode: "json" }).$type<string[]>(),
    artifacts: text("artifacts_json", { mode: "json" }).$type<Artifact[]>(),
    requiredAction: text("required_action"),
    routingReasons: text("routing_reasons_json", { mode: "json" }).$type<RoutingReason[]>(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_events_created").on(t.createdAt), index("idx_events_type").on(t.type)],
);

/** Per-recipient delivery rows produced by the routing engine (the inbox). */
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    recipientAgentId: text("recipient_agent_id").notNull(),
    priority: text("priority").$type<Severity>().notNull(),
    reason: text("reason"),
    requiredAction: text("required_action"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_deliveries_recipient").on(t.recipientAgentId, t.createdAt),
    index("idx_deliveries_unread").on(t.recipientAgentId, t.readAt),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id"),
    senderAgentId: text("sender_agent_id"),
    recipientAgentId: text("recipient_agent_id"),
    recipientGroup: text("recipient_group"),
    subject: text("subject"),
    body: text("body").notNull(),
    relatedEventId: text("related_event_id"),
    priority: text("priority").$type<Severity>().notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_messages_recipient").on(t.recipientAgentId, t.createdAt),
    index("idx_messages_thread").on(t.threadId, t.createdAt),
  ],
);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  scope: text("scope_json", { mode: "json" }).$type<Record<string, unknown>>(),
  status: text("status").$type<"active" | "superseded" | "rejected" | "draft">().notNull(),
  createdBy: text("created_by"),
  supersedes: text("supersedes"),
  relatedArtifacts: text("related_artifacts_json", { mode: "json" }).$type<Artifact[]>(),
  // True when recorded through the owner channel (CLI presenting the owner token).
  // Agents/workers should trust an authorization only when this is set.
  ownerVerified: integer("owner_verified", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const repos = sqliteTable("repos", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path"),
  remoteUrl: text("remote_url"),
  defaultBranch: text("default_branch"),
  metadata: text("metadata_json", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoId: text("repo_id"),
  owners: text("owners_json", { mode: "json" }).$type<string[]>(),
  deploymentUnit: text("deployment_unit"),
  metadata: text("metadata_json", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const contracts = sqliteTable("contracts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  serviceId: text("service_id"),
  path: text("path"),
  version: text("version"),
  providerServiceId: text("provider_service_id"),
  consumerServiceIds: text("consumer_service_ids_json", { mode: "json" }).$type<string[]>(),
  schemaHash: text("schema_hash"),
  lastChangedAt: text("last_changed_at"),
});

export const conflictWarnings = sqliteTable(
  "conflict_warnings",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    summary: text("summary").notNull(),
    // stable dedup key = sorted(agentA,agentB)|kind|sorted(scope) — see plan M2.3
    fingerprint: text("fingerprint"),
    agentIds: text("agent_ids_json", { mode: "json" }).$type<string[]>(),
    repoScope: text("repo_scope_json", { mode: "json" }).$type<string[]>(),
    serviceScope: text("service_scope_json", { mode: "json" }).$type<string[]>(),
    evidence: text("evidence_json", { mode: "json" }).$type<Record<string, unknown>>(),
    suggestedAction: text("suggested_action"),
    status: text("status").$type<"open" | "resolved" | "dismissed">().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_conflicts_status").on(t.status), index("idx_conflicts_fp").on(t.fingerprint, t.status)],
);

/** Latest sensed git state per agent — the cross-agent conflict detector reads
 *  this so it can compare every active agent's changed-file set in a repo. */
export const agentWorktreeState = sqliteTable("agent_worktree_state", {
  agentId: text("agent_id").primaryKey(),
  repoId: text("repo_id"),
  changedFiles: text("changed_files_json", { mode: "json" }).$type<string[]>(),
  branch: text("branch"),
  headSha: text("head_sha"),
  updatedAt: text("updated_at").notNull(),
});

/** Plan addition: per-agent read cursor so `sync` returns only fresh items. */
export const syncMarkers = sqliteTable("sync_markers", {
  agentId: text("agent_id").primaryKey(),
  lastSyncAt: text("last_sync_at").notNull(),
});

/** Plan addition: dedup / suppression to keep routed warnings high-precision. */
export const suppressions = sqliteTable(
  "suppressions",
  {
    id: text("id").primaryKey(),
    // stable fingerprint of a (recipient, conflict-kind, scope) tuple
    fingerprint: text("fingerprint").notNull(),
    recipientAgentId: text("recipient_agent_id"),
    reason: text("reason"),
    suppressedUntil: text("suppressed_until"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_suppressions_fp").on(t.fingerprint)],
);
