import { basename } from "node:path";
import { api } from "../daemon/client.ts";
import type { JoinPacket } from "../core/join.ts";

/**
 * Claude Code SessionStart hook — deterministic, zero-touch agent registration.
 * Reads the session JSON on stdin, registers the agent for this worktree (so the
 * daemon knows about it without relying on the model calling `register`), and
 * seeds the session with a short coordination summary. Always exits 0 and never
 * blocks the session — and `ensureDaemon()` means launching an agent also starts
 * the daemon. The `register` tool can still enrich this row (capabilities/task).
 */
/** Build the SessionStart `additionalContext` (pure — unit-tested). */
export function formatSessionContext(name: string, peers: { name: string }[]): string {
  const lines = [`🧠 Nerveplane: auto-registered as "${name}". Call the \`register\` tool to add your capabilities and current task.`];
  if (peers.length) {
    lines.push(`${peers.length} other agent(s) active: ${peers.map((p) => p.name).join(", ")} — call \`sync\` before editing.`);
  }
  return lines.join(" ");
}

export async function runSessionStart(): Promise<number> {
  try {
    const raw = await Bun.stdin.text();
    const input = raw ? (JSON.parse(raw) as { cwd?: string }) : {};
    const cwd = input.cwd ?? process.cwd();
    const name = basename(cwd) || "agent";

    const res = await api<{ agent_id: string; join_packet?: JoinPacket }>("POST", "/api/v1/register", {
      name,
      repo_path: cwd,
      worktree_path: cwd,
    });
    if (!res.ok) return 0; // never block the session on coordination failure

    const additionalContext = formatSessionContext(name, res.data?.join_packet?.active_agents ?? []);
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }) + "\n",
    );
    return 0;
  } catch {
    return 0;
  }
}
