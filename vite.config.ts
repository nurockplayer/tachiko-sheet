import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Two build shapes share one source tree:
 * - `vite build` (production) must never include the acceptance/fault module;
 * - `vite build --mode acceptance` emits the separate test distributable;
 * - `vite build --mode desktop` emits the Tauri app's frontend, bound to the
 *   native runtime instead of the Worker/WASM runtime.
 */
export default defineConfig(({ mode }) => {
  const acceptance = mode === "acceptance";
  const desktop = mode === "desktop";
  return {
    plugins: [react()],
    base: "/",
    build: {
      outDir: acceptance ? "dist-acceptance" : desktop ? "dist-desktop" : "dist",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: acceptance,
    },
    server: {
      port: desktop ? 5174 : 5173,
      strictPort: desktop,
    },
    preview: {
      port: 4173,
    },
  };
});
