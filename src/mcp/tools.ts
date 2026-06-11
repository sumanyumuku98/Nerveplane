import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };

/**
 * The 6 consolidated MCP tools (plan Part C.3), defined once and shared by both
 * the stdio server and the Streamable HTTP endpoint. A `ToolCtx` provides the
 * backend: REST-proxy for the spawned stdio bridge, core-direct inside the
 * daemon. Schemas/descriptions live here so the two transports never drift.
 */
export interface ToolCtx {
  register(args: Record<string, unknown>): Promise<unknown>;
  sync(args: { agent_id: string }): Promise<unknown>;
  publish(args: Record<string, unknown>): Promise<unknown>;
  task(args: Record<string, unknown>): Promise<unknown>;
  decision(args: Record<string, unknown>): Promise<unknown>;
  discover(args: Record<string, unknown>): Promise<unknown>;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
const wrap = (fn: () => Promise<unknown>) => fn().then(ok).catch((e) => fail(e instanceof Error ? e.message : String(e)));

export function buildServer(): McpServer {
  return new McpServer({ name: "nerveplane", version: pkg.version });
}

export function registerTools(server: McpServer, ctx: ToolCtx): void {
  server.tool(
    "register",
    "Register this agent with Nerveplane and get a join packet (active agents, open tasks, recent decisions, blockers, suggested next actions). Call once at startup, before editing code.",
    {
      name: z.string().describe("short agent name, e.g. 'backend-agent'"),
      capabilities: z.array(z.string()).optional().describe("e.g. ['backend','typescript','openapi']"),
      repo_path: z.string().optional().describe("absolute path to the repo/worktree you are working in"),
      worktree_path: z.string().optional(),
      branch: z.string().optional(),
      base_branch: z.string().optional().describe("branch you will merge into, e.g. 'main'"),
      task: z.string().optional().describe("one-line description of what you're working on"),
    },
    (args) => wrap(() => ctx.register(args)),
  );

  server.tool(
    "sync",
    "Pull everything new for you since your last sync: routed updates from other agents (file changes, contract changes, conflicts), direct messages, and open conflict warnings. Call periodically and before finalizing work.",
    { agent_id: z.string() },
    (args) => wrap(() => ctx.sync(args)),
  );

  server.tool(
    "publish",
    "Publish a typed coordination event (or send a direct message). Use for things sensing can't infer: intent, API/schema changes you're making, test failures. kind='event' (default) or kind='message'.",
    {
      producer_agent_id: z.string(),
      kind: z.enum(["event", "message"]).optional(),
      type: z.string().optional().describe("event type, e.g. 'api_contract_changed','schema_changed','test_failure_reported'"),
      severity: z.enum(["info", "low", "medium", "high", "blocking"]).optional(),
      summary: z.string().optional(),
      body: z.string().optional(),
      affected_files: z.array(z.string()).optional(),
      required_action: z.string().optional(),
      recipient_agent_id: z.string().optional().describe("for kind='message'"),
      subject: z.string().optional(),
    },
    (args) => wrap(() => ctx.publish(args)),
  );

  server.tool(
    "task",
    "Manage your task: action='claim' (create/claim), 'update' (status/blockers), 'handoff' (to a capability), or 'review' (request review).",
    {
      agent_id: z.string(),
      action: z.enum(["claim", "update", "handoff", "review"]),
      task_id: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z
        .enum(["planned", "claimed", "in_progress", "blocked", "needs_review", "ready_to_merge", "merged", "abandoned"])
        .optional(),
      blockers: z.array(z.string()).optional(),
      required_capabilities: z.array(z.string()).optional(),
    },
    (args) => wrap(() => ctx.task(args)),
  );

  server.tool(
    "decision",
    "Record a durable decision to the shared ledger (action='record') or query decisions relevant to a repo/file/service/task (action='query').",
    {
      action: z.enum(["record", "query"]).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      created_by: z.string().optional(),
      scope: z.record(z.unknown()).optional(),
      repo_id: z.string().optional(),
      file: z.string().optional(),
    },
    (args) => wrap(() => ctx.decision(args)),
  );

  server.tool(
    "discover",
    "Find other agents by capability, repo, or status.",
    {
      capability: z.string().optional(),
      repo_id: z.string().optional(),
      status: z.string().optional(),
    },
    (args) => wrap(() => ctx.discover(args)),
  );
}
