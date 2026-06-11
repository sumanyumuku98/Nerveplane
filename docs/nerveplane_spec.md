# Nerveplane Product & Technical Specification

**Version:** 0.1 Draft  
**Date:** June 2, 2026  
**Working name:** Nerveplane  
**Category:** Repo-aware and service-aware A2A coordination plane for autonomous coding agents

---

## 1. Executive Summary

Nerveplane is a local-first coordination plane for autonomous coding agents working across repositories, branches, Git worktrees, services, and microservice contracts.

Most current agent collaboration tools provide one of three things: a mailbox, a worktree orchestrator, or a general agent-to-agent protocol surface. Nerveplane combines those primitives with repository and service intelligence. It lets independent CLI agents discover each other, exchange structured A2A-style task state, route updates to the agents who are actually affected, and detect semantic drift before merge or deployment time.

**Core thesis:** As developers run multiple coding agents in parallel, the bottleneck shifts from code generation to coordination. Nerveplane provides the missing coordination layer.

**One-liner:** Nerveplane is the coordination plane that keeps autonomous coding agents aligned across repos, branches, services, contracts, tasks, and decisions.

---

## 2. Problem Statement

Git worktrees and separate branches prevent agents from overwriting the same local files, but they do not prevent logical drift.

In real engineering systems, agents can conflict without touching the same file or repository:

- A backend agent changes an API response while a frontend agent builds against the old shape.
- A service agent changes an event schema while another agent updates a subscriber in a separate repo.
- A test agent updates expectations before the implementation contract is stable.
- A new agent joins late and lacks the current project state, blockers, and decisions.
- Agents broadcast irrelevant updates, creating noisy inboxes.
- Important architecture decisions are buried in chat threads.
- Microservice dependency changes are invisible to agents working in consumer repos.

The current state is too manual:

- Humans coordinate agents through chat or terminal panes.
- Agents use generic inbox/outbox messages.
- Orchestrators launch parallel agents but do not deeply understand service contracts.
- Protocols like A2A enable inter-agent communication, but do not provide repo/service-specific coordination intelligence by themselves.

Nerveplane addresses this gap.

---

## 3. Product Positioning

### 3.1 Category

Coordination runtime for autonomous coding agents.

### 3.2 Technical Positioning

A2A-style coordination core with MCP-compatible local integration and optional real A2A endpoint.

### 3.3 Primary Wedge

Repo-aware and service-aware routing for autonomous coding agents.

### 3.4 Differentiated Claim

Nerveplane does not just let agents send messages. It determines when coordination is needed, who should be notified, what artifacts matter, and what action is required.

### 3.5 Suggested Taglines

- The coordination plane for autonomous coding agents.
- Keep parallel coding agents aligned before merge time.
- A nervous system for agentic software development.
- A2A coordination grounded in repos, services, contracts, tasks, and decisions.
- Route the right signals to the right agents.

---

## 4. Target Users and Buyers

### 4.1 Primary Users

- Engineers running multiple CLI coding agents in parallel.
- AI-native engineering teams.
- Developers using Git worktrees for agent isolation.
- Platform teams building internal agent infrastructure.
- Teams using Claude Code, Codex CLI, Gemini CLI, Cursor, custom agents, or MCP-compatible tools.

### 4.2 Buyers or Sponsors

- Developer productivity teams.
- AI platform teams.
- Engineering infrastructure teams.
- Microservices platform teams.
- Code review automation teams.
- Enterprise AI governance teams.

### 4.3 Early Adopter Profile

A likely early adopter is a developer or team that already runs multiple coding agents in parallel and experiences merge drift, duplicated work, stale contracts, and manual coordination overhead.

---

## 5. Core Product Principles

1. **Local-first by default.** It should run on a developer laptop without a cloud dependency.
2. **Agent-agnostic.** Any CLI agent should be able to participate through MCP, CLI, HTTP, or A2A.
3. **A2A-native internally.** The internal model should use agents, capabilities, tasks, artifacts, status, handoffs, and results.
4. **MCP-compatible externally.** MCP should be the first integration surface because current CLI agents can consume MCP tools today.
5. **Repo-aware.** Nerveplane should understand Git state, worktrees, branches, diffs, files, packages, and tests.
6. **Service-aware.** In microservice architectures, Nerveplane should understand services, contracts, event schemas, and consumers.
7. **Structured over prose.** Use typed coordination events instead of only generic chat messages.
8. **Relevant by default.** Route only actionable updates to affected agents.
9. **Auditable.** Every coordination decision should be explainable with artifacts and routing reasons.
10. **Extensible.** Start with simple rules, then support plugins for OpenAPI, GraphQL, protobuf, Backstage, CI, and observability.

