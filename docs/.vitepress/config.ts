import { defineConfig } from "vitepress";

// Project Pages site at https://sumanyumuku98.github.io/Nerveplane/
export default defineConfig({
  title: "Nerveplane",
  description:
    "Local-first, MCP-compatible coordination plane for autonomous coding agents — passive git sensing, cross-repo conflict & contract-breaking-change routing, and a decision ledger.",
  base: "/Nerveplane/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "/Nerveplane/logo.svg" }]],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Roadmap", link: "/roadmap" },
      { text: "Spec", link: "/nerveplane_spec" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Concepts", link: "/guide/concepts" },
            { text: "Claude Code Integration", link: "/guide/claude-code" },
            { text: "Autonomous Workers", link: "/guide/autonomous-workers" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "CLI", link: "/reference/cli" },
            { text: "MCP Tools", link: "/reference/mcp-tools" },
            { text: "Architecture", link: "/reference/architecture" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/sumanyumuku98/Nerveplane" }],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/sumanyumuku98/Nerveplane/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: { message: "Released under the MIT License.", copyright: "© 2026 Sumanyu Muku" },
  },
});
