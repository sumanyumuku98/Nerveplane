#!/usr/bin/env bun
import "./bun-guard.ts"; // must be first — exits cleanly if not running under Bun
import { runCli } from "./cli/index.ts";

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`nerveplane: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
