import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The workspace contract package is compiled as CommonJS for NestJS. Alias
    // the source for Vite so browser builds retain named ESM exports.
    alias: {
      "@oms/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
  },
  build: { sourcemap: false, target: "es2022" },
});
