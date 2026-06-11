import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { api } from "../daemon/client.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * The stdio MCP server is what Claude Code / Cursor / Codex spawn. It exposes
 * the 6 consolidated tools (plan Part C.3 — minimizing per-turn schema-token
 * cost) and proxies each to the daemon's REST API, so the daemon stays the
 * single writer and always runs sensing.
 */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "nerveplane", version: pkg.version });

  server.tool(
    "register",
    "Register this agent with Nerveplane and get a join packet (active agents, open tasks, recent decisions, blockers, suggested next actions). Call this once at startup, before editing code.",
    {
      name: z.string().describe("short agent name, e.g. 'backend-agent'"),
      capabilities: z.array(z.string()).optional().describe("e.g. ['backend','typescript','openapi']"),
      repo_path: z.string().optional().describe("absolute path to the repo/worktree you are working in"),
      worktree_path: z.string().optional(),
      branch: z.string().optional(),
      base_branch: z.string().optional().describe("branch you will merge into, e.g. 'main'"),
      task: z.string().optional().describe("one-line description of what you're working on"),
    },
    async (args) => {
      const res = await api("POST", "/api/v1/register", args);
      return res.ok ? ok(res.data) : fail(`register failed (${res.status})`);
    },
  );

  server.tool(
    "sync",
    "Pull everything new for you since your last sync: routed updates from other agents (file changes, contract changes, conflicts), direct messages, and open conflict warnings. Call periodically and before finalizing work.",
    { agent_id: z.string() },
    async (args) => {
      const res = await api("POST", `/api/v1/agents/${args.agent_id}/sync`, { ack: true });
      return res.ok ? ok(res.data) : fail(`sync failed (${res.status})`);
    },
  );

  server.tool(
    "publish",
    "Publish a typed coordination event (or send a direct message). Use for things sensing can't infer: intent, API/schema changes you're making, test failures. kind='event' (default) or kind='message'.",
    {
      producer_agent_id: z.string(),
      kind: z.enum(["event", "message"]).optional(),
      type: z
        .string()
        .optional()
        .describe("event type, e.g. 'api_contract_changed','schema_changed','test_failure_reported'"),
      severity: z.enum(["info", "low", "medium", "high", "blocking"]).optional(),
      summary: z.string().optional(),
      body: z.string().optional(),
      affected_files: z.array(z.string()).optional(),
      required_action: z.string().optional(),
      recipient_agent_id: z.string().optional().describe("for kind='message'"),
      subject: z.string().optional(),
    },
    async (args) => {
      const res = await api("POST", "/api/v1/publish", args);
      return res.ok ? ok(res.data) : fail(`publish failed (${res.status})`);
    },
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
    async (args) => {
      const res = await api("POST", "/api/v1/tasks", args);
      return res.ok ? ok(res.data) : fail(`task failed (${res.status})`);
    },
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
    async (args) => {
      const res = await api("POST", "/api/v1/decisions", args);
      return res.ok ? ok(res.data) : fail(`decision failed (${res.status})`);
    },
  );

  server.tool(
    "discover",
    "Find other agents by capability, repo, or status.",
    {
      capability: z.string().optional(),
      repo_id: z.string().optional(),
      status: z.string().optional(),
    },
    async (args) => {
      const qs = new URLSearchParams(
        Object.entries(args).filter(([, v]) => v != null) as [string, string][],
      ).toString();
      const res = await api("GET", `/api/v1/agents${qs ? `?${qs}` : ""}`);
      return res.ok ? ok(res.data) : fail(`discover failed (${res.status})`);
    },
  );

  return server;
}

export async function runStdioMcp(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stay alive until the client closes stdin (otherwise the CLI returns and
  // process.exit fires before any request is handled).
  await new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
}
