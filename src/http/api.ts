import { Hono, type Context } from "hono";
import type { AgentStatus, EventType, Severity } from "../storage/schema.ts";
import { registerAgent, heartbeat, setStatus, discoverAgents, getAgent, agentByWorktree, noteConnection } from "../core/registry.ts";
import { upsertRepoByPath, listRepos } from "../core/repos.ts";
import { emitEvent } from "../core/events.ts";
import { sendMessage, syncAgent, peek, peekMessages, broadcast, markMessagesRead } from "../core/inbox.ts";
import { sendChat, replyChat, threadMessages, listThreads, allThreads, waitForChat } from "../core/chat.ts";
import { waitForWork } from "../core/worker.ts";
import { claimTask, updateTask, handoffTask, requestReview, openTasks } from "../core/tasks.ts";
import { recordDecision, queryDecisions, recentDecisions, setDecisionStatus } from "../core/decisions.ts";
import { listConflicts, resolveConflict, dismissConflict } from "../core/conflicts.ts";
import { scanServiceGraph, listServices, listContracts, invalidateGraphCache } from "../services/contracts.ts";
import { buildJoinPacket } from "../core/join.ts";
import { recentEvents } from "../core/events.ts";
import { isOwnerToken } from "../security/owner.ts";
import { scanSecrets, hasHigh } from "../security/scan.ts";
import { SCAN_MODE } from "../config.ts";

/**
 * Granular local REST API (mounted at /api/v1). It is the single in-process
 * surface that the CLI, the dashboard, and the stdio MCP proxy all call into.
 * The MCP layer's 7 consolidated tools map onto these endpoints.
 */
export function buildApi(): Hono {
  const api = new Hono();

  // Sensitive-content guard for outbound agent text. Returns a 400 Response to
  // return early when blocked, else null (and warns on lower-severity findings).
  const scanGuard = (c: Context, text: string | undefined | null) => {
    if (SCAN_MODE === "off") return null;
    const findings = scanSecrets(text);
    if (!findings.length) return null;
    if (SCAN_MODE === "block" && hasHigh(findings)) {
      return c.json({ error: "blocked by sensitive-content scan", findings }, 400);
    }
    console.warn("nerveplane: sensitive content flagged:", findings.map((f) => f.kind).join(", "));
    return null;
  };

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
      connectionPid: b.connection_pid ?? b.connectionPid,
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
    heartbeat(c.req.param("id")); // the hook fires before every edit — proof of life (TTL fallback)
    const items = peek(c.req.param("id"), (body.min_severity as Severity) ?? "high", ack);
    const msgs = peekMessages(c.req.param("id"), { ack });
    return c.json({ updates: items, messages: msgs });
  });

  // Unread direct messages only (used by the Stop hook to autonomously reply
  // before going idle). Acks them so the same DM never re-blocks; refreshes presence.
  api.post("/agents/:id/peek-messages", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { ack?: boolean });
    heartbeat(c.req.param("id"));
    return c.json({ messages: peekMessages(c.req.param("id"), { ack: body.ack ?? true }) });
  });

  // Long-poll for actionable work (used by `nerveplane worker`): blocks until an
  // unread DM or a high-severity routed update arrives, else times out. Read-only
  // (the spawned agent turn acks via sync); info events never wake it (cost guard).
  api.post("/agents/:id/next", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { timeout_ms?: number; connection_pid?: number });
    if (body.connection_pid) noteConnection(c.req.param("id"), body.connection_pid);
    return c.json(await waitForWork(c.req.param("id"), { timeoutMs: body.timeout_ms ?? body.timeoutMs }));
  });

  // Ack specific messages by id (the worker marks the DMs it has handled so
  // `/next` won't return them again).
  api.post("/agents/:id/ack", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { message_ids?: string[] });
    return c.json({ acked: markMessagesRead(body.message_ids ?? body.messageIds ?? []) });
  });

  // --- sync (consolidated inbox pull) ---
  api.post("/agents/:id/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { ack?: boolean; connection_pid?: number });
    if (body.connection_pid) noteConnection(c.req.param("id"), body.connection_pid);
    else heartbeat(c.req.param("id")); // a sync counts as presence
    return c.json(syncAgent(c.req.param("id"), { ack: body.ack ?? true }));
  });

  // --- publish (event or direct message) ---
  api.post("/publish", async (c) => {
    const b = await c.req.json();
    const producer = b.producer_agent_id ?? b.producerAgentId;
    if (b.connection_pid && producer) noteConnection(producer, b.connection_pid);
    const blocked = scanGuard(c, [b.summary, b.body].filter(Boolean).join("\n"));
    if (blocked) return blocked;
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
    const sender = b.agent_id ?? b.agentId ?? b.sender_agent_id ?? b.senderAgentId;
    if (b.connection_pid && sender) noteConnection(sender, b.connection_pid);
    const blocked = scanGuard(c, b.body);
    if (blocked) return blocked;
    return c.json(
      sendChat({
        senderAgentId: sender,
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
    if (b.connection_pid && (b.agent_id ?? b.agentId)) noteConnection(b.agent_id ?? b.agentId, b.connection_pid);
    const blocked = scanGuard(c, b.body);
    if (blocked) return blocked;
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
    const b = await c.req.json().catch(() => ({}) as { agent_id?: string; thread_id?: string; timeout_ms?: number; connection_pid?: number });
    const agentId = b.agent_id ?? b.agentId;
    if (b.connection_pid && agentId) noteConnection(agentId, b.connection_pid);
    const result = await waitForChat(agentId, { threadId: b.thread_id ?? b.threadId, timeoutMs: b.timeout_ms ?? b.timeoutMs });
    return c.json(result);
  });

  // --- tasks ---
  api.post("/tasks", async (c) => {
    const b = await c.req.json();
    const action = b.action ?? "claim";
    const agentId = b.agent_id ?? b.agentId;
    if (b.connection_pid && agentId) noteConnection(agentId, b.connection_pid);
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
    // Owner-verified iff the request carries the owner secret (body or header) —
    // CLI `authorize` does; agents calling the MCP tool never have it.
    const ownerVerified = isOwnerToken(b.owner_token ?? c.req.header("x-nerveplane-owner-token"));
    return c.json({
      decision: recordDecision({
        title: b.title,
        description: b.description,
        scope: b.scope,
        createdBy: b.created_by ?? b.createdBy,
        supersedes: b.supersedes,
        repoScope: b.repo_scope ?? b.repoScope,
        ownerVerified,
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
