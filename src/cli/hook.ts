import { api } from "../daemon/client.ts";
import type { UpdateItem } from "../core/inbox.ts";

/** Build the `additionalContext` injected into the agent (pure — unit-tested). */
export function formatHookContext(updates: UpdateItem[]): string {
  const lines = updates.map(
    (u) =>
      `- [${u.priority.toUpperCase()}] ${u.summary}` +
      (u.requiredAction ? `\n  → required: ${u.requiredAction}` : "") +
      (u.reason ? `\n  (why: ${u.reason})` : ""),
  );
  return `⚠️ Nerveplane: ${updates.length} high-priority coordination warning(s) before you edit:\n${lines.join("\n")}\n\nCall the \`sync\` tool for full details.`;
}

/**
 * Claude Code PreToolUse hook (plan Part C.2 — last-mile delivery). Resolves
 * the agent for the current worktree and injects any unread high-severity
 * warnings into the agent's context before it edits. Always exits 0 and never
 * blocks the edit — coordination must never break the host tool.
 */
export async function runHook(): Promise<number> {
  try {
    const raw = await Bun.stdin.text();
    const input = raw ? (JSON.parse(raw) as { cwd?: string }) : {};
    const cwd = input.cwd ?? process.cwd();

    const lookup = await api<{ agent: { id: string } | null }>(
      "GET",
      `/api/v1/agent-by-worktree?path=${encodeURIComponent(cwd)}`,
    );
    const agentId = lookup.data?.agent?.id;
    if (!agentId) return 0; // no registered agent here — stay silent

    const res = await api<{ updates: UpdateItem[] }>("POST", `/api/v1/agents/${agentId}/peek`, {
      min_severity: "high",
      ack: true,
    });
    const updates = res.data?.updates ?? [];
    if (updates.length === 0) return 0;

    const additionalContext = formatHookContext(updates);

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext },
      }) + "\n",
    );
    return 0;
  } catch {
    // Never block edits on coordination failure.
    return 0;
  }
}
