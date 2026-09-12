import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadCoreKit } from "./core-loader.js";
import { createLocalCopies } from "./host/local-copies.js";
import { createSheetRuntime } from "./runtime/session.js";
import type { KitLoader } from "./contracts.js";

/**
 * Boots the production composition. In the acceptance build only, the test
 * module is loaded statically behind this mode gate, wraps the real kit loader
 * and installs observation/fault hooks before the runtime is created. The
 * production build compiles this branch away and ships no hook module or global.
 */
async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("The application root element is missing.");

  let kitLoader: KitLoader = loadCoreKit;
  if (import.meta.env.MODE === "acceptance") {
    const acceptance = await import("./acceptance/sheet-foundation.js");
    kitLoader = acceptance.wrapKitLoader(loadCoreKit);
    const runtime = createSheetRuntime(kitLoader);
    const copies = createLocalCopies();
    acceptance.installAcceptance({ runtime, copies });
    createRoot(root).render(<App runtime={runtime} copies={copies} />);
    return;
  }

  const runtime = createSheetRuntime(kitLoader);
  const copies = createLocalCopies();
  createRoot(root).render(<App runtime={runtime} copies={copies} />);
}

void boot();
