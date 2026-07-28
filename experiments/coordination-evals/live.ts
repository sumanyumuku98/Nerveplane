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
import { appendFileSync } from "node:fs";
import { getProvider, listProviders } from "../../src/agents/index.ts";

const REPLY_LOG = process.env.NP_EVAL_LOG ?? "/tmp/np-eval-replies.log";

// Phrased to BLEND IN with the distractor notes (same "- event N:" shape) — a
// shouty "IMPORTANT:" prefix defeats the test by making the fact trivially salient.
const CRITICAL_FACT = "- event 101: auth was centralized into src/lib/authClient — teams should import getAuth from there instead of rolling their own.";
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

// --- Context-dilution experiment (the "context engineering" thesis) ---
// FAIR test: a few tiny repos can't dilute a 200k–1M-token window, so we GENERATE
// a realistically large microservices codebase (parametrised by target tokens) and
// bury the ONE current payments contract mid-context among MANY plausible-but-wrong
// money/invoice shapes (hard negatives). A single agent must retrieve the right
// contract from the whole diluted world; Nerveplane scopes the agent to its own repo
// and ROUTES just the exact cross-repo fact. Correct answer = the CURRENT payments
// contract (total + currency), NOT any decoy (amount/subtotal/grossValue/netAmount/…).

// Default sweep of diluted-context sizes (approx tokens); override with a single size
// via NP_EVAL_DILUTION_TOKENS. ~4 chars/token estimate for sizing.
const DILUTION_SIZES = process.env.NP_EVAL_DILUTION_TOKENS
  ? [Number(process.env.NP_EVAL_DILUTION_TOKENS)]
  : [10_000, 50_000, 100_000, 200_000];
export const approxTokens = (s: string) => Math.round(s.length / 4);

// The CURRENT source of truth (must be present but buried) and the decoys that make
// this a genuine disambiguation, not a "find the money field" gimme.
const CURRENT_CONTRACT =
  "// payments-svc — CURRENT invoice contract (SOURCE OF TRUTH; supersedes all legacy shapes)\nexport interface Invoice { id: string; total: number; currency: string }\nexport function getInvoice(id: string): Invoice { return { id, total: 0, currency: 'USD' }; }\n";
const DECOYS: string[] = [
  "// billing-legacy — DEPRECATED invoice shape, kept only for the old ledger export\nexport interface LegacyInvoice { id: string; amount: number }\nexport function fetchAmount(id: string): number { return 0; }\n",
  "// reporting-svc — invoice ROLLUP for finance reports (not the live contract)\nexport interface InvoiceReport { id: string; grossValue: number; tax: number }\nexport function report(id: string): InvoiceReport { return { id, grossValue: 0, tax: 0 }; }\n",
  "// ledger-svc — double-entry ledger row (internal accounting, not the API contract)\nexport interface LedgerEntry { id: string; subtotal: number; vat: number }\nexport function post(e: LedgerEntry): void {}\n",
  "// analytics-svc — revenue analytics row (derived, not authoritative)\nexport interface RevenueRow { id: string; netAmount: number; fx: number }\nexport function ingest(r: RevenueRow): void {}\n",
];

// Deterministic filler that looks like real service code, sized to a char budget.
function fillerBlock(svc: string, i: number): string {
  return (
    `export interface ${svc}Config${i} { id: string; enabled: boolean; retries: number; timeoutMs: number }\n` +
    `export function handle_${svc}_${i}(req: { id: string; payload: unknown }): { ok: boolean; id: string } {\n` +
    `  // ${svc}: validate, process with backoff, and enqueue for downstream delivery (idempotent by id)\n` +
    `  const ok = typeof req.id === 'string' && req.id.length > 0;\n  return { ok, id: req.id };\n}\n` +
    `// ${svc} step ${i}: retries use exponential backoff; see runbook for on-call escalation and SLOs.\n`
  );
}

/** Build a diluted single-agent dump ~targetTokens, current contract buried mid,
 *  decoys spread through the pile. Returns the assembled prompt body. */
