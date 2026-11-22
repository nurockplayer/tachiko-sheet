import type { ImportCompanion, InteropMetadata } from "../contracts.js";

export const IMPORT_COMPANION_NOTE = "Imported sheet information is missing or no longer matches this .ro file. Original sheet names and order may be unavailable.";

export async function companionDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Desktop Open carries a sidecar with the File without changing its bytes.
export const openedCompanions = new WeakMap<File, string>();

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tachiko-sheet-ro-companions", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("companions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Browser downloads retain the opaque companion on this device, keyed by bytes. */
export async function retainCompanion(companion: ImportCompanion): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("companions", "readwrite", { durability: "strict" });
      tx.objectStore("companions").put(companion, companion.snapshotDigest);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function openedFileCompanion(file: File): ImportCompanion | undefined {
  const sidecar = openedCompanions.get(file);
  if (sidecar === undefined) return undefined;
  try { return JSON.parse(sidecar) as ImportCompanion; }
  catch { return undefined; } // An unreadable optional sidecar never prevents Open.
}

export async function fileCompanion(file: File, bytes: ArrayBuffer): Promise<ImportCompanion | undefined> {
  if (openedCompanions.has(file)) return openedFileCompanion(file);
  let db: IDBDatabase;
  try { db = await database(); }
  catch { return undefined; } // Optional browser storage may be unavailable.
  try {
    const digest = await companionDigest(bytes);
    return await new Promise((resolve, reject) => {
      const request = db.transaction("companions").objectStore("companions").get(digest);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  } finally { db.close(); }
}

/** Validate only the byte binding. Work alone validates and interprets metadata. */
export async function companionMetadata(bytes: ArrayBuffer, companion?: ImportCompanion): Promise<InteropMetadata | undefined> {
  if (!companion) return undefined;
  return companion.snapshotDigest === await companionDigest(bytes) ? companion.metadata : undefined;
}