---

## 6. Competitive Landscape and Market Study Notes

### 6.1 Existing Adjacent Categories

#### Mailbox and Agent Message Bus Tools

Examples include MCP Agent Mail and agent mailbox/message-bus projects. These typically provide identities, inbox/outbox, searchable message history, and sometimes file reservation leases. They are useful, but they are usually mailbox-first rather than repo/service-aware coordination systems.

#### Worktree Orchestrators

Examples include tools that launch and monitor multiple agents in Git worktrees. These help with parallel execution, but they often do not provide deep A2A-style peer coordination or semantic dependency routing.

#### Multi-Repo Code Intelligence Tools

Examples include code intelligence systems that help AI assistants understand multiple repositories. These can provide semantic search and context retrieval across repos, but they are not necessarily inter-agent coordination planes.

#### A2A Protocol Implementations and Bridges

A2A provides agent-to-agent interoperability primitives such as discovery, capabilities, tasks, artifacts, and communication. A2A is a foundation, but it does not automatically understand repo graphs, service graphs, API breakage, or affected coding agents.

#### Service Catalog and Contract Testing Tools

Examples include Backstage, Pact, OpenAPI diff tools, GraphQL diff tools, and protobuf compatibility checkers. They understand services and contracts, but they are not designed as coordination layers for autonomous coding agents.

### 6.2 Uniqueness Hypothesis

Nerveplane is likely differentiated if it delivers this combined package:

- Agent registration and dynamic peer discovery.
- New-agent join packets.
- MCP-compatible integration.
- A2A-style task and artifact model.
- Typed coordination events.
- Repo-aware routing.
- Service-aware routing.
- Contract-aware routing across microservice repos.
- Semantic conflict detection.
- Artifact-grounded communication.
- Decision ledger.
- Human observability dashboard.

The market study should test whether any public project supports this full combination, not whether it supports individual pieces.

---

## 7. Key Use Cases

### 7.1 Parallel Agents in Git Worktrees

Agents work in separate branches or worktrees:

- Backend agent implements an API.
- Frontend agent consumes the API.
- Test agent updates E2E tests.
- Review agent inspects branch readiness.

Nerveplane tracks each agent's branch, worktree, changed files, task, and status. When the backend API changes, Nerveplane routes a structured contract-change event to frontend and test agents.

### 7.2 Multi-Repo Microservices Coordination

Agents work across different repositories:

- `billing-service` agent changes invoice API.
- `checkout-service` agent consumes billing API.
- `frontend-web` agent depends on checkout flows.
- `e2e-tests` agent owns integration tests.

Nerveplane uses a service graph to route contract changes across repos.

### 7.3 Dynamic Agent Join

A new agent joins after work has started. Nerveplane gives it a join packet containing active agents, open tasks, blockers, recent decisions, relevant conflicts, contracts, and suggested next actions.

### 7.4 Contract Change Notification

An agent changes an OpenAPI, GraphQL, protobuf, AsyncAPI, or JSON schema contract. Nerveplane identifies direct and indirect consumers and notifies relevant agents with a breaking-change summary.

### 7.5 Semantic Conflict Warning

Nerveplane detects that one branch changed an API producer while another branch changed a consumer. There is no Git conflict, but the combined system may fail. Nerveplane raises a semantic conflict warning.

### 7.6 Task Handoff

An agent completes a backend task and requests frontend integration. Nerveplane routes the task handoff to an available frontend-capable agent and attaches relevant artifacts.

### 7.7 Decision Ledger Query

An agent asks: "What decisions affect my current files?" Nerveplane returns durable decisions rather than forcing the agent to read all prior messages.

---

## 8. Conceptual Model

Nerveplane combines four graphs:

