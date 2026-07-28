import { select, isCancel, cancel } from "@clack/prompts";
import { listProviders, getProvider, DEFAULT_AGENT } from "../agents/index.ts";
import type { AgentProvider } from "../agents/types.ts";

/**
 * Interactive selection prompts (via @clack/prompts). Every prompt is gated on a
 * real TTY by its caller — off a TTY (scripts, pipes, CI, tests) the CLI keeps
 * its existing flag/default/usage-error behavior and nothing here runs.
 */

export const isInteractive = (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY;

/** Provider picker for `worker` / `install`. Lists install + MCP status. Returns undefined if cancelled. */
export async function pickAgent(providers: AgentProvider[] = listProviders()): Promise<string | undefined> {
  const options = providers.map((p) => {
    const bits: string[] = [p.detect() ? "installed" : "not on PATH"];
    if (p.capabilities.hooks) bits.push("hooks");
    if (!p.capabilities.inlineMcpConfig) {
      let registered = false;
      try {
        registered = p.mcpConfigStatus().registered;
      } catch {
        /* status is best-effort */
      }
      bits.push(registered ? "MCP ✓" : "run install first");
    }
    return { value: p.id, label: p.label, hint: bits.join(" · ") };
  });
  const res = await select({ message: "Which CLI agent?", options, initialValue: DEFAULT_AGENT });
  if (isCancel(res)) {
    cancel("cancelled");
    return undefined;
  }
  return res as string;
}

/**
 * Resolve which agent id to use. An explicit id (from `--agent`) is validated and
 * returned (unknown throws — unchanged). Otherwise prompt on a TTY, else fall back
 * to the default. `deps` is injectable for tests.
 */
export async function resolveAgent(
  explicit: string | undefined,
  deps: { isTTY?: boolean; prompt?: (providers: AgentProvider[]) => Promise<string | undefined> } = {},
): Promise<string> {
  if (explicit) {
    getProvider(explicit); // throws on unknown id — preserves prior behavior
    return explicit;
  }
  const isTTY = deps.isTTY ?? isInteractive();
  if (!isTTY) return DEFAULT_AGENT;
  const picked = deps.prompt ? await deps.prompt(listProviders()) : await pickAgent();
  return picked ?? DEFAULT_AGENT;
}

export interface ConflictRow {
  id: string;
  type: string;
  severity: string;
  summary: string;
}

/** Conflict picker for the interactive `conflicts` flow. Returns undefined if cancelled. */
export async function pickConflict(conflicts: ConflictRow[]): Promise<string | undefined> {
  const res = await select({
    message: "Select a conflict",
    options: conflicts.map((c) => ({ value: c.id, label: `[${c.severity}] ${c.type} — ${c.summary}`, hint: c.id })),
  });
  if (isCancel(res)) {
    cancel("cancelled");
    return undefined;
  }
  return res as string;
}

/** resolve / dismiss / skip for a selected conflict. undefined = skip/cancel. */
export async function pickAction(): Promise<"resolve" | "dismiss" | undefined> {
  const res = await select({
    message: "Action",
    options: [
      { value: "resolve", label: "Resolve — mark handled" },
      { value: "dismiss", label: "Dismiss — not a real conflict" },
      { value: "skip", label: "Skip" },
    ],
  });
  if (isCancel(res) || res === "skip") return undefined;
  return res as "resolve" | "dismiss";
}
