import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadCoreKit } from "./core-loader.js";
import { createLocalCopies } from "./host/local-copies.js";
import { createSheetRuntime } from "./runtime/session.js";
import { createBrowserAppearancePreferencePort } from "./host/appearance-preference.js";
import { createAppearancePreferenceController } from "./application/appearance-preference.js";
import {
  applyResolvedProfile,
  resolveBuiltInInterfaceProfile,
  resolveInterfaceProfile,
} from "./ui/interface-profile/index.js";
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

  const appearancePreference = createAppearancePreferenceController(
    createBrowserAppearancePreferencePort(),
    (choice) => {
      const resolvedProfile = choice.kind === "built-in"
        ? resolveBuiltInInterfaceProfile(choice.profileId, choice.density)
        : resolveInterfaceProfile(choice.profile);
      if (!resolvedProfile.ok || !applyResolvedProfile(document.documentElement, resolvedProfile.value)) {
        throw new Error("The selected interface profile could not be applied.");
      }
    },
  );

  let kitLoader: KitLoader = loadCoreKit;
  if (import.meta.env.MODE === "acceptance") {
    const acceptance = await import("./acceptance/sheet-foundation.js");
    kitLoader = acceptance.wrapKitLoader(loadCoreKit);
    const runtime = createSheetRuntime(kitLoader);
    const copies = createLocalCopies();
    acceptance.installAcceptance({ runtime, copies });
    createRoot(root).render(<App runtime={runtime} copies={copies} appearancePreference={appearancePreference} />);
    return;
  }

  const runtime = createSheetRuntime(kitLoader);
  const copies = createLocalCopies();
  createRoot(root).render(<App runtime={runtime} copies={copies} appearancePreference={appearancePreference} />);
}

void boot();
