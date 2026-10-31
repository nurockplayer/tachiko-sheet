import { COLUMN_SAVE_UNAVAILABLE, DUPLICATE_SAVE_UNAVAILABLE, columnSavePreflightDecision, duplicateSavePreflightDecision } from "./application/column-save-preflight.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppearancePreferenceController } from "./application/appearance-preference.js";
import { emptyLocalHistory, observeLocalHistory, type LocalHistorySnapshot } from "./application/local-history.js";
import { DetachedReportPresentations } from "./application/detached-report-presentations.js";
import { readWorkFile, requireWorkFileName, sameWorkFileOmissions, workFileOmissions, WORK_FILE_SAVE_UNAVAILABLE, WORK_FILE_DESKTOP_UNAVAILABLE } from "./application/work-file.js";
import { createMutationCompletion, settledSaveStatus, salesRevisionHasChanged, type MutationRecovery } from "./app/mutation-completion.js";
import { preparedDownloadIsCurrent, type PreparedDownload } from "./application/prepared-download.js";
import type { FieldConstraintInput, FormulaCopy, GroupDimension, GroupScope } from "../public/core-kit/runtime/protocol.js";
import {
  UnknownOperationOutcomeError,
  type AnySavedCopy,
  bindingCatalogContainsDate,
  DATE_SUMMARY_UNSUPPORTED_MESSAGE,
  type CanonicalProjectFile,
  type Currentness,
  type FieldTarget,
  type ImportInspection,
  type ImportedSourceAttachment,
  type ImportSelection,
  type InteropState,
  type KeyedGroupedSumBindingCatalog,
  type KeyedGroupedSumBindingChoice,
  type KeyedGroupedSumResult,
  type LocalCopies,
  LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE,
  type OperationOutcome,
  type PresentationAttachment,
  type ReportConfiguration,
  type SaveStatus,
  type SalesEntryOutcome,
  type SalesCatalogLayoutMarker,
  type SalesEntryTipMarker,
  type SavedCopySummary,
  type ScalarEdit,
  type NewTableColumn,
  type RowInitializer,
  type CellEdit,
  type CommitOutcome,
  type CreateCopyOutcome,
  type PasteCellInput,
  type ColumnInitializer,
  type RowCommandOutcome,
  type SheetRuntime,
  type ViewWitness,
  type WorkbookView,
} from "./contracts.js";
import type { NumberFormat } from "../public/core-kit/runtime/protocol.js";
import {
  OpenedProjectionRecoveryError,
  NoResidentWorkError,
  PublishedProjectionRecoveryError,
  RuntimeStartupError,
} from "./runtime/session.js";
import { SheetShell } from "./ui/SheetShell.js";
import { detectCsvDelimiter, guessCsvEncoding, toUtf8Bytes, type CsvDelimiter, type CsvEncoding } from "./ui/csv-text.js";
import { capacityForView, type CapacityReading } from "./ui/capacity-message.js";
import { workFileOpenRefusal } from "./ui/work-file-copy.js";
import { copyFailureReason } from "./ui/save-close.js";
import { findingColumnTables } from "./ui/interop-copy.js";
import { useHostFiles } from "./host/host-files.js";
import { COPY_CHANGED_MESSAGE, validatePresentationAttachment, validateWorkFileCopy } from "./host/local-copies.js";

/** Fixed same-origin transport inventory; bytes are opaque and never parsed. */
const EXAMPLE_BASE = "/examples/release-plan/";
const J4_CANARY_BASE = "/examples/j4-catalog-sales/";
const SALES_EXAMPLE_BASE = "/examples/sales-catalog/";
const EXAMPLE_FILES: readonly string[] = [
  "manifest.json",
  "schemas.json",
  ...Array.from("0123456789abcdef", (shard) => `entities/${shard}.jsonl`),
];

export interface AppProps {
  runtime: SheetRuntime;
  copies: LocalCopies;
  appearancePreference: AppearancePreferenceController;
}

export type RecoveryDraftBoundary = "reobserve" | "replacement" | "close";

export { settledSaveStatus } from "./app/mutation-completion.js";

/** Keep an unknown-edit draft only while reobserving its own occurrence. */
export function recoveryDraftAfterBoundary(
  draft: string | null,
  boundary: RecoveryDraftBoundary,
): string | null {
  return boundary === "reobserve" ? draft : null;
}

export function noResidentRecoveryState(): {
  dirty: false;
  currentness: "current";
  outcome: "idle";
  message: string;
  recoveryDraft: null;
} {
  return {
    dirty: false,
    currentness: "current",
    outcome: "idle",
    message: "No work is open. Open a project to continue.",
    recoveryDraft: null,
  };
}

export function clearRecoveryOccurrenceContext(
  context: { current: string | null },
  error: unknown,
): boolean {
  if (!(error instanceof OpenedProjectionRecoveryError)) return false;
  context.current = null;
  return true;
}

/** Decide whether an unknown-open refresh may restore the old receipt. */
export function openRecoveryRestoreDecision(
  checkpoint: {
    occurrence: string;
    revision: string;
    savedRevision: string | null;
    pendingDirty: boolean;
    draftDirty: boolean;
    presentationDirty?: boolean;
  },
  observed: Pick<WorkbookView, "occurrence" | "revision">,
): { sameOccurrence: boolean; saved: boolean } {
  const sameOccurrence = checkpoint.occurrence === observed.occurrence;
  return {
    sameOccurrence,
    saved: sameOccurrence &&
      checkpoint.savedRevision !== null &&
      checkpoint.savedRevision === observed.revision &&
      !checkpoint.pendingDirty &&
      !checkpoint.draftDirty &&
      !checkpoint.presentationDirty,
  };
}

/** Keep every normal dispatch behind the unknown-open recovery marker. */
export function runIfRecoveryCleared<T>(
  unknownOpenRecovery: boolean,
  action: () => T,
  blocked: () => T,
): T {
  return unknownOpenRecovery ? blocked() : action();
}

const SALES_SUMMARY_FIELD_TYPES = {
  "sales.product_code": "text",
  "sales.quantity": "number",
  "catalog.code": "text",
  "catalog.category": "text",
  "catalog.price": "number",
} as const;

/** Resolve the approved Sales binding only from one unambiguous live catalog. */
export function resolveSalesSummaryBinding(catalog: KeyedGroupedSumBindingCatalog): KeyedGroupedSumBindingChoice {
  const collection = (key: "sales" | "catalog") => {
    const matches = catalog.collections.filter((candidate) => candidate.key === key);
    if (matches.length !== 1) throw new Error(`The ${key} table could not be resolved uniquely from the current schema.`);
    return matches[0]!;
  };
  const field = (collectionKey: "sales" | "catalog", fieldKey: string, fieldType: string): void => {
    const matches = collection(collectionKey).fields.filter((candidate) => candidate.key === fieldKey);
    if (matches.length !== 1 || matches[0]!.fieldType !== fieldType) {
      throw new Error(`The ${collectionKey}.${fieldKey} field does not match the required ${fieldType} schema.`);
    }
  };
  for (const [qualified, fieldType] of Object.entries(SALES_SUMMARY_FIELD_TYPES)) {
    const [collectionKey, fieldKey] = qualified.split(".") as ["sales" | "catalog", string];
    field(collectionKey, fieldKey, fieldType);
  }
  return {
    ordersCollection: "sales",
    orderLookupKeyField: "product_code",
    orderQuantityField: "quantity",
    productsCollection: "catalog",
    productKeyField: "code",
    productCategoryField: "category",
    productPriceField: "price",
  };
}

/** One source gate shared by manual and coordinated report binding. */
export function confirmedReportSource(
  live: Pick<WorkbookView, "revision"> | null,
  results: readonly KeyedGroupedSumResult[],
  definitionId: string,
): KeyedGroupedSumResult | null {
  if (!live || !definitionId) return null;
  const matches = results.filter((candidate) => candidate.definitionId === definitionId);
  if (matches.length !== 1) return null;
  const source = matches[0]!;
  return source.revision === live.revision && source.diagnostics.length === 0 ? source : null;
}

export function salesReportConfiguration(definitionId: string): ReportConfiguration {
  return {
    definitionId,
    type: "bar",
    title: "Sales by product",
    categoryLabel: "Product",
    valueLabel: "Revenue",
    legendVisible: false,
  };
}

/** Open recovery is never described as a no-change refusal to Home. */
export function salesEntryOutcomeAfterReplacement(
  kind: "confirmed" | "blocked" | "refused" | "acknowledged-recovery" | "unknown-recovery" | "startup-unavailable",
): SalesEntryOutcome | null {
  if (kind === "confirmed") return null;
  if (kind === "startup-unavailable") return { kind: "startup-unavailable" };
  if (kind === "acknowledged-recovery") return { kind: "acknowledged-open-recovery" };
  if (kind === "unknown-recovery") return { kind: "unknown-open-recovery" };
  return { kind: "refused", message: kind === "blocked" ? "Recovery must be resolved before entering the Sales example." : "The Sales example could not be opened." };
}

export function salesEntryOutcomeAfterCleanupFailure(): SalesEntryOutcome {
  return { kind: "reload-required", message: LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE };
}

export function salesEntryTipAfterSuccessfulSave(
  marker: SalesEntryTipMarker | null,
  savedOccurrence: string,
): SalesEntryTipMarker | null {
  return marker?.occurrence === savedOccurrence ? null : marker;
}

export function salesInitialOccurrenceAfterConfirmedChange(
  initialOccurrence: string | null,
  changedOccurrence: string,
): string | null {
  return initialOccurrence === changedOccurrence ? null : initialOccurrence;
}

export function salesChangeOccurrenceAfterConfirmedEdit(
  tip: SalesEntryTipMarker | null,
  changedOccurrence: string,
): string | null {
  return tip?.occurrence === changedOccurrence ? changedOccurrence : null;
}

export interface SalesOccurrenceMarkers {
  salesEntryTip: SalesEntryTipMarker | null;
  salesCatalogLayout: SalesCatalogLayoutMarker | null;
  salesInitialOccurrence: string | null;
  salesChangedOccurrence: string | null;
}

export function salesMarkersAfterBoundary(
  markers: SalesOccurrenceMarkers,
  boundary: "abandon" | "known-publication-recovery" | "unknown-open-recovery" | "prepublication-refusal" | "unknown-publication",
  occurrence?: string,
  confirmedEdit = false,
): SalesOccurrenceMarkers {
  if (boundary === "abandon") return { salesEntryTip: null, salesCatalogLayout: null, salesInitialOccurrence: null, salesChangedOccurrence: null };
  if (boundary === "known-publication-recovery" && occurrence) {
    return {
      ...markers,
      salesInitialOccurrence: salesInitialOccurrenceAfterConfirmedChange(markers.salesInitialOccurrence, occurrence),
      salesChangedOccurrence: confirmedEdit
        ? salesChangeOccurrenceAfterConfirmedEdit(markers.salesEntryTip, occurrence)
        : markers.salesChangedOccurrence,
    };
  }
  return markers;
}

export function targetedResultRefreshIsAdmitted(input: {
  currentness: Currentness;
  live: Pick<WorkbookView, "occurrence" | "revision"> | null;
  witness: ViewWitness;
  definitionIds: readonly string[];
  definitionId: string;
}): boolean {
  return input.currentness === "current" && input.live !== null &&
    input.live.occurrence === input.witness.occurrence && input.live.revision === input.witness.revision &&
    input.definitionIds.includes(input.definitionId);
}

export function savedCopiesRequestIsCurrent(request: number, latestRequest: number): boolean {
  return request === latestRequest;
}

/** A confirmed import is a new occurrence and cannot inherit a prior report attachment. */
export function presentationAfterConfirmedImport(_prior: ReportConfiguration | null): {
  report: null;
  presentationDirty: false;
} {
  return { report: null, presentationDirty: false };
}

