import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false, // 👈 CRITICAL: Turning off source maps saves massive amounts of RAM
    cssCodeSplit: true,
    minify: "esbuild", // Uses fast esbuild minification instead of heavy terser threads
    rollupOptions: {
      maxParallelFileOps: 2, // 👈 CRITICAL: Restricts the compiler from reading more than 2 files at once in RAM
    },
    cacheDir: ".vite_cache",
  },
});