export function buildDilutedDump(targetTokens: number): string {
  const budget = targetTokens * 4; // chars
  const fillerSvcs = ["notifications", "search", "users", "inventory", "shipping", "catalog", "fraud", "audit"];
  const blocks: string[] = [];
  let used = 0;
  let i = 0;
  // Anchor points (fractions of the final block list) where we splice the contract/decoys.
  while (used < budget) {
    const svc = fillerSvcs[i % fillerSvcs.length];
    const b = `=== repo: ${svc}-svc / module ${i} ===\n// ${svc}-svc — internal module ${i}\n${fillerBlock(svc, i)}`;
    blocks.push(b);
    used += b.length;
    i++;
  }
  // Insert decoys spread across the pile and the CURRENT contract at ~50% (worst
  // position for lost-in-the-middle). Wrap each in a repo header so it reads native.
  const wrap = (name: string, code: string) => `=== repo: ${name} ===\n${code}`;
  const at = (frac: number) => Math.max(0, Math.min(blocks.length, Math.floor(blocks.length * frac)));
  blocks.splice(at(0.12), 0, wrap("billing-legacy", DECOYS[0]));
  blocks.splice(at(0.3), 0, wrap("reporting-svc", DECOYS[1]));
  blocks.splice(at(0.5), 0, wrap("payments-svc", CURRENT_CONTRACT)); // the one true fact, buried mid
  blocks.splice(at(0.68), 0, wrap("ledger-svc", DECOYS[2]));
  blocks.splice(at(0.86), 0, wrap("analytics-svc", DECOYS[3]));
  return blocks.join("\n");
}

// STRUCTURED output (not prose) so scoring is robust — no false-negatives from a
// correct-but-explanatory reply. The agent must emit a JSON array of field names.
const DILUTION_TASK =
  'Task (in orders-svc): render the invoice total together with its currency, per the CURRENT payments invoice contract (the live source of truth — ignore deprecated/legacy/report/ledger/analytics shapes). Reply with ONLY a JSON array of the exact invoice field names you must read from that CURRENT contract — e.g. ["x","y"]. No prose, no code fences.';

export function dilutionSinglePrompt(targetTokens: number): string {
  return `You are a single agent responsible for the WHOLE microservices system. Here are all the service codebases:\n${buildDilutedDump(targetTokens)}\n\n${DILUTION_TASK}`;
}
export function dilutionScopedPrompt(): string {
  const orders = "=== repo: orders-svc (yours) ===\n// orders-svc\nexport function renderInvoice(inv: unknown) { /* fill in */ }\n";
  const routed = "📓 Routed from payments-svc (current contract): Invoice has fields { id, total, currency }.";
  return `You are the orders-svc agent (Nerveplane scopes you to your repo).\n${orders}\n${routed}\n\n${DILUTION_TASK}`;
}
/** Robust scorer: parse the JSON array; correct = uses the CURRENT contract
 *  (total + currency) and NOT any decoy field. Raw replies are logged so the
 *  scorer is auditable, never trusted blindly. */
export function adheredDilution(reply: string): boolean {
  const m = reply.match(/\[[^\]]*\]/);
  let fields: string[] = [];
  if (m) {
    try {
      fields = (JSON.parse(m[0]) as unknown[]).map((x) => String(x).toLowerCase());
    } catch {
      /* fall through */
    }
  }
  const set = new Set(fields);
  const decoy = ["amount", "subtotal", "grossvalue", "netamount", "tax", "vat", "fx"];
  return set.has("total") && set.has("currency") && !decoy.some((d) => set.has(d));
}

function requireLiveEnv(): { agent: string } | null {
  const agent = process.env.NP_EVAL_AGENT ?? "";
  const provider = agent ? listProviders().find((p) => p.id === agent) : undefined;
  const ready = provider?.detect() && (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || agent === "claude");
  return ready ? { agent } : null;
}

/**
 * Frontier-capable stressor: a SUPERSEDED decision under distraction + recency.
 * Frontier models resist the classic positional dip but still anchor on a stale
 * or recent instruction when the real update is buried among similar notes.
 * Maps onto Nerveplane's decision-ledger(supersede) + JIT routing.
 */
function supersedeDumpPrompt(): string {
  const notes = [...DISTRACTORS];
  // OLD decision early; the UPDATE that supersedes it buried mid; hard negatives;
  // a recency distractor reinforcing the OLD choice near the end.
  notes.splice(2, 0, "- event 2: DECISION — auth will use the express-session middleware in server.ts.");
  notes.splice(Math.floor(notes.length / 2), 0, "- event 77: DECISION UPDATE — auth is now centralized in src/lib/authClient; express-session is deprecated, do not use it.");
  notes.splice(Math.floor(notes.length * 0.7), 0, "- event 120: sessionHelper in src/legacy/oldAuth was tidied up (lint only).");
  notes.push("- event 199: reminder — session setup and middleware wiring live in server.ts; check there when adding endpoints.");
  return `You are one of several coding agents. Team coordination history:\n${notes.join("\n")}\n\nTask: add a login handler. Reply with ONLY the module path you will import for authentication.`;
}
function supersedeRoutedPrompt(): string {
  return "You are one of several coding agents.\n📓 Current decision (supersedes earlier notes): auth is centralized in src/lib/authClient; express-session is deprecated.\n\nTask: add a login handler. Reply with ONLY the module path you will import for authentication.";
}
// adhered = chose the CURRENT decision (authClient) and not the superseded/stale one
function adheredSupersede(reply: string): boolean {
  return /authClient/i.test(reply) && !/express-session/i.test(reply);
}

