import { simpleGit, type SimpleGit } from "simple-git";
import { basename, dirname } from "node:path";

/**
 * Thin, defensive wrappers over the git CLI (via simple-git). We shell out
 * rather than bind libgit2: isomorphic-git is broken on linked-worktree `.git`
 * files and nodegit is unmaintained (plan Part D). Every helper degrades to a
 * null/empty result instead of throwing, so the sensing loop never crashes on
 * a weird repo state.
 */

export interface RepoInfo {
  /** Canonical repo root, shared across all linked worktrees (keyed on the
   *  common git dir) — this is what gives a stable repoId so agents in
   *  different worktrees of the same repo route to each other. */
  root: string;
  /** The toplevel of the specific worktree this path lives in. */
  worktreeRoot: string;
  name: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
}

export interface WorktreeState {
  branch: string | null;
  headSha: string | null;
  baseBranch: string | null;
  mergeBase: string | null;
  /** Union of uncommitted (working-tree) changes and commits-since-merge-base. */
  changedFiles: string[];
}

function git(path: string): SimpleGit {
  return simpleGit({ baseDir: path });
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await git(path).checkIsRepo();
  } catch {
    return false;
  }
}

export async function getRepoInfo(path: string): Promise<RepoInfo | null> {
  try {
    const g = git(path);
    const worktreeRoot = (await g.revparse(["--show-toplevel"])).trim();

    // Canonical root = parent of the *common* git dir, which is identical for
    // every linked worktree of a repo (so two worktrees share one repoId).
    let root = worktreeRoot;
    try {
      const commonDir = (await g.raw(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
      root = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
    } catch {
      /* older git / bare repo — fall back to the worktree root */
    }

    let remoteUrl: string | null = null;
    try {
      const remotes = await g.getRemotes(true);
      remoteUrl = remotes.find((r) => r.name === "origin")?.refs.fetch ?? remotes[0]?.refs.fetch ?? null;
    } catch {
      /* no remotes */
    }
    return { root, worktreeRoot, name: basename(root), remoteUrl, defaultBranch: await detectDefaultBranch(g) };
  } catch {
    return null;
  }
}

async function detectDefaultBranch(g: SimpleGit): Promise<string | null> {
  // Prefer origin/HEAD; fall back to common names that actually exist locally.
  try {
    const ref = (await g.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])).trim();
    const name = ref.replace(/^refs\/remotes\/origin\//, "");
    if (name) return name;
  } catch {
    /* no origin/HEAD */
  }
  for (const candidate of ["main", "master"]) {
    try {
      await g.raw(["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      /* not present */
    }
  }
  return null;
}

export async function getWorktreeState(path: string, baseBranchHint?: string | null): Promise<WorktreeState> {
  const g = git(path);
  const out: WorktreeState = {
    branch: null,
    headSha: null,
    baseBranch: baseBranchHint ?? null,
    mergeBase: null,
    changedFiles: [],
  };

  try {
    out.branch = (await g.revparse(["--abbrev-ref", "HEAD"])).trim();
  } catch {
    /* detached or empty repo */
  }
  try {
    out.headSha = (await g.revparse(["HEAD"])).trim();
  } catch {
    /* no commits yet */
  }

  const changed = new Set<string>();

  // (a) uncommitted working-tree changes — the signal that matters for "agent
  // is editing X right now".
  try {
    const status = await g.status();
    for (const f of status.files) changed.add(f.path);
  } catch {
    /* ignore */
  }

  // (b) committed changes on this branch since its merge-base with the base.
  const base = baseBranchHint ?? out.baseBranch ?? (await detectDefaultBranch(g));
  out.baseBranch = base;
  if (base && out.branch && base !== out.branch) {
    try {
      out.mergeBase = (await g.raw(["merge-base", base, "HEAD"])).trim();
      if (out.mergeBase) {
        const diff = await g.diff(["--name-only", `${out.mergeBase}...HEAD`]);
        for (const line of diff.split("\n")) {
          const f = line.trim();
          if (f) changed.add(f);
        }
      }
    } catch {
      /* base may not exist locally */
    }
  }

  out.changedFiles = [...changed].sort();
  return out;
}

/** Returns the content of `path` at the given ref, or null if absent (for contract-diff baselines, M3). */
export async function showFileAtRef(repoPath: string, ref: string, file: string): Promise<string | null> {
  try {
    return await git(repoPath).show([`${ref}:${file}`]);
  } catch {
    return null;
  }
}
