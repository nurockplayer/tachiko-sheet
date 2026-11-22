import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    // This Playwright host suite uses node:test (see test:unit).
    exclude: [...configDefaults.exclude, "src/host/local-copies.test.mjs"],
  },
}));
