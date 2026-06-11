// Imported FIRST in index.ts so it evaluates before any module that touches a
// Bun-only API (bun:sqlite, Bun.serve, …). Nerveplane is Bun-native and cannot
// run on plain Node; fail fast with a clear message instead of a cryptic
// "Cannot find module 'bun:sqlite'".
if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
  process.stderr.write("Nerveplane requires the Bun runtime. Install it from https://bun.sh and run again.\n");
  process.exit(1);
}
