/**
 * Acceptance-only wiring for the Sheet M1 product slice.
 *
 * This module may observe real runtime/host/DOM state and may inject one
 * bounded fault into a real operation. It never publishes semantic state,
 * substitutes calculation results, approves anything or fabricates receipts.
 * It is imported only by the `acceptance` build (see `src/main.tsx`).
 */
import {
  UnknownOperationOutcomeError,
  type CoreKit,
  type KitLoader,
  type LocalCopies,
  type PresentationAttachment,
  type SheetRuntime,
  type WorkbookView,
} from "../contracts.js";
import { LOCAL_COPIES_DB_NAME, LOCAL_COPIES_STORE } from "../host/local-copies.js";
import type { FieldProjection, PublicationProjection } from "../../public/core-kit/experimental-client.js";
import { hashCanonicalFiles } from "./canonical-hash.js";
import { applyResolvedProfile, resolveInterfaceProfile } from "../ui/interface-profile/index.js";

export interface AcceptanceRuntimeSnapshot {
  occurrence: string;
  revision: string;
  opaqueBytesHash: string;
}

export interface AcceptanceSavedSnapshot {
  kind: "canonical" | "opaque";
  revision: string;
  bytesHash: string;
  presentation: PresentationAttachment | null;
}

export interface AcceptanceObservation {
  occurrence: string;
  revision: string;
  entity: string;
  impact: number | null;
  priority: number | null;
  notes: string | null;
  canonicalHash: string;
}

export interface AcceptanceSaveObservation {
  saveStatus: string | null;
  saved: boolean;
  dirty: boolean;
  currentness: string | null;
}

export interface AcceptanceUnknownObservation {
  outcome: string;
  saved: boolean;
  staleValuesPresentedAsCurrent: boolean;
  currentness: string | null;
}

export interface AcceptanceCoreFailureProbe {
  name: string;
  causeName: string;
  causeFailureCode: string | null;
}

export interface AcceptanceApi {
  runtimeSnapshot(): Promise<AcceptanceRuntimeSnapshot>;
  savedSnapshot(name: string): Promise<AcceptanceSavedSnapshot | null>;
  workMethodCounts(): Record<string, number>;
  applyInterfaceProfile(input: unknown): boolean;
  observe(): Promise<AcceptanceObservation>;
  savedHash(name: string): Promise<string | null>;
  failNextSave(): void;
  failNextSpreadsheetExport(): void;
  failNextCleanupPreview(): void;
  deferNextImportInspection(): void;
  releaseImportInspection(): void;
  deferNextImportApplication(): void;
  releaseImportApplication(): void;
  deferNextCopyWrite(): void;
  releaseCopyWrite(): void;
  loseNextExecuteReply(): void;
  loseNextOpenReply(): void;
  loseNextImportBeforeDispatch(): void;
  loseNextImportReplyAfterDispatch(): void;
  failNextImportProjection(): void;
  failNextOpenProjection(): void;
  failNextJ4PostPublicationRead(): void;
  openProjectRequestCount(): number;
  importSpreadsheetRequestCount(): number;
  executeRequestCount(): number;
  settleFaultWindow(): Promise<void>;
  saveObservation(): AcceptanceSaveObservation;
  unknownObservation(): AcceptanceUnknownObservation;
  lastReceipt(): PublicationProjection | null;
  exportDispatchCounts(): { canonical: number; opaque: number };
  copyWriteDispatchCounts(): { canonical: number; opaque: number };
  acceptanceHarnessVersion(): string;
  resetCoreFailureProbe(): void;
  coreFailureProbe(): AcceptanceCoreFailureProbe | null;
}

export interface AcceptanceWiring {
  runtime: SheetRuntime;
  copies: LocalCopies;
}

declare global {
  interface Window {
    __tachikoAcceptance?: AcceptanceApi;
  }
}

type PublicClient = ReturnType<CoreKit["createExperimentalDesignerClient"]>;

const EDIT_METHODS = new Set(["editNumber", "editText", "editBoolean", "editDate"]);
const PUBLICATION_METHODS = new Set([...EDIT_METHODS, "commitCleanup"]);
const OBSERVED_COLUMN_KEYS = ["impact", "priority", "notes"] as const;
const ACCEPTANCE_HARNESS_VERSION = "j4-no-resident-runtime-read-probe-v2";

