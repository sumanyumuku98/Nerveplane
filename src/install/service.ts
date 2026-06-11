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

export interface ServiceResult {
  path: string;
  loadCmd: string;
  unloadHint: string;
}

const macPlistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const systemdPath = () => join(homedir(), ".config", "systemd", "user", "nerveplane.service");

/** Install a login service that keeps `nerveplane daemon` running. */
export function installService(): ServiceResult {
  const { program, args } = daemonCommand();
  const home = join(homedir(), ".nerveplane");
  mkdirSync(home, { recursive: true });

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
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
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
