import { Hono } from "hono";
import type { AgentStatus, EventType, Severity } from "../storage/schema.ts";
import { registerAgent, heartbeat, setStatus, discoverAgents, getAgent, agentByWorktree } from "../core/registry.ts";
import { upsertRepoByPath, listRepos } from "../core/repos.ts";
import { emitEvent } from "../core/events.ts";
import { sendMessage, syncAgent, peek, peekMessages, broadcast } from "../core/inbox.ts";
import { sendChat, replyChat, threadMessages, listThreads, allThreads, waitForChat } from "../core/chat.ts";
import { claimTask, updateTask, handoffTask, requestReview, openTasks } from "../core/tasks.ts";
import { recordDecision, queryDecisions, recentDecisions, setDecisionStatus } from "../core/decisions.ts";
import { listConflicts, resolveConflict, dismissConflict } from "../core/conflicts.ts";
import { scanServiceGraph, listServices, listContracts, invalidateGraphCache } from "../services/contracts.ts";
import { buildJoinPacket } from "../core/join.ts";
import { recentEvents } from "../core/events.ts";

/**
 * Granular local REST API (mounted at /api/v1). It is the single in-process
 * surface that the CLI, the dashboard, and the stdio MCP proxy all call into.
 * The MCP layer's 7 consolidated tools map onto these endpoints.
 */