let wiring: AcceptanceWiring | null = null;
const workMethodInvocations = new Map<string, number>();
let dispatchCount = 0;
let loseArmed = false;
let openReplyFaultArmed = false;
let importBeforeDispatchFaultArmed = false;
let importReplyAfterDispatchFaultArmed = false;
let importProjectionFaultRequested = false;
let importProjectionFaultArmed = false;
let openProjectionFaultArmed = false;
let j4PostPublicationReadFaultRequested = false;
let j4PostPublicationReadFaultArmed = false;
let j4PostPublicationReadSkipped = false;
let openProjectDispatchCount = 0;
let importSpreadsheetDispatchCount = 0;
let exportCanonicalDispatchCount = 0;
let exportOpaqueDispatchCount = 0;
let copyCanonicalDispatchCount = 0;
let copyOpaqueDispatchCount = 0;
let lastReceiptValue: PublicationProjection | null = null;
let settlePendingFault: (() => void) | null = null;
let pendingFault: Promise<void> | null = null;
let lastCoreFailureProbe: AcceptanceCoreFailureProbe | null = null;
let spreadsheetExportFaultArmed = false;
let cleanupPreviewFaultArmed = false;

function operationGate() {
  let armed = false;
  let active = false;
  let pending: Promise<void> | null = null;
  let releasePending: (() => void) | null = null;
  return {
    defer(): void {
      if (armed || active) return;
      armed = true;
      pending = new Promise<void>((resolve) => { releasePending = resolve; });
    },
    async pause(): Promise<void> {
      if (!armed || !pending) return;
      armed = false;
      active = true;
      const wait = pending;
      pending = null;
      await wait;
      active = false;
    },
    release(): void {
      const resolve = releasePending;
      releasePending = null;
      resolve?.();
    },
  };
}

const importInspectionGate = operationGate();
const importApplicationGate = operationGate();
const copyWriteGate = operationGate();

function requireWiring(): AcceptanceWiring {
  if (!wiring) throw new Error("The acceptance wiring has not been installed.");
  return wiring;
}

/**
 * Wraps the real kit loader so the acceptance build observes the actual public
 * client instance dispatched by the product, via a Proxy with bound methods.
 */
export function wrapKitLoader(load: KitLoader): KitLoader {
  return async (): Promise<CoreKit> => instrumentKit(await load());
}

function instrumentKit(kit: CoreKit): CoreKit {
  const create = kit.createExperimentalDesignerClient;
  return {
    ...kit,
    createExperimentalDesignerClient: () => observeClientMethods(instrumentClient(create())),
  };
}