1. **Agent Graph** - agents, capabilities, status, tasks, ownership, presence.
2. **Repo Graph** - repos, branches, worktrees, files, diffs, imports, tests.
3. **Service Graph** - services, contracts, providers, consumers, events, deployments.
4. **Decision Graph** - decisions, blockers, contracts, handoffs, task state, dependencies.

The routing engine uses these graphs to decide which agents should receive which updates.

---

## 9. System Architecture

```text
CLI Agents / IDE Agents / Custom Agents
    |
    | MCP tools / CLI / HTTP / A2A
    v
Nerveplane Integration Layer
    |
    v
Coordination Core
    |-- Agent Registry
    |-- Presence and Heartbeats
    |-- Task State Machine
    |-- Typed Event Log
    |-- Message Inbox
    |-- Decision Ledger
    |-- Artifact Store
    |
    v
Repo Intelligence Engine
    |-- Git Scanner
    |-- Diff Analyzer
    |-- Import Graph Builder
    |-- Test Impact Mapper
    |-- Package Boundary Detector
    |
    v
Service Intelligence Engine
    |-- Service Catalog Ingestor
    |-- Contract Parser
    |-- Contract Diff Engine
    |-- Consumer/Provider Graph
    |-- Event Schema Mapper
    |
    v
Routing and Conflict Engine
    |-- Recipient Selection
    |-- Severity Scoring
    |-- Conflict Detection
    |-- Notification Policy
    |
    v
Storage Layer
    |-- SQLite local-first
    |-- Optional Postgres
    |-- Optional Redis
    |-- Optional remote server
```

---

## 10. Integration Surfaces

### 10.1 MCP Server

Primary MVP integration surface. Agents call Nerveplane tools via MCP.

### 10.2 CLI

Human and agent usable commands for registration, status, events, messages, conflicts, and dashboard.

### 10.3 Local HTTP API

Used for dashboards, integrations, and non-MCP clients.

### 10.4 Optional A2A Endpoint

Later phase. Exposes agent cards, tasks, artifacts, status, and result exchange through a real A2A-compatible interface.

### 10.5 WebSocket or SSE Stream

Optional event stream for live dashboards and agent watch loops.

---

## 11. Core Entities

### 11.1 Agent

Represents a participating autonomous coding agent.

Fields:

- `id`
- `name`
- `display_name`
- `capabilities`
- `status`
- `current_task_id`
- `repo_id`
- `service_id`
- `worktree_path`
- `branch`
- `base_branch`
- `cwd`
- `last_seen_at`
- `registered_at`
- `metadata`

Statuses:

- `available`
- `in_progress`
- `blocked`
- `needs_review`
- `idle`
- `offline`
- `error`

### 11.2 Capability

Examples:

- `frontend`
- `backend`
- `typescript`
- `python`
- `postgres`
- `openapi`
- `graphql`
- `protobuf`
- `e2e-tests`
- `security-review`
- `performance`
- `docs`
- `infra`

### 11.3 Task

Fields:

- `id`
- `title`
- `description`
- `owner_agent_id`
- `requester_agent_id`
- `required_capabilities`
- `status`
- `dependencies`
- `blockers`
- `input_artifacts`
- `output_artifacts`
- `repo_scope`
- `service_scope`
- `created_at`
- `updated_at`

Statuses:

- `planned`
- `claimed`
- `in_progress`
- `blocked`
- `needs_review`
- `ready_to_merge`
- `merged`
- `abandoned`

### 11.4 Event

Structured coordination event.

Fields:

- `id`
- `type`
- `producer_agent_id`
- `severity`
- `summary`
- `body`
- `repo_scope`
- `service_scope`
- `affected_files`
- `affected_contracts`
- `artifacts`
- `required_action`
- `routing_reasons`
- `created_at`

Event types:

- `agent_joined`
- `agent_left`
- `agent_status_changed`
- `task_claimed`
- `task_blocked`
- `task_handoff_requested`
- `review_requested`
- `api_contract_changed`
- `event_schema_changed`
- `db_migration_added`
- `schema_changed`
- `test_failure_reported`
- `branch_ready`
- `decision_recorded`
- `semantic_conflict_detected`
- `merge_risk_detected`
- `deployment_risk_detected`

