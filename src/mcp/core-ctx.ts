import type { ToolCtx } from "./tools.ts";
import type { AgentStatus, EventType, Severity } from "../storage/schema.ts";
import { registerAgent, heartbeat, discoverAgents } from "../core/registry.ts";
import { emitEvent } from "../core/events.ts";
import { sendMessage, syncAgent } from "../core/inbox.ts";
import { claimTask, updateTask, handoffTask, requestReview } from "../core/tasks.ts";
import { recordDecision, queryDecisions } from "../core/decisions.ts";
import { buildJoinPacket } from "../core/join.ts";

const s = (v: unknown) => v as string | undefined;

/** Tool backend used inside the daemon (Streamable HTTP /mcp): calls core
 *  directly. Mirrors the REST handlers in src/http/api.ts. */
export const coreCtx: ToolCtx = {
  async register(a) {
    const agent = await registerAgent({
      name: a.name as string,
      capabilities: a.capabilities as string[] | undefined,
      repoPath: s(a.repo_path),
      worktreePath: s(a.worktree_path),
      branch: s(a.branch),
      baseBranch: s(a.base_branch),
      task: s(a.task),
    });
    if (a.task) {
      try {
        claimTask({ agentId: agent.id, title: a.task as string, requiredCapabilities: a.capabilities as string[] | undefined });
      } catch {
        /* non-fatal */
      }
    }
    return { agent_id: agent.id, agent, join_packet: buildJoinPacket(agent.id) };
  },

  async sync(a) {
    heartbeat(a.agent_id);
    return syncAgent(a.agent_id, { ack: true });
  },

  async publish(a) {
    if (a.kind === "message") {
      return { kind: "message", ...sendMessage({ senderAgentId: s(a.producer_agent_id), recipientAgentId: s(a.recipient_agent_id), subject: s(a.subject), body: a.body as string, priority: a.severity as Severity | undefined }) };
    }
    const r = emitEvent(
      {
        type: a.type as EventType,
        producerAgentId: s(a.producer_agent_id),
        severity: a.severity as Severity | undefined,
        summary: a.summary as string,
        body: s(a.body),
        affectedFiles: a.affected_files as string[] | undefined,
        requiredAction: s(a.required_action),
      },
      {},
    );
    return { kind: "event", event_id: r.event.id, recipients: r.recipients };
  },

  async task(a) {
    const agentId = a.agent_id as string;
    const taskId = s(a.task_id);
    switch (a.action) {
      case "update":
        return { task: updateTask({ agentId, taskId: taskId!, status: a.status as never, blockers: a.blockers as string[] | undefined }) };
      case "handoff":
        return { task: handoffTask({ agentId, taskId: taskId!, requiredCapabilities: (a.required_capabilities as string[]) ?? [] }) };
      case "review":
        return { task: requestReview({ agentId, taskId: taskId!, requiredCapabilities: (a.required_capabilities as string[]) ?? [] }) };
      default:
        return { task: claimTask({ agentId, taskId, title: s(a.title), description: s(a.description), requiredCapabilities: a.required_capabilities as string[] | undefined }) };
    }
  },

  async decision(a) {
    if (a.action === "query") {
      return { decisions: queryDecisions({ repoId: s(a.repo_id), file: s(a.file) }) };
    }
    return { decision: recordDecision({ title: a.title as string, description: s(a.description), scope: a.scope as Record<string, unknown> | undefined, createdBy: s(a.created_by) }) };
  },

  async discover(a) {
    return { agents: discoverAgents({ capability: s(a.capability), repoId: s(a.repo_id), status: s(a.status) as AgentStatus | undefined }) };
  },
};
