/**
 * Tier-B live-agent evals (research spike) — REAL Claude/Codex/opencode agents.
 *
 *   bun run experiments/coordination-evals/live.ts
 *
 * Env-gated (needs a real agent + key); prints a runbook and exits 0 if the
 * environment isn't set up, so it never breaks CI or a dry run. Nondeterministic
 * by nature → run K≥5 seeds and report mean ± CI. Results are appended to
 * results.md by hand from the printed JSON (Tier B is not a CI gate).
 *
 * Two experiments:
 *  1) OUTCOME LIFT — drive real agents on the Tier-A scenarios under C0 vs C1
 *     (C1 = agents run against a live daemon with sensing/chat/memory; C0 = no
 *     daemon). Reuses the same scorers as Tier A. [scaffold — wire to the worker
 *     headless path in src/agents + src/cli/worker.ts]
 *  2) LOST-IN-THE-MIDDLE (H7) — the self-contained, highest-signal experiment.
 */
import { getProvider, listProviders } from "../../src/agents/index.ts";

const CRITICAL_FACT = "IMPORTANT: authentication is centralized in src/lib/authClient.ts — never implement your own auth; import from there.";
// Lost-in-the-middle needs a substantial context to manifest, so model a realistic
// busy-team coordination history: NP_EVAL_DISTRACTORS notes (default 200), each a
// full sentence, ≈8–12k tokens total. Tune via env.
const N_DISTRACTORS = Number(process.env.NP_EVAL_DISTRACTORS ?? 200);
const DISTRACTORS = Array.from(
  { length: N_DISTRACTORS },
  (_, i) =>
    `- event ${i}: agent svc_${i % 17} refactored module_${i} — renamed helper_${i} to util_${i}, updated ${3 + (i % 5)} call sites in package pkg_${i % 9}, and bumped the internal changelog; no cross-team action required and no public contract changed.`,
);

/** Build the naive "dump the whole coordination history into context" prompt,
 *  with the one critical fact at a given position (start | middle | end). */
function dumpPrompt(position: "start" | "middle" | "end"): string {
  const notes = [...DISTRACTORS];
  const at = position === "start" ? 0 : position === "end" ? notes.length : Math.floor(notes.length / 2);
  notes.splice(at, 0, CRITICAL_FACT);
  return `You are one of several coding agents. Here is the recent team coordination history:\n${notes.join("\n")}\n\nTask: add a login endpoint. Reply with the single import line you would use for auth.`;
}

/** C1: Nerveplane routes only the relevant fact, just-in-time (short, high-signal). */
function routedPrompt(): string {
  return `You are one of several coding agents.\n📓 Relevant: ${CRITICAL_FACT}\n\nTask: add a login endpoint. Reply with the single import line you would use for auth.`;
}

/** Adherence = the reply references src/lib/authClient (didn't roll its own). */
function adhered(reply: string): boolean {
  return /authClient/i.test(reply);
}

function requireLiveEnv(): { agent: string } | null {
  const agent = process.env.NP_EVAL_AGENT ?? "";
  const provider = agent ? listProviders().find((p) => p.id === agent) : undefined;
  const ready = provider?.detect() && (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || agent === "claude");
  return ready ? { agent } : null;
}

async function runTurn(agentId: string, prompt: string): Promise<string> {
  const provider = getProvider(agentId);
  const args = provider.headlessArgs(prompt, {});
  const proc = Bun.spawn([provider.bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return provider.parseResult(out).result ?? "";
}

async function main() {
  const env = requireLiveEnv();
  if (!env) {
    process.stdout.write(
      [
        "Tier-B live evals require a real agent + key. Runbook:",
        "  1. Pick an agent:  export NP_EVAL_AGENT=claude|codex|opencode",
        "  2. Provide a key:  export OPENAI_API_KEY=... (or ANTHROPIC_API_KEY / a logged-in Claude CLI)",
        "  3. nerveplane install <agent>   # so it has the nerveplane MCP",
        "  4. bun run experiments/coordination-evals/live.ts",
        "",
        "Experiments: (1) outcome-lift on the Tier-A scenarios with real agents (C0 vs C1);",
        "(2) lost-in-the-middle — critical-fact adherence vs. position (dump) vs. routed (Nerveplane).",
        "Run K≥5 seeds; append mean ± CI to results.md. Not a CI gate (costs money, nondeterministic).",
      ].join("\n") + "\n",
    );
    return;
  }

  const K = Number(process.env.NP_EVAL_SEEDS ?? 5);
  const positions = ["start", "middle", "end"] as const;
  const dump: Record<string, number> = {};
  for (const pos of positions) {
    let hits = 0;
    for (let k = 0; k < K; k++) if (adhered(await runTurn(env.agent, dumpPrompt(pos)))) hits++;
    dump[pos] = hits / K;
  }
  let routedHits = 0;
  for (let k = 0; k < K; k++) if (adhered(await runTurn(env.agent, routedPrompt()))) routedHits++;

  process.stdout.write(
    "\n## Lost-in-the-middle (H7) — critical-fact adherence\n" +
      JSON.stringify({ agent: env.agent, seeds: K, dump_by_position: dump, nerveplane_routed: routedHits / K }, null, 2) +
      "\n\nExpect: dump shows the U-shaped dip (middle lowest); routed stays high + position-invariant.\n",
  );
}

await main();
