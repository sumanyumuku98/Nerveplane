import { basename, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { api, ensureDaemon } from "../daemon/client.ts";
import { NERVEPLANE_HOME } from "../config.ts";
import type { WorkResult } from "../core/worker.ts";

/**
 * `nerveplane worker` — run an agent as an always-on autonomous process. Unlike
 * an interactive Claude session (turn-based, only acts when a human/hook drives
 * it), a worker blocks on its Nerveplane inbox and spawns a headless `claude -p`
 * turn to handle/reply to each incoming message — so a teammate can message it
 * and get a reply with no human in the loop. One worker per worktree.
 */

export interface WorkerOptions {
  cwd?: string;
  name?: string;
  model?: string;
  permissionMode?: string; // claude --permission-mode (default acceptEdits)
  allowedTools?: string; // claude --allowedTools
  mcpConfig?: string; // claude --mcp-config (defaults to an inline nerveplane stdio server)
  pollMs?: number;
  once?: boolean; // single iteration (testing)
  print?: boolean; // dry-run: show the claude invocation, spawn nothing
}

/** Inline MCP config so the spawned agent always has the nerveplane tools. */
function defaultMcpConfig(): string {
  return JSON.stringify({ mcpServers: { nerveplane: { command: "nerveplane", args: ["mcp"] } } });
}

/** Build the headless `claude` argv (pure — unit-tested). */
export function buildClaudeArgs(prompt: string, sessionId: string | undefined, opts: WorkerOptions): string[] {
  const args = ["-p", prompt, "--output-format", "json", "--permission-mode", opts.permissionMode ?? "acceptEdits"];
  if (opts.allowedTools) args.push("--allowedTools", opts.allowedTools);
  if (opts.model) args.push("--model", opts.model);
  args.push("--mcp-config", opts.mcpConfig ?? defaultMcpConfig());
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

/** Build the turn prompt handed to the headless agent (pure — unit-tested). */
export function buildWorkerPrompt(work: WorkResult, agentId: string): string {
  const lines = [`You are Nerveplane agent ${agentId}, running autonomously. New coordination items arrived:`, ""];
  for (const m of work.messages) {
    lines.push(`- 💬 message from ${m.from ?? "a teammate"} (thread ${m.threadId ?? "?"})${m.subject ? ` — ${m.subject}` : ""}: ${m.body}`);
  }
  for (const u of work.updates) {
    lines.push(`- ⚠️ [${u.priority}] ${u.summary}${u.requiredAction ? ` — required: ${u.requiredAction}` : ""}`);
  }
  lines.push(
    "",
    `Call \`sync\` (agent_id="${agentId}") to read full context and acknowledge, then respond: reply to teammates ` +
      `with the \`chat\` tool (action='reply', using the thread id above) and \`publish\` anything the team should know. ` +
      "Keep it brief and act only on what's needed. If nothing requires a response, acknowledge and stop.",
  );
  return lines.join("\n");
}

export type TurnRunner = (
  prompt: string,
  ctx: { cwd: string; sessionId?: string; opts: WorkerOptions },
) => Promise<{ sessionId?: string; result?: string }>;

/** Default runner: spawn a real headless `claude -p` turn. */
const spawnRunner: TurnRunner = async (prompt, { cwd, sessionId, opts }) => {
  const args = buildClaudeArgs(prompt, sessionId, opts);
  const proc = Bun.spawn(["claude", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const j = JSON.parse(out) as { session_id?: string; result?: string };
    return { sessionId: j.session_id, result: j.result };
  } catch {
    return {};
  }
};

export async function runWorker(opts: WorkerOptions = {}, runner: TurnRunner = spawnRunner): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const name = opts.name ?? (basename(cwd) || "worker");
  const o: WorkerOptions = { ...opts, mcpConfig: opts.mcpConfig ?? defaultMcpConfig() };

  if (opts.print) {
    const args = buildClaudeArgs("<prompt>", undefined, o);
    process.stdout.write(
      `nerveplane worker (dry run)\n  cwd:   ${cwd}\n  name:  ${name}\n  each turn runs:  claude ${args
        .map((a) => (a === "<prompt>" || a.includes(" ") ? `"${a}"` : a))
        .join(" ")}\n`,
    );
    return 0;
  }

  await ensureDaemon();
  const reg = await api<{ agent_id: string }>("POST", "/api/v1/register", {
    name,
    repo_path: cwd,
    worktree_path: cwd,
    connection_pid: process.pid,
  });
  const agentId = reg.data?.agent_id;
  if (!agentId) {
    process.stderr.write("nerveplane worker: failed to register with the daemon\n");
    return 1;
  }
  process.stdout.write(`nerveplane worker: ${name} (${agentId}) watching ${cwd}\n  every incoming message wakes a headless claude turn. Ctrl-C to stop.\n`);

  const sessDir = join(NERVEPLANE_HOME, "workers");
  const sessFile = join(sessDir, `${agentId}.json`);
  mkdirSync(sessDir, { recursive: true });
  let sessionId: string | undefined = existsSync(sessFile)
    ? (JSON.parse(readFileSync(sessFile, "utf8")).sessionId as string | undefined)
    : undefined;

  let backoff = 1_000;
  for (;;) {
    let work: WorkResult;
    try {
      const res = await api<WorkResult>("POST", `/api/v1/agents/${agentId}/next`, {
        timeout_ms: opts.pollMs ?? 45_000,
        connection_pid: process.pid,
      });
      work = res.data ?? { messages: [], updates: [], timedOut: true };
    } catch {
      await Bun.sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
      continue;
    }
    backoff = 1_000;

    if (work.timedOut || (work.messages.length === 0 && work.updates.length === 0)) {
      if (opts.once) return 0;
      continue;
    }

    process.stdout.write(`  ↳ ${work.messages.length} message(s) / ${work.updates.length} update(s) — running a turn…\n`);
    try {
      const r = await runner(buildWorkerPrompt(work, agentId), { cwd, sessionId, opts: o });
      if (r.sessionId) {
        sessionId = r.sessionId;
        writeFileSync(sessFile, JSON.stringify({ sessionId }));
      }
      process.stdout.write("  ↳ done.\n");
    } catch (e) {
      process.stderr.write(`  ↳ turn failed: ${e instanceof Error ? e.message : String(e)}\n`);
      await Bun.sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
    if (opts.once) return 0;
  }
}
