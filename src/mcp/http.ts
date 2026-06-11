import type { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer, registerTools } from "./tools.ts";
import { coreCtx } from "./core-ctx.ts";

/**
 * Streamable HTTP MCP endpoint (carry-over from M1, folded into M4). Stateless:
 * a fresh server+transport per request, tools backed by `coreCtx` (direct core
 * calls, same process as the DB + sensing). Lets HTTP-MCP clients connect
 * without spawning the stdio bridge.
 */
export function registerMcpHttp(app: Hono): void {
  app.all("/mcp", async (c) => {
    const server = buildServer();
    registerTools(server, coreCtx);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