### 11.5 Artifact

Evidence attached to messages/events/tasks.

Artifact types:

- `branch`
- `commit`
- `diff`
- `file`
- `test_output`
- `log`
- `stack_trace`
- `pull_request`
- `openapi_schema`
- `graphql_schema`
- `protobuf_schema`
- `asyncapi_schema`
- `migration`
- `package_manifest`
- `decision`

### 11.6 Decision

Durable project truth extracted from events, human approvals, or explicit agent records.

Fields:

- `id`
- `title`
- `description`
- `scope`
- `status`
- `created_by`
- `created_at`
- `supersedes`
- `related_artifacts`

Statuses:

- `active`
- `superseded`
- `rejected`
- `draft`

### 11.7 Repo

Fields:

- `id`
- `name`
- `path`
- `remote_url`
- `default_branch`
- `metadata`

### 11.8 Service

Fields:

- `id`
- `name`
- `repo_id`
- `owners`
- `provides_contracts`
- `consumes_contracts`
- `publishes_events`
- `subscribes_events`
- `deployment_unit`
- `metadata`

### 11.9 Contract

Fields:

- `id`
- `type`
- `name`
- `service_id`
- `path`
- `version`
- `provider_service_id`
- `consumer_service_ids`
- `schema_hash`
- `last_changed_at`

Contract types:

- `openapi`
- `graphql`
- `protobuf`
- `grpc`
- `asyncapi`
- `json_schema`
- `avro`
- `thrift`

---

## 12. Data Model: Suggested SQLite Schema

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL,
  current_task_id TEXT,
  repo_id TEXT,
  service_id TEXT,
  worktree_path TEXT,
  branch TEXT,
  base_branch TEXT,
  cwd TEXT,
  metadata_json TEXT,
  registered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE capabilities (
  agent_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  PRIMARY KEY (agent_id, capability)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  owner_agent_id TEXT,
  requester_agent_id TEXT,
  status TEXT NOT NULL,
  required_capabilities_json TEXT,
  repo_scope_json TEXT,
  service_scope_json TEXT,
  dependencies_json TEXT,
  blockers_json TEXT,
  input_artifacts_json TEXT,
  output_artifacts_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  producer_agent_id TEXT,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  repo_scope_json TEXT,
  service_scope_json TEXT,
  affected_files_json TEXT,
  affected_contracts_json TEXT,
  artifacts_json TEXT,
  required_action TEXT,
  routing_reasons_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  sender_agent_id TEXT,
  recipient_agent_id TEXT,
  recipient_group TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  related_event_id TEXT,
  priority TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  scope_json TEXT,
  status TEXT NOT NULL,
  created_by TEXT,
  supersedes TEXT,
  related_artifacts_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  remote_url TEXT,
  default_branch TEXT,
  metadata_json TEXT
);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_id TEXT,
  owners_json TEXT,
  deployment_unit TEXT,
  metadata_json TEXT
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  service_id TEXT,
  path TEXT,
  version TEXT,
  provider_service_id TEXT,
  consumer_service_ids_json TEXT,
  schema_hash TEXT,
  last_changed_at TEXT
);

CREATE TABLE conflict_warnings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  agent_ids_json TEXT,
  repo_scope_json TEXT,
  service_scope_json TEXT,
  evidence_json TEXT,
  suggested_action TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 13. MCP Tool Specification

### 13.1 `register_agent`

Registers an agent and returns a join packet.

Input:

```json
{
  "name": "backend-agent",
  "capabilities": ["backend", "typescript", "openapi"],
  "repo_path": "/repo/billing-service",
  "service_name": "billing-service",
  "worktree_path": "/repo/.worktrees/billing-api",
  "branch": "feature/invoice-api-v2",
  "base_branch": "main",
  "task": "Change invoice API response"
}
```

Output:

```json
{
  "agent_id": "agent_123",
  "join_packet": {
    "active_agents": [],
    "open_tasks": [],
    "recent_decisions": [],
    "open_blockers": [],
    "relevant_conflicts": [],
    "suggested_next_actions": []
  }
}
```

### 13.2 `heartbeat`

Updates agent presence.

### 13.3 `list_agents`

Lists active agents and their status.

### 13.4 `discover_agents`

