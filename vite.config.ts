import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Keep ignored kit imports on Vite's byte-preserving public-file path. */
function publicCoreKitDevImports(): Plugin {
  return {
    name: "public-core-kit-dev-imports",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname.startsWith("/core-kit/") && url.search === "?import") {
          // Vite injects ?import even for @vite-ignore dynamic imports. Its
          // public middleware skips that marker, sending the kit to transforms.
          // Keep all other queries on Vite's normal path, including ?import&url.
          request.url = url.pathname;
        }
        next();
      });
    },
  };
}

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
    plugins: [publicCoreKitDevImports(), react()],
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
