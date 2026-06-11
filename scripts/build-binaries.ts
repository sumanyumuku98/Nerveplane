// Cross-compiles standalone single-file binaries for all supported platforms.
// Run via `bun run build:binaries` (which builds the dashboard first).
const TARGETS = [
  { name: "darwin-arm64", target: "bun-darwin-arm64", ext: "" },
  { name: "darwin-x64", target: "bun-darwin-x64", ext: "" },
  { name: "linux-x64", target: "bun-linux-x64", ext: "" },
  { name: "linux-arm64", target: "bun-linux-arm64", ext: "" },
  { name: "windows-x64", target: "bun-windows-x64", ext: ".exe" },
] as const;

for (const t of TARGETS) {
  const outfile = `dist/nerveplane-${t.name}${t.ext}`;
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
