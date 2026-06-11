import { Hono } from "hono";
import pkg from "../../package.json" with { type: "json" };

/**
 * Builds the daemon's HTTP surface. M0 ships health/version; M1 mounts the
 * REST API (/api/v1/*), the SSE stream (/events), and the Streamable HTTP MCP
 * endpoint (/mcp). A2A's /.well-known/agent-card.json is reserved for later.
 */
export function buildApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "nerveplane", version: pkg.version, ts: new Date().toISOString() }),
  );

  app.get("/", (c) => c.text(`nerveplane daemon v${pkg.version}`));

  return app;
}