Finds agents by capability, repo scope, service scope, task, or status.

### 13.5 `set_status`

Updates agent status.

### 13.6 `send_message`

Sends direct message to an agent.

### 13.7 `read_inbox`

Reads direct and routed messages.

### 13.8 `publish_event`

Publishes a typed coordination event and triggers routing.

### 13.9 `get_relevant_updates`

Returns relevant unread updates since a timestamp or last sync marker.

### 13.10 `claim_task`

Claims or creates a task.

### 13.11 `update_task`

Updates task status, blockers, artifacts, or result.

### 13.12 `request_review`

Requests review from an agent or capability class.

### 13.13 `record_decision`

Adds a durable decision to the ledger.

### 13.14 `query_decisions`

Returns decisions relevant to an agent, file, repo, service, task, or contract.

### 13.15 `get_repo_context`

Returns Git state, changed files, branch, worktree, and recent diff summary.

### 13.16 `detect_conflicts`

Runs conflict detection for an agent, repo, branch, or service scope.

### 13.17 `get_join_packet`

Returns onboarding state for an agent.

---

## 14. CLI Specification

```bash
nerveplane init
nerveplane daemon
nerveplane register --name backend-agent --capability backend --repo . --service billing-service
nerveplane agents
nerveplane discover --capability frontend
nerveplane inbox
nerveplane send frontend-agent "Report API changed"
nerveplane event api_contract_changed --files src/api/report.ts --summary "ReportSummaryResponse changed"
nerveplane task claim "Build report UI"
nerveplane task block task_123 --reason "Waiting for API contract"
nerveplane decision add "Report API v2 uses fluencyScore"
nerveplane repo scan
nerveplane service scan
nerveplane conflicts
nerveplane join-packet
nerveplane dashboard
```

---

## 15. Repo-Aware Intelligence

### 15.1 MVP Signals

- Current branch.
- Worktree path.
- Changed files.
- Commits since merge base.
- Diff summary.
- Same-file overlap between agents.
- Same-directory overlap.
- Package boundary overlap.

### 15.2 V1 Signals

- Import graph.
- Test ownership mapping.
- API route detection.
- Generated type staleness.
- Database migration overlap.
- Package dependency drift.

### 15.3 V2 Signals

- TypeScript symbol graph.
- Python import graph.
- Test impact prediction.
- Deleted symbol usage.
- Semantic conflict scoring.
- Branch dependency graph.
- Merge readiness scoring.

---

## 16. Service-Aware Intelligence

### 16.1 Service Graph

A service graph maps services, repos, owners, contracts, events, consumers, and providers.

Example config:

```yaml
services:
  billing-service:
    repo: git@github.com:org/billing-service.git
    provides:
      - openapi: openapi/billing.yaml
      - event: InvoiceCreated
    consumed_by:
      - checkout-service
      - finance-dashboard

  checkout-service:
    repo: git@github.com:org/checkout-service.git
    consumes:
      - service: billing-service
        api: POST /invoices
      - event: PaymentAuthorized

  frontend-web:
    repo: git@github.com:org/frontend-web.git
    consumes:
      - service: checkout-service
        api: POST /checkout
```

### 16.2 Contract Types

- OpenAPI.
- GraphQL SDL.
- Protobuf/gRPC.
- AsyncAPI.
- JSON Schema.
- Avro.
- Thrift.

### 16.3 Integrations

- Backstage `catalog-info.yaml`.
- Kubernetes manifests.
- Helm charts.
- Terraform.
- Docker Compose.
- CI/CD pipelines.
- Observability service maps.
- Pact files.
- OpenAPI specs.

### 16.4 Contract-Aware Routing

When a provider contract changes, Nerveplane should identify:

- Direct consumers.
- Indirect consumers.
- Test owners.
- SDK/generated type owners.
- Agents currently working in affected repos.
- Agents with relevant capabilities.

---

## 17. Routing Algorithm

### 17.1 Routing Inputs

- Event type.
- Severity.
- Affected files.
- Affected contracts.
- Producer agent.
- Agent capabilities.
- Active branches.
- Tasks and blockers.
- Repo graph.
- Service graph.
- Explicit mentions.
- Subscriptions.

