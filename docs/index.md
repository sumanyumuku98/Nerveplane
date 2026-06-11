---
layout: home
hero:
  name: Nerveplane
  text: The coordination plane for autonomous coding agents
  tagline: Local-first, MCP-compatible, repo- and service-aware. Keep parallel coding agents aligned across repos, branches, worktrees, services, and contracts — before merge.
  image:
    src: /logo.svg
    alt: Nerveplane
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Concepts
      link: /guide/concepts
    - theme: alt
      text: GitHub
      link: https://github.com/sumanyumuku98/Nerveplane
features:
  - icon: 👁️
    title: Passive sensing
    details: The daemon watches registered worktrees itself — changed files, diffs, contract changes — and emits coordination events without agents having to remember to report anything.
  - icon: ⚔️
    title: Conflict detection
    details: Same-file (high) and same-package (medium) collisions between agents are detected and routed to exactly the pair involved, with a conservative, dismissible noise budget.
  - icon: 🔗
    title: Contract-aware cross-repo routing
    details: When an agent changes an OpenAPI/GraphQL contract, consumer-repo agents (direct, transitive, and test owners) are warned about the breaking change — across repo boundaries, before merge.
  - icon: 📒
    title: Decision ledger
    details: Durable project decisions live separately from chat history and are queryable by file, repo, service, or task.
  - icon: 🔌
    title: MCP-native
    details: Six consolidated MCP tools over stdio and Streamable HTTP. A two-minute installer wires Claude Code with an .mcp.json and a warning-injection hook.
  - icon: 💻
    title: Local-first
    details: A single user-level daemon, SQLite (WAL) storage, a live Svelte dashboard — runs on your laptop with no cloud dependency.
---

## Why Nerveplane?

> As developers run multiple coding agents in parallel, the bottleneck shifts from code generation to **coordination**.

Git worktrees stop two agents from overwriting the same file, but they don't stop **logical drift**: a backend agent changes an API response while a frontend agent builds against the old shape; a service agent changes an event schema while a subscriber in another repo goes stale. Nerveplane is the missing layer that detects these and routes the right signal to the right agent — grounded in repository and service dependency state, not generic chat.

See the [full specification](/nerveplane_spec) for the complete product and technical design.
