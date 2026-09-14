import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  ImportedSourceAttachment,
  LocalCopies,
  OpaqueProjectExport,
  OpaqueSavedCopy,
  SaveReceipt,
  SavedCopy,
  SavedCopySummary,
  AnySavedCopy,
} from "../contracts.js";

/**
 * A dedicated IndexedDB database for durable local copies. This name is app
 * identity: it must stay distinct from any runtime/core/designer database so a
 * copy survives independently of the interactive occurrence.
 */
export const LOCAL_COPIES_DB_NAME = "tachiko-sheet-local-copies";
export const LOCAL_COPIES_STORE = "copies";
export const LOCAL_OPAQUE_COPIES_STORE = "opaque-copies";
export const OPAQUE_COPY_FORMAT_VERSION = 2;
const DB_VERSION = 2;

interface StoredFile {
  path: string;
  bytes: ArrayBuffer;
}

interface StoredCopy {
  /** Added in format v2; missing on records written by the v1 schema. */
  kind?: "canonical";
  name: string;
  savedAt: string;
  revision: string;
  files: StoredFile[];
  /** Private IndexedDB composition, never a canonical project entry. */
  importedSource?: Omit<ImportedSourceAttachment, "bytes"> & { bytes: ArrayBuffer };
}

interface StoredOpaqueCopy {
  kind: "opaque";
  formatVersion: 2;
  name: string;
  savedAt: string;
  revision: string;
  bytes: ArrayBuffer;
  /** Private IndexedDB composition, never embedded in the opaque bytes. */
  importedSource?: Omit<ImportedSourceAttachment, "bytes"> & { bytes: ArrayBuffer };
}

let connection: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  const existing = connection;
  if (existing) return existing;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this host."));
      return;
    }
    const request = indexedDB.open(LOCAL_COPIES_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_COPIES_STORE)) {
        db.createObjectStore(LOCAL_COPIES_STORE, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(LOCAL_OPAQUE_COPIES_STORE)) {
        db.createObjectStore(LOCAL_OPAQUE_COPIES_STORE, { keyPath: "name" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open the local-copy database."));
    };
  });
  connection = pending;
  pending.catch(() => {
    if (connection === pending) connection = undefined;
  });
  return pending;
}

