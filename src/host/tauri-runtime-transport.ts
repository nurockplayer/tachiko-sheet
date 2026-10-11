import { invoke } from "@tauri-apps/api/core";
import type { NativeRuntimeTransport } from "./native-runtime.js";

/** The desktop host's two private runtime commands over Tauri binary IPC. */
export const tauriRuntimeTransport: NativeRuntimeTransport = {
  attach: () => invoke<number>("runtime_attach"),
  dispatch: (frame) => invoke<ArrayBuffer>("runtime_dispatch", frame),
};
