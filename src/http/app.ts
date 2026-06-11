import { Hono } from "hono";
import { buildApi } from "./api.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * Builds the daemon's HTTP surface. M1 mounts the REST API (/api/v1/*). The SSE
 * stream (/events) and Streamable HTTP MCP endpoint (/mcp) land in later
 * milestones; A2A's /.well-known/agent-card.json is reserved.
 */
export function buildApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "nerveplane", version: pkg.version, ts: new Date().toISOString() }),
  );

  app.get("/", (c) => c.text(`nerveplane daemon v${pkg.version}`));

  app.route("/api/v1", buildApi());

  return app;
}
