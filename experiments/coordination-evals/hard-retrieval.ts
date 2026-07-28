/**
 * H8 — HARD compositional retrieval under dilution (Tier B, live agents).
 * See HARD-RETRIEVAL.md for the full design. The single-lookup dilution sweep
 * (results.md) showed no accuracy gap because the needle was lexically salient.
 * This task removes that crutch: the answer is a JOIN of ≥3 facts at different
 * depths, with LOW lexical overlap to the query, where the authoritative fact is
 * chosen by a RULE (not a "CURRENT" label) — the regime where big contexts rot.
 *
 *   bun run experiments/coordination-evals/hard-retrieval.ts --selftest   # no keys
 *   NP_EVAL_AGENT=claude NP_EVAL_SEEDS=5 bun run .../hard-retrieval.ts     # live
 *
 * Env-gated; prints a runbook and exits 0 if no agent/key. Structured scoring +
 * raw-reply logging; per-hop + per-trap breakdown so we can localise failures and
 * never trust the scorer blindly. C_routed doubles as the solvability gate.
 */
import { appendFileSync } from "node:fs";
import { getProvider, listProviders } from "../../src/agents/index.ts";

const REPLY_LOG = process.env.NP_EVAL_LOG ?? "/tmp/np-hard-replies.log";
// Sizes chosen to FIT both models' windows (~1.4× real tokens vs this char/4
// estimate) so an accuracy gap isn't confounded by overflow (characterised
// separately in results.md). Override with NP_EVAL_DILUTION_TOKENS.
const SIZES = process.env.NP_EVAL_DILUTION_TOKENS
  ? [Number(process.env.NP_EVAL_DILUTION_TOKENS)]
  : [10_000, 50_000, 100_000];
const approxTokens = (s: string) => Math.round(s.length / 4);

// --- seeded RNG so each seed randomises the answer (no priors/memorisation) ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(arr: T[], r: () => number): T => arr[Math.floor(r() * arr.length)];

const FIELDS = ["total", "grandTotal", "amountDue", "netPayable", "balanceOwed"];
const REGIONS = ["emea-2", "apac-5", "amer-9", "emea-7", "apac-3", "latam-1"];
const CURRENCIES = ["EUR", "JPY", "USD", "GBP", "SGD", "BRL"];

interface HardCase {
  seed: number;
  acctId: string;
  region: string;
  field: string; // authoritative contract's monetary field (answer hop A)
  currency: string; // fx[region] current (answer hops B+C)
  retiredField: string; // A-trap
  reportField: string; // A-trap #2
  staleCurrency: string; // C-trap
}

function makeCase(seed: number): HardCase {
  const r = mulberry32(seed + 1);
  const field = pick(FIELDS, r);
  const retiredField = pick(FIELDS.filter((f) => f !== field), r);
  const reportField = pick(FIELDS.filter((f) => f !== field && f !== retiredField), r);
  const region = pick(REGIONS, r);
  const currency = pick(CURRENCIES, r);
  const staleCurrency = pick(CURRENCIES.filter((c) => c !== currency), r);
  const acctId = `acct_${4000 + Math.floor(r() * 5000)}`;
  return { seed, acctId, region, field, currency, retiredField, reportField, staleCurrency };
}

// realistic-looking filler service code, sized to a char budget
function fillerBlock(svc: string, i: number): string {
  return (
    `export interface ${svc}Config${i} { id: string; enabled: boolean; retries: number; timeoutMs: number }\n` +
    `export function handle_${svc}_${i}(req: { id: string; payload: unknown }): { ok: boolean; id: string } {\n` +
    `  // ${svc}: validate, process with backoff, and enqueue for downstream delivery (idempotent by id)\n` +
    `  const ok = typeof req.id === 'string' && req.id.length > 0;\n  return { ok, id: req.id };\n}\n` +
    `// ${svc} step ${i}: retries use exponential backoff; see runbook for on-call escalation and SLOs.\n`
  );
}

