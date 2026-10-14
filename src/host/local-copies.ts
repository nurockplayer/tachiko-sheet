import type {
  CanonicalProjectFile,
  CanonicalTreeExport,
  ImportedSourceAttachment,
  LocalCopies,
  OpaqueProjectExport,
  OpaqueSavedCopy,
  WorkFileSavedCopy,
  PresentationAttachment,
  SaveReceipt,
  SavedCopy,
  SavedCopySummary,
  AnySavedCopy,
} from "../contracts.js";
import { reportPresentationLimitViolation, requireWorkFileSize } from "../contracts.js";

/**
 * A dedicated IndexedDB database for durable local copies. This name is app
 * identity: it must stay distinct from any runtime/core/designer database so a
 * copy survives independently of the interactive occurrence.
 */
export const LOCAL_COPIES_DB_NAME = "tachiko-sheet-local-copies";
export const LOCAL_COPIES_STORE = "copies";
export const LOCAL_OPAQUE_COPIES_STORE = "opaque-copies";
export const OPAQUE_COPY_FORMAT_VERSION = 2;
// A variant in the existing private store, not a new database/schema or core format.
export const WORK_FILE_COPY_FORMAT_VERSION = 1;
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
  /** Private presentation data paired to this exact opaque snapshot. */
  presentation?: PresentationAttachment;
}

interface StoredWorkFileCopy extends Omit<StoredOpaqueCopy, "kind" | "formatVersion"> {
  kind: "work-file";
  formatVersion: 1;
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
  // IndexedDB records are persisted input. Do not let a malformed optional
  // attachment become a typed runtime value merely because it is truthy.
  if (record.presentation !== undefined) copy.presentation = clonePresentation(record.presentation)!;
  return copy;
}

/** Persisted input and alternate host ports must pass this before cloning or hashing. */
export function validateWorkFileCopy(record: Pick<WorkFileSavedCopy, "revision" | "bytes" | "importedSource" | "presentation">): void {
  if (typeof record.revision !== "string" || !record.revision ||
    Object.prototype.toString.call(record.bytes) !== "[object ArrayBuffer]" || !record.bytes.byteLength) {
    throw new TypeError("The saved work file is invalid. Nothing was opened.");
  }
  requireWorkFileSize(record.bytes.byteLength);
  // Portable packages omit import provenance. No attachment, even an otherwise
  // valid foreign source, can establish provenance for this variant.
  if (record.importedSource !== undefined) {
    throw new TypeError("The saved work file has unsupported import information. Nothing was opened.");
  }
  validatePresentationAttachment(record.presentation);
  if (record.presentation && record.presentation.snapshotRevision !== record.revision) {
    throw new Error("The saved report settings do not match this project copy.");
  }
}

function toWorkFileSavedCopy(record: StoredWorkFileCopy): WorkFileSavedCopy {
  validateWorkFileCopy(record);
  return {
    kind: "work-file",
    formatVersion: WORK_FILE_COPY_FORMAT_VERSION,
    name: record.name,
    savedAt: record.savedAt,
    revision: record.revision,
    bytes: cloneBytes(record.bytes),
    ...(record.presentation !== undefined ? { presentation: clonePresentation(record.presentation) } : {}),
  };
}

export function validatePresentationAttachment(presentation: unknown): asserts presentation is PresentationAttachment | undefined {
  if (presentation === undefined) return;
  if (typeof presentation !== "object" || presentation === null) {
    throw new TypeError("The presentation attachment is invalid.");
  }
  const candidate = presentation as Partial<PresentationAttachment>;
  const report = candidate.report;
  if (candidate.version !== 1 ||
    typeof report !== "object" || report === null ||
    (report.type !== "bar" && report.type !== "line") ||
    typeof report.definitionId !== "string" || report.definitionId.length === 0 ||
    typeof report.title !== "string" || typeof report.categoryLabel !== "string" ||
    typeof report.valueLabel !== "string" || typeof report.legendVisible !== "boolean" ||
    typeof candidate.snapshotRevision !== "string" || candidate.snapshotRevision.length === 0 ||
    typeof candidate.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.snapshotDigest) ||
    reportPresentationLimitViolation(report as PresentationAttachment["report"]) !== null) {
    throw new TypeError("The presentation attachment is invalid.");
  }
}

