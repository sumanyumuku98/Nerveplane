// Cross-compiles standalone single-file binaries for the supported platforms
// (macOS arm64/x64 + Linux x64). Run via `bun run build:binaries` (which builds
// the dashboard first). Windows / extra arches are deferred.
const TARGETS = [
  { name: "darwin-arm64", target: "bun-darwin-arm64" },
  { name: "darwin-x64", target: "bun-darwin-x64" },
  { name: "linux-x64", target: "bun-linux-x64" },
] as const;

for (const t of TARGETS) {
  const outfile = `dist/nerveplane-${t.name}`;
  console.log(`building ${outfile} (${t.target})…`);
  const r = Bun.spawnSync(
    ["bun", "build", "--compile", `--target=${t.target}`, "src/index.ts", "--outfile", outfile],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (r.exitCode !== 0) {
    console.error(`failed to build ${outfile}`);
    process.exit(r.exitCode ?? 1);
  }
}
console.log("✓ all binaries built in dist/");
