import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds a single self-contained dist/index.html (JS + CSS inlined) so the
// daemon can embed and serve it from one file in the compiled binary.
export default defineConfig({
  base: "./",
  plugins: [svelte(), viteSingleFile()],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 100_000_000 },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7734",
      "/events": { target: "http://127.0.0.1:7734", ws: false },
    },
  },
});