/** The needles (each buried at a different depth), phrased with LOW lexical
 *  overlap to the query. `rev` values randomised per seed but preserving
 *  "highest-active == payments". */
function needles(c: HardCase, r: () => number) {
  const base = 3 + Math.floor(r() * 5);
  const paymentsRev = base + 2; // highest ACTIVE
  const reportingRev = base; // active, lower
  const billingRev = base + 4; // higher, but RETIRED (A-trap)
  return {
    rule:
      "=== repo: platform-schemas / SCHEMA-POLICY.md ===\n" +
      "Contract selection policy: the live schema for any domain is the `@contract` block with the greatest `rev` whose `state` is `active`. Blocks with `state: retired` are historical snapshots and MUST be ignored when picking the live shape.\n",
    payments:
      `=== repo: payments-svc / invoice.ts ===\n// @contract rev: ${paymentsRev}, state: active\n` +
      `export interface Invoice { id: string; ${c.field}: number; issuedAt: string }\n`,
    billing:
      `=== repo: billing-legacy / oldInvoice.ts ===\n// @contract rev: ${billingRev}, state: retired\n` +
      `export interface ArchivedInvoice { id: string; ${c.retiredField}: number; closedAt: string }\n`,
    reporting:
      `=== repo: reporting-svc / rollup.ts ===\n// @contract rev: ${reportingRev}, state: active\n` +
      `export interface InvoiceRollup { id: string; ${c.reportField}: number; period: string }\n`,
    accounts:
      "=== repo: users-svc / accounts.ts ===\nexport const ACCOUNTS = {\n" +
      REGIONS.map((rg, i) => `  acct_${4100 + i * 11}: { billingRegion: '${rg}', tier: 'std' },`).join("\n") +
      `\n  ${c.acctId}: { billingRegion: '${c.region}', tier: 'ent' },\n};\n`,
    fxCurrent:
      "=== repo: fx-config / rates.current.ts ===\n// ACTIVE region→settlement-currency table\nexport const SETTLEMENT = {\n" +
      REGIONS.map((rg) => `  '${rg}': '${rg === c.region ? c.currency : pick(CURRENCIES, r)}',`).join("\n") +
      "\n};\n",
    fxStale:
      "=== repo: fx-config / rates.2019.ts ===\n// DEPRECATED historical table — retained for audit only, do not use for live billing\nexport const SETTLEMENT_2019 = {\n" +
      `  '${c.region}': '${c.staleCurrency}',\n};\n`,
  };
}

const TASK = (acctId: string) =>
  `Task (in orders-svc): for account ${acctId}, render the invoice's monetary amount in that account's billing settlement currency. ` +
  `Reply with ONLY a JSON object {"field":"…","currency":"…"} where "field" is the monetary field name on the AUTHORITATIVE LIVE invoice contract (per the platform contract-selection policy) and "currency" is the ISO code that account settles in. No prose, no code fences.`;

/** Build the single-agent diluted world (~targetTokens) with all needles buried. */
function singlePrompt(c: HardCase, targetTokens: number): string {
  const r = mulberry32(c.seed + 777);
  const n = needles(c, r);
  const budget = targetTokens * 4;
  const fillerSvcs = ["notifications", "search", "inventory", "shipping", "catalog", "fraud", "audit", "email"];
  const blocks: string[] = [];
  let used = 0;
  let i = 0;
  while (used < budget) {
    const svc = fillerSvcs[i % fillerSvcs.length];
    const b = `=== repo: ${svc}-svc / module ${i} ===\n// ${svc}-svc module ${i}\n${fillerBlock(svc, i)}`;
    blocks.push(b);
    used += b.length;
    i++;
  }
  const at = (f: number) => Math.max(0, Math.min(blocks.length, Math.floor(blocks.length * f)));
  // spread needles across depths (splice from the end so earlier indices stay valid)
  const inserts: Array<[number, string]> = [
    [0.15, n.billing], // A-trap early
    [0.2, n.rule],
    [0.3, n.fxStale], // C-trap
    [0.4, n.accounts],
    [0.55, n.payments], // authoritative, mid
    [0.65, n.fxCurrent],
    [0.75, n.reporting],
  ];
  for (const [f, text] of inserts.sort((a, b) => b[0] - a[0])) blocks.splice(at(f), 0, text);
  return `You are a single agent responsible for the WHOLE microservices system. Here are all the service codebases and policies:\n${blocks.join("\n")}\n\n${TASK(c.acctId)}`;
}

