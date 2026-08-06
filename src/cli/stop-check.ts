import { api } from "../daemon/client.ts";
import type { InboxMessage } from "../core/inbox.ts";
import type { CheckpointStatus } from "../core/checkpoint.ts";

/**
 * Claude Code `Stop` hook. Two turn-end nudges, DMs first:
 *
 * 1. A Claude agent is turn-based with no background loop, so a direct message
 *    sits unread until the agent next acts. If a teammate DM'd it, we return a
 *    `block` decision so the agent handles the message instead of parking.
 * 2. Otherwise, if the agent did memory-worthy work this session (recorded a
 *    decision, handed off a task, or made substantial file changes) but saved no
 *    durable memory, we nudge it to `remember` — closing the write-side gap
 *    (recall is already auto-injected at SessionStart / before edits).
 *
 * Loop-safe: Claude sets `stop_hook_active` once it has already blocked (plus an
 * 8-block cap), so we exit 0 in that case; the memory nudge additionally acks a
 * per-agent cursor so the same work never re-nudges, and writing the memory
 * clears the signal at the source. Always exits 0; never breaks the host.
 */

/** Build the DM `reason` injected back into the agent (pure — unit-tested). */
export function formatStopReason(messages: InboxMessage[]): string {
  const lines = messages.map((m) => `- 💬 ${m.from ?? "a teammate"}${m.subject ? ` — ${m.subject}` : ""}: ${m.body}`);
  return (
    `Nerveplane: ${messages.length} new message(s) from teammates before you finish:\n${lines.join("\n")}\n\n` +
    "Reply with the `chat` tool (action='reply', addressed to the sender's thread), or call `sync` for full context. " +
    "If no reply is needed, you can stop."
  );
}

/** Build the memory-checkpoint `reason` injected back into the agent (pure — unit-tested). */
export function formatMemoryNudge(status: CheckpointStatus): string {
  const work = status.signals.join(" and ");
  return (
    `Nerveplane: this session you have ${work}, but saved no durable memory. ` +
    "Before you finish, call the `memory` tool (action='remember', kind='episode') with where you left off, " +
    "plus any kind='fact' gotchas or decisions — so another agent (even a different CLI) can resume. " +
    "If nothing here is worth keeping, you can stop."
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
    if (messages.length > 0) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "Stop" },
          decision: "block",
          reason: formatStopReason(messages),
        }) + "\n",
      );
      return 0;
    }

    // No DMs waiting — nudge a memory write if this turn did memory-worthy work
    // without saving anything (acks the cursor so the same work won't re-nudge).
    const chk = await api<CheckpointStatus>("POST", `/api/v1/agents/${agentId}/memory-checkpoint`, {});
    if (chk.data?.shouldNudge) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "Stop" },
          decision: "block",
          reason: formatMemoryNudge(chk.data),
        }) + "\n",
      );
      return 0;
    }
    return 0; // nothing waiting — let it stop
  } catch {
    // Never block stopping on a coordination failure.
    return 0;
  }
}