function clonePresentation(presentation: unknown): PresentationAttachment | undefined {
  validatePresentationAttachment(presentation);
  return presentation === undefined ? undefined : structuredClone(presentation);
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
function addCopyOnce(db: IDBDatabase, storeName: string, record: StoredCopy | StoredOpaqueCopy | StoredWorkFileCopy): Promise<void> {
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

export const COPY_CHANGED_MESSAGE = "This copy changed in another window. Save a copy instead.";

/** CAS and replacement (including a store transition) are one atomic write. */
function replaceCopyOnce(db: IDBDatabase, storeName: string, record: StoredCopy | StoredOpaqueCopy | StoredWorkFileCopy, expected: SavedCopySummary): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readwrite", { durability: "strict" });
    let failure: unknown;
    let checked = 0;
    const entries: StoredListingEntry[] = [];
    tx.oncomplete = () => failure ? reject(failure) : resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("The local-copy transaction was aborted."));
    tx.onerror = () => { failure ??= tx.error ?? new Error("The local-copy transaction failed."); };
    for (const sourceStore of [LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE] as const) {
      const request = tx.objectStore(sourceStore).get(expected.name);
      request.onerror = () => { failure ??= request.error; };
      request.onsuccess = () => {
        if (request.result !== undefined) entries.push({ record: request.result, storeName: sourceStore });
        if (++checked !== 2) return;
        const entry = entries[0];
        const current = entry?.record;
        if (entries.length !== 1 || !hasUsableSummaryMetadata(current) || current.name !== expected.name ||
            current.savedAt !== expected.savedAt || !expected.kind || classifyStoredEnvelope(current, entry!.storeName) !== expected.kind) {
          failure = new Error(COPY_CHANGED_MESSAGE);
          tx.abort();
          return;
        }
        // Ensure even two saves within one millisecond have distinct witnesses.
        if (record.savedAt <= current.savedAt) {
          const previous = Date.parse(current.savedAt);
          if (!Number.isFinite(previous)) {
            failure = new Error(COPY_CHANGED_MESSAGE); tx.abort(); return;
          }
          record.savedAt = new Date(previous + 1).toISOString();
        }
        if (entry!.storeName !== storeName) tx.objectStore(entry!.storeName).delete(expected.name);
        tx.objectStore(storeName).put(record);
      };
    }
  });
}

function deleteCopyOnce(db: IDBDatabase, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readwrite", { durability: "strict" });
    let failure: unknown;
    let checked = 0;
    const locations: string[] = [];
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("The copy could not be deleted."));
    for (const storeName of [LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE]) {
      const request = tx.objectStore(storeName).get(name);
      request.onsuccess = () => {
        if (request.result !== undefined) locations.push(storeName);
        if (++checked !== 2) return;
        if (locations.length > 1) {
          failure = new Error(`The local-copy name “${name}” exists in multiple stores. Nothing was deleted.`);
          tx.abort();
        } else if (locations[0]) tx.objectStore(locations[0]).delete(name);
      };
    }
  });
}

interface StoredListingEntry {
  record: unknown;
  storeName: typeof LOCAL_COPIES_STORE | typeof LOCAL_OPAQUE_COPIES_STORE;
}

interface SummaryMetadata {
  name: string;
  savedAt: string;
}

function summarize(record: SummaryMetadata, storeName: StoredListingEntry["storeName"]): SavedCopySummary {
  const kind = classifyStoredEnvelope(record, storeName);
  return {
    name: record.name,
    savedAt: record.savedAt,
    ...(kind ? {kind} : {}),
  };
}

/**
 * Admit only stored envelopes whose kind/version combination is understood.
 * The v1 IndexedDB canonical records intentionally have neither property;
 * their schema version is not a canonical record format version.
 */
