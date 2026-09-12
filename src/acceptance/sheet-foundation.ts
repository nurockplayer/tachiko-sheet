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
  type SheetRuntime,
  type WorkbookView,
} from "../contracts.js";
import { LOCAL_COPIES_DB_NAME, LOCAL_COPIES_STORE } from "../host/local-copies.js";
import type { FieldProjection, PublicationProjection } from "../../public/core-kit/experimental-client.js";
import { hashCanonicalFiles } from "./canonical-hash.js";

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

export interface AcceptanceApi {
  observe(): Promise<AcceptanceObservation>;
  savedHash(name: string): Promise<string | null>;
  failNextSave(): void;
  loseNextExecuteReply(): void;
  failNextOpenProjection(): void;
  executeRequestCount(): number;
  settleFaultWindow(): Promise<void>;
  saveObservation(): AcceptanceSaveObservation;
  unknownObservation(): AcceptanceUnknownObservation;
  lastReceipt(): PublicationProjection | null;
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
const OBSERVED_COLUMN_KEYS = ["impact", "priority", "notes"] as const;

let wiring: AcceptanceWiring | null = null;
let dispatchCount = 0;
let loseArmed = false;
let openProjectionFaultArmed = false;
let lastReceiptValue: PublicationProjection | null = null;
let settlePendingFault: (() => void) | null = null;
let pendingFault: Promise<void> | null = null;

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
    createExperimentalDesignerClient: () => instrumentClient(create()),
  };
}

function instrumentClient(client: PublicClient): PublicClient {
  return new Proxy(client, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (typeof property === "string" && EDIT_METHODS.has(property)) {
        return (...args: unknown[]): Promise<PublicationProjection> =>
          dispatchScalarEdit(target, property, args);
      }
      if (property === "queryTable") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (openProjectionFaultArmed) {
            openProjectionFaultArmed = false;
            throw new Error("The replacement projection reply was lost after real open dispatch.");
          }
          return result;
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Genuine scalar-edit dispatch. When the reply-loss arm is set, the real call is
 * made exactly once, its real successful projection is retained observationally
 * and only then is an unknown outcome raised. The result is never resent.
 */
async function dispatchScalarEdit(
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
  const outcome = normalized.includes("unknown")
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

export function failNextOpenProjection(): void {
  openProjectionFaultArmed = true;
}

/** Resolves only when the bounded real-dispatch / drop experiment has settled. */
export async function settleFaultWindow(): Promise<void> {
  await (pendingFault ?? Promise.resolve());
}

export function installAcceptance(next: AcceptanceWiring): void {
  wiring = next;
  window.__tachikoAcceptance = {
    observe,
    savedHash,
    failNextSave,
    loseNextExecuteReply,
    failNextOpenProjection,
    executeRequestCount,
    settleFaultWindow,
    saveObservation,
    unknownObservation,
    lastReceipt,
  };
}
