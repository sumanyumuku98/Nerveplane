import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Resolves the "package" a file belongs to, for same-package conflict grouping.
 * Walks up from the file to the nearest dependency manifest; if none is found,
 * falls back to the file's top-level directory. Grouping by package (not raw
 * directory) keeps same-package warnings meaningful and is the unit we dedup on
 * (plan M2.2 / M2.3).
 */

const MANIFESTS = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle"];

// cache: worktreePath -> (file -> packageKey)
const cache = new Map<string, Map<string, string>>();

export function packageKeyFor(worktreePath: string, file: string): string {
  let perRepo = cache.get(worktreePath);
  if (!perRepo) {
    perRepo = new Map();
    cache.set(worktreePath, perRepo);
  }
  const hit = perRepo.get(file);
  if (hit !== undefined) return hit;

  const key = resolve(worktreePath, file);
  perRepo.set(file, key);
  return key;
}

function resolve(worktreePath: string, file: string): string {
  // `file` is repo-relative (from git). Walk its directory chain upward,
  // looking for a manifest, staying within the worktree.
  let rel = dirname(file);
  const segments: string[] = [];
  for (const part of rel.split("/")) {
    if (part && part !== ".") segments.push(part);
  }

  // Search from the file's directory up to the repo root.
  for (let depth = segments.length; depth >= 0; depth--) {
    const relDir = segments.slice(0, depth).join("/");
    const absDir = relDir ? join(worktreePath, relDir) : worktreePath;
    if (MANIFESTS.some((m) => existsSync(join(absDir, m)))) {
      return relDir || "."; // package key is the manifest dir, relative to repo
    }
  }

  // No manifest anywhere: group by top-level directory (or root for top-level files).
  return segments[0] ?? ".";
}

/** Clears the package-resolution cache (tests, or when files are added/removed). */
export function resetPackageCache(): void {
  cache.clear();
}