function classifyStoredEnvelope(record: unknown, storeName: StoredListingEntry["storeName"]): SavedCopySummary["kind"] | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const envelope = record as Record<string, unknown>;
  const hasKind = Object.prototype.hasOwnProperty.call(envelope, "kind");
  const hasFormatVersion = Object.prototype.hasOwnProperty.call(envelope, "formatVersion");

  if (storeName === LOCAL_COPIES_STORE && !hasKind && !hasFormatVersion) return "canonical";
  if (storeName === LOCAL_COPIES_STORE && hasKind && envelope.kind === "canonical" && !hasFormatVersion) return "canonical";
  if (storeName === LOCAL_OPAQUE_COPIES_STORE && hasKind && envelope.kind === "opaque" && hasFormatVersion &&
      typeof envelope.formatVersion === "number" && envelope.formatVersion === OPAQUE_COPY_FORMAT_VERSION) {
    return "opaque";
  }
  if (storeName === LOCAL_OPAQUE_COPIES_STORE && hasKind && envelope.kind === "work-file" &&
      hasFormatVersion && envelope.formatVersion === WORK_FILE_COPY_FORMAT_VERSION) {
    try {
      validateWorkFileCopy(envelope as unknown as StoredWorkFileCopy);
      return "work-file";
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function hasUsableSummaryMetadata(record: unknown): record is Record<string, unknown> & SummaryMetadata {
  if (typeof record !== "object" || record === null) return false;
  const candidate = record as Record<string, unknown>;
  return typeof candidate.name === "string" && typeof candidate.savedAt === "string";
}

function compareSummaries(left: SummaryMetadata, right: SummaryMetadata): number {
  if (left.savedAt !== right.savedAt) return left.savedAt < right.savedAt ? 1 : -1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

/** Disable only the portable writer for rollback; all readers stay installed. */
export function createLocalCopies(options: { workFileWrites?: boolean } = {}): LocalCopies {
  const host = {
    async list(): Promise<SavedCopySummary[]> {
      const db = await openDatabase();
      const records = await new Promise<StoredListingEntry[]>((resolve, reject) => {
        const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readonly");
        let canonical: unknown[] | undefined;
        let opaque: unknown[] | undefined;
        const finish = () => {
          if (!canonical || !opaque) return;
          resolve([
            ...canonical.map((record): StoredListingEntry => ({record, storeName: LOCAL_COPIES_STORE})),
            ...opaque.map((record): StoredListingEntry => ({record, storeName: LOCAL_OPAQUE_COPIES_STORE})),
          ]);
        };
        const canonicalRequest = tx.objectStore(LOCAL_COPIES_STORE).getAll();
        canonicalRequest.onsuccess = () => {
          canonical = (canonicalRequest.result ?? []) as unknown[];
          finish();
        };
        canonicalRequest.onerror = () => reject(canonicalRequest.error ?? new Error("Unable to read canonical local copies."));
        const opaqueRequest = tx.objectStore(LOCAL_OPAQUE_COPIES_STORE).getAll();
        opaqueRequest.onsuccess = () => {
          opaque = (opaqueRequest.result ?? []) as unknown[];
          finish();
        };
        opaqueRequest.onerror = () => reject(opaqueRequest.error ?? new Error("Unable to read opaque local copies."));
        tx.onabort = () => reject(tx.error ?? new Error("The local-copy read was aborted."));
      });
      return records
        .filter((entry): entry is StoredListingEntry & {record: Record<string, unknown> & SummaryMetadata} => hasUsableSummaryMetadata(entry.record))
        .sort((left, right) => compareSummaries(left.record, right.record))
        .map((entry) => summarize(entry.record, entry.storeName));
    },

    async readAny(name: string): Promise<AnySavedCopy | null> {
      const db = await openDatabase();
      const entry = await new Promise<StoredListingEntry | null>((resolve, reject) => {
        const tx = db.transaction([LOCAL_COPIES_STORE, LOCAL_OPAQUE_COPIES_STORE], "readonly");
        let canonical: unknown;
        let opaque: unknown;
        let completed = 0;
        const finish = () => {
          completed += 1;
          if (completed !== 2) return;
          if (canonical !== undefined && opaque !== undefined) {
            reject(new Error(`The local-copy name "${name}" exists in multiple stores.`));
          } else if (canonical !== undefined) {
            resolve({record: canonical, storeName: LOCAL_COPIES_STORE});
          } else if (opaque !== undefined) {
            resolve({record: opaque, storeName: LOCAL_OPAQUE_COPIES_STORE});
          } else {
            resolve(null);
          }
        };
        const canonicalRequest = tx.objectStore(LOCAL_COPIES_STORE).get(name);
        canonicalRequest.onsuccess = () => {
          canonical = canonicalRequest.result;
          finish();
        };
        canonicalRequest.onerror = () => reject(canonicalRequest.error ?? new Error("Unable to read canonical local copy."));
        const opaqueRequest = tx.objectStore(LOCAL_OPAQUE_COPIES_STORE).get(name);
        opaqueRequest.onsuccess = () => {
          opaque = opaqueRequest.result;
          finish();
        };
        opaqueRequest.onerror = () => reject(opaqueRequest.error ?? new Error("Unable to read opaque local copy."));
        tx.onabort = () => reject(tx.error ?? new Error("The local-copy read was aborted."));
      });
      if (!entry) return null;
      const record = entry.record;
      if (typeof record !== "object" || record === null) {
        throw new TypeError(`The local copy "${name}" uses an unsupported record envelope or storage location.`);
      }
      if ((record as Record<string, unknown>).name !== name) return null;
      // Preserve the plain corrupt/over-limit refusal while list classifies the
      // same invalid input without failing unrelated rows.
      const envelope = record as Record<string, unknown>;
      if (entry.storeName === LOCAL_OPAQUE_COPIES_STORE && envelope.kind === "work-file" &&
        envelope.formatVersion === WORK_FILE_COPY_FORMAT_VERSION) {
        return toWorkFileSavedCopy(record as StoredWorkFileCopy);
      }
      const kind = classifyStoredEnvelope(record, entry.storeName);
      if (kind === "opaque") return toOpaqueSavedCopy(record as StoredOpaqueCopy);
      if (kind === "canonical") return toCanonicalSavedCopy(record as StoredCopy);
      throw new TypeError(`The local copy "${name}" uses an unsupported record envelope or storage location.`);
    },

    async read(name: string): Promise<SavedCopy | null> {
      // Keep the pre-J4 signature source-compatible. New callers must use
      // readAny and dispatch on the returned discriminator before opening a
      // record. Never expose an opaque record through the legacy canonical
      // return type, which would make it possible to open it as tree files.
      const copy = await this.readAny(name);
      if (copy?.kind === "work-file") throw new TypeError("Work-file local copies must be read with readAny().");
      if (copy?.kind === "opaque") {
        throw new TypeError("Opaque local copies must be read with readAny().");
      }
      return copy;
    },

    async create(name: string, snapshot: CanonicalTreeExport, importedSource?: ImportedSourceAttachment, expected?: SavedCopySummary): Promise<SaveReceipt> {
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
      if (expected) await replaceCopyOnce(db, LOCAL_COPIES_STORE, record, expected);
      else await addCopyOnce(db, LOCAL_COPIES_STORE, record);
      return {name: record.name, savedAt: record.savedAt, kind: "canonical", revision: record.revision};
    },

    async createOpaque(name: string, snapshot: OpaqueProjectExport, expected?: SavedCopySummary): Promise<SaveReceipt> {
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
        presentation: clonePresentation(snapshot.presentation),
      };
      const db = await openDatabase();
      if (expected) await replaceCopyOnce(db, LOCAL_OPAQUE_COPIES_STORE, record, expected);
      else await addCopyOnce(db, LOCAL_OPAQUE_COPIES_STORE, record);
      return {name: record.name, savedAt: record.savedAt, kind: "opaque", revision: record.revision};
    },

    ...(options.workFileWrites === false ? {} : {
      async createWorkFile(name: string, snapshot: OpaqueProjectExport, expected?: SavedCopySummary): Promise<SaveReceipt> {
        if (typeof name !== "string" || !name) throw new TypeError("A local copy needs a non-empty name.");
        const record: StoredWorkFileCopy = {
          kind: "work-file",
          formatVersion: WORK_FILE_COPY_FORMAT_VERSION,
          name,
          savedAt: new Date().toISOString(),
          revision: snapshot.revision,
          bytes: snapshot.bytes,
          ...(snapshot.importedSource !== undefined ? { importedSource: snapshot.importedSource } : {}),
          ...(snapshot.presentation !== undefined ? { presentation: snapshot.presentation } : {}),
        };
        // Clone before any await; no caller can mutate the pending durable payload.
        const copy = toWorkFileSavedCopy(record);
        const db = await openDatabase();
        if (expected) await replaceCopyOnce(db, LOCAL_OPAQUE_COPIES_STORE, copy, expected);
        else await addCopyOnce(db, LOCAL_OPAQUE_COPIES_STORE, copy);
        return { name: copy.name, savedAt: copy.savedAt, kind: "work-file", revision: copy.revision };
      },
    }),

    async delete(name: string): Promise<void> {
      if (typeof name !== "string" || !name) throw new TypeError("A local copy needs a non-empty name.");
      await deleteCopyOnce(await openDatabase(), name);
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
  return {
    ...host,
    replace: (expected, snapshot, importedSource) => host.create(expected.name, snapshot, importedSource, { ...expected }),
    replaceOpaque: (expected, snapshot) => host.createOpaque(expected.name, snapshot, { ...expected }),
    ...(options.workFileWrites === false ? {} : {
      replaceWorkFile: (expected: SavedCopySummary, snapshot: OpaqueProjectExport) => host.createWorkFile!(expected.name, snapshot, { ...expected }),
    }),
  };
}
