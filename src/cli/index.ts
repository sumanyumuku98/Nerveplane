import { startDaemon } from "../daemon/server.ts";
import { api, baseUrl, ensureDaemon } from "../daemon/client.ts";
import { readLiveLock } from "../daemon/lock.ts";
import { runStdioMcp } from "../mcp/stdio.ts";
import { runHook } from "./hook.ts";
import { installClaudeCode } from "../install/claude-code.ts";
import { DEFAULT_PORT } from "../config.ts";
import pkg from "../../package.json" with { type: "json" };

const HELP = `nerveplane v${pkg.version} — coordination plane for autonomous coding agents

Usage: nerveplane <command> [options]

Daemon:
  daemon                 Run the coordination daemon in the foreground
  status                 Show daemon status and health
  stop                   Stop the running daemon

Project:
  init                   Register the current repo with the daemon
  install claude-code    Wire Claude Code into Nerveplane (.mcp.json + hook)
  agents                 List active agents
  events                 Show recent coordination events

Integration (usually invoked by tools, not humans):
  mcp                    Run the stdio MCP server (spawned by Claude Code/Cursor)
  hook                   PreToolUse hook entrypoint (reads JSON on stdin)

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
      const lock = readLiveLock();
      if (!lock) {
        process.stdout.write("nerveplane: daemon not running\n");
        return 0;
      }
      const url = baseUrl();
      let health: unknown = null;
      try {
        health = await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })).json();
      } catch {
        /* unreachable despite live lock */
      }
      process.stdout.write(
        `nerveplane daemon: running\n  pid:     ${lock.pid}\n  url:     ${url}\n  started: ${lock.startedAt}\n  health:  ${health ? "ok" : "unreachable"}\n`,
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
        `nerveplane: registered repo "${res.data.repo.name}" (${res.data.repo.id})\n  path: ${res.data.repo.path}\nNext: nerveplane install claude-code\n`,
      );
      return 0;
    }

    case "install": {
      const target = rest[0];
      if (target !== "claude-code") {
        process.stderr.write("usage: nerveplane install claude-code\n");
        return 1;
      }
      const result = installClaudeCode(process.cwd());
      process.stdout.write("nerveplane: installed Claude Code integration\n");
      for (const f of result.files) process.stdout.write(`  wrote ${f}\n`);
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

    default:
      process.stderr.write(`nerveplane: unknown command "${cmd}"\n\n${HELP}`);
      void rest;
      return 1;
  }
}
