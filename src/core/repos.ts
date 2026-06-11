import { eq } from "drizzle-orm";
import { getDb } from "../storage/db.ts";
import { repos } from "../storage/schema.ts";
import { getRepoInfo } from "../repo/git.ts";
import { normalizeRemote } from "../services/graph.ts";
import { newId } from "./util.ts";

export type Repo = typeof repos.$inferSelect;

/**
 * Registers (or returns) a repo by its filesystem root. Idempotent on `path`,
 * so re-running `nerveplane init` in the same repo resumes the same row.
 */
export async function upsertRepoByPath(path: string): Promise<Repo> {
  const db = getDb();
  const info = await getRepoInfo(path);
  const root = info?.root ?? path;

  const existing = db.select().from(repos).where(eq(repos.path, root)).get();
  if (existing) {
    if (info) {
      db.update(repos)
        .set({ remoteUrl: info.remoteUrl, defaultBranch: info.defaultBranch })
        .where(eq(repos.id, existing.id))
        .run();
    }
    return db.select().from(repos).where(eq(repos.id, existing.id)).get()!;
  }

  const row: Repo = {
    id: newId("repo"),
    name: info?.name ?? root.split("/").pop() ?? "repo",
    path: root,
    remoteUrl: info?.remoteUrl ?? null,
    defaultBranch: info?.defaultBranch ?? null,
    metadata: null,
  };
  db.insert(repos).values(row).run();
  return row;
}

export function listRepos(): Repo[] {
  return getDb().select().from(repos).all();
}

export function getRepo(id: string): Repo | undefined {
  return getDb().select().from(repos).where(eq(repos.id, id)).get();
}

/** Find a registered repo whose git remote matches `remoteUrl` (ssh/https-agnostic). */
export function repoByRemote(remoteUrl: string | null): Repo | undefined {
  if (!remoteUrl) return undefined;
  const want = normalizeRemote(remoteUrl);
  return getDb()
    .select()
    .from(repos)
    .all()
    .find((r) => r.remoteUrl && normalizeRemote(r.remoteUrl) === want);
}
