import { api } from "../daemon/client.ts";
import type { InboxMessage } from "../core/inbox.ts";

/**
 * Claude Code `Stop` hook — autonomous reply to teammate DMs before going idle.
 *
 * A Claude agent is turn-based with no background loop, so a direct message sits
 * unread until the agent next acts. When the agent finishes a turn, this hook
 * checks its Nerveplane inbox; if a teammate DM'd it, it returns a `block`
 * decision so the agent keeps going and handles the message instead of parking.
 * Loop-safe: Claude sets `stop_hook_active` once it has already blocked (plus an
 * 8-block cap), so we exit 0 in that case. Only direct messages trigger a block
 * (not info events) to avoid over-blocking. Always exits 0; never breaks the host.
 */

/** Build the `reason` injected back into the agent (pure — unit-tested). */
export function formatStopReason(messages: InboxMessage[]): string {
  const lines = messages.map((m) => `- 💬 ${m.from ?? "a teammate"}${m.subject ? ` — ${m.subject}` : ""}: ${m.body}`);
  return (
    `Nerveplane: ${messages.length} new message(s) from teammates before you finish:\n${lines.join("\n")}\n\n` +
    "Reply with the `chat` tool (action='reply', addressed to the sender's thread), or call `sync` for full context. " +
    "If no reply is needed, you can stop."
  );
}

export async function runStopCheck(): Promise<number> {
  try {
    const raw = await Bun.stdin.text();
    const input = raw ? (JSON.parse(raw) as { cwd?: string; stop_hook_active?: boolean }) : {};
    // Already forced a continuation once — let the agent stop (prevents loops).
    if (input.stop_hook_active) return 0;

    const cwd = input.cwd ?? process.cwd();
    const lookup = await api<{ agent: { id: string } | null }>(
      "GET",
      `/api/v1/agent-by-worktree?path=${encodeURIComponent(cwd)}`,
    );
    const agentId = lookup.data?.agent?.id;
    if (!agentId) return 0; // no registered agent here — let it stop

    const res = await api<{ messages: InboxMessage[] }>("POST", `/api/v1/agents/${agentId}/peek-messages`, {});
    const messages = res.data?.messages ?? [];
    if (messages.length === 0) return 0; // nothing waiting — let it stop

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "Stop" },
        decision: "block",
        reason: formatStopReason(messages),
      }) + "\n",
    );
    return 0;
  } catch {
    // Never block stopping on a coordination failure.
    return 0;
  }
}
