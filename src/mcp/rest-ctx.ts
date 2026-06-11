import { api } from "../daemon/client.ts";
import type { ToolCtx } from "./tools.ts";

/** Tool backend for the spawned stdio bridge: proxy every call to the daemon's
 *  REST API so the daemon stays the single writer and always runs sensing. */
export const restCtx: ToolCtx = {
  register: (a) => api("POST", "/api/v1/register", a).then((r) => r.data),
  sync: (a) => api("POST", `/api/v1/agents/${a.agent_id}/sync`, { ack: true }).then((r) => r.data),
  publish: (a) => api("POST", "/api/v1/publish", a).then((r) => r.data),
  task: (a) => api("POST", "/api/v1/tasks", a).then((r) => r.data),
  decision: (a) => api("POST", "/api/v1/decisions", a).then((r) => r.data),
  discover: (a) => {
    const qs = new URLSearchParams(Object.entries(a).filter(([, v]) => v != null) as [string, string][]).toString();
    return api("GET", `/api/v1/agents${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
};