/** Copy opaque bytes so callers cannot alias-mutate stored/returned data. */
function cloneBytes(source: ArrayBuffer): ArrayBuffer {
  // `source` may have crossed an IndexedDB or iframe realm, so `instanceof`
  // alone is not a reliable ArrayBuffer check.
  if (ArrayBuffer.isView(source)) {
    const view = source as unknown as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }
  if (source && typeof source.byteLength === "number" && typeof source.slice === "function") {
    return source.slice(0) as ArrayBuffer;
  }
  const view = source as unknown as ArrayBufferView;
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

function cloneFiles(files: readonly CanonicalProjectFile[]): StoredFile[] {
  return files.map((file) => ({ path: String(file.path), bytes: cloneBytes(file.bytes) }));
}

function toCanonicalSavedCopy(record: StoredCopy): SavedCopy {
  return {
    name: record.name,
    savedAt: record.savedAt,
    kind: "canonical",
    revision: record.revision,
    files: record.files.map((file) => ({ path: file.path, bytes: cloneBytes(file.bytes) })),
    importedSource: record.importedSource ? {
      ...record.importedSource,
      bytes: cloneBytes(record.importedSource.bytes),
      metadata: structuredClone(record.importedSource.metadata),
      ledger: structuredClone(record.importedSource.ledger),
    } : undefined,
  };
}

function toOpaqueSavedCopy(record: StoredOpaqueCopy): OpaqueSavedCopy {
  const copy: OpaqueSavedCopy = {
    name: record.name,
    savedAt: record.savedAt,
    kind: "opaque",
    formatVersion: 2,
    revision: record.revision,
    bytes: cloneBytes(record.bytes),
  };
  if (record.importedSource) {
    copy.importedSource = {
      ...record.importedSource,
      bytes: cloneBytes(record.importedSource.bytes),
      metadata: structuredClone(record.importedSource.metadata),
      ledger: structuredClone(record.importedSource.ledger),
    };
  }
  return copy;
}

/**
 * Create-only write: `add` never overwrites an existing destination, and a
 * conflict/quota/abort error rolls the single-transaction write back before the
 * promise rejects. The transaction requests `durability: "strict"` so success
 * resolves only on durable transaction completion; there is no fallback that
 * would report success without strict durability.
 */
function conflictError(name: string): DOMException {
  return new DOMException(`A local copy named "${name}" already exists.`, "ConstraintError");
}

/**
 * Create-only write across both copy kinds. Checking both stores and adding
 * the selected record in one strict transaction prevents a canonical/opaque
 * same-name race and rolls back any partial write on conflict or abort.
 */
function addCopyOnce(db: IDBDatabase, storeName: string, record: StoredCopy | StoredOpaqueCopy): Promise<void> {
  return new Promise((resolve, reject) => {
    let failure: unknown;
    let checked = 0;
    let existingCanonical: StoredCopy | undefined;
    let existingOpaque: StoredOpaqueCopy | undefined;
    let settled = false;
    const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readwrite", {durability: "strict"});
    const abort = (error: unknown) => {
      failure ??= error;
      try {
        tx.abort();
      } catch {
        // The transaction may already be settling; its completion handlers
        // below preserve the original failure either way.
      }
    };
    const checkDone = () => {
      checked += 1;
      if (checked !== 2) return;
      if (existingCanonical || existingOpaque) {
        abort(conflictError(record.name));
        return;
      }
      const request = tx.objectStore(storeName).add(record);
      request.onerror = () => {
        failure ??= request.error ?? new Error("The local copy could not be added.");
      };
    };
    const canonicalRequest = tx.objectStore(LOCAL_COPIES_STORE).get(record.name);
    canonicalRequest.onsuccess = () => {
      existingCanonical = canonicalRequest.result as StoredCopy | undefined;
      checkDone();
    };
    canonicalRequest.onerror = () => {
      failure = canonicalRequest.error ?? new Error("Unable to check canonical local copies.");
    };
    const opaqueRequest = tx.objectStore(LOCAL_OPAQUE_COPIES_STORE).get(record.name);
    opaqueRequest.onsuccess = () => {
      existingOpaque = opaqueRequest.result as StoredOpaqueCopy | undefined;
      checkDone();
    };
    opaqueRequest.onerror = () => {
      failure = opaqueRequest.error ?? new Error("Unable to check opaque local copies.");
    };
    tx.onerror = () => {
      failure ??= tx.error ?? new Error("The local-copy transaction failed.");
    };
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(failure ?? tx.error ?? new Error("The local-copy transaction was aborted."));
      }
    };
  });
}

function summarize(record: StoredCopy | StoredOpaqueCopy): SavedCopySummary {
  return {name: record.name, savedAt: record.savedAt, kind: record.kind === "opaque" ? "opaque" : "canonical"};
}

