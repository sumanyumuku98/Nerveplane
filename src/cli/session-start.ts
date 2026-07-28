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
export interface RecalledMemory {
  kind: string;
  title?: string | null;
  body: string;
}

/** Build the SessionStart `additionalContext` (pure — unit-tested). Recalled
 *  memories are appended only when present, so an empty store yields output
 *  byte-identical to before this feature. */
export function formatSessionContext(name: string, peers: { name: string }[], memories: RecalledMemory[] = []): string {
  const lines = [`🧠 Nerveplane: auto-registered as "${name}". Call the \`register\` tool to add your capabilities and current task.`];
  if (peers.length) {
    lines.push(`${peers.length} other agent(s) active: ${peers.map((p) => p.name).join(", ")} — call \`sync\` before editing.`);
  }
  if (memories.length) {
    const top = memories[0]!;
    const snippet = (top.title || top.body).replace(/\s+/g, " ").slice(0, 140);
    lines.push(`📓 ${memories.length} memory(ies) recalled for this repo (e.g. "${snippet}") — see more via the \`memory\` tool (action='recall').`);
    const episode = memories.find((m) => m.kind === "episode");
    if (episode) lines.push(`▶ Resume: ${episode.body.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return lines.join(" ");
}

export async function runSessionStart(): Promise<number> {
  try {
    const raw = await Bun.stdin.text();
    const input = raw ? (JSON.parse(raw) as { cwd?: string }) : {};
    const cwd = input.cwd ?? process.cwd();
    const name = basename(cwd) || "agent";

    const res = await api<{ agent_id: string; agent?: { repoId?: string }; join_packet?: JoinPacket }>("POST", "/api/v1/register", {
      name,
      repo_path: cwd,
      worktree_path: cwd,
    });
    if (!res.ok) return 0; // never block the session on coordination failure

    // Recall this repo's memories so a fresh agent (any CLI) is handed prior
    // context + any resumable task trail. Scoped to repoId to avoid cross-repo noise.
    let memories: RecalledMemory[] = [];
    const repoId = res.data?.agent?.repoId;
    if (repoId) {
      try {
        const m = await api<{ memories: RecalledMemory[] }>("POST", "/api/v1/memory", { action: "recall", repo_id: repoId, limit: 5 });
        memories = m.data?.memories ?? [];
      } catch {
        /* memory recall is best-effort; never block the session */
      }
    }

    const additionalContext = formatSessionContext(name, res.data?.join_packet?.active_agents ?? [], memories);
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }) + "\n",
    );
    return 0;
  } catch {
    return 0;
  }
}
