import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "web/src")
    }
  },
  build: {
    outDir: resolve(__dirname, "public"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false
  }
});