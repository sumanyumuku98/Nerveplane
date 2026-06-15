import { api } from "../daemon/client.ts";
import type { ToolCtx } from "./tools.ts";

// This module runs *inside* the long-lived stdio bridge process, so its PID is a
// precise liveness token for the agent's session. We stamp it on the bridge's
// calls (the daemon records it as the agent's connection PID). The hook /
// session-start / CLI use `api()` directly and never stamp — their PIDs are
// short-lived and would falsely look dead.
const PID = process.pid;
const withPid = (a: Record<string, unknown>) => ({ ...a, connection_pid: PID });

/** Tool backend for the spawned stdio bridge: proxy every call to the daemon's
 *  REST API so the daemon stays the single writer and always runs sensing. */
export const restCtx: ToolCtx = {
  register: (a) => api("POST", "/api/v1/register", withPid(a)).then((r) => r.data),
  sync: (a) => api("POST", `/api/v1/agents/${a.agent_id}/sync`, { ack: true, connection_pid: PID }).then((r) => r.data),
  publish: (a) => api("POST", "/api/v1/publish", withPid(a)).then((r) => r.data),
  task: (a) => api("POST", "/api/v1/tasks", withPid(a)).then((r) => r.data),
  decision: (a) => api("POST", "/api/v1/decisions", a).then((r) => r.data),
  discover: (a) => {
    const qs = new URLSearchParams(Object.entries(a).filter(([, v]) => v != null) as [string, string][]).toString();
    return api("GET", `/api/v1/agents${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
  chat: (a) => {
    switch (a.action) {
      case "reply":
        return api("POST", "/api/v1/chat/reply", withPid(a)).then((r) => r.data);
      case "wait":
        // The long-poll can be interrupted if the daemon restarts mid-wait.
        // Retry once — safe because `wait` is read-only (ensureDaemon() inside
        // api() respawns the daemon). Never auto-retry the writes above.
        return api("POST", "/api/v1/chat/wait", withPid(a))
          .then((r) => r.data)
          .catch(() => api("POST", "/api/v1/chat/wait", withPid(a)).then((r) => r.data));
      case "threads":
        return api("GET", `/api/v1/chat/threads?agentId=${encodeURIComponent(String(a.agent_id))}`).then((r) => r.data);
      case "history":
        return api("GET", `/api/v1/chat/threads/${encodeURIComponent(String(a.thread_id))}`).then((r) => r.data);
      default: // "send"
        return api("POST", "/api/v1/chat/send", withPid(a)).then((r) => r.data);
    }
  },
};