/**
 * A saved report is only safe to rebind after the acknowledged replacement is
 * observed again and its current grouped-summary result is freshly discovered.
 * An absent occurrence witness is used only for the projection-recovery path
 * where the runtime acknowledged Open but could not return its first view.
 */
export function recoverPresentationAfterAcknowledgedOpen(
  candidate: {
    occurrence: string | null;
    presentation: PresentationAttachment;
  },
  observed: Pick<WorkbookView, "occurrence" | "revision">,
  results: readonly KeyedGroupedSumResult[],
): ReportConfiguration | null {
  if (candidate.occurrence !== null && candidate.occurrence !== observed.occurrence) return null;
  const source = results.find((result) =>
    result.definitionId === candidate.presentation.report.definitionId &&
    result.revision === observed.revision &&
    result.diagnostics.length === 0,
  );
  return source ? { ...candidate.presentation.report } : null;
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (Details: ${error.message})`;
  return fallback;
}

export function describeExportRefusal(error: unknown): string {
  // Public runtime failures carry located diagnostics. Do not expose the
  // transport error/code in place of the actual reason the file was refused.
  const failure = (error as { failure?: { code?: string; diagnostics?: Array<{ path: string; message: string }> } } | null)?.failure;
  if (failure?.code === "stale_revision") {
    return "The work changed before the file was prepared. Refresh the work and prepare it again.";
  }
  if (failure?.code === "imported_spreadsheet_export_refused") {
    return "This table changed in ways the original workbook layout can't represent, so it can't be downloaded in that layout. Your work is unchanged.";
  }
  if (failure?.code === "native_tables_export_refused") {
    const details = failure.diagnostics?.map((diagnostic) =>
      `${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`).join(" ");
    return `This file cannot be prepared.${details ? ` ${details}` : " The current tables are not supported by this format."}`;
  }
  return describe(error, "The export could not be prepared for review.");
}

async function opaqueSnapshotDigest(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("This device cannot verify the project copy.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Complete attachment admission before dispatching any resident-work replacement. */
export async function savedCopyPresentation(copy: AnySavedCopy): Promise<PresentationAttachment | null> {
  if (copy.kind === "work-file") validateWorkFileCopy(copy);
  if (copy.kind !== "opaque" && copy.kind !== "work-file") return null;
  validatePresentationAttachment(copy.presentation);
  if (!copy.presentation) return null;
  if (copy.presentation.snapshotRevision !== copy.revision ||
    copy.presentation.snapshotDigest !== await opaqueSnapshotDigest(copy.bytes)) {
    throw new Error("The saved report settings do not match this project copy.");
  }
  return copy.presentation;
}

async function loadExampleFiles(): Promise<CanonicalProjectFile[]> {
  return loadFixtureFiles(EXAMPLE_BASE);
}

async function loadJ4CanaryFiles(): Promise<CanonicalProjectFile[]> {
  return loadFixtureFiles(J4_CANARY_BASE);
}

async function loadSalesExampleFiles(): Promise<CanonicalProjectFile[]> {
  return loadFixtureFiles(SALES_EXAMPLE_BASE);
}

async function loadFixtureFiles(base: string): Promise<CanonicalProjectFile[]> {
  return Promise.all(
    EXAMPLE_FILES.map(async (path) => {
      const response = await fetch(`${base}${path}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`example file ${path} is unavailable (${response.status})`);
      }
      return { path, bytes: await response.arrayBuffer() };
    }),
  );
}

/**
 * Product composition. All authoritative state stays in the runtime and host:
 * this component keeps only the disposable projection, pending/currentness
 * status, draft presence and the save receipt keyed to the exported revision.
 */
