import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "hono/bun";
import { fileURLToPath } from "node:url";
import { buildApi } from "./api.ts";
import { bus } from "../core/events.ts";
import { registerMcpHttp } from "../mcp/http.ts";
import pkg from "../../package.json" with { type: "json" };

const DASHBOARD_DIST = fileURLToPath(new URL("../../dashboard/dist", import.meta.url));

/**
 * Builds the daemon's HTTP surface: REST (/api/v1), live SSE (/events), the
 * Streamable HTTP MCP endpoint (/mcp), and the served dashboard (/dashboard).
 * A2A's /.well-known/agent-card.json is reserved.
 */
export function buildApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "nerveplane", version: pkg.version, ts: new Date().toISOString() }),
  );
  app.get("/", (c) => c.text(`nerveplane daemon v${pkg.version} — dashboard at /dashboard`));

  app.route("/api/v1", buildApi());

  // Live event stream for the dashboard: every typed event pushed via the bus.
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      // Default (unnamed) message so the browser's EventSource.onmessage fires
      // for every event type; the type travels inside the payload.
      const unsub = bus.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      });
      stream.onAbort(unsub);
      try {
        while (!stream.closed && !stream.aborted) {
          await stream.sleep(25_000);
          await stream.writeSSE({ event: "heartbeat", data: "{}" });
        }
      } finally {
        unsub();
      }
    }),
  );

  // Streamable HTTP MCP endpoint (carry-over: lets HTTP MCP clients connect).
  registerMcpHttp(app);

  // Served dashboard (built by vite into dashboard/dist; 404 until built).
  app.get("/dashboard", serveStatic({ path: `${DASHBOARD_DIST}/index.html` }));
  app.use(
    "/dashboard/*",
    serveStatic({ root: DASHBOARD_DIST, rewriteRequestPath: (p) => p.replace(/^\/dashboard/, "") || "/index.html" }),
  );

  return app;
}
