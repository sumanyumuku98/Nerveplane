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
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { getProvider, listProviders } from "../../src/agents/index.ts";
import { remember, recall } from "../../src/core/memory.ts";
import { initBenchDb } from "./harness.ts";

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

// --- Memory-continuity experiment (SUM-152, S2.1) ---
// The paper's "capability-independent" result: no model, however strong, can
// recall a PROJECT-SPECIFIC gotcha it was never told. A prior agent (session 1)
// discovered the convention and recorded it with the REAL memory primitive; a
// fresh later agent (session 2) either has that memory recalled into its context
// (C1) or not (C0). C0 and C1 differ ONLY in whether the recalled lesson is
// present — so any C1>C0 lift is attributable to memory, not model strength.

// GROUND-TRUTH SANDBOX (fixes the validity bug from the first keyed run): a
// tool-enabled agent fact-checks a recalled note against the repo it's in. So we
// run session 2 INSIDE an isolated repo that genuinely contains TWO working auth
// modules — `src/lib/authClient.ts` (getAuth) and `src/legacy/expressSession.ts`
// (session middleware). Both are real and importable, so the recalled note is
// verifiably true. Which one is *canonical* is a TEAM DECISION that is NOT
// derivable from the code alone — that decision is exactly what memory carries.
// C0 (no memory) must guess between two legitimate options; C1 (recall) knows.
// The sandbox holds TWO auth backends that are DELIBERATELY SYMMETRIC in code —
// same exported name, same shape, equally-plausible neutral doc comments, no
// "canonical"/"legacy"/"deprecated" hint anywhere. So the correct choice is NOT
// derivable by reading the repo (a strong tool-using agent can't reverse-engineer
// a team decision that was never written down). The ONLY signal is the recalled
// decision. This is what makes the result capability-independent.
const CONTINUITY_LESSON =
  "Decision from a prior session: for new endpoints, auth must use `getAuth` from 'src/auth/edgeAuth'. We migrated OFF 'src/auth/sessionAuth' because its server-side sessions broke our edge deploys. Both modules still exist and compile; edgeAuth is the sanctioned one.";
const CONTINUITY_TASK =
  "Task: add a login endpoint. This repo has more than one auth backend — inspect the code, then reply with ONLY the single `import` line you would use for authentication.";

/** Build an isolated repo with two SYMMETRIC, equally-valid auth backends. Which
 *  one is sanctioned is a team decision that appears NOWHERE in the code — only
 *  in memory. Returns the repo path. */
