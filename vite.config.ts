import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Two build shapes share one source tree:
 * - `vite build` (production) must never include the acceptance/fault module;
 * - `vite build --mode acceptance` emits the separate test distributable.
 */
export default defineConfig(({ mode }) => {
  const acceptance = mode === "acceptance";
  return {
    plugins: [react()],
    base: "/",
    build: {
      outDir: acceptance ? "dist-acceptance" : "dist",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: acceptance,
    },
    server: {
      port: 5173,
    },
    preview: {
      port: 4173,
    },
  };
});
