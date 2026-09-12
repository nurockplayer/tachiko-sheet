import type { CoreKit, KitLoader } from "./contracts.js";

/**
 * The intact public kit entry served from this origin. It is loaded as a real
 * dynamic module (never bundled or rewritten) so the vendored Worker/WASM pair
 * resolves next to it. Types come from the same intact entry via `contracts`.
 */
export const PUBLIC_CLIENT_ENTRY = "/core-kit/experimental-client.js";

export const loadCoreKit: KitLoader = async (): Promise<CoreKit> => {
  const entry = PUBLIC_CLIENT_ENTRY;
  const kit = (await import(/* @vite-ignore */ entry)) as CoreKit;
  if (typeof kit.createExperimentalDesignerClient !== "function") {
    throw new Error("The pinned core kit entry did not expose its public client factory.");
  }
  return kit;
};
