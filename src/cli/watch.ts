import { api, baseUrl, ensureDaemon } from "../daemon/client.ts";
import { readLiveLock } from "../daemon/lock.ts";
import { HOST, DEFAULT_PORT } from "../config.ts";
import { bold, cyan, dim, gray, screen, severityColor, statusColor, truncate } from "../tui/ansi.ts";

/**
 * `nerveplane watch` — a full-screen, live terminal monitor of the coordination
 * plane: active agents, open conflicts, the event timeline, and the chat feed.
 * It subscribes to the daemon's SSE `/events` stream (the same one the web
 * dashboard uses) as a wake signal, then throttled-refreshes the agent/conflict
 * snapshots over REST (so panes never drift). Hand-rolled ANSI — no native deps,
 * so it bundles into the single-file `bun build --compile` binaries.
 *
 * Keys: q/Ctrl-C quit · ↑/↓ or j/k select conflict · r resolve · d dismiss · ? help.
 * `--once` paints one snapshot and exits (non-TTY-safe; used for scripting/tests).
 */

// ---------- pure data model (unit-tested) ----------

export interface AgentRow {
  id: string;
  name: string;
  status: string;
  branch: string | null;
  lastSeenAt?: string;
}
export interface ConflictRow {
  id: string;
  type: string;
  severity: string;
  summary: string;
  suggestedAction?: string | null;
}
export interface EventRow {
  type: string;
  severity: string;
  summary: string;
  createdAt: string;
}
export interface ChatRow {
  from?: string;
  to?: string;
  body: string;
}

export interface WatchState {
  url: string;
  version?: string;
  uptime?: string;
  agents: AgentRow[];
  conflicts: ConflictRow[];
  events: EventRow[]; // newest last
  chat: ChatRow[]; // newest last
  selected: number; // index into conflicts
  showHelp: boolean;
  cols: number;
  rows: number;
}

export function initialState(url: string): WatchState {
  return { url, agents: [], conflicts: [], events: [], chat: [], selected: 0, showHelp: false, cols: 80, rows: 24 };
}

/** Push to a rolling buffer, keeping at most `cap` newest items. */
export function appendCapped<T>(arr: T[], item: T, cap: number): T[] {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
  return arr;
}

export interface SSEFrame {
  event?: string;
  data: string;
}

/**
 * Incremental SSE parser: consumes complete `\n\n`-separated frames from `buffer`
 * and returns them plus any trailing incomplete bytes to carry forward.
 */
export function parseSSE(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      // ignore id:, retry:, and `:` comment lines
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join("\n") });
  }
  return { frames, rest };
}