export function buildApi(): Hono {
  const api = new Hono();

  // --- registration & presence ---
  api.post("/register", async (c) => {
    const b = await c.req.json();
    const agent = await registerAgent({
      name: b.name,
      displayName: b.display_name ?? b.displayName,
      capabilities: b.capabilities,
      repoPath: b.repo_path ?? b.repoPath,
      serviceName: b.service_name ?? b.serviceName,
      worktreePath: b.worktree_path ?? b.worktreePath,
      branch: b.branch,
      baseBranch: b.base_branch ?? b.baseBranch,
      cwd: b.cwd,
      task: b.task,
      metadata: b.metadata,
    });
    // Optional convenience: claim an initial task if one was described.
    if (b.task) {
      try {
        claimTask({ agentId: agent.id, title: b.task, requiredCapabilities: b.capabilities });
      } catch {
        /* non-fatal */
      }
    }
    return c.json({ agent_id: agent.id, agent, join_packet: buildJoinPacket(agent.id) });
  });

  api.post("/agents/:id/heartbeat", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { status?: AgentStatus });
    const ok = heartbeat(c.req.param("id"), body.status);
    return c.json({ ok });
  });

  api.post("/agents/:id/status", async (c) => {
    const body = (await c.req.json()) as { status: AgentStatus };
    return c.json({ ok: setStatus(c.req.param("id"), body.status) });
  });

  api.get("/agents", (c) => {
    const q = c.req.query();
    const agents = discoverAgents({
      capability: q.capability,
      repoId: q.repoId,
      serviceId: q.serviceId,
      status: q.status as AgentStatus | undefined,
      includeOffline: q.includeOffline === "true",
    });
    return c.json({ agents });
  });

  api.get("/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"));
    return agent ? c.json({ agent }) : c.json({ error: "not found" }, 404);
  });

  // Resolve "which agent is this shell/worktree" for the last-mile hook.
  api.get("/agent-by-worktree", (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path required" }, 400);
    const agent = agentByWorktree(path);
    return c.json({ agent: agent ?? null });
  });

  // High-severity peek for the hook: returns unread warnings + unread direct
  // messages, acking just those (so they don't re-inject on every tool call).
  api.post("/agents/:id/peek", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { min_severity?: Severity; ack?: boolean });
    const ack = body.ack ?? true;
    const items = peek(c.req.param("id"), (body.min_severity as Severity) ?? "high", ack);
    const msgs = peekMessages(c.req.param("id"), { ack });
    return c.json({ updates: items, messages: msgs });
  });

  // --- sync (consolidated inbox pull) ---
  api.post("/agents/:id/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { ack?: boolean });
    heartbeat(c.req.param("id")); // a sync counts as presence
    return c.json(syncAgent(c.req.param("id"), { ack: body.ack ?? true }));
  });

  // --- publish (event or direct message) ---
  api.post("/publish", async (c) => {
    const b = await c.req.json();
    if (b.kind === "message") {
      const res = sendMessage({
        senderAgentId: b.producer_agent_id ?? b.producerAgentId,
        recipientAgentId: b.recipient_agent_id ?? b.recipientAgentId,
        recipientGroup: b.recipient_group ?? b.recipientGroup,
        subject: b.subject,
        body: b.body,
        priority: b.priority as Severity | undefined,
      });
      return c.json({ kind: "message", ...res });
    }
    const result = emitEvent(
      {
        type: b.type as EventType,
        producerAgentId: b.producer_agent_id ?? b.producerAgentId,
        severity: b.severity as Severity | undefined,
        summary: b.summary,
        body: b.body,
        repoScope: b.repo_scope ?? b.repoScope,
        serviceScope: b.service_scope ?? b.serviceScope,
        affectedFiles: b.affected_files ?? b.affectedFiles,
        affectedContracts: b.affected_contracts ?? b.affectedContracts,
        requiredAction: b.required_action ?? b.requiredAction,
      },
      {
        taskId: b.task_id ?? b.taskId,
        requiredCapabilities: b.required_capabilities ?? b.requiredCapabilities,
        explicitRecipientIds: b.recipient_ids ?? b.recipientIds,
      },
    );
    return c.json({ kind: "event", event_id: result.event.id, recipients: result.recipients });
  });

  // --- chat (direct agent-to-agent conversation) ---
  api.post("/chat/send", async (c) => {
    const b = await c.req.json();
    return c.json(
      sendChat({
        senderAgentId: b.agent_id ?? b.agentId ?? b.sender_agent_id ?? b.senderAgentId,
        recipientAgentId: b.to ?? b.recipient_agent_id ?? b.recipientAgentId,
        recipientGroup: b.recipient_group ?? b.recipientGroup,
        threadId: b.thread_id ?? b.threadId,
        subject: b.subject,
        body: b.body,
        priority: b.priority as Severity | undefined,
      }),
    );
  });

  api.post("/chat/reply", async (c) => {
    const b = await c.req.json();
    return c.json(
      replyChat({
        agentId: b.agent_id ?? b.agentId,
        threadId: b.thread_id ?? b.threadId,
        subject: b.subject,
        body: b.body,
        priority: b.priority as Severity | undefined,
      }),
    );
  });

  api.get("/chat/threads", (c) => {
    const agentId = c.req.query("agentId") ?? c.req.query("agent_id");
    return c.json({ threads: agentId ? listThreads(agentId) : allThreads() });
  });

  api.get("/chat/threads/:threadId", (c) => c.json({ messages: threadMessages(c.req.param("threadId")) }));

  // Long-poll: blocks (≤50s) until a new direct message arrives — real-time chat.
  api.post("/chat/wait", async (c) => {
    const b = await c.req.json().catch(() => ({}) as { agent_id?: string; thread_id?: string; timeout_ms?: number });
    const agentId = b.agent_id ?? b.agentId;
    const result = await waitForChat(agentId, { threadId: b.thread_id ?? b.threadId, timeoutMs: b.timeout_ms ?? b.timeoutMs });
    return c.json(result);
  });

  // --- tasks ---
  api.post("/tasks", async (c) => {
    const b = await c.req.json();
    const action = b.action ?? "claim";
    const agentId = b.agent_id ?? b.agentId;
    switch (action) {
      case "claim":
        return c.json({ task: claimTask({ agentId, taskId: b.task_id ?? b.taskId, title: b.title, description: b.description, requiredCapabilities: b.required_capabilities ?? b.requiredCapabilities, repoScope: b.repo_scope ?? b.repoScope }) });
      case "update":
        return c.json({ task: updateTask({ agentId, taskId: b.task_id ?? b.taskId, status: b.status, blockers: b.blockers, outputArtifacts: b.output_artifacts ?? b.outputArtifacts }) });
      case "handoff":
        return c.json({ task: handoffTask({ agentId, taskId: b.task_id ?? b.taskId, requiredCapabilities: b.required_capabilities ?? b.requiredCapabilities ?? [] }) });
      case "review":
        return c.json({ task: requestReview({ agentId, taskId: b.task_id ?? b.taskId, requiredCapabilities: b.required_capabilities ?? b.requiredCapabilities ?? [] }) });
      default:
        return c.json({ error: `unknown task action: ${action}` }, 400);
    }
  });

  api.get("/tasks", (c) => c.json({ tasks: openTasks() }));

  // --- decisions ---
  api.post("/decisions", async (c) => {
    const b = await c.req.json();
    if ((b.action ?? "record") === "query") {
      return c.json({ decisions: queryDecisions({ repoId: b.repo_id ?? b.repoId, file: b.file, serviceId: b.service_id ?? b.serviceId, taskId: b.task_id ?? b.taskId, status: b.status }) });
    }
    return c.json({
      decision: recordDecision({
        title: b.title,
        description: b.description,
        scope: b.scope,
        createdBy: b.created_by ?? b.createdBy,
        supersedes: b.supersedes,
        repoScope: b.repo_scope ?? b.repoScope,
      }),
    });
  });

  // --- repos & events ---
  api.post("/repos/register", async (c) => {
    const b = await c.req.json();
    const repo = await upsertRepoByPath(b.path);
    return c.json({ repo });
  });
  api.get("/repos", (c) => c.json({ repos: listRepos() }));
  api.get("/events", (c) => c.json({ events: recentEvents(Number(c.req.query("limit") ?? 50)) }));

  // --- conflicts ---
  api.get("/conflicts", (c) => {
    const q = c.req.query();
    return c.json({
      conflicts: listConflicts({
        status: (q.status as "open" | "resolved" | "dismissed" | undefined) ?? "open",
        repoId: q.repoId,
        agentId: q.agentId,
      }),
    });
  });
  api.post("/conflicts/:id/resolve", (c) => c.json({ ok: resolveConflict(c.req.param("id")) }));
  api.post("/conflicts/:id/dismiss", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { reason?: string });
    return c.json({ ok: dismissConflict(c.req.param("id"), body.reason) });
  });

  // --- service graph & contracts ---
  api.post("/services/scan", async (c) => {
    const b = await c.req.json();
    try {
      invalidateGraphCache();
      const counts = scanServiceGraph(b.path);
      return c.json({ ok: true, ...counts });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
  api.get("/services", (c) => c.json({ services: listServices(), contracts: listContracts() }));
  api.get("/contracts", (c) => c.json({ contracts: listContracts() }));

  // --- dashboard snapshot + human actions (spec §21) ---
  api.get("/dashboard", (c) =>
    c.json({
      agents: discoverAgents({ includeOffline: true }),
      tasks: openTasks(),
      events: recentEvents(50),
      conflicts: listConflicts({ status: "open" }),
      decisions: recentDecisions(50),
      services: listServices(),
      contracts: listContracts(),
    }),
  );

  api.post("/decisions/:id/status", async (c) => {
    const body = (await c.req.json()) as { status: "active" | "superseded" | "rejected" | "draft" };
    const decision = setDecisionStatus(c.req.param("id"), body.status);
    return decision ? c.json({ decision }) : c.json({ error: "not found" }, 404);
  });

  api.post("/announce", async (c) => {
    const b = await c.req.json();
    const sent = broadcast({ from: b.from, subject: b.subject, body: b.body, priority: b.priority });
    return c.json({ ok: true, sent });
  });

  return api;
}