/** C_routed / oracle: the three pre-joined facts, size-invariant (~hundreds of tokens). */
function routedPrompt(c: HardCase): string {
  return (
    "You are the orders-svc agent (Nerveplane scoped you to your repo and routed the joined cross-repo facts).\n" +
    `📓 Routed: the authoritative live invoice contract is payments-svc (active, highest rev); its monetary field is \`${c.field}\`.\n` +
    `📓 Routed: account ${c.acctId} settles in region ${c.region}, whose current settlement currency is ${c.currency}.\n\n` +
    TASK(c.acctId)
  );
}

function parseAnswer(reply: string): { field: string; currency: string } | null {
  const m = reply.match(/\{[^{}]*"field"[^{}]*\}/i) ?? reply.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    return { field: String(o.field ?? "").toLowerCase(), currency: String(o.currency ?? "").toUpperCase() };
  } catch {
    return null;
  }
}

interface Score {
  field: boolean;
  currency: boolean;
  both: boolean;
  choseRetired: boolean;
  choseReport: boolean;
  staleFx: boolean;
  parsed: boolean;
}
function score(reply: string, c: HardCase): Score {
  const a = parseAnswer(reply);
  const field = !!a && a.field === c.field.toLowerCase();
  const currency = !!a && a.currency === c.currency;
  return {
    parsed: !!a,
    field,
    currency,
    both: field && currency,
    choseRetired: !!a && a.field === c.retiredField.toLowerCase(),
    choseReport: !!a && a.field === c.reportField.toLowerCase(),
    staleFx: !!a && a.currency === c.staleCurrency,
  };
}

function requireLiveEnv(): { agent: string } | null {
  const agent = process.env.NP_EVAL_AGENT ?? "";
  const provider = agent ? listProviders().find((p) => p.id === agent) : undefined;
  const ready = provider?.detect() && (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || agent === "claude");
  return ready ? { agent } : null;
}

