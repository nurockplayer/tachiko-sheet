import { useCallback, useEffect, useRef, useState } from "react";
import type { AppearancePreferenceController } from "./application/appearance-preference.js";
import { confirmHistoryCommand, confirmScalarHistory, emptyLocalHistory, observeLocalHistory, type LocalHistorySnapshot } from "./application/local-history.js";
import {
  UnknownOperationOutcomeError,
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
  type SheetRuntime,
  type ViewWitness,
  type WorkbookView,
} from "./contracts.js";
import {
  OpenedProjectionRecoveryError,
  NoResidentWorkError,
  PublishedProjectionRecoveryError,
  RuntimeStartupError,
  SheetSessionError,
} from "./runtime/session.js";
import { SheetShell } from "./ui/SheetShell.js";

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

/** A completed copy is saved only for its exact current revision with no retained draft. */
export function settledSaveStatus(
  previous: SaveStatus,
  savedRevision: string | null,
  liveRevision: string | null,
  hasUncommittedDraft: boolean,
): SaveStatus {
  if (previous === "failed") return previous;
  return savedRevision !== null && liveRevision !== null && savedRevision === liveRevision && !hasUncommittedDraft
    ? "saved"
    : "not-saved";
}

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
    message: "No resident work is available. Open a project to continue.",
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
  if (error instanceof Error && error.message.length > 0) return `${fallback} (${error.message})`;
  return fallback;
}

