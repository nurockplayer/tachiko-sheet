import { invoke } from "@tauri-apps/api/core";
import type { HostFiles, SaveOutcome } from "./host-files.js";

const encoder = new TextEncoder();

/** Saves still in progress, counted from the moment one is requested. */
let pending = 0;
/** Saves run one after another, in the order they were requested. */
let queue: Promise<unknown> = Promise.resolve();
/**
 * This page's save epoch, learned when the page starts: saves from an earlier
 * page are refused by the host, and a late first save cannot borrow a newer
 * page's epoch.
 */
const epoch: Promise<number> = invoke<number>("save_attach");

/**
 * A save in progress is work the person asked for: leaving now would lose
 * it, so it counts in the Sheet's own unsaved-work guard, which the desktop
 * host consults before closing, quitting or reloading.
 */
window.addEventListener("beforeunload", (event) => {
  if (pending === 0) return;
  event.preventDefault();
  event.returnValue = "";
});

/** `[u64 epoch][u32 name length][name][bytes]`, little-endian. */
export function encodeSaveFrame(saveEpoch: number, name: string, bytes: Uint8Array): Uint8Array {
  const nameBytes = encoder.encode(name);
  const frame = new Uint8Array(12 + nameBytes.byteLength + bytes.byteLength);
  const view = new DataView(frame.buffer);
  view.setBigUint64(0, BigInt(saveEpoch), true);
  view.setUint32(8, nameBytes.byteLength, true);
  frame.set(nameBytes, 12);
  frame.set(bytes, 12 + nameBytes.byteLength);
  return frame;
}

async function save(suggestedName: string, content: Blob | Promise<Blob>): Promise<SaveOutcome> {
  const bytes = new Uint8Array(await (await content).arrayBuffer());
  const frame = encodeSaveFrame(await epoch, suggestedName, bytes);
  let outcome: string;
  try {
    outcome = await invoke<string>("save_export", frame);
  } catch (error) {
    // The host answers a failure with its own message; anything else means
    // the reply was lost and the file may or may not have been written.
    if (typeof error === "string") throw new Error(error);
    throw new Error(`“${suggestedName}” may not have been saved. Check the file before relying on it.`);
  }
  if (outcome !== "saved" && outcome !== "cancelled") {
    throw new Error(`“${suggestedName}” may not have been saved. Check the file before relying on it.`);
  }
  return outcome;
}

/** The desktop host writes exports itself, after asking with a Save sheet. */
export const tauriHostFiles: HostFiles = {
  saveFile(suggestedName, content) {
    // Count and order the save before any await, so it is never invisible to
    // the guard and a slower encoding cannot be overtaken by a later save.
    pending += 1;
    const run = queue.then(() => save(suggestedName, content));
    queue = run.catch(() => undefined);
    return run.finally(() => {
      pending -= 1;
    });
  },
};
