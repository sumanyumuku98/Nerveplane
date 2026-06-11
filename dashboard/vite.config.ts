import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The daemon serves the build under /dashboard and proxies /api + /events.
export default defineConfig({
  base: "/dashboard/",
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7734",
      "/events": { target: "http://127.0.0.1:7734", ws: false },
    },
  },
});
