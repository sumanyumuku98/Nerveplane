import { startDaemon } from "../daemon/server.ts";
import { api, baseUrl, ensureDaemon } from "../daemon/client.ts";
import { readLiveLock } from "../daemon/lock.ts";
import { runStdioMcp } from "../mcp/stdio.ts";
import { runHook } from "./hook.ts";
import { runSessionStart } from "./session-start.ts";
import { runEvalCli } from "../eval/run.ts";
import { installClaudeCode } from "../install/claude-code.ts";
import { installService, serviceStatus } from "../install/service.ts";
import { DEFAULT_PORT } from "../config.ts";
import pkg from "../../package.json" with { type: "json" };

const HELP = `nerveplane v${pkg.version} — coordination plane for autonomous coding agents

Usage: nerveplane <command> [options]

Daemon:
  daemon                 Run the coordination daemon in the foreground
  status                 Show daemon status and health
  stop                   Stop the running daemon

Setup:
  setup                  One-time machine setup: global hook + instructions, login
                         service, and register this repo (flags: --no-service, --print)
  install claude-code    Install the Claude Code hooks + agent instructions
                         flags: --global (user scope, all repos), --with-mcp, --print
                         (register the MCP server: claude mcp add --scope user nerveplane -- nerveplane mcp)
  init                   Register the current repo (optional — the agent 'register'
                         tool does this automatically; prefer 'nerveplane setup')

Project:
  agents                 List active agents
  events                 Show recent coordination events
  conflicts              List open conflict warnings (resolve/dismiss <id>)
  service scan [path]    Load a services.yaml into the service graph
  service install        Install a login service unit (launchd/systemd) for the daemon
  service uninstall      Remove the daemon service unit
  services               List services and contracts
  dashboard              Open the live web dashboard in your browser
  eval                   Run the deterministic conflict-detection eval

Integration (usually invoked by tools, not humans):
  mcp                    Run the stdio MCP server (spawned by Claude Code/Cursor)
  hook                   PreToolUse hook entrypoint (reads JSON on stdin)
  session-start          SessionStart hook entrypoint — auto-registers the agent

  --help, -h             Show this help
  --version, -v          Show version
`;

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(HELP);
      return 0;

    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`${pkg.version}\n`);
      return 0;

    case "daemon": {
      const handle = await startDaemon(DEFAULT_PORT);
      // Block forever; the signal handlers in startDaemon handle shutdown.
      await new Promise<void>(() => {});
      void handle;
      return 0;
    }

    case "status": {
      const svc = serviceStatus();
      const lock = readLiveLock();
      if (!lock) {
        process.stdout.write("nerveplane: daemon not running\n");
        process.stdout.write(
          svc.installed
            ? "  supervised: yes (login service installed) — it will start on next use\n"
            : "  supervised: no — run `nerveplane service install` to keep it always-on\n",
        );
        return 0;
      }
      const url = baseUrl();
      let health: unknown = null;
      try {
        health = await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })).json();
      } catch {
        /* unreachable despite live lock */
      }
      const uptime = (() => {
        const ms = Date.now() - new Date(lock.startedAt).getTime();
        const m = Math.floor(ms / 60000);
        return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
      })();
      process.stdout.write(
        `nerveplane daemon: running\n  pid:        ${lock.pid}\n  url:        ${url}\n  version:    ${lock.version}\n  uptime:     ${uptime}\n  health:     ${health ? "ok" : "unreachable"}\n  supervised: ${svc.installed ? "yes (login service)" : "no — run `nerveplane service install` to keep it always-on"}\n`,
      );
      return 0;
    }

    case "stop": {
      const lock = readLiveLock();
      if (!lock) {
        process.stdout.write("nerveplane: daemon not running\n");
        return 0;
      }
      process.kill(lock.pid, "SIGTERM");
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && readLiveLock()) await Bun.sleep(100);
      process.stdout.write(readLiveLock() ? "nerveplane: daemon did not stop\n" : "nerveplane: daemon stopped\n");
      return readLiveLock() ? 1 : 0;
    }

    case "mcp":
      await runStdioMcp();
      return 0;

    case "hook":
      return runHook();

    case "session-start":
      return runSessionStart();

    case "setup": {
      const flags = rest;
      const print = flags.includes("--print");
      const noService = flags.includes("--no-service");
      process.stdout.write(print ? "nerveplane setup (dry run):\n" : "nerveplane setup:\n");

      // 1) Daemon up + register this repo.
      if (!print) {
        await ensureDaemon();
        const reg = await api<{ repo: { name: string } }>("POST", "/api/v1/repos/register", { path: process.cwd() });
        process.stdout.write(reg.ok ? `  ✓ registered repo "${reg.data.repo.name}"\n` : "  • repo registration skipped (daemon unreachable)\n");
      }

      // 2) Global Claude Code install (hooks + instructions, user scope).
      const result = installClaudeCode(process.cwd(), { global: true, print });
      const verb = print ? "would write" : "✓ wrote";
      for (const f of result.files) process.stdout.write(`  ${verb} ${f}\n`);

      // 3) Login service (keep the daemon always-on) unless opted out.
      if (noService) {
        process.stdout.write("  • skipped login service (--no-service)\n");
      } else if (print) {
        process.stdout.write("  would install a login service (launchd/systemd)\n");
      } else {
        try {
          const svc = installService();
          process.stdout.write(`  ✓ installed login service: ${svc.path}\n    load it: ${svc.loadCmd}\n`);
        } catch (err) {
          process.stdout.write(`  • login service skipped (${err instanceof Error ? err.message : String(err)}) — run \`nerveplane service install\` later\n`);
        }
      }

      // 4) Next steps.
      process.stdout.write("\nFinish setup:\n");
      const run = `${Bun.which("nerveplane") ?? "nerveplane"} mcp`;
      process.stdout.write(`  1. Register the MCP server (once):  claude mcp add --scope user nerveplane -- ${run}\n`);
      process.stdout.write("  2. Restart Claude Code. New agents auto-register; no per-repo setup needed.\n");
      return 0;
    }

    case "init": {
      await ensureDaemon();
      const res = await api<{ repo: { id: string; name: string; path: string } }>("POST", "/api/v1/repos/register", {
        path: process.cwd(),
      });
      if (!res.ok) {
        process.stdout.write("nerveplane: failed to register repo\n");
        return 1;
      }
      process.stdout.write(
        `nerveplane: registered repo "${res.data.repo.name}" (${res.data.repo.id})\n  path: ${res.data.repo.path}\n` +
          "Note: this is optional — an agent's `register` tool registers the repo automatically.\n" +
          "For full machine setup (global hooks + service), run: nerveplane setup\n",
      );
      return 0;
    }

    case "install": {
      if (rest[0] !== "claude-code") {
        process.stderr.write("usage: nerveplane install claude-code [--global] [--with-mcp] [--print]\n");
        return 1;
      }
      const flags = rest.slice(1);
      const global = flags.includes("--global");
      const result = installClaudeCode(process.cwd(), {
        global,
        withMcp: flags.includes("--with-mcp"),
        print: flags.includes("--print"),
      });
      const verb = flags.includes("--print") ? "would write" : "wrote";
      process.stdout.write(
        flags.includes("--print")
          ? "nerveplane: dry run — no files changed\n"
          : `nerveplane: installed the Claude Code hooks + agent instructions${global ? " (user scope — all repos)" : ""}\n`,
      );
      for (const f of result.files) process.stdout.write(`  ${verb} ${f}\n`);
      for (const n of result.notes) process.stdout.write(`  • ${n}\n`);
      return 0;
    }

    case "agents": {
      const res = await api<{ agents: { id: string; name: string; status: string; branch: string | null; capabilities: string[] }[] }>(
        "GET",
        "/api/v1/agents?includeOffline=true",
      );
      const agents = res.data?.agents ?? [];
      if (agents.length === 0) {
        process.stdout.write("nerveplane: no agents registered\n");
        return 0;
      }
      for (const a of agents) {
        process.stdout.write(`  ${a.status.padEnd(12)} ${a.name.padEnd(20)} ${a.branch ?? "-"}  [${a.capabilities.join(",")}]  ${a.id}\n`);
      }
      return 0;
    }

    case "events": {
      const res = await api<{ events: { type: string; severity: string; summary: string; createdAt: string }[] }>(
        "GET",
        "/api/v1/events?limit=30",
      );
      const events = res.data?.events ?? [];
      if (events.length === 0) {
        process.stdout.write("nerveplane: no events yet\n");
        return 0;
      }
      for (const e of events) {
        process.stdout.write(`  ${e.createdAt}  ${e.severity.padEnd(8)} ${e.type.padEnd(22)} ${e.summary}\n`);
      }
      return 0;
    }

    case "conflicts": {
      const sub = rest[0];
      if (sub === "resolve" || sub === "dismiss") {
        const id = rest[1];
        if (!id) {
          process.stderr.write(`usage: nerveplane conflicts ${sub} <id>\n`);
          return 1;
        }
        const res = await api<{ ok: boolean }>("POST", `/api/v1/conflicts/${id}/${sub}`, {});
        process.stdout.write(res.data?.ok ? `nerveplane: conflict ${sub}d\n` : "nerveplane: conflict not found\n");
        return res.data?.ok ? 0 : 1;
      }
      const res = await api<{ conflicts: { id: string; type: string; severity: string; summary: string; suggestedAction: string | null }[] }>(
        "GET",
        "/api/v1/conflicts?status=open",
      );
      const conflicts = res.data?.conflicts ?? [];
      if (conflicts.length === 0) {
        process.stdout.write("nerveplane: no open conflicts\n");
        return 0;
      }
      for (const w of conflicts) {
        process.stdout.write(`  [${w.severity}] ${w.type.padEnd(13)} ${w.summary}\n        → ${w.suggestedAction ?? ""}  (${w.id})\n`);
      }
      return 0;
    }

    case "service": {
      if (rest[0] === "install") {
        const { installService } = await import("../install/service.ts");
        const r = installService();
        process.stdout.write(`nerveplane: wrote service unit\n  ${r.path}\nLoad it with:\n  ${r.loadCmd}\nRemove with: ${r.unloadHint}\n`);
        return 0;
      }
      if (rest[0] === "uninstall") {
        const { uninstallService } = await import("../install/service.ts");
        const r = uninstallService();
        process.stdout.write(
          r.removed
            ? `nerveplane: removed ${r.path}\nIf it was loaded, stop it with:\n  ${r.stopCmd}\n`
            : "nerveplane: no service unit installed\n",
        );
        return 0;
      }
      if (rest[0] !== "scan") {
        process.stderr.write("usage: nerveplane service <scan [path] | install | uninstall>\n");
        return 1;
      }
      const path = rest[1] ?? `${process.cwd()}/services.yaml`;
      const res = await api<{ ok: boolean; services?: number; contracts?: number; error?: string }>(
        "POST",
        "/api/v1/services/scan",
        { path },
      );
      process.stdout.write(
        res.data?.ok
          ? `nerveplane: loaded ${res.data.services} services, ${res.data.contracts} contracts from ${path}\n`
          : `nerveplane: scan failed — ${res.data?.error ?? "unknown error"}\n`,
      );
      return res.data?.ok ? 0 : 1;
    }

    case "services": {
      const res = await api<{ services: { id: string; name: string }[]; contracts: { name: string; type: string; serviceId: string | null; path: string | null }[] }>(
        "GET",
        "/api/v1/services",
      );
      const svcs = res.data?.services ?? [];
      const contracts = res.data?.contracts ?? [];
      if (svcs.length === 0) {
        process.stdout.write("nerveplane: no services (run `nerveplane service scan`)\n");
        return 0;
      }
      process.stdout.write("services:\n");
      for (const s of svcs) process.stdout.write(`  ${s.name}\n`);
      process.stdout.write("contracts:\n");
      for (const ct of contracts) process.stdout.write(`  ${ct.type.padEnd(9)} ${ct.name.padEnd(20)} ${ct.path ?? ""} (${ct.serviceId})\n`);
      return 0;
    }

    case "dashboard": {
      await ensureDaemon();
      const url = `${baseUrl()}/dashboard`;
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      const { spawn } = await import("node:child_process");
      spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
      process.stdout.write(`nerveplane: dashboard at ${url}\n`);
      return 0;
    }

    case "eval":
      return runEvalCli();

    default:
      process.stderr.write(`nerveplane: unknown command "${cmd}"\n\n${HELP}`);
      void rest;
      return 1;
  }
}
