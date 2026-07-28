import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

/**
 * Persisted machine config at ~/.nerveplane/config.json — lets `nerveplane
 * memory setup` remember the chosen memory backend across daemon restarts (env
 * vars don't survive a launchd relaunch). Resolution precedence is always
 * **env var › config.json › default**, so CI/scripts can still override with
 * NERVEPLANE_* env and the interactive picker's choice persists otherwise.
 *
 * Standalone/low-level: computes its own path (no import from config.ts) to
 * avoid an import cycle. Never stores secrets — API keys stay in the environment.
 */
const HOME = process.env.NERVEPLANE_HOME ?? join(homedir(), ".nerveplane");
export const CONFIG_JSON_PATH = join(HOME, "config.json");

export type MemoryMode = "keyword" | "semantic" | "hybrid";
export type Embedder = "openai" | "ollama";

export interface NerveplaneConfig {
  memory?: {
    mode?: MemoryMode;
    embedder?: Embedder;
    embedderModel?: string;
    ollamaUrl?: string;
  };
}

export function readConfig(): NerveplaneConfig {
  try {
    return existsSync(CONFIG_JSON_PATH) ? (JSON.parse(readFileSync(CONFIG_JSON_PATH, "utf8")) as NerveplaneConfig) : {};
  } catch {
    return {};
  }
}

/** Shallow-merge a patch (with a nested merge of `memory`) and persist. */
export function writeConfig(patch: NerveplaneConfig): NerveplaneConfig {
  const cur = readConfig();
  const next: NerveplaneConfig = { ...cur, ...patch, memory: { ...cur.memory, ...patch.memory } };
  mkdirSync(HOME, { recursive: true });
  writeFileSync(CONFIG_JSON_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

const isMode = (v: unknown): v is MemoryMode => v === "keyword" || v === "semantic" || v === "hybrid";
const isEmbedder = (v: unknown): v is Embedder => v === "openai" || v === "ollama";

/** env `NERVEPLANE_MEMORY` › config.json `memory.mode` › `keyword`. */
export function resolveMemoryMode(cfg: NerveplaneConfig = readConfig()): MemoryMode {
  if (isMode(process.env.NERVEPLANE_MEMORY)) return process.env.NERVEPLANE_MEMORY;
  if (isMode(cfg.memory?.mode)) return cfg.memory!.mode!;
  return "keyword";
}

/** env `NERVEPLANE_EMBEDDER` › config.json `memory.embedder` › `none`. */
export function resolveEmbedder(cfg: NerveplaneConfig = readConfig()): Embedder | "none" {
  if (isEmbedder(process.env.NERVEPLANE_EMBEDDER)) return process.env.NERVEPLANE_EMBEDDER;
  if (isEmbedder(cfg.memory?.embedder)) return cfg.memory!.embedder!;
  return "none";
}

export function resolveOllamaUrl(cfg: NerveplaneConfig = readConfig()): string {
  return process.env.NERVEPLANE_OLLAMA_URL ?? cfg.memory?.ollamaUrl ?? "http://127.0.0.1:11434";
}

export function resolveEmbedderModel(cfg: NerveplaneConfig = readConfig()): string | undefined {
  return process.env.NERVEPLANE_EMBEDDER_MODEL ?? cfg.memory?.embedderModel;
}
