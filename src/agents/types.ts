/**
 * Provider abstraction for CLI coding agents (Claude Code, Codex, opencode, …).
 *
 * Nerveplane's coordination substrate — the MCP tools, REST API, and daemon — is
 * already vendor-neutral: any MCP-capable CLI can drive it. What differs per CLI
 * is (1) the headless invocation the worker uses to wake a turn, and (2) how you
 * register an MCP server + agent instructions for it. Each of those quirks lives
 * entirely in one adapter file; the worker/installer only ever talk to this
 * interface, so adding a new CLI = drop in a new adapter, nothing else changes.
 */

/** Options the worker passes when building a headless turn. */
export interface HeadlessOptions {
  sessionId?: string; // prior session to resume (only if the provider supports it)
  model?: string; // model override, if any
  permissionMode?: string; // provider-specific non-interactive mode override
  allowedTools?: string; // provider-specific tool allow-list override
  mcpConfig?: string; // inline MCP config JSON (providers that support it; else ignored)
}

export interface TurnResult {
  ok: boolean;
  sessionId?: string;
  result?: string;
  exitCode?: number;
  stderr?: string;
}

export interface ProviderInstallOptions {
  global?: boolean; // user scope (~/.<cli>) vs project scope
  withMcp?: boolean; // also write a project MCP config (provider-specific meaning)
  print?: boolean; // dry-run: report intended actions, write nothing
}

export interface InstallResult {
  files: string[];
  notes: string[];
  mcpRegistered: boolean;
}

export interface ProviderCapabilities {
  hooks: boolean; // lifecycle hooks (auto-register / pre-edit warnings / stop-reply)
  resume: boolean; // headless session continuity across turns
  inlineMcpConfig: boolean; // MCP server can be passed inline per-invocation (vs config file only)
}

export interface AgentProvider {
  readonly id: string; // "claude" | "codex" | "opencode"
  readonly label: string; // human name, e.g. "Claude Code"
  readonly bin: string; // executable to look for on PATH
  readonly instructionsFilename: string; // memory/instructions file this CLI reads
  readonly capabilities: ProviderCapabilities;

  /** Is the CLI installed (on PATH)? */
  detect(): boolean;

  /** argv AFTER the bin for one headless turn. */
  headlessArgs(prompt: string, opts: HeadlessOptions): string[];

  /** Extract the final text + (optional) session id from the CLI's stdout. */
  parseResult(stdout: string): { result?: string; sessionId?: string };

  /** Wire this CLI up to Nerveplane (register MCP server + write instructions [+ hooks]). */
  install(projectDir: string, opts: ProviderInstallOptions): InstallResult;

  /** Best-effort: where this CLI's MCP config lives and whether nerveplane is in it (for `doctor`). */
  mcpConfigStatus(opts?: { global?: boolean }): { path: string; registered: boolean };
}