### 17.2 Routing Output

For each recipient:

```json
{
  "agent_id": "frontend-agent",
  "priority": "high",
  "reason": "Agent edits src/client/reportClient.ts, which consumes changed contract ReportSummaryResponse",
  "required_action": "Update consumer before merge"
}
```

### 17.3 Routing Rules: MVP

1. Direct recipient always receives.
2. Task owner receives task events.
3. Agents touching the same file receive high-priority warnings.
4. Agents touching the same package receive medium-priority warnings.
5. Agents subscribed to event type receive update.
6. Agents with matching capability receive review or handoff requests.

### 17.4 Routing Rules: Service-Aware V1

1. Contract provider change notifies direct consumers.
2. Breaking contract change notifies direct and indirect consumers.
3. Event schema change notifies subscribers.
4. Deployment-affecting change notifies dependent service agents.
5. Contract change notifies E2E/integration test agents.

---

## 18. Conflict Detection

### 18.1 Conflict Types

#### Git-Level

- Same-file overlap.
- Same-directory/package overlap.
- Branch divergence.

#### Repo-Semantic

- API producer/consumer mismatch.
- Deleted symbol used by another branch.
- Generated type staleness.
- Test fixture mismatch.
- Migration order conflict.
- Package version drift.

#### Service-Semantic

- Breaking OpenAPI change with active consumer agent.
- GraphQL schema breaking change.
- Protobuf field removal or incompatible type change.
- Event schema change affecting subscriber.
- Deployment order conflict.
- Shared SDK not regenerated.

### 18.2 Warning Object

```json
{
  "type": "service_contract_conflict",
  "severity": "high",
  "summary": "billing-service changed POST /invoices; checkout-service agent is editing a consumer branch",
  "evidence": {
    "provider_branch": "feature/invoice-api-v2",
    "consumer_branch": "feature/checkout-flow",
    "contract": "POST /invoices",
    "changed_fields": ["invoice_id -> id", "total -> amount_cents"]
  },
  "suggested_action": "checkout-agent should update billing client before merge"
}
```

### 18.3 Severity Levels

- `info`
- `low`
- `medium`
- `high`
- `blocking`

---

## 19. New-Agent Join Protocol

When an agent registers, Nerveplane should:

1. Create or update identity.
2. Capture capabilities, repo, service, branch, worktree, and task.
3. Scan local repo context.
4. Match against active agents and tasks.
5. Generate join packet.
6. Notify relevant agents about the new participant.
7. Subscribe the new agent to relevant events.

Join packet contents:

- Active agents.
- Open tasks.
- Current blockers.
- Recent decisions.
- Relevant branches.
- Relevant services.
- Known contracts.
- Conflict warnings.
- Suggested peers.
- Suggested next actions.

---

## 20. Decision Ledger

### 20.1 Purpose

The decision ledger stores durable truth separately from message history.

### 20.2 Example Decisions

- Report API v2 returns `fluencyScore` instead of `score`.
- Frontend should consume generated types only.
- Billing service owns invoice ID generation.
- Checkout service must remain backward-compatible until mobile app v4.3 is released.
- E2E tests are blocked until seeded fixtures are updated.

### 20.3 Decision Lifecycle

- Draft.
- Active.
- Superseded.
- Rejected.

### 20.4 Agent Queries

- What decisions affect my files?
- What decisions affect my service?
- What changed since my last sync?
- What contracts are current?
- What blockers are open?

---

## 21. Dashboard Requirements

### 21.1 MVP Dashboard Views

- Active agents.
- Agent status.
- Active tasks.
- Inbox/events timeline.
- Conflict warnings.
- Decisions.
- Repos and branches.
- Service graph summary.

### 21.2 V1 Dashboard Views

- Branch dependency graph.
- Service dependency graph.
- Contract change timeline.
- Review requests.
- Merge readiness.
- Agent join/leave history.
- Blocker board.

### 21.3 Human Actions

- Approve or reject decision.
- Assign task.
- Resolve conflict warning.
- Mark blocker resolved.
- Request review.
- Broadcast announcement.
- Override routing.

---

## 22. Security and Governance

### 22.1 MVP Security