async function runTurn(agentId: string, prompt: string, label = ""): Promise<string> {
  const provider = getProvider(agentId);
  const model = process.env.NP_EVAL_MODEL;
  const args = provider.headlessArgs(prompt, model ? { model } : {});
  const proc = Bun.spawn([provider.bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const reply = provider.parseResult(out).result ?? "";
  try {
    appendFileSync(REPLY_LOG, `\n[${label}] ${JSON.stringify(reply).slice(0, 400)}\n`); // audit trail — inspect raw replies, don't trust the scorer blindly
  } catch {
    /* logging best-effort */
  }
  return reply;
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
  const mode = process.env.NP_EVAL_MODE ?? "all"; // all | positional | supersede | dilution
  const run = (m: string) => mode === "all" || mode === m;
  const positions = ["start", "middle", "end"] as const;
  const dump: Record<string, number> = {};
  let routedHits = 0;
  if (run("positional")) {
    for (const pos of positions) {
      let hits = 0;
      for (let k = 0; k < K; k++) if (adhered(await runTurn(env.agent, dumpPrompt(pos), `pos-${pos}`))) hits++;
      dump[pos] = hits / K;
    }
    for (let k = 0; k < K; k++) if (adhered(await runTurn(env.agent, routedPrompt(), "pos-routed"))) routedHits++;
  }

  // Superseded decision under distraction + recency.
  let ssDump = 0;
  let ssRouted = 0;
  if (run("supersede")) {
    for (let k = 0; k < K; k++) {
      if (adheredSupersede(await runTurn(env.agent, supersedeDumpPrompt(), "ss-dump"))) ssDump++;
      if (adheredSupersede(await runTurn(env.agent, supersedeRoutedPrompt(), "ss-routed"))) ssRouted++;
    }
  }

  // Context dilution: single agent carrying the WHOLE diluted microservices world vs
  // Nerveplane per-repo scope + routed fact — SWEPT across realistic context sizes so
  // the test is fair against a large window. Scoped context is tiny and size-invariant.
  const dilutionSweep: Array<Record<string, number>> = [];
  if (run("dilution")) {
    // Nerveplane scoped condition is size-invariant → measure once.
    const scopedPrompt = dilutionScopedPrompt();
    let dilScoped = 0;
    for (let k = 0; k < K; k++) if (adheredDilution(await runTurn(env.agent, scopedPrompt, "dil-scoped"))) dilScoped++;
    for (const target of DILUTION_SIZES) {
      const single = dilutionSinglePrompt(target);
      const actualTok = approxTokens(single);
      let dilSingle = 0;
      let overflow = 0; // prompt exceeded the model's window (capacity ceiling, distinct from wrong answer)
      for (let k = 0; k < K; k++) {
        const reply = await runTurn(env.agent, single, `dil-single-${target}`);
        if (/too long|exceeds?.{0,20}(context|token|window)|context.{0,15}(limit|window).{0,20}exceed/i.test(reply)) overflow++;
        else if (adheredDilution(reply)) dilSingle++;
      }
      dilutionSweep.push({
        target_tokens: target,
        actual_tokens: actualTok,
        single_agent_correct: dilSingle / K,
        single_agent_overflow: overflow / K, // couldn't fit the window at all
        nerveplane_per_repo_routed: dilScoped / K,
      });
    }
  }

  process.stdout.write(
    "\n## H7 — context adherence (agent=" +
      env.agent +
      (process.env.NP_EVAL_MODEL ? `, model=${process.env.NP_EVAL_MODEL}` : "") +
      `, seeds=${K}) — raw replies logged to ${REPLY_LOG}\n` +
      JSON.stringify(
        {
          positional_recall: { dump_by_position: dump, nerveplane_routed: routedHits / K },
          superseded_decision: { dump: ssDump / K, nerveplane_routed: ssRouted / K },
          context_dilution_sweep: dilutionSweep,
        },
        null,
        2,
      ) +
      "\n\npositional: dump vs routed (frontier models resist the dip). superseded: dump buries the UPDATE with a stale+recent distractor — frontier models can anchor on the wrong one; routed delivers the current decision.\n",
  );
}

if (import.meta.main) await main();