/** Fold one SSE frame into the state (timeline/chat append; heartbeat ignored). */
export function applyFrame(state: WatchState, frame: SSEFrame, cap = { events: 100, chat: 50 }): void {
  if (frame.event === "heartbeat") return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(frame.data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (frame.event === "chat") {
    appendCapped(
      state.chat,
      { from: str(payload.fromAgentId ?? payload.from), to: str(payload.toAgentId ?? payload.to), body: str(payload.body) ?? "" },
      cap.chat,
    );
    return;
  }
  // default (unnamed) event = a typed coordination Event
  appendCapped(
    state.events,
    { type: str(payload.type) ?? "event", severity: str(payload.severity) ?? "info", summary: str(payload.summary) ?? "", createdAt: str(payload.createdAt) ?? new Date().toISOString() },
    cap.events,
  );
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Compact "3m ago" style age from an ISO timestamp. */
export function ago(iso?: string, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Render the monitor to an array of lines (pure — snapshot-tested). Color is a
 * no-op off a TTY, so tests see plain text. Section lists are capped for space.
 */
export function renderLines(state: WatchState, now = Date.now()): string[] {
  const w = Math.max(40, state.cols);
  const lines: string[] = [];
  const rule = () => lines.push(dim("─".repeat(w)));

  lines.push(bold(cyan("nerveplane watch")) + dim(`  ${state.url}${state.version ? `  v${state.version}` : ""}${state.uptime ? `  up ${state.uptime}` : ""}`));
  rule();

  lines.push(bold(`AGENTS (${state.agents.length})`));
  if (state.agents.length === 0) lines.push(dim("  none"));
  for (const a of state.agents.slice(0, 8)) {
    lines.push(truncate(`  ${statusColor(a.status, a.status.padEnd(12))} ${a.name.padEnd(18)} ${(a.branch ?? "-").padEnd(20)} ${dim(ago(a.lastSeenAt, now))}`, w));
  }
  lines.push("");

  lines.push(bold(`OPEN CONFLICTS (${state.conflicts.length})`));
  if (state.conflicts.length === 0) lines.push(dim("  none"));
  state.conflicts.slice(0, 8).forEach((c, i) => {
    const marker = i === state.selected ? cyan("▸ ") : "  ";
    lines.push(truncate(`${marker}${severityColor(c.severity, `[${c.severity}]`)} ${c.type.padEnd(13)} ${c.summary}`, w));
  });
  lines.push("");

  lines.push(bold("EVENTS"));
  const recentEvents = state.events.slice(-8).reverse();
  if (recentEvents.length === 0) lines.push(dim("  none"));
  for (const e of recentEvents) {
    lines.push(truncate(`  ${dim(ago(e.createdAt, now).padStart(4))} ${severityColor(e.severity, e.severity.padEnd(8))} ${e.type.padEnd(22)} ${e.summary}`, w));
  }
  lines.push("");

  lines.push(bold("CHAT"));
  const recentChat = state.chat.slice(-5);
  if (recentChat.length === 0) lines.push(dim("  none"));
  for (const m of recentChat) {
    lines.push(truncate(`  ${cyan(m.from ?? "?")} ${dim("→")} ${m.to ?? "?"}: ${m.body}`, w));
  }

  const footer = state.showHelp
    ? "q quit · ↑/↓ or j/k select conflict · r resolve · d dismiss · ? hide help"
    : "q quit · j/k select · r resolve · d dismiss · ? help";
  lines.push("");
  lines.push(gray(truncate(footer, w)));
  return lines;
}

// ---------- IO shell ----------

async function refreshSnapshot(state: WatchState): Promise<void> {
  const lock = readLiveLock();
  state.version = lock?.version;
  if (lock?.startedAt) {
    const m = Math.floor((Date.now() - new Date(lock.startedAt).getTime()) / 60000);
    state.uptime = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  const [ag, cf, ev] = await Promise.all([
    api<{ agents: AgentRow[] }>("GET", "/api/v1/agents?includeOffline=true"),
    api<{ conflicts: ConflictRow[] }>("GET", "/api/v1/conflicts?status=open"),
    api<{ events: EventRow[] }>("GET", "/api/v1/events?limit=30"),
  ]);
  state.agents = ag.data?.agents ?? [];
  state.conflicts = cf.data?.conflicts ?? [];
  if (state.events.length === 0) state.events = (ev.data?.events ?? []).slice().reverse(); // seed newest-last
  if (state.selected >= state.conflicts.length) state.selected = Math.max(0, state.conflicts.length - 1);
}

export async function runWatch(opts: { once?: boolean } = {}): Promise<number> {
  await ensureDaemon();
  const state = initialState(baseUrl() ?? `http://${HOST}:${DEFAULT_PORT}`);
  await refreshSnapshot(state);

  if (opts.once || !process.stdout.isTTY) {
    process.stdout.write(renderLines(state).join("\n") + "\n");
    return 0;
  }

  const stdin = process.stdin;
  let running = true;
  const controller = new AbortController();
  const restore = () => {
    try {
      stdin.setRawMode?.(false);
    } catch {
      /* not a raw-capable tty */
    }
    process.stdout.write(screen.showCursor + screen.leaveAlt);
    stdin.pause();
  };
  const paint = () => {
    state.cols = process.stdout.columns ?? 80;
    state.rows = process.stdout.rows ?? 24;
    const body = renderLines(state).slice(0, Math.max(1, state.rows - 1));
    process.stdout.write(screen.home + screen.clear + body.join("\r\n"));
  };
  const shutdown = (code: number) => {
    running = false;
    controller.abort();
    restore();
    process.exit(code);
  };

  process.stdout.write(screen.enterAlt + screen.hideCursor);
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      await refreshSnapshot(state);
      paint();
    }, 300);
  };

  // SSE subscription loop (reconnects on drop).
  void (async () => {
    while (running) {
      try {
        const res = await fetch(`${state.url}/events`, { signal: controller.signal, headers: { accept: "text/event-stream" } });
        const reader = res.body?.getReader();
        if (!reader) throw new Error("no stream");
        const decoder = new TextDecoder();
        let buf = "";
        while (running) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSSE(buf);
          buf = rest;
          for (const f of frames) applyFrame(state, f);
          if (frames.length) {
            scheduleRefresh();
            paint();
          }
        }
      } catch {
        if (!running) break;
      }
      if (running) await Bun.sleep(1000);
    }
  })();

  const onChunk = async (chunk: string) => {
    if (chunk === "q" || chunk === "\x03") return shutdown(0);
    if (chunk === "j" || chunk === "\x1b[B") state.selected = Math.min(state.selected + 1, Math.max(0, state.conflicts.length - 1));
    else if (chunk === "k" || chunk === "\x1b[A") state.selected = Math.max(state.selected - 1, 0);
    else if (chunk === "?") state.showHelp = !state.showHelp;
    else if (chunk === "r" || chunk === "d") {
      const c = state.conflicts[state.selected];
      if (c) {
        await api("POST", `/api/v1/conflicts/${c.id}/${chunk === "r" ? "resolve" : "dismiss"}`, {});
        await refreshSnapshot(state);
      }
    } else return;
    paint();
  };
  stdin.on("data", (d: string) => void onChunk(d));

  process.on("SIGWINCH", paint);
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  paint();
  await new Promise<void>(() => {}); // run until a key/signal calls shutdown()
  return 0;
}
