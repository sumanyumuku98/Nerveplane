import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
const LABEL = "dev.nerveplane.daemon";

/** Resolve how to launch the daemon for a service unit (installed binary preferred). */
function daemonCommand(): { program: string; args: string[] } {
  const onPath = Bun.which("nerveplane");
  if (onPath) return { program: onPath, args: ["daemon"] };
  const isBun = /bun(\.exe)?$/.test(basename(process.execPath));
  return isBun
    ? { program: process.execPath, args: ["run", ENTRY, "daemon"] }
    : { program: process.execPath, args: ["daemon"] };
}

/**
 * PATH for the service unit. launchd/systemd run with a minimal PATH, but the
 * npm `nerveplane` is a `#!/usr/bin/env bun` shim — without the Bun runtime dir
 * on PATH it fails with exit 127 (`env: bun: No such file or directory`). We
 * front-load the Bun runtime dir and the launcher's own dir, then the usual
 * locations and the install-time PATH, so the unit works for npm/Bun installs.
 */
export function servicePath(program: string): string {
  const parts = [
    dirname(process.execPath), // the Bun (or Node) runtime dir — resolves the shebang
    dirname(program), // the nerveplane bin dir
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    ...(process.env.PATH ? process.env.PATH.split(":") : []),
  ];
  return [...new Set(parts.filter(Boolean))].join(":");
}

export interface ServiceResult {
  path: string;
  loadCmd: string;
  unloadHint: string;
}

const macPlistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const systemdPath = () => join(homedir(), ".config", "systemd", "user", "nerveplane.service");

/** Whether a login service unit (launchd/systemd) is installed for the daemon. */
export function serviceStatus(): { installed: boolean; path: string } {
  const path = platform() === "darwin" ? macPlistPath() : systemdPath();
  return { installed: existsSync(path), path };
}

/** Install a login service that keeps `nerveplane daemon` running. */
export function installService(): ServiceResult {
  const { program, args } = daemonCommand();
  const home = join(homedir(), ".nerveplane");
  mkdirSync(home, { recursive: true });
  const pathEnv = servicePath(program);

  if (platform() === "darwin") {
    const path = macPlistPath();
    mkdirSync(dirname(path), { recursive: true });
    const argXml = [program, ...args].map((a) => `    <string>${a}</string>`).join("\n");
    writeFileSync(
      path,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${pathEnv}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
    <key>Crashed</key><true/>
  </dict>
  <key>StandardOutPath</key><string>${join(home, "daemon.out.log")}</string>
  <key>StandardErrorPath</key><string>${join(home, "daemon.err.log")}</string>
</dict>
</plist>
`,
    );
    return { path, loadCmd: `launchctl bootstrap gui/$(id -u) "${path}"`, unloadHint: "nerveplane service uninstall" };
  }

  // Linux: systemd user unit.
  const path = systemdPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `[Unit]
Description=Nerveplane coordination daemon
After=network.target

[Service]
Environment=PATH=${pathEnv}
ExecStart=${[program, ...args].join(" ")}
Restart=on-failure

[Install]
WantedBy=default.target
`,
  );
  return { path, loadCmd: "systemctl --user enable --now nerveplane", unloadHint: "nerveplane service uninstall" };
}

export function uninstallService(): { path: string; removed: boolean; stopCmd: string } {
  const path = platform() === "darwin" ? macPlistPath() : systemdPath();
  const removed = existsSync(path);
  const stopCmd =
    platform() === "darwin" ? `launchctl bootout gui/$(id -u) "${path}"` : "systemctl --user disable --now nerveplane";
  if (removed) rmSync(path, { force: true });
  return { path, removed, stopCmd };
}
