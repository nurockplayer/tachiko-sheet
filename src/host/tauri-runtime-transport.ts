import { invoke } from "@tauri-apps/api/core";
import type { NativeRuntimeTransport } from "./native-runtime.js";
import { pageIdentity } from "./tauri-page.js";

/** Each runtime channel of this page attaches with a new, rising number. */
let channels = 0;

/** The desktop host's two private runtime commands over Tauri binary IPC. */
export const tauriRuntimeTransport: NativeRuntimeTransport = {
  attach: async () => {
    const channel = ++channels;
    return invoke<number>("runtime_attach", { page: await pageIdentity, channel });
  },
  dispatch: (frame) => invoke<ArrayBuffer>("runtime_dispatch", frame),
};