export function App({ runtime, copies, appearancePreference }: AppProps) {
  const hostFiles = useHostFiles();
  const [view, setView] = useState<WorkbookView | null>(null);
  const [capacity, setCapacity] = useState<CapacityReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentness, setCurrentness] = useState<Currentness>("current");
  const [outcome, setOutcome] = useState<OperationOutcome>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("not-saved");
  const [message, setMessage] = useState<string | null>(null);
  const [savedCopies, setSavedCopies] = useState<SavedCopySummary[]>([]);
  const [savedCopiesStatus, setSavedCopiesStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const savedCopiesRequestRef = useRef(0);
  const [j4Results, setJ4Results] = useState<KeyedGroupedSumResult[]>([]);
  const [j4DefinitionIds, setJ4DefinitionIds] = useState<string[]>([]);
  const [report, setReport] = useState<ReportConfiguration | null>(null);
  const [salesEntryTip, setSalesEntryTip] = useState<SalesEntryTipMarker | null>(null);
  const [salesCatalogLayout, setSalesCatalogLayout] = useState<SalesCatalogLayoutMarker | null>(null);
  const [salesInitialOccurrence, setSalesInitialOccurrence] = useState<string | null>(null);
  const [salesChangedOccurrence, setSalesChangedOccurrence] = useState<string | null>(null);
  const [interop, setInterop] = useState<InteropState | null>(null);
  const [localHistory, setLocalHistory] = useState<LocalHistorySnapshot>(() => emptyLocalHistory());
  useEffect(() => {
    let current = true;
    setCapacity(null);
    if (!view) return () => { current = false; };
    const occurrence = view.occurrence;
    const revision = view.revision;
    const collectionId = view.table.collection.id;
    // A capacity read is advisory: any failure, even a synchronous one, only hides the warning.
    void Promise.resolve().then(() => runtime.queryCapacity(revision)).then((projection) => {
      const active = viewRef.current;
      if (!current || !projection || !active || active.occurrence !== occurrence ||
        active.revision !== revision || active.table.collection.id !== collectionId) return;
      const usage = projection.usage.tables[collectionId];
      setCapacity(usage ? { occurrence, revision, collectionId, rows: usage.rows, maximum: projection.limits.table_rows } : null);
    }).catch(() => {
      if (current) setCapacity(null);
    });
    return () => { current = false; };
  }, [runtime, view]);
  const importBytesRef = useRef<ArrayBuffer | null>(null);
  const importedSourceRef = useRef<ImportedSourceAttachment | null>(null);
  // An ephemeral, user-consented delivery candidate; never canonical state.
  const preparedDownloadRef = useRef<PreparedDownload | null>(null);

  const viewRef = useRef<WorkbookView | null>(null);
  const localHistoryRef = useRef<LocalHistorySnapshot>(emptyLocalHistory());
  const inflightRef = useRef(false);
  const terminalReloadRequiredRef = useRef(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const startupUnavailableRef = useRef(false);
  const [startupUnavailable, setStartupUnavailable] = useState(false);
  const pendingDirtyRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const reportDraftDirtyRef = useRef(false);
  const dirtyRef = useRef(false);
  const boundCopyRef = useRef<{ occurrence: string; copy: SavedCopySummary } | null>(null);
  const [boundCopyName, setBoundCopyName] = useState<string | null>(null);
  function bindCopy(occurrence: string | null, copy: SavedCopySummary | null): void {
    boundCopyRef.current = occurrence && copy ? { occurrence, copy } : null;
    setBoundCopyName(boundCopyRef.current?.copy.name ?? null);
  }
  const savedRevisionRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const recoveryDraftRef = useRef<string | null>(null);
  const j4DefinitionIdsRef = useRef<string[]>([]);
  const j4ResultsRef = useRef<KeyedGroupedSumResult[]>([]);
  const reportRef = useRef<ReportConfiguration | null>(null);
  const detachedReportsRef = useRef(new DetachedReportPresentations());
  const presentationDirtyRef = useRef(false);
  type CleanupPreviewContext = {
    occurrence: string;
    revision: string;
    collection: string;
    previewId: string;
  };
  const cleanupPreviewContextRef = useRef<CleanupPreviewContext | null>(null);
  // Independent of the old-work checkpoint: an unknown Open may start from
  // the home screen, so recovery must remain fail-closed even without one.
  const unknownOpenRecoveryRef = useRef(false);
  const salesOpeningRef = useRef<{ occurrence: string; revision: string } | null>(null);
  // A known import publication can still lose its first projection. This is
  // separate from operation outcome: the candidate source identity is not
  // safe to expose or save until an authoritative refresh settles it.
  const provenanceUnconfirmedRef = useRef(false);

  type PendingReplacementProvenance = {
    occurrence: string | null;
    revision: string | null;
    importedSource: ImportedSourceAttachment | null;
    interop: InteropState | null;
    savedRevision: string | null;
    boundCopy: SavedCopySummary | null;
    presentation: PresentationAttachment | null;
  };
  // Candidate provenance stays private until Refresh proves that the
  // acknowledged replacement is the one whose projection was recovered.
  const pendingReplacementRef = useRef<PendingReplacementProvenance | null>(null);

  type OpenRecoveryCheckpoint = {
    occurrence: string;
    revision: string;
    importedSource: ImportedSourceAttachment | null;
    interop: InteropState | null;
    importBytes: ArrayBuffer | null;
    preparedDownload: PreparedDownload | null;
    pendingDirty: boolean;
    draftDirty: boolean;
    presentationDirty: boolean;
    report: ReportConfiguration | null;
    savedRevision: string | null;
    saveStatus: SaveStatus;
    boundCopy: SavedCopySummary | null;
    recoveryDraft: string | null;
    cleanupPreviewContext: CleanupPreviewContext | null;
  };
  const openRecoveryCheckpointRef = useRef<OpenRecoveryCheckpoint | null>(null);

  type ReplacementOutcome =
    | { kind: "confirmed" }
    | { kind: "refused" }
    | { kind: "blocked" }
    | { kind: "startup-unavailable" }
    | { kind: "acknowledged-recovery" }
    | { kind: "unknown-recovery" };

  const syncDirty = useCallback((): void => {
    const next = pendingDirtyRef.current || draftDirtyRef.current || reportDraftDirtyRef.current || presentationDirtyRef.current;
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const refreshCopies = useCallback(async (): Promise<void> => {
    const request = ++savedCopiesRequestRef.current;
    setSavedCopiesStatus("checking");
    try {
      const next = await copies.list();
      if (terminalReloadRequiredRef.current || !savedCopiesRequestIsCurrent(request, savedCopiesRequestRef.current)) return;
      setSavedCopies(next);
      setSavedCopiesStatus("ready");
    } catch {
      if (terminalReloadRequiredRef.current || !savedCopiesRequestIsCurrent(request, savedCopiesRequestRef.current)) return;
      setSavedCopiesStatus("unavailable");
    }
  }, [copies]);

  useEffect(() => {
    void refreshCopies();
  }, [refreshCopies]);

  const startupEffectGenerationRef = useRef(0);
  useEffect(() => {
    const generation = ++startupEffectGenerationRef.current;
    let active = true;
    void runtime.prepare().catch((error: unknown) => {
      if (!active || generation !== startupEffectGenerationRef.current || !(error instanceof RuntimeStartupError)) return;
      startupUnavailableRef.current = true;
      setStartupUnavailable(true);
      setOutcome("idle");
      setMessage(null);
    });
    return () => {
      active = false;
    };
  }, [runtime]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      // An operation still in flight (an edit, Undo/Redo, open or save) may
      // change the work after this check, so leaving now could lose it.
      if (!dirtyRef.current && !inflightRef.current && !unknownOpenRecoveryRef.current && !provenanceUnconfirmedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function installLocalHistory(next: LocalHistorySnapshot): void {
    localHistoryRef.current = next;
    setLocalHistory(next);
  }

  function installView(next: WorkbookView | null): void {
    // A temporarily unreadable view does not prove an occurrence change.
    // Confirmed Open/replace and explicit Close own the cache boundary.
    if (next) detachedReportsRef.current.observeOccurrence(next.occurrence);
    installLocalHistory(next ? observeLocalHistory(localHistoryRef.current, next) : emptyLocalHistory());
    viewRef.current = next;
    setView(next);
  }

  function clearJ4Results(): void {
    j4ResultsRef.current = [];
    setJ4Results([]);
  }

  function installReport(next: ReportConfiguration | null, dirty = false): void {
    reportRef.current = next;
    setReport(next);
    presentationDirtyRef.current = dirty;
    syncDirty();
  }

  function observeSalesRevision(next: WorkbookView): void {
    const opening = salesOpeningRef.current;
    if (!salesRevisionHasChanged(opening, next)) return;
    setSalesInitialOccurrence(null);
    setSalesChangedOccurrence(next.occurrence);
  }

  function abandonSalesOccurrenceMarkers(): void {
    salesOpeningRef.current = null;
    const markers = salesMarkersAfterBoundary({
      salesEntryTip, salesCatalogLayout, salesInitialOccurrence, salesChangedOccurrence,
    }, "abandon");
    setSalesEntryTip(markers.salesEntryTip);
    setSalesCatalogLayout(markers.salesCatalogLayout);
    setSalesInitialOccurrence(markers.salesInitialOccurrence);
    setSalesChangedOccurrence(markers.salesChangedOccurrence);
  }

  function installJ4DefinitionIds(ids: string[]): void {
    j4DefinitionIdsRef.current = ids;
    setJ4DefinitionIds(ids);
  }

  async function readJ4Results(next: WorkbookView): Promise<KeyedGroupedSumResult[]> {
    return runtime.discoverKeyedGroupedSums(witnessOf(next));
  }

  function installJ4Results(results: KeyedGroupedSumResult[]): void {
    installJ4DefinitionIds(results.map((result) => result.definitionId));
    j4ResultsRef.current = results;
    setJ4Results(results);
    // Full discovery alone confirms definition absence/restoration. Detached
    // settings are private to this occurrence, never shown/exported as current.
    const live = viewRef.current;
    if (live) {
      const restored = detachedReportsRef.current.reconcile(live.occurrence, reportRef.current, j4DefinitionIdsRef.current);
      if (restored !== reportRef.current) installReport(restored, true);
    }
  }

  /** Restore confirmed pre-publication J4 state after a refused operation. */
  function restoreJ4Results(
    definitionIds: string[],
    results: KeyedGroupedSumResult[],
  ): void {
    installJ4DefinitionIds(definitionIds);
    j4ResultsRef.current = results;
    setJ4Results(results);
  }

  function clearCleanupPreview(): void {
    cleanupPreviewContextRef.current = null;
    setInterop((current) => current && current.cleanupPreview !== null
      ? { ...current, cleanupPreview: null }
      : current);
  }

  function setCleanupPreview(preview: NonNullable<InteropState["cleanupPreview"]>, view: WorkbookView): void {
    cleanupPreviewContextRef.current = {
      occurrence: view.occurrence,
      revision: view.revision,
      collection: view.table.collection.key,
      previewId: preview.preview_id,
    };
    setInterop((current) => current
      ? { ...current, cleanupPreview: preview }
      : { importInspection: null, metadata: null, ledger: [], cleanupPreview: preview, downloadStatus: "idle", downloadError: null });
  }

  function upsertJ4Result(result: KeyedGroupedSumResult): void {
    const definitionIds = j4DefinitionIdsRef.current.includes(result.definitionId)
      ? j4DefinitionIdsRef.current
      : [...j4DefinitionIdsRef.current, result.definitionId];
    j4DefinitionIdsRef.current = definitionIds;
    setJ4DefinitionIds(definitionIds);
    const byDefinition = new Map(j4ResultsRef.current.map((candidate) => [candidate.definitionId, candidate]));
    byDefinition.set(result.definitionId, result);
    const next = definitionIds.flatMap((definitionId) => {
      const candidate = byDefinition.get(definitionId);
      return candidate ? [candidate] : [];
    });
    j4ResultsRef.current = next;
    setJ4Results(next);
  }

  function dropJ4Result(definitionId: string): void {
    const next = j4ResultsRef.current.filter((result) => result.definitionId !== definitionId);
    j4ResultsRef.current = next;
    setJ4Results(next);
  }

  function witnessOf(target: WorkbookView): ViewWitness {
    return { occurrence: target.occurrence, revision: target.revision };
  }

  /** Synchronous guard: a second click cannot dispatch before React re-renders. */
  function begin(): boolean {
    if (inflightRef.current || terminalReloadRequiredRef.current || startupUnavailableRef.current) return false;
    inflightRef.current = true;
    setBusy(true);
    setOutcome("pending");
    return true;
  }

  function end(): void {
    inflightRef.current = false;
    setBusy(false);
  }

  function markNotSaved(): void {
    savedRevisionRef.current = null;
    setSaveStatus("not-saved");
  }

  /**
   * A receipt may claim "saved" only for the still-current revision and only
   * when no uncommitted draft remains and no save is in flight.
   */
  function evaluateSavedStatus(): void {
    const live = viewRef.current;
    const saved = savedRevisionRef.current;
    if (saveInFlightRef.current) return;
    const hasUncommittedDraft =
      draftDirtyRef.current || reportDraftDirtyRef.current || presentationDirtyRef.current;
    setSaveStatus((previous) => settledSaveStatus(previous, saved, live?.revision ?? null, hasUncommittedDraft));
  }

  function guardReplacement(allowHomeDraft = false): void {
    if (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current) {
      throw new Error("Recovery is pending. Refresh or close the open work before opening another project.");
    }
    const onlyHomeDraft = allowHomeDraft && viewRef.current === null &&
      !pendingDirtyRef.current && !reportDraftDirtyRef.current && !presentationDirtyRef.current;
    if ((dirtyRef.current || draftDirtyRef.current) && !onlyHomeDraft) {
      throw new Error(
        "The open work has unsaved changes. Close or save it before opening another project.",
      );
    }
  }

  type ReplacementProvenance = {
    importedSource?: ImportedSourceAttachment | null;
    interop?: InteropState | null;
    boundCopy?: SavedCopySummary | null;
    savedRevision?: string | null;
    presentation?: PresentationAttachment | null;
  };

  function checkpointBeforeOpen(replaceExisting = false): void {
    const old = viewRef.current;
    if (old && openRecoveryCheckpointRef.current !== null && !replaceExisting) return;
    openRecoveryCheckpointRef.current = old ? {
      occurrence: old.occurrence,
      revision: old.revision,
      importedSource: importedSourceRef.current,
      interop,
      importBytes: importBytesRef.current?.slice(0) ?? null,
      preparedDownload: preparedDownloadRef.current
        ? { ...preparedDownloadRef.current, bytes: preparedDownloadRef.current.bytes.slice(0) }
        : null,
      pendingDirty: pendingDirtyRef.current,
      draftDirty: draftDirtyRef.current,
      presentationDirty: presentationDirtyRef.current,
      report: reportRef.current ? { ...reportRef.current } : null,
      savedRevision: savedRevisionRef.current,
      saveStatus,
      boundCopy: boundCopyRef.current?.copy ?? null,
      recoveryDraft: recoveryDraftRef.current,
      cleanupPreviewContext: cleanupPreviewContextRef.current,
    } : null;
  }

  function clearOpenCheckpoint(): void {
    openRecoveryCheckpointRef.current = null;
  }

  function blockUnknownOpenRecovery(): boolean {
    if (terminalReloadRequiredRef.current || startupUnavailableRef.current) return true;
    return runIfRecoveryCleared(
      unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current,
      () => false,
      () => {
        setMessage("Recovery is pending. Refresh to confirm the open work, or close it before continuing.");
        return true;
      },
    );
  }

  function failClosedAfterReplacement(
    provenance: ReplacementProvenance,
    witness: Pick<WorkbookView, "occurrence" | "revision"> | null = null,
  ): void {
    viewRef.current = null;
    installView(null);
    installJ4DefinitionIds([]);
    clearJ4Results();
    recoveryDraftRef.current = null;
    pendingDirtyRef.current = false;
    draftDirtyRef.current = false;
    reportDraftDirtyRef.current = false;
    presentationDirtyRef.current = false;
    installReport(null);
    syncDirty();
    // The resident runtime now belongs to the candidate occurrence. Keep its
    // provenance private until Refresh proves this exact replacement; old
    // work must not leak into an unconfirmed projection.
    pendingReplacementRef.current = (provenance.importedSource || provenance.interop || provenance.savedRevision || provenance.presentation)
      ? {
          occurrence: witness?.occurrence ?? null,
          revision: witness?.revision ?? null,
          importedSource: provenance.importedSource ?? null,
          interop: provenance.interop ?? null,
          savedRevision: provenance.savedRevision ?? null,
          boundCopy: provenance.boundCopy ?? null,
          presentation: provenance.presentation ?? null,
        }
      : null;
    bindCopy(null, null);
    savedRevisionRef.current = null;
    setSaveStatus("not-saved");
    importedSourceRef.current = null;
    importBytesRef.current = null;
    preparedDownloadRef.current = null;
    setInterop(null);
    cleanupPreviewContextRef.current = null;
    setCurrentness("unknown");
    setOutcome("unknown");
  }

  function failClosedAfterOpenRecovery(
    error: OpenedProjectionRecoveryError,
    provenance: ReplacementProvenance = {},
    preserveProvenanceCheckpoint = false,
  ): void {
    if (error.operationOutcome === "opened") abandonSalesOccurrenceMarkers();
    // An unknown Open has no trustworthy candidate identity. Keep only the
    // recovery checkpoint; candidate source metadata must not leak into the
    // unconfirmed occurrence. A confirmed Open may retain its own candidate
    // provenance while its first projection is re-observed.
    failClosedAfterReplacement(error.operationOutcome === "unknown" ? {} : provenance);
    unknownOpenRecoveryRef.current = error.operationOutcome === "unknown";
    provenanceUnconfirmedRef.current = preserveProvenanceCheckpoint;
    // A successful Open can still lose its first projection/J4 discovery
    // reply. The candidate occurrence is known, so only its currentness is
    // unknown; reserve an unknown outcome for an unacknowledged Open.
    setOutcome(error.operationOutcome === "unknown" ? "unknown" : "idle");
    setMessage(
      error.operationOutcome === "unknown"
        ? "We could not confirm whether the file opened or read its values. Refresh to check the open work."
        : "The new work opened, but its values could not be confirmed. Refresh to read the work again.",
    );
  }

  function commitReplacement(
    next: WorkbookView,
    results: KeyedGroupedSumResult[],
    provenance: ReplacementProvenance = {},
    recoveredReport: ReportConfiguration | null = null,
  ): void {
    abandonSalesOccurrenceMarkers();
    bindCopy(next.occurrence, provenance.boundCopy ?? null);
    installView(next);
    // Discovery must not detach the previous occurrence's current report.
    installReport(recoveredReport);
    installJ4Results(results);
    pendingDirtyRef.current = false;
    draftDirtyRef.current = false;
    reportDraftDirtyRef.current = false;
    presentationDirtyRef.current = false;
    syncDirty();
    if (typeof provenance.savedRevision === "string") {
      savedRevisionRef.current = next.revision;
      setSaveStatus("saved");
    } else {
      markNotSaved();
    }
    importedSourceRef.current = provenance.importedSource ?? null;
    importBytesRef.current = null;
    preparedDownloadRef.current = null;
    setInterop(provenance.interop ?? null);
    cleanupPreviewContextRef.current = null;
    setCurrentness("current");
    setOutcome("idle");
  }

  async function replaceWork(open: () => Promise<WorkbookView>, provenance: ReplacementProvenance = {}): Promise<ReplacementOutcome> {
    if (blockUnknownOpenRecovery()) return { kind: "blocked" };
    let next: WorkbookView | null = null;
    checkpointBeforeOpen();
    try {
      next = await open();
      const results = await readJ4Results(next);
      const recoveredReport = provenance.presentation
        ? recoverPresentationAfterAcknowledgedOpen(
            { occurrence: next.occurrence, presentation: provenance.presentation },
            next,
            results,
          )
        : null;
      if (provenance.presentation && !recoveredReport) {
        // A known runtime Open is not an unknown operation, but the paired
        // host-private presentation is still unconfirmed. Keep the complete
        // candidate for Refresh instead of publishing a partial saved copy.
        abandonSalesOccurrenceMarkers();
        failClosedAfterReplacement(provenance, next);
        unknownOpenRecoveryRef.current = false;
        provenanceUnconfirmedRef.current = false;
        clearOpenCheckpoint();
        setOutcome("idle");
        setMessage("The saved work opened, but its report configuration could not be confirmed. Refresh to re-read the paired work.");
        return { kind: "acknowledged-recovery" };
      }
      commitReplacement(next, results, provenance, recoveredReport);
      unknownOpenRecoveryRef.current = false;
      provenanceUnconfirmedRef.current = false;
      clearOpenCheckpoint();
      return { kind: "confirmed" };
    } catch (error) {
      if (error instanceof RuntimeStartupError) {
        startupUnavailableRef.current = true;
        setStartupUnavailable(true);
        setOutcome("idle");
        setMessage(null);
        clearOpenCheckpoint();
        unknownOpenRecoveryRef.current = false;
        provenanceUnconfirmedRef.current = false;
        return { kind: "startup-unavailable" };
      }
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error, provenance);
        if (error.operationOutcome !== "unknown") clearOpenCheckpoint();
        return error.operationOutcome === "unknown"
          ? { kind: "unknown-recovery" }
          : { kind: "acknowledged-recovery" };
      }
      if (next !== null) {
        abandonSalesOccurrenceMarkers();
        failClosedAfterReplacement(provenance, next);
        unknownOpenRecoveryRef.current = false;
        provenanceUnconfirmedRef.current = false;
        clearOpenCheckpoint();
        // Open was acknowledged; a later J4 discovery/projection failure
        // leaves freshness unknown, not the Open operation outcome.
        setOutcome("idle");
        setMessage("The new work opened, but its values could not be confirmed. Refresh to read the work again.");
        return { kind: "acknowledged-recovery" };
      }
      // A known refusal happened before replacement; the old resident and
      // every piece of its provenance remain authoritative.
      unknownOpenRecoveryRef.current = false;
      provenanceUnconfirmedRef.current = false;
      clearOpenCheckpoint();
      throw error;
    }
  }

  function markMutationDirty(): void {
    pendingDirtyRef.current = true;
    syncDirty();
  }

  /** React/ref adapter for the seam's recovery decision. Replacement/Open
   * retains its separate checkpoint policy: an unknown source is not an edit. */
  function installMutationRecovery(recovery: MutationRecovery): void {
    viewRef.current = null;
    installView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    if (!recovery.resetPreview) cleanupPreviewContextRef.current = null;
    setCurrentness("unknown");
    setOutcome(recovery.kind === "unknown-outcome" ? "unknown" : "idle");
    if (recovery.resetPreview) {
      setInterop((current) => current ? { ...current, cleanupPreview: null, downloadStatus: "idle", downloadError: null } : current);
      cleanupPreviewContextRef.current = null;
    }
    if (recovery.retainedInput !== undefined) recoveryDraftRef.current = recovery.retainedInput;
    setMessage(recovery.message);
  }

  const mutationCompletion = createMutationCompletion({
    state: () => ({
      view: viewRef.current, history: localHistoryRef.current, currentness,
      savedRevision: savedRevisionRef.current,
      definitionIds: j4DefinitionIdsRef.current, results: j4ResultsRef.current,
    }),
    installView, installHistory: installLocalHistory,
    clearResults: clearJ4Results, readResults: readJ4Results, readView: () => runtime.read(),
    installResults: installJ4Results,
    restoreResults: ({ definitionIds, results }) => restoreJ4Results(definitionIds, results),
    upsertResult: upsertJ4Result, dropResult: dropJ4Result,
    clearPreview: clearCleanupPreview, markDirty: markMutationDirty, markNotSaved,
    endInitial: (occurrence) => setSalesInitialOccurrence((initial) => salesInitialOccurrenceAfterConfirmedChange(initial, occurrence)),
    markSalesChanged: (occurrence) => {
      const changed = salesChangeOccurrenceAfterConfirmedEdit(salesEntryTip, occurrence);
      if (changed) setSalesChangedOccurrence(changed);
    },
    observeSales: observeSalesRevision, setCurrentness, setOutcome, setMessage,
    recover: installMutationRecovery,
    newTable: {
      close: () => runtime.close(),
      resetClosed: resetClosedWorkState,
      retainDraft: () => { setMessage(null); draftDirtyRef.current = true; syncDirty(); },
      closeFailed: () => {
        resetClosedWorkState();
        terminalReloadRequiredRef.current = true;
        savedCopiesRequestRef.current += 1;
        setReloadRequired(true);
        setCurrentness("unknown");
        setMessage(LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE);
        throw new Error(LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE);
      },
    },
    acceptSave: (occurrence, receipt) => {
      bindCopy(occurrence, receipt);
      setSalesEntryTip((marker) => salesEntryTipAfterSuccessfulSave(marker, occurrence));
      setSalesInitialOccurrence((initial) => salesInitialOccurrenceAfterConfirmedChange(initial, occurrence));
      savedRevisionRef.current = receipt.revision;
      pendingDirtyRef.current = false;
      presentationDirtyRef.current = false;
      syncDirty();
    },
  });

  function newTable(name: string, columns: NewTableColumn[]): Promise<boolean> {
    if (blockUnknownOpenRecovery() || !begin()) return Promise.resolve(false);
    const unconfirmed = new Error("Tachiko couldn't confirm the table was created. Nothing was saved — choose Create to try again.");
    const failure = (error: unknown): unknown => {
      if (!terminalReloadRequiredRef.current) {
        setCurrentness("current");
        setOutcome("idle");
      }
      return error === unconfirmed || (error && typeof error === "object" && "failure" in error)
        ? error : new Error(describe(error, "The table could not be created."));
    };
    try {
      // The schema dialog is a Home action; its resident is disposable.
      if (viewRef.current !== null) throw new Error("Close the open work before creating a table.");
      guardReplacement(true);
      setMessage(null);
      setCurrentness("pending");
      return mutationCompletion.newTable(() => replaceWork(() => runtime.newTable(name, columns)), unconfirmed, end, failure);
    } catch (error) {
      const rejected = failure(error);
      end();
      return Promise.reject(rejected);
    }
  }

  async function openFiles(files: FileList): Promise<void> {
    if (blockUnknownOpenRecovery()) return;
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      if ((await replaceWork(() => runtime.openFiles(files))).kind !== "confirmed") return;
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      importBytesRef.current = null;
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      } else if (viewRef.current === null && dirtyRef.current &&
        (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current)) {
        setCurrentness("unknown");
        setOutcome("unknown");
        setMessage("Recovery is pending. Refresh to re-read the open work before opening another project.");
        return;
      } else {
        setCurrentness("current");
        setOutcome("idle");
      }
      throw new Error(describe(error, "The selected project folder could not be opened."));
    } finally {
      end();
    }
  }

  async function openWorkFile(file: File): Promise<void> {
    if (blockUnknownOpenRecovery() || !begin()) return;
    try {
      if (import.meta.env.MODE === "desktop") throw new Error(WORK_FILE_DESKTOP_UNAVAILABLE);
      requireWorkFileName(file.name);
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      const bytes = await readWorkFile(file);
      if ((await replaceWork(() => runtime.openWorkFile(bytes))).kind !== "confirmed") return;
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      }
      setCurrentness("current");
      setOutcome("idle");
      throw error;
    } finally { end(); }
  }

  async function openExample(): Promise<void> {
    if (blockUnknownOpenRecovery()) return;
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      if ((await replaceWork(async () => runtime.openCanonical(await loadExampleFiles()))).kind !== "confirmed") return;
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      importBytesRef.current = null;
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      } else if (viewRef.current === null && dirtyRef.current &&
        (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current)) {
        setCurrentness("unknown");
        setOutcome("unknown");
        setMessage("Recovery is pending. Refresh to re-read the open work before opening another project.");
        return;
      } else {
        setCurrentness("current");
        setOutcome("idle");
      }
      throw new Error(describe(error, "The example work could not be opened."));
    } finally {
      end();
    }
  }

  function resetClosedWorkState(): void {
    detachedReportsRef.current.observeOccurrence(null);
    viewRef.current = null;
    installView(null);
    installJ4DefinitionIds([]);
    clearJ4Results();
    installReport(null);
    abandonSalesOccurrenceMarkers();
    recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "close");
    pendingDirtyRef.current = false;
    draftDirtyRef.current = false;
    reportDraftDirtyRef.current = false;
    syncDirty();
    savedRevisionRef.current = null;
    setSaveStatus("not-saved");
    importedSourceRef.current = null;
    importBytesRef.current = null;
    preparedDownloadRef.current = null;
    setInterop(null);
    cleanupPreviewContextRef.current = null;
    pendingReplacementRef.current = null;
    unknownOpenRecoveryRef.current = false;
    provenanceUnconfirmedRef.current = false;
    clearOpenCheckpoint();
    setCurrentness("current");
    setOutcome("idle");
  }

  async function refuseSalesEntry(
    opened: Pick<WorkbookView, "occurrence" | "revision"> | null,
    error: unknown,
  ): Promise<SalesEntryOutcome> {
    const detail = describe(error, "The Sales example could not be prepared.");
    const live = viewRef.current;
    if (opened && live?.occurrence === opened.occurrence && live.revision === opened.revision &&
      !pendingDirtyRef.current && !draftDirtyRef.current &&
      !unknownOpenRecoveryRef.current && !provenanceUnconfirmedRef.current) {
      try {
        await runtime.close();
        resetClosedWorkState();
      } catch {
        terminalReloadRequiredRef.current = true;
        savedCopiesRequestRef.current += 1;
        setReloadRequired(true);
        abandonSalesOccurrenceMarkers();
        viewRef.current = null;
        installView(null);
        installJ4DefinitionIds([]);
        clearJ4Results();
        installReport(null);
        pendingDirtyRef.current = false;
        draftDirtyRef.current = false;
        reportDraftDirtyRef.current = false;
        presentationDirtyRef.current = false;
        syncDirty();
        savedRevisionRef.current = null;
        setSaveStatus("not-saved");
        importedSourceRef.current = null;
        importBytesRef.current = null;
        preparedDownloadRef.current = null;
        setInterop(null);
        cleanupPreviewContextRef.current = null;
        pendingReplacementRef.current = null;
        setCurrentness("unknown");
        setOutcome("idle");
        setMessage(LOCAL_RUNTIME_RELOAD_REQUIRED_MESSAGE);
        return salesEntryOutcomeAfterCleanupFailure();
      }
    }
    setCurrentness("current");
    setOutcome("idle");
    setMessage(detail);
    return { kind: "refused", message: detail };
  }

  async function openJ4Canary(): Promise<SalesEntryOutcome> {
    if (startupUnavailableRef.current) return { kind: "startup-unavailable" };
    if (terminalReloadRequiredRef.current) {
      return { kind: "reload-required", message: "The open work can no longer be used. Reload this page before continuing." };
    }
    if (blockUnknownOpenRecovery()) return { kind: "refused", message: "Recovery must be resolved before entering the Sales example." };
    if (!begin()) return { kind: "refused", message: "Another operation is in progress." };
    let opened: WorkbookView | null = null;
    let createDispatched = false;
    let published = false;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      const replaced = await replaceWork(async () => runtime.openCanonical(await loadSalesExampleFiles()));
      const nonConfirmed = salesEntryOutcomeAfterReplacement(replaced.kind);
      if (nonConfirmed) return nonConfirmed;
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      importBytesRef.current = null;
      opened = viewRef.current;
      if (!opened) {
        return { kind: "refused", message: "The Sales example opened, but its current view could not be confirmed." };
      }
      if (j4DefinitionIdsRef.current.length !== 0 || j4ResultsRef.current.length !== 0) {
        return await refuseSalesEntry(opened, new Error("The new Sales example already contains a cross-table summary."));
      }
      const witness = witnessOf(opened);
      const catalog = await runtime.listKeyedGroupedSumBindings(witness);
      if (bindingCatalogContainsDate(catalog)) {
        return await refuseSalesEntry(opened, new Error(DATE_SUMMARY_UNSUPPORTED_MESSAGE));
      }
      const binding = resolveSalesSummaryBinding(catalog);
      setCurrentness("pending");
      createDispatched = true;
      const created = await runtime.createKeyedGroupedSum(witness, binding);
      published = true;
      const next = await runtime.read();
      if (next.occurrence !== opened.occurrence || next.revision !== created.revision) {
        throw new Error("The Sales summary could not be matched to the current work.");
      }
      const results = await readJ4Results(next);
      const source = confirmedReportSource(next, results, created.definitionId);
      const ids = results.map((result) => result.definitionId);
      if (!source || ids.length !== 1 || new Set(ids).size !== 1 || ids[0] !== created.definitionId ||
        created.revision !== next.revision || created.diagnostics.length !== 0) {
        throw new Error("The current Sales summary could not be uniquely confirmed.");
      }
      const catalogCollection = catalog.collections.find((collection) => collection.key === "catalog");
      if (!catalogCollection) throw new Error("The Catalog table could not be resolved from the current schema.");
      const selected = next.table.collection.key === catalogCollection.key
        ? next
        : await runtime.selectCollection(witnessOf(next), catalogCollection.key);
      if (selected.occurrence !== opened.occurrence || selected.revision !== next.revision ||
        selected.table.collection.key !== catalogCollection.key) {
        throw new Error("The confirmed Sales summary could not land on the Catalog table.");
      }
      // This coordinator additionally verifies the unique Sales source and
      // Catalog landing; the shared seam still completes its publication.
      mutationCompletion.confirmCoordinatedPublication(selected, results);
      installReport(salesReportConfiguration(created.definitionId), true);
      setSalesEntryTip({ occurrence: selected.occurrence, collection: "catalog", field: "price" });
      setSalesCatalogLayout({ occurrence: selected.occurrence, collectionId: selected.table.collection.id });
      salesOpeningRef.current = { occurrence: selected.occurrence, revision: selected.revision };
      setSalesInitialOccurrence(selected.occurrence);
      setSalesChangedOccurrence(null);
      setCurrentness("current");
      setOutcome("idle");
      setMessage(null);
      return { kind: "confirmed", occurrence: selected.occurrence, revision: selected.revision, definitionId: created.definitionId };
    } catch (error) {
      if (published || (createDispatched && error instanceof PublishedProjectionRecoveryError)) {
        installReport(null);
        abandonSalesOccurrenceMarkers();
        mutationCompletion.recover("known-publication-recovery", { kind: "summary" });
        return { kind: "published-recovery" };
      }
      if (createDispatched && error instanceof UnknownOperationOutcomeError) {
        installReport(null);
        abandonSalesOccurrenceMarkers();
        mutationCompletion.recover("unknown-outcome", { kind: "summary" });
        return { kind: "unknown-recovery" };
      }
      return await refuseSalesEntry(opened, error);
    } finally {
      end();
    }
  }

  async function openSaved(name: string): Promise<void> {
    if (blockUnknownOpenRecovery()) return;
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      const copy = await copies.readAny(name);
      if (!copy) throw new Error(`the saved copy “${name}” is no longer stored on this device`);
      // Hash and attachment failures are known refusals before replacement.
      const presentation = await savedCopyPresentation(copy);
      if (copy.kind !== "opaque" && copy.kind !== "work-file" && copy.importedSource) {
        await runtime.validateImportedProject(copy.files, copy.importedSource.metadata);
      }
      const candidateInterop = copy.importedSource ? {
        importInspection: null, metadata: copy.importedSource.metadata, ledger: copy.importedSource.ledger,
        cleanupPreview: null, downloadStatus: "idle" as const, downloadError: null,
      } : null;
      if ((await replaceWork(
        () => copy.kind === "work-file" ? runtime.openWorkFile(copy.bytes)
          : copy.kind === "opaque" ? runtime.openOpaque(copy.bytes, copy.importedSource?.metadata) : runtime.openCanonical(copy.files),
        { importedSource: copy.importedSource ?? null, interop: candidateInterop, savedRevision: copy.revision, presentation, boundCopy: copy },
      )).kind !== "confirmed") return;
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      } else if (viewRef.current === null && dirtyRef.current &&
        (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current)) {
        setCurrentness("unknown");
        setOutcome("unknown");
        setMessage("Recovery is pending. Refresh to re-read the open work before opening another project.");
        return;
      } else {
        setCurrentness("current");
        setOutcome("idle");
      }
      throw new Error(error instanceof Error && /portable_package\.resource_limit/.test(error.message)
        ? workFileOpenRefusal(error)
        : describe(error, `The saved copy “${name}” could not be opened.`));
    } finally {
      end();
    }
  }

  async function selectCollection(witness: ViewWitness, collection: string): Promise<void> {
    if (blockUnknownOpenRecovery()) return;
    if (draftDirtyRef.current) {
      setMessage("Apply or cancel the current draft before switching tables.");
      return;
    }
    if (!begin()) return;
    try {
      setMessage(null);
      setCurrentness("pending");
      const next = await runtime.selectCollection(witness, collection);
      installView(next);
      clearCleanupPreview();
      setCurrentness("current");
      setOutcome("idle");
    } catch (error) {
      setCurrentness("current");
      setOutcome("idle");
      setMessage(describe(error, "The selected table could not be opened."));
      throw error;
    } finally {
      end();
    }
  }

  async function inspectImport(file: File, csv?: { delimiter?: CsvDelimiter; encoding?: CsvEncoding }): Promise<ImportInspection> {
    if (blockUnknownOpenRecovery()) throw new Error("Recovery is pending. Refresh or close the open work first.");
    if (!begin()) throw new Error("Another operation is in progress.");
    try {
      setMessage(null);
      guardReplacement();
      checkpointBeforeOpen();
      const lower = file.name.toLowerCase();
      const delimited = lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt");
      const format = delimited ? "csv" : lower.endsWith(".xlsx") ? "xlsx" : null;
      if (!format) throw new Error("Choose a .csv, .tsv, .txt or .xlsx file.");
      const raw = await file.arrayBuffer();
      let bytes = raw;
      let csvRead: { delimiter: CsvDelimiter; encoding: CsvEncoding } | undefined;
      if (format === "csv") {
        const encoding = csv?.encoding ?? guessCsvEncoding(raw, navigator.languages?.length ? navigator.languages : [navigator.language]);
        bytes = toUtf8Bytes(raw, encoding);
        const delimiter = csv?.delimiter ?? (lower.endsWith(".tsv") ? "\t" : detectCsvDelimiter(new TextDecoder().decode(bytes.slice(0, 65_536))));
        csvRead = { delimiter, encoding };
      }
      const source = await runtime.inspectSpreadsheet(bytes, format, { delimiter: csvRead?.delimiter ?? ",", header: true });
      const inspection = { name: file.name, format, source, ...(csvRead ? { csv: csvRead } : {}) } as ImportInspection;
      importBytesRef.current = bytes.slice(0);
      setInterop({ importInspection: inspection, metadata: null, ledger: source.ledger, cleanupPreview: null, downloadStatus: "idle", downloadError: null });
      setMessage(null);
      return inspection;
    } catch (error) {
      clearOpenCheckpoint();
      throw error;
    } finally { end(); }
  }

  async function importCandidate(selection: ImportSelection): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const pending = interop?.importInspection;
    const bytes = importBytesRef.current;
    if (!pending || !bytes || !begin()) return false;
    try {
      guardReplacement();
      // A valid retry owns the visible status from this point. Recovery gates
      // above retain their message and fail-closed state unchanged.
      setMessage(null);
      // Inspection is not dispatch. Replace the earlier inspection snapshot
      // at the actual import boundary so unknown-import recovery restores the
      // latest same-occurrence report, dirty marker, and save receipt.
      checkpointBeforeOpen(true);
      setCurrentness("pending");
      const imported = await runtime.importSpreadsheet(bytes, pending.format, { delimiter: pending.csv?.delimiter ?? ",", header: true }, selection);
      // Import installs a different work occurrence. Never present an older
      // work's groups or definition IDs against this newly imported view.
      installJ4DefinitionIds([]);
      clearJ4Results();
      installView(imported.view);
      abandonSalesOccurrenceMarkers();
      const presentation = presentationAfterConfirmedImport(reportRef.current);
      installReport(presentation.report, presentation.presentationDirty);
      preparedDownloadRef.current = null;
      pendingDirtyRef.current = true;
      syncDirty();
      markNotSaved();
      setInterop({ importInspection: null, metadata: imported.metadata, ledger: imported.ledger, cleanupPreview: null, downloadStatus: "idle", downloadError: null });
      cleanupPreviewContextRef.current = null;
      importedSourceRef.current = { name: pending.name, format: pending.format, bytes: bytes.slice(0), metadata: imported.metadata, ledger: imported.ledger };
      setCurrentness("current");
      setOutcome("idle");
      importBytesRef.current = null;
      pendingReplacementRef.current = null;
      provenanceUnconfirmedRef.current = false;
      clearOpenCheckpoint();
      return true;
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error, {}, error.operationOutcome === "opened");
        if (error.operationOutcome !== "unknown" && error.operationOutcome !== "opened") clearOpenCheckpoint();
      } else {
        const checkpoint = openRecoveryCheckpointRef.current;
        if (checkpoint) {
          setInterop(checkpoint.interop);
          importBytesRef.current = checkpoint.importBytes?.slice(0) ?? null;
          cleanupPreviewContextRef.current = checkpoint.cleanupPreviewContext;
        }
        clearOpenCheckpoint();
        setMessage(describe(error, "The import was not applied."));
      }
      return false;
    } finally { end(); }
  }

  function cancelImport(): void {
    const checkpoint = openRecoveryCheckpointRef.current;
    importBytesRef.current = null;
    if (checkpoint) {
      setInterop(checkpoint.interop);
      importBytesRef.current = checkpoint.importBytes?.slice(0) ?? null;
      cleanupPreviewContextRef.current = checkpoint.cleanupPreviewContext;
    } else {
      setInterop((current) => current ? { ...current, importInspection: null } : null);
    }
    clearOpenCheckpoint();
  }

  async function previewTrim(witness: ViewWitness, fields: FieldTarget[]) {
    if (blockUnknownOpenRecovery()) return null;
    if (!begin()) return null;
    try {
      const preview = await runtime.previewCleanup(witness, { kind: "trim", fields });
      const live = viewRef.current;
      if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision) {
        setOutcome("idle");
        setMessage("The cleanup preview belongs to an older work view.");
        return null;
      }
      setCleanupPreview(preview, live);
      setOutcome("idle");
      return preview;
    } catch (error) { setOutcome("idle"); setMessage(describe(error, "A cleanup preview could not be created.")); return null; }
    finally { end(); }
  }

  async function previewDeduplicate(witness: ViewWitness, entities: string[], fields: string[]) {
    if (blockUnknownOpenRecovery()) return null;
    if (!begin()) return null;
    try {
      const preview = await runtime.previewCleanup(witness, { kind: "deduplicate", entities, key_fields: fields });
      const live = viewRef.current;
      if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision) {
        setOutcome("idle");
        setMessage("The cleanup preview belongs to an older work view.");
        return null;
      }
      setCleanupPreview(preview, live);
      setOutcome("idle");
      return preview;
    } catch (error) { setOutcome("idle"); setMessage(describe(error, "A duplicate-row preview could not be created.")); return null; }
    finally { end(); }
  }

  function commitCleanup(witness: ViewWitness, previewId: string): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return Promise.resolve(false);
    const live = viewRef.current;
    const context = cleanupPreviewContextRef.current;
    if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision ||
      !context || context.occurrence !== live.occurrence || context.revision !== live.revision ||
      context.collection !== live.table.collection.key || context.previewId !== previewId) {
      setOutcome("idle");
      setMessage("This cleanup preview is no longer current. Preview it again before committing.");
      return Promise.resolve(false);
    }
    if (!begin()) return Promise.resolve(false);
    return mutationCompletion.run({ kind: "cleanup", witness, dispatch: () => runtime.commitCleanup(witness, previewId) }, result => result.kind === "published", end);
  }

  function cancelCleanup(): void {
    clearCleanupPreview();
    setOutcome("idle");
  }

  function currentWorkFileOmissions(): string[] {
    return workFileOmissions({ importedSource: importedSourceRef.current !== null, report: reportRef.current !== null });
  }

  async function prepareDownload(format: "csv" | "xlsx" | "ro"): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const live = viewRef.current;
    const metadata = interop?.metadata;
    if (!live || !begin()) return false;
    setMessage(null);
    setInterop((current) => ({ importInspection: null, metadata: null, ledger: [], cleanupPreview: null, ...current, ledgerColumns: undefined, downloadStatus: "idle", downloadError: null }));
    try {
      if (format === "ro" && import.meta.env.MODE === "desktop") throw new Error(WORK_FILE_DESKTOP_UNAVAILABLE);
      // Any download snapshots the published revision; unpublished edits would be silently missing.
      if (currentness !== "current" || draftDirtyRef.current || reportDraftDirtyRef.current) {
        throw new Error("Finish or cancel unfinished edits and wait for the values before preparing a download.");
      }
      const exported = format === "ro"
        ? await runtime.exportWorkFile(witnessOf(live))
        : metadata
          ? await runtime.exportSpreadsheet(witnessOf(live), metadata, format)
          : await runtime.exportNativeTables(witnessOf(live), live.table.collection.key, format);
      preparedDownloadRef.current = {
        format, occurrence: live.occurrence, revision: exported.revision,
        collectionId: live.table.collection.id, bytes: exported.bytes.slice(0),
        ...(format === "ro" ? { omissions: currentWorkFileOmissions() } : {}),
      };
      // A finding about a column in another table needs that table's column
      // names; without them the dialog still names the table.
      const ledgerColumns = "ledger" in exported && findingColumnTables(exported.ledger).some((id) => id !== live.table.collection.id)
        ? await runtime.listKeyedGroupedSumBindings(witnessOf(live)).catch(() => undefined)
        : undefined;
      setInterop((current) => current ? { ...current, ledger: "ledger" in exported ? exported.ledger : current.ledger, ledgerColumns, downloadStatus: "consent", downloadError: null } : current);
      setOutcome("idle");
      return true;
    } catch (error) {
      preparedDownloadRef.current = null;
      setOutcome("idle");
      const detail = describeExportRefusal(error);
      setInterop((current) => current ? { ...current, downloadStatus: "failed", downloadError: detail } : current);
      setMessage(detail); return false;
    } finally { end(); }
  }

  async function download(format: "csv" | "xlsx" | "ro"): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const live = viewRef.current;
    const prepared = preparedDownloadRef.current;
    if (!live || !prepared || !preparedDownloadIsCurrent(prepared, live, format) ||
      (format === "ro" && (currentness !== "current" || draftDirtyRef.current || reportDraftDirtyRef.current ||
        !sameWorkFileOmissions(prepared.omissions ?? [], currentWorkFileOmissions())))) {
      preparedDownloadRef.current = null;
      setMessage("The work changed after this download was prepared. Prepare it again and review it before downloading.");
      return false;
    }
    if (!begin()) return false;
    setMessage(null);
    setInterop((current) => current ? { ...current, downloadError: null } : current);
    try {
      if (format === "ro" && import.meta.env.MODE === "desktop") throw new Error(WORK_FILE_DESKTOP_UNAVAILABLE);
      if (format === "ro" && !preparedDownloadIsCurrent(prepared, await runtime.read(), "ro")) {
        throw new Error("The work changed after this download was prepared. Prepare it again and review it before downloading.");
      }
      const blob = new Blob([prepared.bytes], { type: format === "ro" ? "application/octet-stream" : format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      // The host saves it: a browser download, or the desktop Save panel.
      await hostFiles.saveFile(`${live.title}.${format}`, blob);
      preparedDownloadRef.current = null;
      setInterop((current) => current ? { ...current, downloadStatus: "idle", downloadError: null } : current);
      setOutcome("idle");
      return true;
    } catch (error) {
      preparedDownloadRef.current = null;
      setOutcome("idle");
      const detail = describe(error, "The download was not created.");
      setInterop((current) => current ? { ...current, downloadStatus: "failed", downloadError: detail } : current);
      setMessage(detail); return false;
    } finally { end(); }
  }

  function commit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<CommitOutcome> {
    if (blockUnknownOpenRecovery()) {
      return Promise.resolve({ accepted: false, message: "Recovery is pending. Refresh to confirm the open work before editing." });
    }
    if (!begin()) {
      return Promise.resolve({ accepted: false, message: "An operation is in progress; editing is disabled until it finishes." });
    }
    const live = viewRef.current;
    if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision) {
      setOutcome("idle");
      setMessage("This draft belongs to an older view. Refresh to load the current work.");
      end();
      return Promise.resolve({ accepted: false, message: "This draft belongs to an older view. Refresh to load the current work." });
    }
    // Map/finish inside the seam's continuation, as in base App's finally.
    // Known/unknown publication must exit the rejected-editor retry path.
    return mutationCompletion.run<CommitOutcome>(
      { kind: "scalar", witness, edit, dispatch: () => runtime.editConfirmed(witness, target, edit) },
      // Work's refusal is shown verbatim; a published or unknown outcome is
      // never a refusal and keeps the existing editor-retry policy.
      result => result.kind === "refused"
        ? { accepted: false, message: result.message, ...(result.position !== undefined ? { position: result.position } : {}), ...(result.sourcePosition !== undefined ? { sourcePosition: result.sourcePosition } : {}), ...(result.ruleRefusal ? { ruleRefusal: true as const } : {}) }
        : { accepted: true },
      end,
    );
  }

  function changeRows(
    witness: ViewWitness,
    command: () => ReturnType<SheetRuntime["insertRow"]>,
    saveCheck: "column" | "duplicate" | null = null,
    /** Typed input the command would otherwise lose when its dialog closes. */
    retainedInput?: string,
  ): Promise<RowCommandOutcome> {
    if (saveCheck && !copies.createWorkFile) {
      return Promise.resolve({ kind: "refused", message: saveCheck === "duplicate" ? DUPLICATE_SAVE_UNAVAILABLE : COLUMN_SAVE_UNAVAILABLE });
    }
    if (blockUnknownOpenRecovery() || !begin()) return Promise.resolve({ kind: "refused", message: "Wait for the current work before making this change." });
    const live = viewRef.current;
    if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision) {
      setOutcome("idle");
      end();
      return Promise.resolve({ kind: "refused", message: "This change belongs to an older view. Refresh before trying again." });
    }
    const apply = () => mutationCompletion.run<RowCommandOutcome>({
      kind: "rows", witness, dispatch: command,
      ...(retainedInput !== undefined ? { retainedInput } : {}),
    }, result => {
      if (result.kind === "published") return { kind: "confirmed", addedEntities: result.addedEntities };
      if (result.kind === "refused") return result;
      return { kind: "recovery" };
    }, end);
    if (!saveCheck) return apply();
    return (async () => {
      // begin() owns the operation lock throughout export and dispatch. This
      // dry run writes no host state and supplies no Save receipt/status.
      let exportedRevision: string | null = null;
      try { exportedRevision = (await runtime.exportWorkFile(witness)).revision; }
      catch { /* Every portable-export failure refuses before publication. */ }
      const decision = saveCheck === "duplicate"
        ? duplicateSavePreflightDecision(witness, viewRef.current, exportedRevision)
        : columnSavePreflightDecision(witness, viewRef.current, exportedRevision);
      if (!decision.allowed) {
        setOutcome("idle");
        end();
        return { kind: "refused", message: decision.message };
      }
      // The adapter rechecks the witness inside its serialized mutation queue.
      return apply();
    })();
  }

  function insertRow(witness: ViewWitness, collection: string, initializers: RowInitializer[]) {
    return changeRows(witness, () => runtime.insertRow(witness, collection, initializers));
  }

  function editCells(witness: ViewWitness, edits: CellEdit[]) {
    return changeRows(witness, () => runtime.editCells(witness, edits));
  }

  function pasteCells(witness: ViewWitness, collection: string, startEntity: string | null, startField: string, rows: PasteCellInput[][]) {
    return changeRows(witness, () => runtime.pasteCells(witness, collection, startEntity, startField, rows));
  }

  function addColumn(witness: ViewWitness, collection: string, name: string, fieldType: NewTableColumn["field_type"], initializers: ColumnInitializer[] | undefined, required = true) {
    return changeRows(witness, () => runtime.addColumn(witness, collection, name, fieldType, initializers, required), "column");
  }

  function setColumnRequiredness(witness: ViewWitness, collection: string, field: string, required: boolean) {
    return changeRows(witness, () => runtime.setColumnRequiredness(witness, collection, field, required), "column");
  }

  function setColumnConstraint(witness: ViewWitness, collection: string, field: string, constraint: FieldConstraintInput) {
    return changeRows(witness, () => runtime.setColumnConstraint(witness, collection, field, constraint), "column");
  }

  function setColumnNumberFormat(witness: ViewWitness, collection: string, field: string, format: NumberFormat | null) {
    return changeRows(witness, () => runtime.setColumnNumberFormat(witness, collection, field, format), "column");
  }

  function copyFormula(witness: ViewWitness, request: FormulaCopy) {
    return changeRows(witness, () => runtime.copyFormula(witness, request));
  }

  function renameColumn(witness: ViewWitness, collection: string, field: string, name: string) {
    return changeRows(witness, () => runtime.renameColumn(witness, collection, field, name), "column");
  }

  function removeColumn(witness: ViewWitness, collection: string, field: string) {
    return changeRows(witness, () => runtime.removeColumn(witness, collection, field), "column");
  }

  function moveColumn(witness: ViewWitness, collection: string, field: string, toIndex: number) {
    return changeRows(witness, () => runtime.moveColumn(witness, collection, field, toIndex), "column");
  }

  function removeRows(witness: ViewWitness, collection: string, entities: string[]) {
    return changeRows(witness, () => runtime.removeRows(witness, collection, entities));
  }

  function duplicateTable(witness: ViewWitness, collection: string, name: string, columnNames?: Record<string, string>) {
    // The dialog closes on a recovery, so the recovery message carries the name.
    return changeRows(witness, () => runtime.duplicateCollection(witness, collection, name, columnNames), "duplicate", name);
  }

  function queryShownTotals(witness: ViewWitness, collection: string, entities: string[]) {
    // A read only: it never takes the operation slot, and a failure leaves the whole-table footer.
    return runtime.queryColumnTotals(witness, collection, entities);
  }

  function queryGroupTotals(witness: ViewWitness, collection: string, dimensions: GroupDimension[], measures: string[], scope: GroupScope) {
    // A read only, like the footer totals: Work groups and sums; Sheet shows its reply.
    return runtime.queryGroupTotals(witness, collection, dimensions, measures, scope);
  }

  function runHistory(direction: "undo" | "redo"): Promise<FieldTarget | null> {
    const live = viewRef.current;
    const known = localHistoryRef.current;
    if (!live || currentness !== "current" || known.occurrence !== live.occurrence ||
      known.revision !== live.revision || (direction === "undo" ? known.undoCount : known.redoCount) < 1 || !begin()) return Promise.resolve(null);
    const witness = witnessOf(live);
    return mutationCompletion.run({ kind: "history", witness, direction, dispatch: () => runtime.trackerHistory(witness, direction) }, result => result.kind === "published" ? result.focusTarget : null, end);
  }

  async function createCopy(name: string, expected?: SavedCopySummary): Promise<CreateCopyOutcome> {
    if (blockUnknownOpenRecovery()) return { saved: false, reason: "The copy was not created. Refresh to confirm the open work, or close it, then try again." };
    if ((viewRef.current?.openedFromWorkFile || viewRef.current?.requiresPortableSave) && !copies.createWorkFile) {
      setMessage(WORK_FILE_SAVE_UNAVAILABLE);
      return { saved: false, reason: WORK_FILE_SAVE_UNAVAILABLE };
    }
    if (!begin()) return { saved: false, reason: "The copy was not created. Another operation is in progress; try again when it finishes." };
    const live = viewRef.current;
    if (!live) {
      end();
      setMessage("There is no open work to save.");
      return { saved: false, reason: "There is no open work to save." };
    }
    saveInFlightRef.current = true;
    setMessage(null);
    setSaveStatus("saving");
    function requireCurrentSnapshot(revision: string): void {
      const current = viewRef.current;
      if (!current || current.occurrence !== live!.occurrence || current.revision !== live!.revision || revision !== live!.revision) {
        throw new Error("The open work changed before saving. Keep it open and try again.");
      }
    }
    try {
      // Every local copy is a native v3 snapshot: portable `.ro` bytes for
      // work-file origin or authored schema, the explicit v3 project export
      // otherwise. There is no legacy writer or writer-selection branch.
      const portableSave = live.openedFromWorkFile || live.requiresPortableSave;
      const snapshot = portableSave
        ? await runtime.exportWorkFile(witnessOf(live))
        : await runtime.exportOpaque(witnessOf(live));
      const snapshotRevision = snapshot.revision;
      if (portableSave) validateWorkFileCopy({
        ...snapshot, importedSource: importedSourceRef.current ?? undefined,
      });
      // Save writes only the truthful current state, without a dangling
      // report. Detached settings stay in memory for same-occurrence Redo;
      // they are not persisted and are discarded on Close/Open/replacement.
      const configuredReport = reportRef.current;
      const source = configuredReport && j4ResultsRef.current.find((candidate) =>
        candidate.definitionId === configuredReport.definitionId &&
        candidate.revision === live.revision &&
        candidate.diagnostics.length === 0,
      );
      if (configuredReport && !source) {
        throw new Error("Refresh the report source before saving its presentation settings.");
      }
      const presentation: PresentationAttachment | undefined = configuredReport ? {
        version: 1,
        report: configuredReport,
        snapshotRevision,
        snapshotDigest: await opaqueSnapshotDigest(snapshot.bytes),
      } : undefined;
      requireCurrentSnapshot(snapshotRevision);
      const payload = {
        ...snapshot,
        importedSource: importedSourceRef.current ?? undefined,
        presentation,
      };
      let receipt;
      if (expected) {
        const replace = portableSave ? copies.replaceWorkFile : copies.replaceOpaque;
        if (!replace) throw new Error("Save is unavailable. Save a copy instead.");
        receipt = await replace.call(copies, expected, payload);
      } else {
        const create = portableSave ? copies.createWorkFile! : copies.createOpaque;
        receipt = await create.call(copies, name, payload);
      }
      void refreshCopies();
      const stillCurrent = mutationCompletion.save(live, snapshotRevision, receipt);
      // The replacement already wrote to the host; `stillCurrent` false means
      // only that the open work moved on before the save could be confirmed,
      // which is not a copy-store conflict.
      return expected && !stillCurrent
        ? { saved: false, reason: "The copy was saved, but this work changed before the save could be confirmed. Refresh to review it." }
        : { saved: true };
    } catch (error) {
      markNotSaved();
      setSaveStatus("failed");
      setOutcome("idle");
      setMessage(error instanceof Error && error.message === COPY_CHANGED_MESSAGE ? COPY_CHANGED_MESSAGE : describe(error, "The copy could not be saved on this device."));
      return { saved: false, reason: copyFailureReason(name, error) };
    } finally {
      saveInFlightRef.current = false;
      evaluateSavedStatus();
      end();
    }
  }

  async function prepareJ4Bindings(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog> {
    if (blockUnknownOpenRecovery()) throw new Error("Recovery is pending. Refresh or close the open work first.");
    if (!begin()) throw new Error("Another operation is in progress.");
    try {
      setMessage(null);
      return await runtime.listKeyedGroupedSumBindings(witness);
    } catch (error) {
      setMessage(describe(error, "The current tables could not be prepared for a cross-table summary."));
      throw error;
    } finally {
      setOutcome("idle");
      end();
    }
  }

  async function createJ4(witness: ViewWitness, binding: KeyedGroupedSumBindingChoice): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    if (!begin()) return false;
    try {
      setMessage(null);
      const catalog = await runtime.listKeyedGroupedSumBindings(witness);
      if (bindingCatalogContainsDate(catalog)) {
        setMessage(DATE_SUMMARY_UNSUPPORTED_MESSAGE);
        setOutcome("idle");
        end();
        return false;
      }
      return mutationCompletion.run({ kind: "summary", witness, dispatch: () => runtime.createKeyedGroupedSum(witness, binding) }, result => result.kind !== "refused", end);
    } catch (error) {
      setOutcome("idle");
      setMessage(describe(error, "The current tables could not be checked before creating the cross-table summary."));
      end();
      return false;
    }
  }

  function refreshJ4(witness: ViewWitness, definitionId: string): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return Promise.resolve(false);
    const admitted = viewRef.current;
    if (!admitted || !targetedResultRefreshIsAdmitted({ currentness, live: admitted, witness, definitionIds: j4DefinitionIdsRef.current, definitionId })) return Promise.resolve(false);
    if (!begin()) return Promise.resolve(false);
    return mutationCompletion.refreshSummary(witness, definitionId, () => runtime.queryKeyedGroupedSum(witness, definitionId), end);
  }

  function createReport(definitionId: string, type: ReportConfiguration["type"]): void {
    const live = viewRef.current;
    if (currentness !== "current" || inflightRef.current) {
      setMessage("Wait for the changed values and all summaries to be confirmed before creating a report.");
      return;
    }
    const source = confirmedReportSource(live, j4ResultsRef.current, definitionId);
    if (!source) {
      setMessage("Refresh the cross-table result before creating a report.");
      return;
    }
    installReport({
      definitionId,
      type,
      title: type === "bar" ? "Current grouped summary" : "Grouped summary trend",
      categoryLabel: "Category",
      valueLabel: "Value",
      legendVisible: true,
    }, true);
    setSalesInitialOccurrence((occurrence) => occurrence === live?.occurrence ? null : occurrence);
    markNotSaved();
  }

  function updateReport(next: ReportConfiguration): void {
    if (next.definitionId.length === 0 || (next.type !== "bar" && next.type !== "line")) return;
    installReport(next, true);
    setSalesInitialOccurrence((occurrence) => occurrence === viewRef.current?.occurrence ? null : occurrence);
    markNotSaved();
  }

  function removeReport(): boolean {
    if (blockUnknownOpenRecovery() || !begin()) return false;
    try {
      if (!viewRef.current || reportRef.current === null) return false;
      installReport(null, true);
      setSalesInitialOccurrence((occurrence) => occurrence === viewRef.current?.occurrence ? null : occurrence);
      markNotSaved();
      setOutcome("idle");
      setMessage("The report configuration was removed. Table data and the cross-table definition were kept.");
      return true;
    } finally {
      end();
    }
  }

  function exportReportPng(witness: ViewWitness, candidate: ReportConfiguration): boolean {
    const live = viewRef.current;
    const current = reportRef.current;
    const result = live && j4ResultsRef.current.find((entry) =>
      entry.definitionId === candidate.definitionId && entry.revision === live.revision && entry.diagnostics.length === 0,
    );
    if (inflightRef.current || !live || !current || current !== candidate || live.occurrence !== witness.occurrence ||
      live.revision !== witness.revision || !result || currentness !== "current") {
      setMessage("The report source changed or is unavailable. Refresh it before exporting a PNG.");
      return false;
    }
    return true;
  }

  async function close(): Promise<void> {
    if (terminalReloadRequiredRef.current || startupUnavailableRef.current || inflightRef.current) return;
    inflightRef.current = true;
    setBusy(true);
    try {
      await runtime.close();
    } catch (error) {
      setMessage(describe(error, "The work could not be closed."));
      throw new Error(describe(error, "The work could not be closed."));
    } finally {
      detachedReportsRef.current.observeOccurrence(null);
      bindCopy(null, null);
      viewRef.current = null;
      installView(null);
      installJ4DefinitionIds([]);
      clearJ4Results();
      installReport(null);
      abandonSalesOccurrenceMarkers();
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "close");
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      reportDraftDirtyRef.current = false;
      syncDirty();
      savedRevisionRef.current = null;
      setSaveStatus("not-saved");
      importedSourceRef.current = null;
      importBytesRef.current = null;
      preparedDownloadRef.current = null;
      setInterop(null);
      cleanupPreviewContextRef.current = null;
      pendingReplacementRef.current = null;
      unknownOpenRecoveryRef.current = false;
      provenanceUnconfirmedRef.current = false;
      clearOpenCheckpoint();
      setCurrentness("current");
      setOutcome("idle");
      end();
    }
  }

  async function refresh(): Promise<void> {
    if (!begin()) return;
    try {
      setMessage(null);
      setCurrentness("pending");
      clearJ4Results();
      const next = await runtime.read();
      // Discovery is part of the coherent refresh boundary. Do not install a
      // table projection that has not yet been paired with its J4 inventory.
      const results = await readJ4Results(next);
      const checkpoint = openRecoveryCheckpointRef.current;
      const pendingReplacement = pendingReplacementRef.current;
      const recoveryDecision = checkpoint ? openRecoveryRestoreDecision(checkpoint, next) : null;
      const sourceUnconfirmed = (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current) &&
        (checkpoint === null || !recoveryDecision?.sameOccurrence);
      if (sourceUnconfirmed) {
        // The candidate occurrence is readable, but its source identity is
        // not. Keep the actionable projection absent so Refresh and explicit
        // Close remain available from the recovery home.
        viewRef.current = null;
        installView(null);
        installJ4DefinitionIds([]);
        clearJ4Results();
        installReport(null);
        importedSourceRef.current = null;
        setInterop(null);
        cleanupPreviewContextRef.current = null;
        importBytesRef.current = null;
        preparedDownloadRef.current = null;
        pendingReplacementRef.current = null;
        pendingDirtyRef.current = false;
        draftDirtyRef.current = false;
        recoveryDraftRef.current = null;
        markNotSaved();
        syncDirty();
        setCurrentness("unknown");
        setOutcome(unknownOpenRecoveryRef.current ? "unknown" : "idle");
        setMessage("We could not confirm which file the open work came from. Refresh again or close it before continuing.");
        return;
      }
      if (pendingReplacement) {
        const sameReplacement = pendingReplacement.savedRevision !== null &&
          (pendingReplacement.occurrence === null ||
            (pendingReplacement.occurrence === next.occurrence && pendingReplacement.revision === next.revision));
        if (sameReplacement) {
          importedSourceRef.current = pendingReplacement.importedSource;
          setInterop(pendingReplacement.interop
            ? { ...pendingReplacement.interop, cleanupPreview: null, downloadStatus: "idle", downloadError: null }
            : null);
          const recoveredReport = pendingReplacement.presentation
            ? recoverPresentationAfterAcknowledgedOpen(
                { occurrence: pendingReplacement.occurrence, presentation: pendingReplacement.presentation },
                next,
                results,
              )
            : null;
          if (pendingReplacement.presentation && !recoveredReport) {
            // Do not publish the workbook receipt without its verified
            // paired presentation. Retain the candidate for another Refresh
            // or the existing explicit Close path.
            failClosedAfterReplacement(pendingReplacement, next);
            unknownOpenRecoveryRef.current = false;
            provenanceUnconfirmedRef.current = false;
            setOutcome("idle");
            setMessage("The saved work opened, but its report configuration could not be confirmed. Refresh to re-read the paired work.");
            return;
          }
          installReport(recoveredReport);
          bindCopy(next.occurrence, pendingReplacement.boundCopy);
          savedRevisionRef.current = next.revision;
          setSaveStatus("saved");
          pendingReplacementRef.current = null;
          if (pendingReplacement.presentation && !recoveredReport) {
            setMessage("The saved report configuration does not match a current source, so it was not opened.");
          }
        } else {
          // A readable result from another occurrence must not inherit the
          // candidate's source attachment, receipt, or report configuration.
          pendingReplacementRef.current = null;
          importedSourceRef.current = null;
          setInterop(null);
          installReport(null);
          markNotSaved();
          setMessage("The saved work could not be confirmed after opening; its report was not restored.");
        }
      }
      installView(next);
      installJ4Results(results);
      observeSalesRevision(next);
      const cleanupContext = cleanupPreviewContextRef.current;
      if (cleanupContext && (cleanupContext.occurrence !== next.occurrence ||
        cleanupContext.revision !== next.revision ||
        cleanupContext.collection !== next.table.collection.key)) {
        clearCleanupPreview();
      }
      if (checkpoint && recoveryDecision?.sameOccurrence) {
        // Reopening the old occurrence restores its settled source context;
        // the receipt is valid only when the observed revision still matches
        // and no draft/dirty state was pending at the checkpoint.
        importedSourceRef.current = checkpoint.importedSource;
        setInterop(checkpoint.interop
          ? {
              ...checkpoint.interop,
              cleanupPreview: checkpoint.revision === next.revision ? checkpoint.interop.cleanupPreview : null,
              downloadStatus: "idle",
              downloadError: null,
            }
          : null);
        cleanupPreviewContextRef.current = checkpoint.cleanupPreviewContext &&
          checkpoint.cleanupPreviewContext.revision === next.revision
          ? checkpoint.cleanupPreviewContext
          : null;
        importBytesRef.current = checkpoint.importBytes?.slice(0) ?? null;
        preparedDownloadRef.current = checkpoint.preparedDownload && preparedDownloadIsCurrent(checkpoint.preparedDownload, next, checkpoint.preparedDownload.format)
          ? { ...checkpoint.preparedDownload, bytes: checkpoint.preparedDownload.bytes.slice(0) }
          : null;
        pendingDirtyRef.current = checkpoint.pendingDirty;
        draftDirtyRef.current = checkpoint.draftDirty;
        installReport(checkpoint.report ? { ...checkpoint.report } : null, checkpoint.presentationDirty);
        recoveryDraftRef.current = checkpoint.recoveryDraft;
        bindCopy(next.occurrence, checkpoint.boundCopy);
        savedRevisionRef.current = recoveryDecision.saved ? checkpoint.savedRevision : null;
        setSaveStatus(recoveryDecision.saved ? checkpoint.saveStatus : "not-saved");
        unknownOpenRecoveryRef.current = false;
        provenanceUnconfirmedRef.current = false;
        clearOpenCheckpoint();
      } else if (checkpoint) {
        // A different occurrence was observed. Its title/revision/schema do
        // not prove source identity, so keep the projection unbound to the
        // previous source attachment and receipt.
        importedSourceRef.current = null;
        setInterop(null);
        cleanupPreviewContextRef.current = null;
        importBytesRef.current = null;
        preparedDownloadRef.current = null;
        pendingReplacementRef.current = null;
        pendingDirtyRef.current = false;
        draftDirtyRef.current = false;
        installReport(null);
        recoveryDraftRef.current = null;
        markNotSaved();
        // Keep both the marker and checkpoint. A later authoritative Refresh
        // may still prove the old occurrence; Close is the explicit abandon
        // path that clears them.
        unknownOpenRecoveryRef.current = true;
      }
      syncDirty();
      if (savedRevisionRef.current !== next.revision) markNotSaved();
      setCurrentness("current");
      setOutcome("idle");
      if (recoveryDraftRef.current !== null) {
        setMessage(`An unconfirmed input was retained for review: ${recoveryDraftRef.current}`);
      }
    } catch (error) {
      viewRef.current = null;
      installView(null);
      if (error instanceof NoResidentWorkError) {
        // The authoritative reobserve proved that the uncertain occurrence is
        // gone. Discard its dirty/recovery context so normal Open routes can
        // safely establish a fresh occurrence without replaying anything.
        bindCopy(null, null);
        const recovered = noResidentRecoveryState();
        abandonSalesOccurrenceMarkers();
        pendingDirtyRef.current = recovered.dirty;
        draftDirtyRef.current = false;
        installReport(null);
        syncDirty();
        recoveryDraftRef.current = recovered.recoveryDraft;
        cleanupPreviewContextRef.current = null;
        pendingReplacementRef.current = null;
        unknownOpenRecoveryRef.current = false;
        provenanceUnconfirmedRef.current = false;
        clearOpenCheckpoint();
        markNotSaved();
        setCurrentness(recovered.currentness);
        setOutcome(recovered.outcome);
        setMessage(recovered.message);
        return;
      } else {
        setCurrentness("unknown");
        setOutcome("unknown");
        setMessage("The current work could not be confirmed. Its freshness stays unknown.");
      }
      throw new Error(describe(error, "The work could not be refreshed."));
    } finally {
      end();
    }
  }

  function onDraftChange(next: boolean): void {
    if (terminalReloadRequiredRef.current || startupUnavailableRef.current) return;
    if (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current) {
      draftDirtyRef.current = false;
      syncDirty();
      return;
    }
    draftDirtyRef.current = next;
    syncDirty();
    if (next) {
      setSaveStatus((previous) =>
        previous === "saving" || previous === "failed" ? previous : "not-saved",
      );
    } else {
      evaluateSavedStatus();
    }
  }

  function onReportDraftChange(next: boolean): void {
    if (terminalReloadRequiredRef.current || startupUnavailableRef.current) return;
    if (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current) {
      reportDraftDirtyRef.current = false;
      syncDirty();
      return;
    }
    reportDraftDirtyRef.current = next;
    syncDirty();
    if (next) {
      setSaveStatus((previous) =>
        previous === "saving" || previous === "failed" ? previous : "not-saved",
      );
    } else {
      evaluateSavedStatus();
    }
  }

  return (
    <div
      className="ts-app-root"
      data-work-dirty={dirty ? "true" : "false"}
      data-sales-initial-occurrence={salesInitialOccurrence ?? undefined}
      data-sales-changed-occurrence={salesChangedOccurrence ?? undefined}
      data-work-currentness={view ? currentness : undefined}
    >
      <SheetShell
          appearancePreference={appearancePreference}
          view={view}
          busy={busy}
          dirty={dirty}
          currentness={currentness}
          reloadRequired={reloadRequired}
          startupUnavailable={startupUnavailable}
          outcome={outcome}
          saveStatus={saveStatus}
          message={message}
          capacity={capacityForView(capacity, view)}
          copies={savedCopies}
          copiesStatus={savedCopiesStatus}
          onRetryCopies={refreshCopies}
          onOpenWorkFile={openWorkFile}
          workFileUnavailableReason={import.meta.env.MODE === "desktop" ? WORK_FILE_DESKTOP_UNAVAILABLE : null}
          workFileSaveUnavailableReason={copies.createWorkFile ? null : WORK_FILE_SAVE_UNAVAILABLE}
          workFileOmissions={currentWorkFileOmissions()}
          onOpenFiles={openFiles}
          onNewTable={newTable}
          onEditCells={editCells}
          onCopyFormula={copyFormula}
          onPasteCells={pasteCells}
          onInsertRow={insertRow}
          // Column authoring needs the portable writer to save its result;
          // reader-only/rollback hosts do not offer it.
          onAddColumn={copies.createWorkFile ? addColumn : undefined}
          onSetColumnRequiredness={copies.createWorkFile ? setColumnRequiredness : undefined}
          onSetColumnConstraint={copies.createWorkFile ? setColumnConstraint : undefined}
          onSetColumnNumberFormat={copies.createWorkFile ? setColumnNumberFormat : undefined}
          onRenameColumn={copies.createWorkFile ? renameColumn : undefined}
          onRemoveColumn={copies.createWorkFile ? removeColumn : undefined}
          onMoveColumn={copies.createWorkFile ? moveColumn : undefined}
          onRemoveRows={removeRows}
          // A duplicate carries an authored display name and is saved through
          // the portable route, like column authoring.
          onDuplicateTable={copies.createWorkFile ? duplicateTable : undefined}
          onQueryShownTotals={queryShownTotals}
          onQueryGroupTotals={queryGroupTotals}
          onOpenExample={openExample}
          onOpenSaved={openSaved}
          onSelectCollection={selectCollection}
          onCommit={commit}
          localHistory={localHistory}
          onHistory={runHistory}
          onCreateCopy={createCopy}
          boundCopyName={boundCopyRef.current?.occurrence === view?.occurrence ? boundCopyName : null}
          onSave={async () => {
            const binding = boundCopyRef.current;
            if (!binding || binding.occurrence !== viewRef.current?.occurrence) return false;
            const outcome = await createCopy(binding.copy.name, binding.copy);
            return outcome.saved;
          }}
          onDeleteCopy={copies.delete ? async (copy) => {
            const name = copy.name;
            if (boundCopyRef.current?.copy.name === name || pendingReplacementRef.current?.boundCopy?.name === name || openRecoveryCheckpointRef.current?.boundCopy?.name === name) {
              throw new Error(`Close “${name}” before deleting it.`);
            }
            if (!begin()) throw new Error("Another operation is in progress.");
            try { await copies.delete!(name, copy); }
            finally { try { await refreshCopies(); } finally { end(); } }
          } : undefined}
          onClose={close}
          onRefresh={refresh}
          onDraftChange={onDraftChange}
          onReportDraftChange={onReportDraftChange}
          j4Results={j4Results}
          j4DefinitionIds={j4DefinitionIds}
          onPrepareJ4Bindings={prepareJ4Bindings}
          onCreateJ4={createJ4}
          onRefreshJ4={refreshJ4}
          onOpenJ4Canary={openJ4Canary}
          salesEntryTip={salesEntryTip}
          salesCatalogLayout={salesCatalogLayout}
          salesInitialNotSaved={salesInitialOccurrence === view?.occurrence}
          salesExampleChanged={salesChangedOccurrence === view?.occurrence}
          onDismissSalesEntryTip={() => { if (!terminalReloadRequiredRef.current && !startupUnavailableRef.current) setSalesEntryTip(null); }}
          report={report}
          onCreateReport={createReport}
          onUpdateReport={updateReport}
          onExportReportPng={exportReportPng}
          onRemoveReport={removeReport}
          interop={interop}
          importedSourceName={importedSourceRef.current?.name ?? null}
          onInspectImport={inspectImport}
          onImportCandidate={importCandidate}
          onCancelImport={cancelImport}
          onPreviewTrim={previewTrim}
          onPreviewDeduplicate={previewDeduplicate}
          onCommitCleanup={commitCleanup}
          onCancelCleanup={cancelCleanup}
          onPrepareDownload={prepareDownload}
          onDownload={download}
        />
      {reloadRequired || startupUnavailable ? null : <footer className="ts-notices">
        <span>Tachiko Sheet · software licenses: </span>
        <a href="/core-kit/notices/THIRD_PARTY_LICENSES.md">third-party licenses</a>
        <span aria-hidden="true"> · </span>
        <a href="/core-kit/notices/LICENSE-MIT">MIT</a>
        <span aria-hidden="true"> · </span>
        <a href="/core-kit/notices/LICENSE-APACHE">Apache-2.0</a>
      </footer>}
    </div>
  );
}
