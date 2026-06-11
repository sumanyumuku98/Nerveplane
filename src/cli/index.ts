import { startDaemon } from "../daemon/server.ts";
import { api, baseUrl, ensureDaemon } from "../daemon/client.ts";
import { readLiveLock } from "../daemon/lock.ts";
import { DEFAULT_PORT } from "../config.ts";
import pkg from "../../package.json" with { type: "json" };

const HELP = `nerveplane v${pkg.version} — coordination plane for autonomous coding agents

Usage: nerveplane <command> [options]

Daemon:
  daemon                 Run the coordination daemon in the foreground
  status                 Show daemon status and health
  stop                   Stop the running daemon

Project:
  init                   Ensure the daemon is running (repo registration: M1)

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

    case "init": {
      await ensureDaemon();
      const res = await api("GET", "/health");
      process.stdout.write(
        res.ok
          ? "nerveplane: daemon ready (repo registration lands in M1)\n"
          : "nerveplane: failed to reach daemon\n",
      );
      return res.ok ? 0 : 1;
    }

    default:
      process.stderr.write(`nerveplane: unknown command "${cmd}"\n\n${HELP}`);
      void rest;
      return 1;
  }
}