function compareSummaries(left: StoredCopy | StoredOpaqueCopy, right: StoredCopy | StoredOpaqueCopy): number {
  if (left.savedAt !== right.savedAt) return left.savedAt < right.savedAt ? 1 : -1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function createLocalCopies(): LocalCopies {
  return {
    async list(): Promise<SavedCopySummary[]> {
      const db = await openDatabase();
      const records = await new Promise<StoredCopy[]>((resolve, reject) => {
        const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readonly");
        let canonical: StoredCopy[] | undefined;
        let opaque: StoredOpaqueCopy[] | undefined;
        const finish = () => {
          if (!canonical || !opaque) return;
          resolve([...canonical, ...opaque] as StoredCopy[]);
        };
        const canonicalRequest = tx.objectStore(LOCAL_COPIES_STORE).getAll();
        canonicalRequest.onsuccess = () => {
          canonical = (canonicalRequest.result ?? []) as StoredCopy[];
          finish();
        };
        canonicalRequest.onerror = () => reject(canonicalRequest.error ?? new Error("Unable to read canonical local copies."));
        const opaqueRequest = tx.objectStore(LOCAL_OPAQUE_COPIES_STORE).getAll();
        opaqueRequest.onsuccess = () => {
          opaque = (opaqueRequest.result ?? []) as StoredOpaqueCopy[];
          finish();
        };
        opaqueRequest.onerror = () => reject(opaqueRequest.error ?? new Error("Unable to read opaque local copies."));
        tx.onabort = () => reject(tx.error ?? new Error("The local-copy read was aborted."));
      });
      return records.filter((record) => record && typeof record.name === "string").sort(compareSummaries).map(summarize);
    },

    async readAny(name: string): Promise<AnySavedCopy | null> {
      const db = await openDatabase();
      const record = await new Promise<StoredCopy | StoredOpaqueCopy | null>((resolve, reject) => {
        const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readonly");
        let canonical: StoredCopy | undefined;
        let opaque: StoredOpaqueCopy | undefined;
        let completed = 0;
        const finish = () => {
          completed += 1;
          if (completed !== 2) return;
          if (canonical && opaque) {
            reject(new Error(`The local-copy name "${name}" exists in multiple stores.`));
          } else {
            resolve(canonical ?? opaque ?? null);
          }
        };
        const canonicalRequest = tx.objectStore(LOCAL_COPIES_STORE).get(name);
        canonicalRequest.onsuccess = () => {
          canonical = canonicalRequest.result as StoredCopy | undefined;
          finish();
        };
        canonicalRequest.onerror = () => reject(canonicalRequest.error ?? new Error("Unable to read canonical local copy."));
        const opaqueRequest = tx.objectStore(LOCAL_OPAQUE_COPIES_STORE).get(name);
        opaqueRequest.onsuccess = () => {
          opaque = opaqueRequest.result as StoredOpaqueCopy | undefined;
          finish();
        };
        opaqueRequest.onerror = () => reject(opaqueRequest.error ?? new Error("Unable to read opaque local copy."));
        tx.onabort = () => reject(tx.error ?? new Error("The local-copy read was aborted."));
      });
      if (!record || record.name !== name) return null;
      return record.kind === "opaque" ? toOpaqueSavedCopy(record) : toCanonicalSavedCopy(record);
    },

    async read(name: string): Promise<SavedCopy | null> {
      // Keep the pre-J4 signature source-compatible. New callers must use
      // readAny and dispatch on the returned discriminator before opening a
      // record. Never expose an opaque record through the legacy canonical
      // return type, which would make it possible to open it as tree files.
      const copy = await this.readAny(name);
      if (copy?.kind === "opaque") {
        throw new TypeError("Opaque local copies must be read with readAny().");
      }
      return copy;
    },

    async create(name: string, snapshot: CanonicalTreeExport, importedSource?: ImportedSourceAttachment): Promise<SaveReceipt> {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError("A local copy needs a non-empty name.");
      }
      const record: StoredCopy = {
        name,
        savedAt: new Date().toISOString(),
        kind: "canonical",
        revision: String(snapshot.revision),
        files: cloneFiles(snapshot.files),
        importedSource: importedSource ? {
          name: importedSource.name,
          format: importedSource.format,
          bytes: cloneBytes(importedSource.bytes),
          metadata: structuredClone(importedSource.metadata),
          ledger: structuredClone(importedSource.ledger),
        } : undefined,
      };
      const db = await openDatabase();
      await addCopyOnce(db, LOCAL_COPIES_STORE, record);
      return {name: record.name, savedAt: record.savedAt, kind: "canonical", revision: record.revision};
    },

    async createOpaque(name: string, snapshot: OpaqueProjectExport): Promise<SaveReceipt> {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError("A local copy needs a non-empty name.");
      }
      if (!snapshot || typeof snapshot.revision !== "string" || !snapshot.bytes ||
          typeof snapshot.bytes.byteLength !== "number" || typeof snapshot.bytes.slice !== "function") {
        throw new TypeError("An opaque local copy needs a revision and ArrayBuffer bytes.");
      }
      const record: StoredOpaqueCopy = {
        kind: "opaque",
        formatVersion: OPAQUE_COPY_FORMAT_VERSION,
        name,
        savedAt: new Date().toISOString(),
        revision: snapshot.revision,
        bytes: cloneBytes(snapshot.bytes),
        importedSource: snapshot.importedSource ? {
          name: snapshot.importedSource.name,
          format: snapshot.importedSource.format,
          bytes: cloneBytes(snapshot.importedSource.bytes),
          metadata: structuredClone(snapshot.importedSource.metadata),
          ledger: structuredClone(snapshot.importedSource.ledger),
        } : undefined,
      };
      const db = await openDatabase();
      await addCopyOnce(db, LOCAL_OPAQUE_COPIES_STORE, record);
      return {name: record.name, savedAt: record.savedAt, kind: "opaque", revision: record.revision};
    },

    async close(): Promise<void> {
      const pending = connection;
      connection = undefined;
      if (!pending) return;
      try {
        (await pending).close();
      } catch {
        // The connection never opened; nothing to release.
      }
    },
  };
}