- Local-only default.
- File permissions on SQLite database.
- No network exposure unless explicitly enabled.
- Secret scanning in messages and artifacts.
- Audit log for all events.

### 22.2 V1 Security

- Agent identity keys.
- Signed messages.
- Scoped capabilities.
- RBAC for humans and agents.
- Per-agent permissions.
- Human approval gates for high-risk events.

### 22.3 Enterprise Security

- Tamper-evident event log.
- SSO for dashboard.
- Networked server auth.
- Policy-based routing.
- Data retention controls.
- Provenance chain for delegated work.

---

## 23. Implementation Roadmap

### Phase 0: Prototype

Goal: prove agent registration, inbox/outbox, typed events, and join packets.

Features:

- SQLite database.
- Local daemon.
- MCP server.
- CLI.
- Agent registration.
- Heartbeats.
- Inbox/outbox.
- Typed events.
- Join packet.

### Phase 1: Repo-Aware MVP

Goal: attach Git context to events and route by changed files.

Features:

- Git repo detection.
- Branch/worktree detection.
- Changed file tracking.
- Diff summary.
- Same-file conflict warning.
- Same-package conflict warning.
- Artifact-grounded messages.
- Basic dashboard.

### Phase 2: Coordination Intelligence

Goal: route updates by task, capability, and repo relationships.

Features:

- Task lifecycle.
- Capability discovery.
- Review requests.
- Decision ledger.
- Subscriptions.
- Import graph.
- Test ownership mapping.

### Phase 3: Service-Aware Coordination

Goal: coordinate agents across microservice repos.

Features:

- Service graph config.
- Backstage catalog import.
- OpenAPI parser.
- GraphQL parser.
- Protobuf parser.
- Contract diffing.
- Consumer/provider routing.
- Cross-repo conflict warnings.

### Phase 4: Semantic Conflict Detection

Goal: detect conflicts that Git cannot detect.

Features:

- Deleted symbol detection.
- Generated type drift.
- DB migration ordering.
- Contract breaking-change scoring.
- Test impact prediction.
- Deployment risk warnings.

### Phase 5: A2A Endpoint and Distributed Mode

Goal: support real A2A interoperability and remote agents.

Features:

- Agent cards.
- A2A task API.
- Artifact exchange.
- Streaming status.
- Authenticated remote server.
- Signed identities.

---

## 24. Suggested Tech Stack

### Backend

- TypeScript/Node.js or Python.
- SQLite for local-first storage.
- FastAPI, Hono, Express, or similar for HTTP.
- MCP SDK for tool server.
- Optional Postgres for team/server mode.

### Git and Repo Analysis

- Native `git` CLI wrapper for MVP.
- Tree-sitter for AST parsing.
- Language-specific parsers later.
- OpenAPI diff library.
- GraphQL schema diff library.
- Protobuf descriptor/parser.

### Dashboard

- React or Svelte.
- Local HTTP API.
- WebSocket/SSE for updates.

### Packaging

- npm package for Node implementation.
- PyPI package if Python implementation.
- Homebrew formula later.
- Docker image for server mode.

---

## 25. MVP Acceptance Criteria

The MVP is successful if:

1. Multiple CLI agents can register through MCP.
2. Agents can discover each other by capability, repo, and service.
3. A newly registered agent receives a useful join packet.
4. Agents can publish typed coordination events.
5. Events can be routed to relevant agents.
6. Git branch/worktree/changed-file metadata is attached to events.
7. Same-file and same-package conflicts are detected.
8. A decision ledger can store and query durable decisions.
9. A human can inspect active agents, tasks, events, and conflicts.
10. The system runs locally with SQLite.

---

## 26. Market Study Checklist

For each competitor, answer:

1. Does it support arbitrary CLI agents?
2. Does it expose MCP tools?
3. Does it implement real A2A concepts or only messaging?
4. Does it support dynamic peer discovery?
5. Does it support new-agent join packets?
6. Does it understand Git branches and worktrees?
7. Does it attach diffs, commits, and changed files to messages?
8. Does it route updates based on repo relationships?
9. Does it support multi-repo service graphs?
10. Does it detect breaking API or event-schema changes?
11. Does it notify agents working in affected consumer repos?
12. Does it detect semantic conflicts beyond same-file edits?
13. Does it maintain a decision ledger?
14. Does it provide a dashboard?
15. Does it support local-first mode?
16. Does it include security primitives like identity, permissions, audit logs, and secret scanning?

