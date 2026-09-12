import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  LocalCopies,
  SaveReceipt,
  SavedCopy,
  SavedCopySummary,
} from "../contracts.js";

/**
 * A dedicated IndexedDB database for durable local copies. This name is app
 * identity: it must stay distinct from any runtime/core/designer database so a
 * copy survives independently of the interactive occurrence.
 */
export const LOCAL_COPIES_DB_NAME = "tachiko-sheet-local-copies";
export const LOCAL_COPIES_STORE = "copies";
const DB_VERSION = 1;

interface StoredFile {
  path: string;
  bytes: ArrayBuffer;
}

interface StoredCopy {
  name: string;
  savedAt: string;
  revision: string;
  files: StoredFile[];
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
  if (source instanceof ArrayBuffer) return source.slice(0);
  const view = source as unknown as ArrayBufferView;
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

function cloneFiles(files: readonly CanonicalProjectFile[]): StoredFile[] {
  return files.map((file) => ({ path: String(file.path), bytes: cloneBytes(file.bytes) }));
}

function toSavedCopy(record: StoredCopy): SavedCopy {
  return {
    name: record.name,
    savedAt: record.savedAt,
    revision: record.revision,
    files: record.files.map((file) => ({ path: file.path, bytes: cloneBytes(file.bytes) })),
  };
}

/**
 * Create-only write: `add` never overwrites an existing destination, and a
 * conflict/quota/abort error rolls the single-transaction write back before the
 * promise rejects. The transaction requests `durability: "strict"` so success
 * resolves only on durable transaction completion; there is no fallback that
 * would report success without strict durability.
 */
function addCopyOnce(db: IDBDatabase, record: StoredCopy): Promise<void> {
  return new Promise((resolve, reject) => {
    let failure: unknown;
    const tx = db.transaction(LOCAL_COPIES_STORE, "readwrite", { durability: "strict" });
    const request = tx.objectStore(LOCAL_COPIES_STORE).add(record);
    request.onerror = () => {
      failure = request.error ?? new Error("The local copy could not be added.");
    };
    tx.onerror = () => {
      failure ??= tx.error ?? new Error("The local-copy transaction failed.");
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(failure ?? tx.error ?? new Error("The local-copy transaction was aborted."));
    };
  });
}

function summarize(record: StoredCopy): SavedCopySummary {
  return { name: record.name, savedAt: record.savedAt };
}

function compareSummaries(left: StoredCopy, right: StoredCopy): number {
  if (left.savedAt !== right.savedAt) return left.savedAt < right.savedAt ? 1 : -1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function createLocalCopies(): LocalCopies {
  return {
    async list(): Promise<SavedCopySummary[]> {
      const db = await openDatabase();
      const records = await new Promise<StoredCopy[]>((resolve, reject) => {
        const tx = db.transaction(LOCAL_COPIES_STORE, "readonly");
        const request = tx.objectStore(LOCAL_COPIES_STORE).getAll();
        request.onsuccess = () => resolve((request.result ?? []) as StoredCopy[]);
        request.onerror = () => reject(request.error ?? new Error("Unable to read local copies."));
        tx.onabort = () => reject(tx.error ?? new Error("The local-copy read was aborted."));
      });
      return records.filter((record) => record && typeof record.name === "string").sort(compareSummaries).map(summarize);
    },

    async read(name: string): Promise<SavedCopy | null> {
      const db = await openDatabase();
      const record = await new Promise<StoredCopy | undefined>((resolve, reject) => {
        const tx = db.transaction(LOCAL_COPIES_STORE, "readonly");
        const request = tx.objectStore(LOCAL_COPIES_STORE).get(name);
        request.onsuccess = () => resolve(request.result as StoredCopy | undefined);
        request.onerror = () => reject(request.error ?? new Error("Unable to read the local copy."));
        tx.onabort = () => reject(tx.error ?? new Error("The local-copy read was aborted."));
      });
      if (!record || record.name !== name) return null;
      return toSavedCopy(record);
    },

    async create(name: string, snapshot: CanonicalTreeExport): Promise<SaveReceipt> {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError("A local copy needs a non-empty name.");
      }
      const record: StoredCopy = {
        name,
        savedAt: new Date().toISOString(),
        revision: String(snapshot.revision),
        files: cloneFiles(snapshot.files),
      };
      const db = await openDatabase();
      await addCopyOnce(db, record);
      return { name: record.name, savedAt: record.savedAt, revision: record.revision };
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
