import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, registerTools } from "./tools.ts";
import { restCtx } from "./rest-ctx.ts";

/**
 * The stdio MCP server is what Claude Code / Cursor / Codex spawn. It exposes
 * the 6 consolidated tools (shared with the HTTP endpoint via registerTools) and
 * proxies each to the daemon's REST API (restCtx) so the daemon stays the single
 * writer and always runs sensing.
 */
export function buildMcpServer(): McpServer {
  const server = buildServer();
  registerTools(server, restCtx);
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
