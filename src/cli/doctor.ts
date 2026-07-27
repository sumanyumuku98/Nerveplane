import { getProvider, listProviders, DEFAULT_AGENT } from "../agents/index.ts";
import { ensureDaemon } from "../daemon/client.ts";

/**
 * `nerveplane doctor` — provider status surface. Shows which CLI agents are
 * installed, whether the nerveplane MCP server is registered in each one's
 * config, and (with --run) does a one-turn live smoke to prove MCP connectivity.
 */
export async function runDoctor(opts: { agent?: string; run?: boolean } = {}): Promise<number> {
  let providers;
  try {
    providers = opts.agent ? [getProvider(opts.agent)] : listProviders();
  } catch (e) {
    process.stderr.write(`nerveplane doctor: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  process.stdout.write("nerveplane providers:\n");
  process.stdout.write(`  ${"agent".padEnd(10)} ${"installed".padEnd(10)} ${"mcp".padEnd(6)} ${"hooks".padEnd(6)} default  instructions\n`);
  for (const p of providers) {
    const mcp = p.mcpConfigStatus();
    process.stdout.write(
      `  ${p.id.padEnd(10)} ${(p.detect() ? "yes" : "—").padEnd(10)} ${(mcp.registered ? "yes" : "—").padEnd(6)} ${(p.capabilities.hooks ? "yes" : "—").padEnd(6)} ${(p.id === DEFAULT_AGENT ? "*" : " ").padEnd(8)} ${p.instructionsFilename}\n`,
    );
    if (!mcp.registered) process.stdout.write(`             ↳ MCP not registered — run 'nerveplane install ${p.id}' (config: ${mcp.path})\n`);
  }

  if (!opts.run) return 0;

  if (!opts.agent) {
    process.stderr.write("\n--run needs --agent <id> (which CLI to smoke-test)\n");
    return 1;
  }
  const p = getProvider(opts.agent);
  if (!p.detect()) {
    process.stderr.write(`\n${p.label} ('${p.bin}') is not on PATH — install it first.\n`);
    return 1;
  }
  process.stdout.write(`\nLive smoke via ${p.label} (one headless turn calling the nerveplane 'discover' tool)…\n`);
  await ensureDaemon();
  const prompt = "Use the nerveplane MCP tool `discover` (no arguments) to list agents, then reply with exactly: FOUND <n> where <n> is how many it returned.";
  const t0 = Date.now();
  const proc = Bun.spawn([p.bin, ...p.headlessArgs(prompt, {})], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  const { result } = p.parseResult(out);
  const ok = code === 0 && (result ?? "").includes("FOUND");
  process.stdout.write(`  ${ok ? "✅ pass" : "❌ fail"} (${Date.now() - t0}ms, exit ${code}) — ${(result ?? "(no result)").slice(0, 100)}\n`);
  if (!ok && err.trim()) process.stdout.write(`  stderr: ${err.slice(0, 300).replace(/\n/g, " ")}\n`);
  return ok ? 0 : 1;
}
