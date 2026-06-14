import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildApi } from "./api.ts";
import { bus } from "../core/events.ts";
import { registerMcpHttp } from "../mcp/http.ts";
import pkg from "../../package.json" with { type: "json" };
// Single self-contained dashboard page (JS+CSS inlined by vite-plugin-singlefile).
// Static `text` import → bundled into the compiled binary AND read from the npm
// package on disk. The built file is committed so this import always resolves.
import dashboardHtmlRaw from "../../dashboard/dist/index.html" with { type: "text" };
const dashboardHtml = dashboardHtmlRaw as unknown as string;

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
      // Direct messages travel on a named "chat" channel (avoids colliding with
      // the default "message" event name) so the dashboard can render chat live.
      const unsubMsg = bus.onMessage((msg) => {
        void stream.writeSSE({ event: "chat", data: JSON.stringify(msg) });
      });
      const stop = () => {
        unsub();
        unsubMsg();
      };
      stream.onAbort(stop);
      try {
        while (!stream.closed && !stream.aborted) {
          await stream.sleep(25_000);
          await stream.writeSSE({ event: "heartbeat", data: "{}" });
        }
      } finally {
        stop();
      }
    }),
  );

  // Streamable HTTP MCP endpoint (carry-over: lets HTTP MCP clients connect).
  registerMcpHttp(app);

  // Served dashboard — single self-contained page (assets inlined).
  app.get("/dashboard", (c) =>
    dashboardHtml ? c.html(dashboardHtml) : c.text("nerveplane: dashboard unavailable", 503),
  );

  return app;
}