function buildContinuitySandbox(): string {
  const repo = mkdtempSync(join(tmpdir(), "np-continuity-"));
  const write = (rel: string, body: string) => {
    const p = join(repo, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  // Symmetric: same export (`getAuth`), neutral descriptive comments, no hint of
  // which is preferred. edgeAuth = token-based; sessionAuth = server sessions.
  write("src/auth/edgeAuth.ts", "// Auth backend: stateless edge tokens.\nexport interface AuthCtx { userId: string }\nexport function getAuth(): AuthCtx { return { userId: '' }; }\n");
  write("src/auth/sessionAuth.ts", "// Auth backend: server-side sessions.\nexport interface AuthCtx { userId: string }\nexport function getAuth(): AuthCtx { return { userId: '' }; }\n");
  write("README.md", "# app\n\nAuth backends (both supported):\n- `src/auth/edgeAuth.ts` — `getAuth()`\n- `src/auth/sessionAuth.ts` — `getAuth()`\n\nAdd new endpoints under `src/routes/`.\n");
  write("src/routes/.gitkeep", "");
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  Bun.spawnSync(["git", "add", "-A"], { cwd: repo });
  Bun.spawnSync(["git", "-c", "user.email=b@np.dev", "-c", "user.name=b", "commit", "-q", "-m", "base"], { cwd: repo });
  return repo;
}

// C0: the task alone, with no access to the prior session's decision.
function continuityNoMemPrompt(): string {
  return `You are a coding agent picking up work in an existing repo.\n\n${CONTINUITY_TASK}`;
}
// C1: the recalled decision routed in, mirroring routedPrompt()'s 📓 shape.
function continuityRecalledPrompt(recalled: string): string {
  return `You are a coding agent picking up work in an existing repo.\n📓 Recalled from a previous session: ${recalled}\n\n${CONTINUITY_TASK}`;
}
// Adherence = the chosen IMPORT targets the sanctioned backend (edgeAuth), not
// sessionAuth. Score ONLY the actual `import ... from '...'` line(s), never prose
// mentions (a correct reply may *name* sessionAuth to say it's avoiding it).
function adheredContinuity(reply: string): boolean {
  const imports = reply.match(/import[^;\n]*from\s*['"][^'"]+['"]/gi) ?? [];
  if (imports.length === 0) return false; // no import line → didn't commit to a choice
  const choseEdge = imports.some((l) => /edgeAuth/i.test(l));
  const choseSession = imports.some((l) => /sessionAuth/i.test(l));
  return choseEdge && !choseSession;
}

async function runTurn(agentId: string, prompt: string, label = "", cwd?: string): Promise<string> {
  const provider = getProvider(agentId);
  const model = process.env.NP_EVAL_MODEL;
  const args = provider.headlessArgs(prompt, model ? { model } : {});
  // `cwd` sandboxes a tool-enabled agent to a specific repo so its fact-checking
  // sees the intended ground truth (used by the memory-continuity experiment).
  const proc = Bun.spawn([provider.bin, ...args], { stdout: "pipe", stderr: "pipe", ...(cwd ? { cwd } : {}) });
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
        "Experiments (select via NP_EVAL_MODE=all|positional|supersede|dilution|continuity):",
        "  (1) outcome-lift on the Tier-A scenarios with real agents (C0 vs C1);",
        "  (2) lost-in-the-middle — critical-fact adherence vs. position (dump) vs. routed (Nerveplane);",
        "  (3) memory-continuity — a prior session records a project gotcha via the real",
        "      remember()/recall() primitives (isolated bench DB); a fresh session repeats the",
        "      mistake without it (C0) but avoids it when recalled (C1). Capability-independent.",
        "Run K≥5 seeds; append mean ± CI to results.md. Not a CI gate (costs money, nondeterministic).",
      ].join("\n") + "\n",
    );
    return;
  }

  const K = Number(process.env.NP_EVAL_SEEDS ?? 5);
  const mode = process.env.NP_EVAL_MODE ?? "all"; // all | positional | supersede | dilution | continuity
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

  // Memory continuity: a prior agent (session 1) records a project-specific
  // gotcha with the REAL remember() primitive into an ISOLATED bench DB; a fresh
  // later agent (session 2) either has it recall()'d into context (C1) or not
  // (C0). Capability-independent: C0/C1 differ ONLY in the recalled lesson.
  let contMistakeC0 = NaN;
  let contMistakeC1 = NaN;
  let contRecalled = "";
  if (run("continuity")) {
    initBenchDb(); // isolated throwaway SQLite — NEVER the user's real memory store
    const repoId = "bench-repo";
    // Ground-truth sandbox: both auth modules exist, so the agent runs INSIDE it
    // and can verify the recalled decision (the canonical choice isn't in code).
    const sandbox = buildContinuitySandbox();
    // Session 1: the prior agent records the team decision with the real primitive.
    await remember({
      kind: "episode",
      title: "auth convention: standardized on getAuth from authClient (legacy expressSession deprecated)",
      body: CONTINUITY_LESSON,
      tags: ["auth", "convention", "decision"],
      repoId,
      authorAgentId: "session1-agent",
    });
    // Session 2, C0 (no continuity): the decision was never available to this session.
    let c0Adhere = 0;
    for (let k = 0; k < K; k++) if (adheredContinuity(await runTurn(env.agent, continuityNoMemPrompt(), "cont-c0", sandbox))) c0Adhere++;
    // Session 2, C1 (continuity): recall the top hit from the bench DB and route it in.
    const hits = await recall("login endpoint auth import convention", { repoId }, { limit: 1 });
    contRecalled = hits[0]?.body ?? "";
    let c1Adhere = 0;
    const c1Prompt = continuityRecalledPrompt(contRecalled);
    for (let k = 0; k < K; k++) if (adheredContinuity(await runTurn(env.agent, c1Prompt, "cont-c1", sandbox))) c1Adhere++;
    contMistakeC0 = 1 - c0Adhere / K; // repeated-mistake rate = 1 − adherence
    contMistakeC1 = 1 - c1Adhere / K;
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
          memory_continuity: {
            repeated_mistake_rate_c0_no_memory: contMistakeC0,
            repeated_mistake_rate_c1_recalled: contMistakeC1,
            recalled_lesson_present: contRecalled.length > 0,
          },
        },
        null,
        2,
      ) +
      "\n\npositional: dump vs routed (frontier models resist the dip). superseded: dump buries the UPDATE with a stale+recent distractor — frontier models can anchor on the wrong one; routed delivers the current decision. continuity: C0 (no memory) repeats the mistake a prior session already discovered; C1 recalls that session's episode via the real remember/recall primitives — capability-independent, since C0/C1 differ only in the recalled lesson.\n",
  );
}

if (import.meta.main) await main();
