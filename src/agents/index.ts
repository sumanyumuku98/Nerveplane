import type { AgentProvider } from "./types.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { opencode } from "./opencode.ts";

export type { AgentProvider, HeadlessOptions, TurnResult, ProviderInstallOptions, InstallResult } from "./types.ts";

export const DEFAULT_AGENT = "claude";

const PROVIDERS: Record<string, AgentProvider> = { claude, codex, opencode };

export function listProviders(): AgentProvider[] {
  return Object.values(PROVIDERS);
}

export function getProvider(id: string = DEFAULT_AGENT): AgentProvider {
  const p = PROVIDERS[id];
  if (!p) {
    throw new Error(`unknown agent "${id}" — choose one of: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return p;
}