async function runTurn(agentId: string, prompt: string, label: string): Promise<string> {
  const provider = getProvider(agentId);
  const model = process.env.NP_EVAL_MODEL;
  const args = provider.headlessArgs(prompt, model ? { model } : {});
  const proc = Bun.spawn([provider.bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const reply = provider.parseResult(out).result ?? "";
  try {
    appendFileSync(REPLY_LOG, `\n[${label}] ${JSON.stringify(reply).slice(0, 600)}\n`);
  } catch {
    /* best-effort */
  }
  return reply;
}

function selftest(): void {
  let ok = true;
  const say = (cond: boolean, msg: string) => {
    if (!cond) ok = false;
    console.log(`${cond ? "✓" : "✗"} ${msg}`);
  };
  // randomisation: distinct seeds give distinct answers often
  const answers = new Set<string>();
  for (let s = 0; s < 8; s++) {
    const c = makeCase(s);
    answers.add(`${c.field}/${c.currency}`);
  }
  say(answers.size >= 5, `per-seed randomisation produces varied answers (${answers.size}/8 distinct)`);
  for (const t of SIZES) {
    const c = makeCase(0);
    const p = singlePrompt(c, t);
    const tok = approxTokens(p);
    const payAt = (p.indexOf("state: active\nexport interface Invoice") / p.length).toFixed(2);
    // solvability: every needed fact is present and the correct answer is derivable
    const hasField = new RegExp(`interface Invoice \\{ id: string; ${c.field}:`).test(p);
    const hasRegion = new RegExp(`${c.acctId}: \\{ billingRegion: '${c.region}'`).test(p);
    const hasCurrency = p.includes(`'${c.region}': '${c.currency}'`);
    const hasRule = p.includes("greatest `rev` whose `state` is `active`");
    const hasTraps = p.includes("state: retired") && p.includes("DEPRECATED historical table");
    say(Math.abs(tok - t) / t < 0.15, `size ${t}: actual ~${tok}tok (payments buried @${payAt})`);
    say(hasField && hasRegion && hasCurrency && hasRule && hasTraps, `size ${t}: all needles + traps present, answer derivable`);
  }
  const r0 = routedPrompt(makeCase(0));
  say(approxTokens(r0) < 400, `routed/oracle context is tiny (~${approxTokens(r0)}tok, size-invariant)`);
  // scorer sanity
  const c = makeCase(3);
  say(score(`{"field":"${c.field}","currency":"${c.currency}"}`, c).both, "scorer accepts the correct join");
  say(!score(`{"field":"${c.retiredField}","currency":"${c.currency}"}`, c).both, "scorer rejects the A-trap (retired field)");
  say(!score(`{"field":"${c.field}","currency":"${c.staleCurrency}"}`, c).both, "scorer rejects the C-trap (stale fx)");
  console.log(ok ? "\nSELFTEST OK" : "\nSELFTEST FAILED");
  if (!ok) process.exit(1);
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  const env = requireLiveEnv();
  if (!env) {
    process.stdout.write(
      [
        "H8 hard-retrieval needs a real agent + key. Runbook:",
        "  export NP_EVAL_AGENT=claude|codex|opencode   (+ ANTHROPIC_API_KEY / logged-in Claude CLI)",
        "  bun run experiments/coordination-evals/hard-retrieval.ts --selftest   # deterministic check, no keys",
        "  NP_EVAL_AGENT=claude NP_EVAL_SEEDS=5 bun run experiments/coordination-evals/hard-retrieval.ts",
        "",
        "Tests whether context engineering rescues ACCURACY on a hard compositional",
        "join (not just cost/capacity). C_routed doubles as the solvability gate.",
      ].join("\n") + "\n",
    );
    return;
  }
  const K = Number(process.env.NP_EVAL_SEEDS ?? 5);
  const agg = (arr: Score[], key: keyof Score) => arr.filter((s) => s[key]).length / arr.length;

  // C_routed / oracle (size-invariant) — the solvability gate.
  const routedScores: Score[] = [];
  for (let k = 0; k < K; k++) {
    const c = makeCase(k);
    routedScores.push(score(await runTurn(env.agent, routedPrompt(c), `routed-s${k}`), c));
  }

  const sweep: Array<Record<string, number>> = [];
  for (const target of SIZES) {
    const scores: Score[] = [];
    let sampleTok = 0;
    for (let k = 0; k < K; k++) {
      const c = makeCase(k);
      const p = singlePrompt(c, target);
      sampleTok = approxTokens(p);
      scores.push(score(await runTurn(env.agent, p, `single-${target}-s${k}`), c));
    }
    sweep.push({
      target_tokens: target,
      actual_tokens: sampleTok,
      both_correct: agg(scores, "both"),
      field_correct: agg(scores, "field"),
      currency_correct: agg(scores, "currency"),
      chose_retired: agg(scores, "choseRetired"),
      stale_fx: agg(scores, "staleFx"),
      parse_fail: 1 - agg(scores, "parsed"),
    });
  }

  process.stdout.write(
    `\n## H8 — hard compositional retrieval (agent=${env.agent}` +
      (process.env.NP_EVAL_MODEL ? `, model=${process.env.NP_EVAL_MODEL}` : "") +
      `, seeds=${K}) — raw replies: ${REPLY_LOG}\n` +
      JSON.stringify(
        {
          routed_oracle: {
            both_correct: agg(routedScores, "both"),
            field_correct: agg(routedScores, "field"),
            currency_correct: agg(routedScores, "currency"),
            note: "solvability gate — must be ~1.0 to interpret the single-agent sweep",
          },
          single_agent_sweep: sweep,
        },
        null,
        2,
      ) +
      "\n",
  );
}

if (import.meta.main) await main();