async function opaqueSnapshotDigest(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("This host cannot verify the opaque project snapshot.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const [view, setView] = useState<WorkbookView | null>(null);
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
  const importBytesRef = useRef<ArrayBuffer | null>(null);
  const importedSourceRef = useRef<ImportedSourceAttachment | null>(null);
  // An ephemeral, user-consented delivery candidate; never canonical state.
  const preparedDownloadRef = useRef<{ format: "csv" | "xlsx"; revision: string; bytes: ArrayBuffer } | null>(null);

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
  const savedRevisionRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const recoveryDraftRef = useRef<string | null>(null);
  const j4DefinitionIdsRef = useRef<string[]>([]);
  const j4ResultsRef = useRef<KeyedGroupedSumResult[]>([]);
  const reportRef = useRef<ReportConfiguration | null>(null);
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
    preparedDownload: { format: "csv" | "xlsx"; revision: string; bytes: ArrayBuffer } | null;
    pendingDirty: boolean;
    draftDirty: boolean;
    presentationDirty: boolean;
    report: ReportConfiguration | null;
    savedRevision: string | null;
    saveStatus: SaveStatus;
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
      if (!dirtyRef.current && !unknownOpenRecoveryRef.current && !provenanceUnconfirmedRef.current) return;
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

  function abandonSalesOccurrenceMarkers(): void {
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

  /** Complete the shared observation half of any known semantic publication. */
  async function completePublishedObservation(
    next: WorkbookView,
    priorJ4: { definitionIds: string[]; results: KeyedGroupedSumResult[] } | null,
    expectedOccurrence: string,
  ): Promise<void> {
    if (next.occurrence !== expectedOccurrence) {
      throw new Error("The published work occurrence changed before its derived results could be confirmed.");
    }
    installView(next);
    clearCleanupPreview();
    pendingDirtyRef.current = true;
    syncDirty();
    if (savedRevisionRef.current !== next.revision) markNotSaved();

    // Keep the old same-occurrence result snapshot visibly pending until the
    // complete new definition/result set is confirmed in one atomic install.
    const results = await readJ4Results(next);
    const ids = results.map((result) => result.definitionId);
    const uniqueIds = new Set(ids);
    if (results.some((result) => result.revision !== next.revision) || uniqueIds.size !== ids.length ||
      (priorJ4 && priorJ4.definitionIds.some((id) => !uniqueIds.has(id)))) {
      throw new Error("The complete grouped-summary result set did not match the published work revision.");
    }
    if (viewRef.current?.occurrence !== next.occurrence || viewRef.current.revision !== next.revision) {
      throw new Error("The published work changed before its grouped summaries could be installed.");
    }
    installJ4Results(results);
    setCurrentness("current");
    setOutcome("idle");
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

  function guardReplacement(): void {
    if (unknownOpenRecoveryRef.current || provenanceUnconfirmedRef.current) {
      throw new Error("Recovery is pending. Refresh or close the resident work before opening another project.");
    }
    if (dirtyRef.current || draftDirtyRef.current) {
      throw new Error(
        "The open work has unsaved changes. Close or save it before opening another project.",
      );
    }
  }

  type ReplacementProvenance = {
    importedSource?: ImportedSourceAttachment | null;
    interop?: InteropState | null;
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
        setMessage("Recovery is pending. Refresh to confirm the resident work, or close it before continuing.");
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
          presentation: provenance.presentation ?? null,
        }
      : null;
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
        ? "The open request outcome is unknown; its current projection could not be confirmed. Refresh to re-read the resident work."
        : "The new work opened, but its current projection could not be confirmed. Refresh to re-read the work.",
    );
  }

  function commitReplacement(
    next: WorkbookView,
    results: KeyedGroupedSumResult[],
    provenance: ReplacementProvenance = {},
    recoveredReport: ReportConfiguration | null = null,
  ): void {
    abandonSalesOccurrenceMarkers();
    installView(next);
    installJ4Results(results);
    installReport(recoveredReport);
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
        setMessage("The new work opened, but its current projection could not be confirmed. Refresh to re-read the work.");
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

  function failClosedAfterPublicationRecovery(knownPublishedOccurrence?: string, confirmedEditOccurrence?: string | null): void {
    if (knownPublishedOccurrence) {
      setSalesInitialOccurrence((initialOccurrence) => salesMarkersAfterBoundary({
        salesEntryTip: null, salesCatalogLayout: null, salesInitialOccurrence: initialOccurrence, salesChangedOccurrence: null,
      }, "known-publication-recovery", knownPublishedOccurrence).salesInitialOccurrence);
    }
    if (knownPublishedOccurrence && confirmedEditOccurrence) {
      setSalesChangedOccurrence((changedOccurrence) => salesMarkersAfterBoundary({
        salesEntryTip, salesCatalogLayout, salesInitialOccurrence: null, salesChangedOccurrence,
      }, "known-publication-recovery", knownPublishedOccurrence, true).salesChangedOccurrence);
    }
    viewRef.current = null;
    installView(null);
    clearJ4Results();
    // Keep dirty as publication truth; the editor/projection itself is no
    // longer safe to present or retry until Refresh re-observes the resident work.
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    // Publication is known; only projection freshness remains unknown.
    setOutcome("idle");
    // The old preview targeted the projection we just discarded.
    setInterop((current) => current ? { ...current, cleanupPreview: null, downloadStatus: "idle", downloadError: null } : current);
    cleanupPreviewContextRef.current = null;
    setMessage("The change was published, but the current work could not be confirmed. Refresh to re-read the work.");
  }

  function failClosedAfterUnknownCleanup(): void {
    viewRef.current = null;
    installView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    setOutcome("unknown");
    setInterop((current) => current ? { ...current, cleanupPreview: null, downloadStatus: "idle", downloadError: null } : current);
    cleanupPreviewContextRef.current = null;
    setMessage("The cleanup was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried.");
  }

  function failClosedAfterUnknownEdit(edit: ScalarEdit): void {
    viewRef.current = null;
    installView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    cleanupPreviewContextRef.current = null;
    setCurrentness("unknown");
    setOutcome("unknown");
    recoveryDraftRef.current = JSON.stringify(edit);
    setMessage(`The change was dispatched but its outcome is unknown. Refresh to re-read the work. Input retained for review: ${recoveryDraftRef.current}`);
  }

  function failClosedAfterUnknownJ4(): void {
    viewRef.current = null;
    installView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    cleanupPreviewContextRef.current = null;
    setCurrentness("unknown");
    setOutcome("unknown");
    setMessage("The cross-table summary request was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried.");
  }

  function failClosedAfterUnknownHistory(direction: "undo" | "redo"): void {
    viewRef.current = null;
    installView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    cleanupPreviewContextRef.current = null;
    setCurrentness("unknown");
    setOutcome("unknown");
    setMessage(`The ${direction} request was dispatched but could not be confirmed. Refresh to re-read the work; it was not retried.`);
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
        setMessage("Recovery is pending. Refresh to re-read the resident work before opening another project.");
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
        setMessage("Recovery is pending. Refresh to re-read the resident work before opening another project.");
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
      return { kind: "reload-required", message: "The local runtime was invalidated. Reload this page before continuing." };
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
        return await refuseSalesEntry(opened, new Error("The new Sales occurrence already contains a cross-table summary."));
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
        throw new Error("The generated Sales summary could not be matched to the current work revision.");
      }
      const results = await readJ4Results(next);
      const source = confirmedReportSource(next, results, created.definitionId);
      const ids = results.map((result) => result.definitionId);
      if (!source || ids.length !== 1 || new Set(ids).size !== 1 || ids[0] !== created.definitionId ||
        created.revision !== next.revision || created.diagnostics.length !== 0) {
        throw new Error("The generated Sales summary was not uniquely confirmed at the current revision.");
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
      installView(selected);
      installJ4Results(results);
      pendingDirtyRef.current = true;
      syncDirty();
      markNotSaved();
      installReport(salesReportConfiguration(created.definitionId), true);
      setSalesEntryTip({ occurrence: selected.occurrence, collection: "catalog", field: "price" });
      setSalesCatalogLayout({ occurrence: selected.occurrence, collectionId: selected.table.collection.id });
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
        failClosedAfterPublicationRecovery();
        return { kind: "published-recovery" };
      }
      if (createDispatched && error instanceof UnknownOperationOutcomeError) {
        installReport(null);
        abandonSalesOccurrenceMarkers();
        failClosedAfterUnknownJ4();
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
      if (copy.kind !== "opaque" && copy.importedSource) {
        await runtime.validateImportedProject(copy.files, copy.importedSource.metadata);
      }
      const candidateInterop = copy.importedSource ? {
        importInspection: null, metadata: copy.importedSource.metadata, ledger: copy.importedSource.ledger,
        cleanupPreview: null, downloadStatus: "idle" as const, downloadError: null,
      } : null;
      // Validate the optional presentation before replacing the resident work.
      // A hash failure is a known refusal to open this copy, not a failed Open
      // after the new occurrence has already become resident.
      const presentationDigest = copy.kind === "opaque" && copy.presentation
        ? await opaqueSnapshotDigest(copy.bytes)
        : null;
      const presentation = copy.kind === "opaque" && copy.presentation
        ? (() => {
            if (copy.presentation!.snapshotRevision !== copy.revision ||
              copy.presentation!.snapshotDigest !== presentationDigest) {
              throw new Error("The saved report configuration does not match its opaque snapshot.");
            }
            return copy.presentation!;
          })()
        : null;
      if ((await replaceWork(
        () => copy.kind === "opaque" ? runtime.openOpaque(copy.bytes, copy.importedSource?.metadata) : runtime.openCanonical(copy.files),
        { importedSource: copy.importedSource ?? null, interop: candidateInterop, savedRevision: copy.revision, presentation },
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
        setMessage("Recovery is pending. Refresh to re-read the resident work before opening another project.");
        return;
      } else {
        setCurrentness("current");
        setOutcome("idle");
      }
      throw new Error(describe(error, `The saved copy “${name}” could not be opened.`));
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

  async function inspectImport(file: File): Promise<ImportInspection> {
    if (blockUnknownOpenRecovery()) throw new Error("Recovery is pending. Refresh or close the resident work first.");
    if (!begin()) throw new Error("Another operation is in progress.");
    try {
      setMessage(null);
      guardReplacement();
      checkpointBeforeOpen();
      const lower = file.name.toLowerCase();
      const format = lower.endsWith(".csv") ? "csv" : lower.endsWith(".xlsx") ? "xlsx" : null;
      if (!format) throw new Error("Choose a .csv or .xlsx file.");
      const bytes = await file.arrayBuffer();
      const source = await runtime.inspectSpreadsheet(bytes, format, { delimiter: ",", header: true });
      const inspection = { name: file.name, format, source } as ImportInspection;
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
      const imported = await runtime.importSpreadsheet(bytes, pending.format, { delimiter: ",", header: true }, selection);
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

  async function commitCleanup(witness: ViewWitness, previewId: string): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const live = viewRef.current;
    const context = cleanupPreviewContextRef.current;
    if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision ||
      !context || context.occurrence !== live.occurrence || context.revision !== live.revision ||
      context.collection !== live.table.collection.key || context.previewId !== previewId) {
      setOutcome("idle");
      setMessage("This cleanup preview is no longer current. Preview it again before committing.");
      return false;
    }
    if (!begin()) return false;
    try {
      const next = await runtime.commitCleanup(witness, previewId);
      // Cleanup publishes a semantic replacement. Its prior core groups are
      // no longer current; keep definition IDs so explicit Refresh can query
      // the newly published revision.
      clearJ4Results();
      setSalesInitialOccurrence((occurrence) => salesInitialOccurrenceAfterConfirmedChange(occurrence, witness.occurrence));
      installView(next); pendingDirtyRef.current = true; syncDirty(); markNotSaved();
      clearCleanupPreview();
      setOutcome("idle");
      return true;
    } catch (error) {
      if (error instanceof PublishedProjectionRecoveryError) {
        failClosedAfterPublicationRecovery(witness.occurrence);
      } else if (error instanceof UnknownOperationOutcomeError) {
        failClosedAfterUnknownCleanup();
      } else {
        setOutcome("idle");
        clearCleanupPreview();
        setMessage(describe(error, "The cleanup was not applied."));
      }
      return false;
    }
    finally { end(); }
  }

  function cancelCleanup(): void {
    clearCleanupPreview();
    setOutcome("idle");
  }

  async function prepareDownload(format: "csv" | "xlsx"): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const live = viewRef.current;
    const metadata = interop?.metadata;
    if (!live || !metadata || !begin()) return false;
    setMessage(null);
    setInterop((current) => current ? { ...current, downloadStatus: "idle", downloadError: null } : current);
    try {
      const exported = await runtime.exportSpreadsheet(witnessOf(live), metadata, format);
      preparedDownloadRef.current = { format, revision: exported.revision, bytes: exported.bytes.slice(0) };
      setInterop((current) => current ? { ...current, ledger: exported.ledger, downloadStatus: "consent", downloadError: null } : current);
      setOutcome("idle");
      return true;
    } catch (error) {
      preparedDownloadRef.current = null;
      setOutcome("idle");
      const detail = describe(error, "The export could not be prepared for review.");
      setInterop((current) => current ? { ...current, downloadStatus: "failed", downloadError: detail } : current);
      setMessage(detail); return false;
    } finally { end(); }
  }

  async function download(format: "csv" | "xlsx"): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const live = viewRef.current;
    const prepared = preparedDownloadRef.current;
    if (!live || !prepared || prepared.format !== format || prepared.revision !== live.revision || !begin()) return false;
    setMessage(null);
    setInterop((current) => current ? { ...current, downloadError: null } : current);
    try {
      const blob = new Blob([prepared.bytes], { type: format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${live.title}.${format}`; anchor.hidden = true;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

  async function commit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    if (!begin()) return false;
    const priorJ4 = currentness === "current"
      ? { definitionIds: [...j4DefinitionIdsRef.current], results: [...j4ResultsRef.current] }
      : null;
    let published = false;
    try {
      const live = viewRef.current;
      if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision) {
        setOutcome("idle");
        setMessage("This draft belongs to an older view. Refresh to load the current work.");
        return false;
      }
      setMessage(null);
      setCurrentness("pending");
      const confirmed = await runtime.editConfirmed(witness, target, edit);
      published = true;
      installLocalHistory(confirmScalarHistory(localHistoryRef.current, confirmed.view, confirmed.publication, true));
      const next = confirmed.view;
      await completePublishedObservation(next, priorJ4, witness.occurrence);
      setSalesInitialOccurrence((occurrence) => salesInitialOccurrenceAfterConfirmedChange(occurrence, witness.occurrence));
      setSalesChangedOccurrence(salesChangeOccurrenceAfterConfirmedEdit(salesEntryTip, witness.occurrence));
      return true;
    } catch (error) {
      if (published || error instanceof PublishedProjectionRecoveryError) {
        installLocalHistory(emptyLocalHistory());
        failClosedAfterPublicationRecovery(
          witness.occurrence,
          salesChangeOccurrenceAfterConfirmedEdit(salesEntryTip, witness.occurrence),
        );
        // Publication is known; avoid SheetShell's rejected-draft path and
        // ordinary semantic retry while only observation remains unresolved.
        return true;
      } else if (error instanceof UnknownOperationOutcomeError) {
        installLocalHistory(emptyLocalHistory());
        failClosedAfterUnknownEdit(edit);
        return true;
      } else {
        if (error instanceof SheetSessionError && (error.code === "not-open" || error.code === "stale-witness")) {
          setOutcome("idle");
          setCurrentness("unknown");
          setMessage("This draft belongs to an unconfirmed work view. Refresh to re-read the work; the draft was kept.");
          return false;
        }
        const current = viewRef.current;
        if (priorJ4 && current &&
          current.occurrence === witness.occurrence && current.revision === witness.revision) {
          restoreJ4Results(priorJ4.definitionIds, priorJ4.results);
        }
        setOutcome("idle");
        setCurrentness("current");
        setMessage(describe(error, "The change was not applied."));
      }
      return false;
    } finally {
      end();
    }
  }

  async function runHistory(direction: "undo" | "redo"): Promise<FieldTarget | null> {
    const live = viewRef.current;
    const known = localHistoryRef.current;
    if (!live || currentness !== "current" || known.occurrence !== live.occurrence ||
      known.revision !== live.revision || (direction === "undo" ? known.undoCount : known.redoCount) < 1 || !begin()) return null;
    const witness = witnessOf(live);
    const priorJ4 = { definitionIds: [...j4DefinitionIdsRef.current], results: [...j4ResultsRef.current] };
    let published = false;
    try {
      setMessage(null);
      setCurrentness("pending");
      const confirmed = await runtime.trackerHistory(witness, direction);
      published = true;
      installLocalHistory(confirmHistoryCommand(localHistoryRef.current, confirmed.view, confirmed.publication, direction));
      await completePublishedObservation(confirmed.view, priorJ4, witness.occurrence);
      setSalesInitialOccurrence((occurrence) => salesInitialOccurrenceAfterConfirmedChange(occurrence, witness.occurrence));
      setSalesChangedOccurrence(salesChangeOccurrenceAfterConfirmedEdit(salesEntryTip, witness.occurrence));
      return confirmed.publication.fields.length === 1 ? confirmed.publication.fields[0]! : null;
    } catch (error) {
      installLocalHistory(emptyLocalHistory());
      if (published || error instanceof PublishedProjectionRecoveryError) {
        failClosedAfterPublicationRecovery(
          witness.occurrence,
          salesChangeOccurrenceAfterConfirmedEdit(salesEntryTip, witness.occurrence),
        );
      } else {
        failClosedAfterUnknownHistory(direction);
      }
      return null;
    } finally {
      end();
    }
  }

  async function createCopy(name: string): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    if (!begin()) return false;
    const live = viewRef.current;
    if (!live) {
      end();
      setMessage("There is no open work to save.");
      return false;
    }
    saveInFlightRef.current = true;
    setMessage(null);
    setSaveStatus("saving");
    try {
      const definitionBearing = j4DefinitionIdsRef.current.length > 0;
      const hasDateColumn = definitionBearing
        ? false
        : bindingCatalogContainsDate(await runtime.listKeyedGroupedSumBindings(witnessOf(live)));
      let snapshotRevision: string;
      let receipt;
      if (definitionBearing || hasDateColumn) {
        const snapshot = await runtime.exportOpaque(witnessOf(live));
        snapshotRevision = snapshot.revision;
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
        receipt = await copies.createOpaque(name, {
          ...snapshot,
          importedSource: importedSourceRef.current ?? undefined,
          presentation,
        });
      } else {
        const snapshot = await runtime.exportCanonical(witnessOf(live));
        snapshotRevision = snapshot.revision;
        receipt = await copies.create(name, snapshot, importedSourceRef.current ?? undefined);
      }
      void refreshCopies();
      const current = viewRef.current;
      const stillCurrent =
        current !== null &&
        current.occurrence === live.occurrence &&
        current.revision === snapshotRevision &&
        receipt.revision === snapshotRevision;
      if (stillCurrent) {
        setSalesEntryTip((marker) => salesEntryTipAfterSuccessfulSave(marker, live.occurrence));
        setSalesInitialOccurrence((occurrence) => salesInitialOccurrenceAfterConfirmedChange(occurrence, live.occurrence));
        savedRevisionRef.current = receipt.revision;
        pendingDirtyRef.current = false;
        presentationDirtyRef.current = false;
        syncDirty();
      } else {
        markNotSaved();
      }
      setOutcome("idle");
      return true;
    } catch (error) {
      markNotSaved();
      setSaveStatus("failed");
      setOutcome("idle");
      setMessage(describe(error, "The copy could not be saved on this device."));
      return false;
    } finally {
      saveInFlightRef.current = false;
      evaluateSavedStatus();
      end();
    }
  }

  async function prepareJ4Bindings(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog> {
    if (blockUnknownOpenRecovery()) throw new Error("Recovery is pending. Refresh or close the resident work first.");
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
    const priorJ4 = currentness === "current"
      ? { definitionIds: [...j4DefinitionIdsRef.current], results: [...j4ResultsRef.current] }
      : null;
    const priorOccurrence = witness.occurrence;
    const priorRevision = witness.revision;
    let published = false;
    let creationStarted = false;
    try {
      setMessage(null);
      const catalog = await runtime.listKeyedGroupedSumBindings(witness);
      if (bindingCatalogContainsDate(catalog)) {
        setMessage(DATE_SUMMARY_UNSUPPORTED_MESSAGE);
        setOutcome("idle");
        return false;
      }
      creationStarted = true;
      setCurrentness("pending");
      clearJ4Results();
      await runtime.createKeyedGroupedSum(witness, binding);
      published = true;
      setSalesInitialOccurrence((occurrence) => salesInitialOccurrenceAfterConfirmedChange(occurrence, witness.occurrence));
      const next = await runtime.read();
      const results = await readJ4Results(next);
      installView(next);
      installJ4Results(results);
      clearCleanupPreview();
      pendingDirtyRef.current = true;
      syncDirty();
      markNotSaved();
      setCurrentness("current");
      setOutcome("idle");
      return true;
    } catch (error) {
      if (!creationStarted) {
        setOutcome("idle");
        setMessage(describe(error, "The current tables could not be checked before creating the cross-table summary."));
        return false;
      }
      if (published) {
        failClosedAfterPublicationRecovery(witness.occurrence);
        return true;
      }
      if (error instanceof PublishedProjectionRecoveryError) {
        failClosedAfterPublicationRecovery(witness.occurrence);
        return true;
      }
      if (error instanceof UnknownOperationOutcomeError) {
        failClosedAfterUnknownJ4();
        return true;
      }
      const current = viewRef.current;
      if (priorJ4 && current &&
        current.occurrence === priorOccurrence && current.revision === priorRevision) {
        restoreJ4Results(priorJ4.definitionIds, priorJ4.results);
      }
      setCurrentness("current");
      setOutcome("idle");
      setMessage(describe(error, "The cross-table summary was not created."));
      return false;
    } finally {
      end();
    }
  }

  async function refreshJ4(witness: ViewWitness, definitionId: string): Promise<boolean> {
    if (blockUnknownOpenRecovery()) return false;
    const admitted = viewRef.current;
    if (!admitted || !targetedResultRefreshIsAdmitted({ currentness, live: admitted, witness, definitionIds: j4DefinitionIdsRef.current, definitionId })) return false;
    if (!begin()) return false;
    try {
      setMessage(null);
      setCurrentness("pending");
      const result = await runtime.queryKeyedGroupedSum(witness, definitionId);
      const current = viewRef.current;
      if (!current || current.occurrence !== admitted.occurrence || current.revision !== admitted.revision ||
        current.occurrence !== witness.occurrence || current.revision !== witness.revision) return false;
      if (result.definitionId !== definitionId || result.revision !== admitted.revision) {
        throw new Error("The summary refresh returned a result for a different definition or revision.");
      }
      // A targeted refresh must not discard sibling summaries. Replace the
      // requested result in place, or append it only when it was not already
      // visible; the definition inventory remains the recovery control set.
      upsertJ4Result(result);
      setCurrentness("current");
      setOutcome("idle");
      return true;
    } catch (error) {
      const current = viewRef.current;
      if (!current || current.occurrence !== admitted.occurrence || current.revision !== admitted.revision) return false;
      if (error instanceof SheetSessionError && (error.code === "not-open" || error.code === "stale-witness")) {
        setCurrentness("unknown");
        setOutcome("unknown");
        setMessage("The work could not be confirmed. Refresh the workbook to recheck all results.");
        return false;
      }
      // A failed targeted refresh invalidates only that result. Other current
      // summaries and every definition refresh control remain available.
      dropJ4Result(definitionId);
      setCurrentness("current");
      setOutcome("idle");
      setMessage(null);
      return false;
    } finally {
      end();
    }
  }

  function createReport(definitionId: string, type: ReportConfiguration["type"]): void {
    const live = viewRef.current;
    if (currentness !== "current" || inflightRef.current) {
      setMessage("Wait for the published work and all grouped summaries to be confirmed before creating a report.");
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
      setMessage(describe(error, "The work could not be released cleanly."));
      throw new Error(describe(error, "The work could not be closed."));
    } finally {
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
        setMessage("The resident work's source identity could not be confirmed. Refresh again or close it before continuing.");
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
        preparedDownloadRef.current = checkpoint.preparedDownload && checkpoint.preparedDownload.revision === next.revision
          ? { ...checkpoint.preparedDownload, bytes: checkpoint.preparedDownload.bytes.slice(0) }
          : null;
        pendingDirtyRef.current = checkpoint.pendingDirty;
        draftDirtyRef.current = checkpoint.draftDirty;
        installReport(checkpoint.report ? { ...checkpoint.report } : null, checkpoint.presentationDirty);
        recoveryDraftRef.current = checkpoint.recoveryDraft;
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
          copies={savedCopies}
          copiesStatus={savedCopiesStatus}
          onRetryCopies={refreshCopies}
          onOpenFiles={openFiles}
          onOpenExample={openExample}
          onOpenSaved={openSaved}
          onSelectCollection={selectCollection}
          onCommit={commit}
          localHistory={localHistory}
          onHistory={runHistory}
          onCreateCopy={createCopy}
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
        <span>Tachiko Sheet · experimental core kit notices: </span>
        <a href="/core-kit/notices/THIRD_PARTY_LICENSES.md">third-party licenses</a>
        <span aria-hidden="true"> · </span>
        <a href="/core-kit/notices/LICENSE-MIT">MIT</a>
        <span aria-hidden="true"> · </span>
        <a href="/core-kit/notices/LICENSE-APACHE">Apache-2.0</a>
      </footer>}
    </div>
  );
}