If most tools fail questions 8-13, Nerveplane has a strong market gap.

---

## 27. Initial Repository Structure

```text
nerveplane/
  README.md
  package.json or pyproject.toml
  src/
    cli/
    daemon/
    mcp/
    http/
    a2a/
    core/
      agents/
      tasks/
      events/
      messages/
      decisions/
      artifacts/
    repo/
      git_scanner/
      diff_analyzer/
      import_graph/
      test_mapper/
    services/
      service_graph/
      contract_parsers/
      openapi/
      graphql/
      protobuf/
    routing/
    conflicts/
    storage/
    security/
  dashboard/
  docs/
    product_spec.md
    architecture.md
    mcp_tools.md
    service_graph.md
    roadmap.md
  examples/
    monorepo/
    microservices/
  tests/
```

---

## 28. Example Agent Instructions

Agents using Nerveplane should be instructed to:

1. Register at startup.
2. Read the join packet before modifying code.
3. Call `get_relevant_updates` periodically.
4. Publish typed events for important changes.
5. Record durable decisions.
6. Check conflicts before declaring work complete.
7. Request review through Nerveplane.
8. Attach artifacts to handoffs.

Example system instruction snippet:

```text
At startup, call register_agent with your role, capabilities, repo path, branch, and task. Read the returned join packet before making changes. Before changing API contracts, database schemas, generated types, or shared utilities, publish a typed event. Periodically call get_relevant_updates. Before finalizing, call detect_conflicts and record any decisions that should persist.
```

---

## 29. Example End-to-End Scenario

### Setup

- Agent A: `billing-agent`, repo `billing-service`, task `Change invoice API`.
- Agent B: `checkout-agent`, repo `checkout-service`, task `Update checkout flow`.
- Agent C: `frontend-agent`, repo `frontend-web`, task `Update checkout UI`.
- Agent D: `test-agent`, repo `e2e-tests`, task `Update integration tests`.

### Event

`billing-agent` changes `POST /invoices` response.

### Nerveplane Processing

1. Parses OpenAPI diff.
2. Detects breaking response field rename.
3. Looks up service graph.
4. Finds `checkout-service` as direct consumer.
5. Finds `frontend-web` as indirect consumer through checkout flow.
6. Finds `e2e-tests` as integration test owner.
7. Routes event to active agents in those repos.
8. Creates semantic conflict warning.
9. Adds suggested actions.

### Routed Message

```text
High-priority contract update:

billing-service changed POST /invoices.
Breaking fields:
- invoice_id -> id
- total -> amount_cents

You are receiving this because your agent is working in checkout-service, which consumes this endpoint.

Required action:
Update billing client and checkout flow before merge.
```

---

## 30. Final Product Definition

Nerveplane is a local-first, MCP-compatible, A2A-ready coordination plane for autonomous coding agents. It combines dynamic peer discovery, typed coordination events, repo-aware routing, service-aware routing, artifact-grounded messages, semantic conflict detection, new-agent join packets, and a shared decision ledger.

The key wedge is not generic inter-agent messaging.

The wedge is:

**A2A coordination grounded in repository and service dependency state.**

Nerveplane turns parallel coding agents from isolated workers into a coordinated engineering team.

---

## 31. Public Sources to Review During Market Study

- A2A Protocol official documentation: https://a2a-protocol.org/latest/
- A2A GitHub organization/repo: https://github.com/a2aproject/A2A
- MCP Agent Mail: https://github.com/Dicklesworthstone/mcp_agent_mail
- MCP Agent Mail on PyPI: https://pypi.org/project/mcp-agent-mail/
- Qodo Open Aware: https://github.com/qodo-ai/open-aware
- RepoOrch article: https://dev.to/ramcsamal/multi-repo-microservice-changes-are-a-coordination-problem-i-solved-it-with-ai-agent-teams-34mf
- Survey of MCP, ACP, A2A, ANP: https://arxiv.org/abs/2505.02279
- Agent Identity Protocol for MCP and A2A: https://arxiv.org/abs/2603.24775