/** Count public client invocations without changing the existing fault wrappers. */
function observeClientMethods(client: PublicClient): PublicClient {
  return new Proxy(client, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        if (typeof property === "string") {
          workMethodInvocations.set(property, (workMethodInvocations.get(property) ?? 0) + 1);
        }
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function instrumentClient(client: PublicClient): PublicClient {
  return new Proxy(client, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (typeof property === "string" && PUBLICATION_METHODS.has(property)) {
        return (...args: unknown[]): Promise<PublicationProjection> =>
          dispatchPublication(target, property, args);
      }
      if (property === "queryTable") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (openProjectionFaultArmed) {
            openProjectionFaultArmed = false;
            throw new Error("The replacement projection reply was lost after real open dispatch.");
          }
          if (importProjectionFaultArmed) {
            importProjectionFaultArmed = false;
            throw new Error("The replacement projection reply was lost after real import dispatch.");
          }
          // A J4 create first re-observes its acknowledged publication inside
          // the runtime. The App's following read is deliberately faulted to
          // exercise its published-recovery boundary without faking a receipt.
          if (j4PostPublicationReadFaultArmed) {
            if (!j4PostPublicationReadSkipped) {
              j4PostPublicationReadSkipped = true;
            } else {
              j4PostPublicationReadFaultArmed = false;
              j4PostPublicationReadSkipped = false;
              throw new Error("The post-publication J4 read projection reply was lost.");
            }
          }
          return result;
        };
      }
      if (property === "inspectSpreadsheet") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          await importInspectionGate.pause();
          return result;
        };
      }
      if (property === "createKeyedGroupedSum") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (j4PostPublicationReadFaultRequested) {
            j4PostPublicationReadFaultRequested = false;
            j4PostPublicationReadFaultArmed = true;
            j4PostPublicationReadSkipped = false;
          }
          return result;
        };
      }
      if (property === "openProject") {
        return async (...args: unknown[]): Promise<unknown> => {
          openProjectDispatchCount += 1;
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (openReplyFaultArmed) {
            openReplyFaultArmed = false;
            throw new UnknownOperationOutcomeError("The dispatched open reply was lost after the real transport replied.");
          }
          return result;
        };
      }
      if (property === "importSpreadsheet") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (importBeforeDispatchFaultArmed) {
            importBeforeDispatchFaultArmed = false;
            throw new UnknownOperationOutcomeError("Import delivery outcome was unknown before dispatch; no candidate was sent.");
          }
          const loseReplyAfterDispatch = importReplyAfterDispatchFaultArmed;
          importReplyAfterDispatchFaultArmed = false;
          importSpreadsheetDispatchCount += 1;
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          await importApplicationGate.pause();
          if (loseReplyAfterDispatch) {
            throw new UnknownOperationOutcomeError("The dispatched import reply was lost after the real transport replied.");
          }
          if (importProjectionFaultRequested) {
            importProjectionFaultRequested = false;
            importProjectionFaultArmed = true;
          }
          return result;
        };
      }
      if (property === "exportSpreadsheet") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (spreadsheetExportFaultArmed) {
            spreadsheetExportFaultArmed = false;
            throw new Error("The acceptance probe rejected spreadsheet export once.");
          }
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === "previewCleanup") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (cleanupPreviewFaultArmed) {
            cleanupPreviewFaultArmed = false;
            throw new Error("The acceptance probe rejected cleanup preview once.");
          }
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === "exportCanonicalTree") {
        return (...args: unknown[]): Promise<unknown> => {
          exportCanonicalDispatchCount += 1;
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === "exportProject") {
        return (...args: unknown[]): Promise<unknown> => {
          exportOpaqueDispatchCount += 1;
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Genuine publication dispatch. When the reply-loss arm is set, the real call
 * is made exactly once, its real successful projection is retained
 * observationally and only then is an unknown outcome raised. The result is
 * never resent. This includes scalar edits and cleanup commits.
 */
async function dispatchPublication(
  target: PublicClient,
  method: string,
  args: unknown[],
): Promise<PublicationProjection> {
  dispatchCount += 1;
  const call = (): Promise<PublicationProjection> =>
    (target[method as keyof PublicClient] as (...rest: unknown[]) => Promise<PublicationProjection>)(
      ...args,
    );
  if (loseArmed) {
    loseArmed = false;
    try {
      lastReceiptValue = await call();
      throw new UnknownOperationOutcomeError(
        "The dispatched change reply was lost after the real transport replied.",
      );
    } finally {
      const resolve = settlePendingFault;
      settlePendingFault = null;
      resolve?.();
    }
  }
  const receipt = await call();
  lastReceiptValue = receipt;
  return receipt;
}

function columnId(view: WorkbookView, key: string): string | null {
  return view.table.columns.find((column) => column.key === key)?.id ?? null;
}

/** Target entity is the first actual table row that exposes all observed columns. */
function selectTarget(view: WorkbookView): string {
  for (const row of view.table.rows) {
    const entity = row.fields[0]?.target.entity ?? row.id;
    const complete = OBSERVED_COLUMN_KEYS.every((key) => {
      const id = columnId(view, key);
      return id !== null && row.fields.some((field) => field.target.field === id);
    });
    if (complete) return entity;
  }
  throw new Error("No projected table row exposes the impact/priority/notes columns.");
}

function fieldFor(batch: readonly FieldProjection[], entity: string, field: string): FieldProjection | null {
  return (
    batch.find(
      (candidate) => candidate.target.entity === entity && candidate.target.field === field,
    ) ?? null
  );
}

function storedNumber(field: FieldProjection | null): number | null {
  if (!field) return null;
  if (field.stored?.kind === "number") return field.stored.value;
  if (field.calculated?.status === "value") return field.calculated.value;
  return null;
}

function calculatedNumber(field: FieldProjection | null): number | null {
  if (!field) return null;
  if (field.calculated?.status === "value") return field.calculated.value;
  if (field.stored?.kind === "number") return field.stored.value;
  return null;
}

function storedText(field: FieldProjection | null): string | null {
  return field?.stored?.kind === "text" ? field.stored.value : null;
}

/** Actual runtime read plus a bounded field read and an explicit debug export. */
export async function observe(): Promise<AcceptanceObservation> {
  const { runtime } = requireWiring();
  const view = await runtime.read();
  const entity = selectTarget(view);
  const impactColumn = columnId(view, "impact");
  const priorityColumn = columnId(view, "priority");
  const notesColumn = columnId(view, "notes");
  if (!impactColumn || !priorityColumn || !notesColumn) {
    throw new Error("The open work does not project the impact/priority/notes columns.");
  }
  const witness = { occurrence: view.occurrence, revision: view.revision };
  const batch = await runtime.readFields(witness, [
    { entity, field: impactColumn },
    { entity, field: priorityColumn },
    { entity, field: notesColumn },
  ]);
  const tree = await runtime.exportCanonical(witness);
  return {
    occurrence: view.occurrence,
    revision: view.revision,
    entity,
    impact: storedNumber(fieldFor(batch.fields, entity, impactColumn)),
    priority: calculatedNumber(fieldFor(batch.fields, entity, priorityColumn)),
    notes: storedText(fieldFor(batch.fields, entity, notesColumn)),
    canonicalHash: await hashCanonicalFiles(tree.files),
  };
}

/** Generic real-kit observation; unlike the M1 probe, no column names are assumed. */
export async function runtimeSnapshot(): Promise<AcceptanceRuntimeSnapshot> {
  const { runtime } = requireWiring();
  const view = await runtime.read();
  const snapshot = await runtime.exportOpaque({ occurrence: view.occurrence, revision: view.revision });
  return { occurrence: view.occurrence, revision: view.revision, opaqueBytesHash: await hashBytes(snapshot.bytes) };
}

/** Readonly host observation; opaque bytes and their attachment are never decoded or rewritten. */
export async function savedSnapshot(name: string): Promise<AcceptanceSavedSnapshot | null> {
  const copy = await requireWiring().copies.readAny(name);
  if (!copy) return null;
  if (copy.kind === "opaque") {
    return {
      kind: "opaque",
      revision: copy.revision,
      bytesHash: await hashBytes(copy.bytes),
      presentation: copy.presentation ? structuredClone(copy.presentation) : null,
    };
  }
  return { kind: "canonical", revision: copy.revision, bytesHash: await hashCanonicalFiles(copy.files), presentation: null };
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function workMethodCounts(): Record<string, number> {
  return Object.fromEntries(workMethodInvocations);
}

/** Exercise the production appearance seam only; this helper has no runtime/host access. */
export function applyInterfaceProfile(input: unknown): boolean {
  const resolved = resolveInterfaceProfile(input);
  return resolved.ok && applyResolvedProfile(document.documentElement, resolved.value);
}

/** Hash of the durable bytes actually stored by the host, or null when absent. */
export async function savedHash(name: string): Promise<string | null> {
  const { copies } = requireWiring();
  const copy = await copies.read(name);
  if (!copy) return null;
  return hashCanonicalFiles(copy.files);
}

let saveFaultArmed = false;
let restoreTransaction: (() => void) | null = null;

function matchesHostCopyWrite(db: IDBDatabase, storeNames: string | string[], mode?: IDBTransactionMode): boolean {
  if (db.name !== LOCAL_COPIES_DB_NAME) return false;
  if (mode !== "readwrite") return false;
  const names = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
  return names.includes(LOCAL_COPIES_STORE);
}

/**
 * Aborts the NEXT real local-copies readwrite transaction before commit by
 * wrapping only `IDBDatabase.prototype.transaction` for the duration of the
 * fault. Other databases, stores and readonly transactions are untouched.
 */
export function failNextSave(): void {
  if (saveFaultArmed) return;
  saveFaultArmed = true;
  const prototype = IDBDatabase.prototype;
  const original = prototype.transaction;
  const patched = function (
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ): IDBTransaction {
    const transaction = original.call(this, storeNames, mode, options);
    if (saveFaultArmed && matchesHostCopyWrite(this, storeNames, mode)) {
      saveFaultArmed = false;
      restore();
      queueMicrotask(() => {
        try {
          transaction.abort();
        } catch {
          // The transaction already settled; the fault is a no-op then.
        }
      });
    }
    return transaction;
  };
  prototype.transaction = patched as typeof original;
  restoreTransaction = (): void => {
    if (prototype.transaction === (patched as typeof original)) {
      prototype.transaction = original;
    }
    restoreTransaction = null;
  };
}

/** One-shot acceptance-only Prepare failure; the next export uses the real kit. */
export function failNextSpreadsheetExport(): void {
  spreadsheetExportFaultArmed = true;
}

/** One-shot acceptance-only cleanup preview failure; later previews use the real kit. */
export function failNextCleanupPreview(): void {
  cleanupPreviewFaultArmed = true;
}

export function deferNextImportInspection(): void {
  importInspectionGate.defer();
}

export function releaseImportInspection(): void {
  importInspectionGate.release();
}

export function deferNextImportApplication(): void {
  importApplicationGate.defer();
}

export function releaseImportApplication(): void {
  importApplicationGate.release();
}

export function deferNextCopyWrite(): void {
  copyWriteGate.defer();
}

export function releaseCopyWrite(): void {
  copyWriteGate.release();
}

function restore(): void {
  restoreTransaction?.();
}

function renderedCurrentness(): string | null {
  const fact = document.querySelector(
    '[data-testid^="cell:"][data-work-currentness], [data-testid^="brief:"][data-work-currentness]',
  );
  if (fact) return fact.getAttribute("data-work-currentness");
  return document.querySelector("[data-work-currentness]")?.getAttribute("data-work-currentness") ?? null;
}

function renderedDirty(): boolean {
  return document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true";
}

/** Reads the real rendered save status, dirty state and fact currentness. */
export function saveObservation(): AcceptanceSaveObservation {
  const saveStatus = document.querySelector('[data-testid="save-status"]')?.textContent?.trim() ?? null;
  return {
    saveStatus,
    saved: saveStatus === "Saved on this device",
    dirty: renderedDirty(),
    currentness: renderedCurrentness(),
  };
}

/** Reads the real rendered operation outcome and whether facts claim currentness. */
export function unknownObservation(): AcceptanceUnknownObservation {
  const text = document.querySelector('[data-testid="operation-outcome"]')?.textContent?.trim() ?? "";
  const normalized = text.toLowerCase();
  const outcome = normalized.includes("unknown") || normalized.includes("needs review")
    ? "unknown"
    : normalized.includes("applying") || normalized.includes("pending")
      ? "pending"
      : "idle";
  const facts = document.querySelectorAll(
    '[data-testid^="cell:"][data-work-currentness], [data-testid^="brief:"][data-work-currentness]',
  );
  const staleValuesPresentedAsCurrent = Array.from(facts).some(
    (fact) => fact.getAttribute("data-work-currentness") === "current",
  );
  return {
    outcome,
    saved: saveObservation().saved,
    staleValuesPresentedAsCurrent,
    currentness: renderedCurrentness(),
  };
}

/** The last real publication projection dispatched through the public client. */
export function lastReceipt(): PublicationProjection | null {
  return lastReceiptValue ? { ...lastReceiptValue } : null;
}

export function executeRequestCount(): number {
  return dispatchCount;
}

export function loseNextExecuteReply(): void {
  if (loseArmed) return;
  loseArmed = true;
  pendingFault = new Promise<void>((resolve) => {
    settlePendingFault = resolve;
  });
}

export function loseNextOpenReply(): void {
  openReplyFaultArmed = true;
}

/**
 * Simulates delivery uncertainty before a candidate is dispatched. No import
 * call is made; this arm is deliberately distinct from reply loss.
 */
export function loseNextImportBeforeDispatch(): void {
  importReplyAfterDispatchFaultArmed = false;
  importBeforeDispatchFaultArmed = true;
}

/** Simulates a lost reply only after one real import dispatch has succeeded. */
export function loseNextImportReplyAfterDispatch(): void {
  importBeforeDispatchFaultArmed = false;
  importReplyAfterDispatchFaultArmed = true;
}

export function failNextImportProjection(): void {
  importProjectionFaultRequested = true;
  importProjectionFaultArmed = false;
}

export function failNextJ4PostPublicationRead(): void {
  j4PostPublicationReadFaultRequested = true;
  j4PostPublicationReadFaultArmed = false;
  j4PostPublicationReadSkipped = false;
}

export function failNextOpenProjection(): void {
  openProjectionFaultArmed = true;
}

export function openProjectRequestCount(): number {
  return openProjectDispatchCount;
}

export function importSpreadsheetRequestCount(): number {
  return importSpreadsheetDispatchCount;
}

export function exportDispatchCounts(): { canonical: number; opaque: number } {
  return { canonical: exportCanonicalDispatchCount, opaque: exportOpaqueDispatchCount };
}

export function copyWriteDispatchCounts(): { canonical: number; opaque: number } {
  return { canonical: copyCanonicalDispatchCount, opaque: copyOpaqueDispatchCount };
}

export function acceptanceHarnessVersion(): string {
  return ACCEPTANCE_HARNESS_VERSION;
}

export function resetCoreFailureProbe(): void {
  lastCoreFailureProbe = null;
}

export function coreFailureProbe(): AcceptanceCoreFailureProbe | null {
  return lastCoreFailureProbe ? { ...lastCoreFailureProbe } : null;
}

function installRuntimeReadProbe(runtime: SheetRuntime): void {
  const originalRead = runtime.read;
  runtime.read = async function readWithAcceptanceProbe(): Promise<WorkbookView> {
    try {
      return await originalRead.call(runtime);
    } catch (error) {
      const cause = (error as { cause?: unknown } | null)?.cause as {
        name?: unknown;
        failure?: { code?: unknown };
      } | null;
      lastCoreFailureProbe = {
        name: error instanceof Error ? error.name : "unknown",
        causeName: typeof cause?.name === "string" ? cause.name : "unknown",
        causeFailureCode: typeof cause?.failure?.code === "string" ? cause.failure.code : null,
      };
      throw error;
    }
  };
}

/** Resolves only when the bounded real-dispatch / drop experiment has settled. */
export async function settleFaultWindow(): Promise<void> {
  await (pendingFault ?? Promise.resolve());
}

export function installAcceptance(next: AcceptanceWiring): void {
  wiring = next;
  installRuntimeReadProbe(next.runtime);
  const create = next.copies.create;
  const createOpaque = next.copies.createOpaque;
  if (typeof create === "function") {
    next.copies.create = async (...args) => {
      copyCanonicalDispatchCount += 1;
      const result = await create.apply(next.copies, args);
      await copyWriteGate.pause();
      return result;
    };
  }
  if (typeof createOpaque === "function") {
    next.copies.createOpaque = async (...args) => {
      copyOpaqueDispatchCount += 1;
      const result = await createOpaque.apply(next.copies, args);
      await copyWriteGate.pause();
      return result;
    };
  }
  window.__tachikoAcceptance = {
    runtimeSnapshot,
    savedSnapshot,
    workMethodCounts,
    applyInterfaceProfile,
    observe,
    savedHash,
    failNextSave,
    failNextSpreadsheetExport,
    failNextCleanupPreview,
    deferNextImportInspection,
    releaseImportInspection,
    deferNextImportApplication,
    releaseImportApplication,
    deferNextCopyWrite,
    releaseCopyWrite,
    loseNextExecuteReply,
    loseNextOpenReply,
    loseNextImportBeforeDispatch,
    loseNextImportReplyAfterDispatch,
    failNextImportProjection,
    failNextOpenProjection,
    failNextJ4PostPublicationRead,
    openProjectRequestCount,
    importSpreadsheetRequestCount,
    executeRequestCount,
    settleFaultWindow,
    saveObservation,
    unknownObservation,
    lastReceipt,
    exportDispatchCounts,
    copyWriteDispatchCounts,
    acceptanceHarnessVersion,
    resetCoreFailureProbe,
    coreFailureProbe,
  };
}
