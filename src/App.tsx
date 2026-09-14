import { useCallback, useEffect, useRef, useState } from "react";
import {
  UnknownOperationOutcomeError,
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
  type OperationOutcome,
  type SaveStatus,
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
  SheetSessionError,
} from "./runtime/session.js";
import { SheetShell } from "./ui/SheetShell.js";

/** Fixed same-origin transport inventory; bytes are opaque and never parsed. */
const EXAMPLE_BASE = "/examples/release-plan/";
const J4_CANARY_BASE = "/examples/j4-catalog-sales/";
const EXAMPLE_FILES: readonly string[] = [
  "manifest.json",
  "schemas.json",
  ...Array.from("0123456789abcdef", (shard) => `entities/${shard}.jsonl`),
];

export interface AppProps {
  runtime: SheetRuntime;
  copies: LocalCopies;
}

export type RecoveryDraftBoundary = "reobserve" | "replacement" | "close";

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

function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (${error.message})`;
  return fallback;
}

async function loadExampleFiles(): Promise<CanonicalProjectFile[]> {
  return loadFixtureFiles(EXAMPLE_BASE);
}

async function loadJ4CanaryFiles(): Promise<CanonicalProjectFile[]> {
  return loadFixtureFiles(J4_CANARY_BASE);
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
export function App({ runtime, copies }: AppProps) {
  const [view, setView] = useState<WorkbookView | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentness, setCurrentness] = useState<Currentness>("current");
  const [outcome, setOutcome] = useState<OperationOutcome>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("not-saved");
  const [message, setMessage] = useState<string | null>(null);
  const [savedCopies, setSavedCopies] = useState<SavedCopySummary[]>([]);
  const [j4Results, setJ4Results] = useState<KeyedGroupedSumResult[]>([]);
  const [j4DefinitionIds, setJ4DefinitionIds] = useState<string[]>([]);
  const [interop, setInterop] = useState<InteropState | null>(null);
  const importBytesRef = useRef<ArrayBuffer | null>(null);
  const importedSourceRef = useRef<ImportedSourceAttachment | null>(null);
  // An ephemeral, user-consented delivery candidate; never canonical state.
  const preparedDownloadRef = useRef<{ format: "csv" | "xlsx"; revision: string; bytes: ArrayBuffer } | null>(null);

  const viewRef = useRef<WorkbookView | null>(null);
  const inflightRef = useRef(false);
  const pendingDirtyRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const dirtyRef = useRef(false);
  const savedRevisionRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const recoveryDraftRef = useRef<string | null>(null);
  const j4DefinitionIdsRef = useRef<string[]>([]);

  const syncDirty = useCallback((): void => {
    const next = pendingDirtyRef.current || draftDirtyRef.current;
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const refreshCopies = useCallback(async (): Promise<void> => {
    try {
      setSavedCopies(await copies.list());
    } catch (error) {
      setMessage(describe(error, "Saved copies could not be listed."));
    }
  }, [copies]);

  useEffect(() => {
    void refreshCopies();
  }, [refreshCopies]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function installView(next: WorkbookView): void {
    viewRef.current = next;
    setView(next);
  }

  function clearJ4Results(): void {
    setJ4Results([]);
  }

  function installJ4DefinitionIds(ids: string[]): void {
    j4DefinitionIdsRef.current = ids;
    setJ4DefinitionIds(ids);
  }

  async function discoverJ4Results(next: WorkbookView): Promise<void> {
    const results = await runtime.discoverKeyedGroupedSums(witnessOf(next));
    installJ4DefinitionIds(results.map((result) => result.definitionId));
    setJ4Results(results);
  }

  function witnessOf(target: WorkbookView): ViewWitness {
    return { occurrence: target.occurrence, revision: target.revision };
  }

  /** Synchronous guard: a second click cannot dispatch before React re-renders. */
  function begin(): boolean {
    if (inflightRef.current) return false;
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
    if (saveInFlightRef.current || saved === null || live === null) return;
    if (live.revision !== saved || draftDirtyRef.current) return;
    setSaveStatus((previous) => (previous === "failed" ? previous : "saved"));
  }

  function guardReplacement(): void {
    if (dirtyRef.current || draftDirtyRef.current) {
      throw new Error(
        "The open work has unsaved changes. Close or save it before opening another project.",
      );
    }
  }

  function failClosedAfterOpenRecovery(error: OpenedProjectionRecoveryError): void {
    viewRef.current = null;
    setView(null);
    installJ4DefinitionIds([]);
    clearJ4Results();
    // The attempted replacement belongs to a new occurrence boundary; never
    // carry an older unknown-edit input into its recovery reobserve.
    const recoveryContext = { current: recoveryDraftRef.current };
    clearRecoveryOccurrenceContext(recoveryContext, error);
    recoveryDraftRef.current = recoveryContext.current;
    pendingDirtyRef.current = false;
    draftDirtyRef.current = false;
    syncDirty();
    savedRevisionRef.current = null;
    setSaveStatus("not-saved");
    setCurrentness("unknown");
    setOutcome(error.operationOutcome === "unknown" ? "unknown" : "idle");
    setMessage(
      error.operationOutcome === "unknown"
        ? "The open request outcome is unknown; its current projection could not be confirmed. Refresh to re-read the resident work."
        : "The new work opened, but its current projection could not be confirmed. Refresh to re-read the work.",
    );
  }

  function failClosedAfterPublicationRecovery(): void {
    viewRef.current = null;
    setView(null);
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
    setInterop((current) => current ? { ...current, cleanupPreview: null, downloadStatus: "idle" } : current);
    setMessage("The change was published, but the current work could not be confirmed. Refresh to re-read the work.");
  }

  function failClosedAfterUnknownCleanup(): void {
    viewRef.current = null;
    setView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    setOutcome("unknown");
    setInterop((current) => current ? { ...current, cleanupPreview: null, downloadStatus: "idle" } : current);
    setMessage("The cleanup was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried.");
  }

  function failClosedAfterUnknownEdit(edit: ScalarEdit): void {
    viewRef.current = null;
    setView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    setOutcome("unknown");
    recoveryDraftRef.current = JSON.stringify(edit);
    setMessage(`The change was dispatched but its outcome is unknown. Refresh to re-read the work. Input retained for review: ${recoveryDraftRef.current}`);
  }

  function failClosedAfterUnknownJ4(): void {
    viewRef.current = null;
    setView(null);
    clearJ4Results();
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    setOutcome("unknown");
    setMessage("The cross-table summary request was dispatched but its outcome is unknown. Refresh to re-read the work; it was not retried.");
  }

  async function openFiles(files: FileList): Promise<void> {
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      installJ4DefinitionIds([]);
      clearJ4Results();
      const next = await runtime.openFiles(files);
      installView(next);
      await discoverJ4Results(next);
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      markNotSaved();
      importBytesRef.current = null;
      importedSourceRef.current = null;
      preparedDownloadRef.current = null;
      setInterop(null);
      setCurrentness("current");
      setOutcome("idle");
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      } else if (viewRef.current === null && dirtyRef.current && currentness === "unknown") {
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
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      installJ4DefinitionIds([]);
      clearJ4Results();
      const next = await runtime.openCanonical(await loadExampleFiles());
      installView(next);
      await discoverJ4Results(next);
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      markNotSaved();
      importBytesRef.current = null;
      importedSourceRef.current = null;
      preparedDownloadRef.current = null;
      setInterop(null);
      setCurrentness("current");
      setOutcome("idle");
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      } else if (viewRef.current === null && dirtyRef.current && currentness === "unknown") {
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

  async function openJ4Canary(): Promise<void> {
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      installJ4DefinitionIds([]);
      clearJ4Results();
      const next = await runtime.openCanonical(await loadJ4CanaryFiles());
      installView(next);
      await discoverJ4Results(next);
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      markNotSaved();
      importBytesRef.current = null;
      importedSourceRef.current = null;
      preparedDownloadRef.current = null;
      setInterop(null);
      setCurrentness("current");
      setOutcome("idle");
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      }
      setCurrentness("current");
      setOutcome("idle");
      throw new Error(describe(error, "The Catalog/Sales canary could not be opened."));
    } finally {
      end();
    }
  }

  async function openSaved(name: string): Promise<void> {
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      installJ4DefinitionIds([]);
      clearJ4Results();
      const copy = await copies.readAny(name);
      if (!copy) throw new Error(`the saved copy “${name}” is no longer stored on this device`);
      if (copy.kind !== "opaque" && copy.importedSource) {
        await runtime.validateImportedProject(copy.files, copy.importedSource.metadata);
      }
      const next = copy.kind === "opaque"
        ? await runtime.openOpaque(copy.bytes, copy.importedSource?.metadata)
        : await runtime.openCanonical(copy.files);
      installView(next);
      await discoverJ4Results(next);
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "replacement");
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      if (next.revision === copy.revision) {
        savedRevisionRef.current = copy.revision;
        setSaveStatus("saved");
      } else {
        markNotSaved();
      }
      setCurrentness("current");
      setOutcome("idle");
      importedSourceRef.current = copy.importedSource ?? null;
      preparedDownloadRef.current = null;
      setInterop(copy.importedSource ? {
        importInspection: null,
        metadata: copy.importedSource.metadata,
        ledger: copy.importedSource.ledger,
        cleanupPreview: null,
        downloadStatus: "idle",
      } : null);
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) {
        failClosedAfterOpenRecovery(error);
        return;
      } else if (viewRef.current === null && dirtyRef.current && currentness === "unknown") {
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
    if (!begin()) return;
    try {
      setMessage(null);
      setCurrentness("pending");
      const next = await runtime.selectCollection(witness, collection);
      installView(next);
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
    if (!begin()) throw new Error("Another operation is in progress.");
    try {
      guardReplacement();
      const lower = file.name.toLowerCase();
      const format = lower.endsWith(".csv") ? "csv" : lower.endsWith(".xlsx") ? "xlsx" : null;
      if (!format) throw new Error("Choose a .csv or .xlsx file.");
      const bytes = await file.arrayBuffer();
      const source = await runtime.inspectSpreadsheet(bytes, format, { delimiter: ",", header: true });
      const inspection = { name: file.name, format, source } as ImportInspection;
      importBytesRef.current = bytes.slice(0);
      setInterop({ importInspection: inspection, metadata: null, ledger: source.ledger, cleanupPreview: null, downloadStatus: "idle" });
      setMessage(null);
      return inspection;
    } catch (error) {
      setMessage(describe(error, "The selected spreadsheet could not be inspected."));
      throw error;
    } finally { end(); }
  }

  async function importCandidate(selection: ImportSelection): Promise<boolean> {
    const pending = interop?.importInspection;
    const bytes = importBytesRef.current;
    if (!pending || !bytes || !begin()) return false;
    try {
      guardReplacement();
      setCurrentness("pending");
      const imported = await runtime.importSpreadsheet(bytes, pending.format, { delimiter: ",", header: true }, selection);
      // Import installs a different work occurrence. Never present an older
      // work's groups or definition IDs against this newly imported view.
      installJ4DefinitionIds([]);
      clearJ4Results();
      installView(imported.view);
      preparedDownloadRef.current = null;
      pendingDirtyRef.current = true;
      syncDirty();
      markNotSaved();
      setInterop({ importInspection: null, metadata: imported.metadata, ledger: imported.ledger, cleanupPreview: null, downloadStatus: "idle" });
      importedSourceRef.current = { name: pending.name, format: pending.format, bytes: bytes.slice(0), metadata: imported.metadata, ledger: imported.ledger };
      setCurrentness("current");
      setOutcome("idle");
      return true;
    } catch (error) {
      if (error instanceof OpenedProjectionRecoveryError) failClosedAfterOpenRecovery(error);
      else setMessage(describe(error, "The import was not applied."));
      return false;
    } finally { end(); }
  }

  function cancelImport(): void {
    importBytesRef.current = null;
    setInterop((current) => current ? { ...current, importInspection: null } : null);
  }

  async function previewTrim(witness: ViewWitness, fields: FieldTarget[]) {
    if (!begin()) return null;
    try {
      const preview = await runtime.previewCleanup(witness, { kind: "trim", fields });
      setInterop((current) => current ? { ...current, cleanupPreview: preview } : current);
      setOutcome("idle");
      return preview;
    } catch (error) { setOutcome("idle"); setMessage(describe(error, "A cleanup preview could not be created.")); return null; }
    finally { end(); }
  }

  async function previewDeduplicate(witness: ViewWitness, entities: string[], fields: string[]) {
    if (!begin()) return null;
    try {
      const preview = await runtime.previewCleanup(witness, { kind: "deduplicate", entities, key_fields: fields });
      setInterop((current) => current ? { ...current, cleanupPreview: preview } : current);
      setOutcome("idle");
      return preview;
    } catch (error) { setOutcome("idle"); setMessage(describe(error, "A duplicate-row preview could not be created.")); return null; }
    finally { end(); }
  }

  async function commitCleanup(witness: ViewWitness, previewId: string): Promise<boolean> {
    if (!begin()) return false;
    try {
      const next = await runtime.commitCleanup(witness, previewId);
      // Cleanup publishes a semantic replacement. Its prior core groups are
      // no longer current; keep definition IDs so explicit Refresh can query
      // the newly published revision.
      clearJ4Results();
      installView(next); pendingDirtyRef.current = true; syncDirty(); markNotSaved();
      setInterop((current) => current ? { ...current, cleanupPreview: null } : current);
      setOutcome("idle");
      return true;
    } catch (error) {
      if (error instanceof PublishedProjectionRecoveryError) {
        failClosedAfterPublicationRecovery();
      } else if (error instanceof UnknownOperationOutcomeError) {
        failClosedAfterUnknownCleanup();
      } else {
        setOutcome("idle");
        setInterop((current) => current ? { ...current, cleanupPreview: null } : current);
        setMessage(describe(error, "The cleanup was not applied."));
      }
      return false;
    }
    finally { end(); }
  }

  function cancelCleanup(): void {
    setInterop((current) => current ? { ...current, cleanupPreview: null } : current);
    setOutcome("idle");
  }

  async function prepareDownload(format: "csv" | "xlsx"): Promise<boolean> {
    const live = viewRef.current;
    const metadata = interop?.metadata;
    if (!live || !metadata || !begin()) return false;
    try {
      const exported = await runtime.exportSpreadsheet(witnessOf(live), metadata, format);
      preparedDownloadRef.current = { format, revision: exported.revision, bytes: exported.bytes.slice(0) };
      setInterop((current) => current ? { ...current, ledger: exported.ledger, downloadStatus: "consent" } : current);
      setOutcome("idle");
      return true;
    } catch (error) {
      preparedDownloadRef.current = null;
      setOutcome("idle");
      setInterop((current) => current ? { ...current, downloadStatus: "failed" } : current);
      setMessage(describe(error, "The export could not be prepared for review.")); return false;
    } finally { end(); }
  }

  async function download(format: "csv" | "xlsx"): Promise<boolean> {
    const live = viewRef.current;
    const prepared = preparedDownloadRef.current;
    if (!live || !prepared || prepared.format !== format || prepared.revision !== live.revision || !begin()) return false;
    try {
      const blob = new Blob([prepared.bytes], { type: format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${live.title}.${format}`; anchor.hidden = true;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      preparedDownloadRef.current = null;
      setInterop((current) => current ? { ...current, downloadStatus: "idle" } : current);
      setOutcome("idle");
      return true;
    } catch (error) {
      preparedDownloadRef.current = null;
      setOutcome("idle");
      setInterop((current) => current ? { ...current, downloadStatus: "failed" } : current);
      setMessage(describe(error, "The download was not created.")); return false;
    } finally { end(); }
  }

  async function commit(witness: ViewWitness, target: FieldTarget, edit: ScalarEdit): Promise<boolean> {
    if (!begin()) return false;
    try {
      const live = viewRef.current;
      if (!live || live.occurrence !== witness.occurrence || live.revision !== witness.revision) {
        setOutcome("idle");
        setMessage("This draft belongs to an older view. Refresh to load the current work.");
        return false;
      }
      setMessage(null);
      setCurrentness("pending");
      clearJ4Results();
      const next = await runtime.edit(witness, target, edit);
      installView(next);
      pendingDirtyRef.current = true;
      syncDirty();
      if (savedRevisionRef.current !== next.revision) markNotSaved();
      setCurrentness("current");
      setOutcome("idle");
      return true;
    } catch (error) {
      if (error instanceof PublishedProjectionRecoveryError) {
        failClosedAfterPublicationRecovery();
        // The publication is known successful; avoid SheetShell's rejected
        // draft path, which would offer an ordinary semantic retry.
        return true;
      } else if (error instanceof UnknownOperationOutcomeError) {
        failClosedAfterUnknownEdit(edit);
        return true;
      } else {
        if (error instanceof SheetSessionError && (error.code === "not-open" || error.code === "stale-witness")) {
          setOutcome("idle");
          setCurrentness("unknown");
          setMessage("This draft belongs to an unconfirmed work view. Refresh to re-read the work; the draft was kept.");
          return false;
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

  async function createCopy(name: string): Promise<boolean> {
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
      let snapshotRevision: string;
      let receipt;
      if (definitionBearing) {
        const snapshot = await runtime.exportOpaque(witnessOf(live));
        snapshotRevision = snapshot.revision;
        receipt = await copies.createOpaque(name, {
          ...snapshot,
          importedSource: importedSourceRef.current ?? undefined,
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
        savedRevisionRef.current = receipt.revision;
        pendingDirtyRef.current = false;
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
    if (!begin()) return false;
    let published = false;
    try {
      setMessage(null);
      setCurrentness("pending");
      clearJ4Results();
      const result = await runtime.createKeyedGroupedSum(witness, binding);
      published = true;
      const next = await runtime.read();
      installView(next);
      installJ4DefinitionIds([result.definitionId]);
      setJ4Results([result]);
      pendingDirtyRef.current = true;
      syncDirty();
      markNotSaved();
      setCurrentness("current");
      setOutcome("idle");
      return true;
    } catch (error) {
      if (published) {
        failClosedAfterPublicationRecovery();
        return true;
      }
      if (error instanceof PublishedProjectionRecoveryError) {
        failClosedAfterPublicationRecovery();
        return true;
      }
      if (error instanceof UnknownOperationOutcomeError) {
        failClosedAfterUnknownJ4();
        return true;
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
    if (!begin()) return false;
    try {
      setMessage(null);
      setCurrentness("pending");
      clearJ4Results();
      const result = await runtime.queryKeyedGroupedSum(witness, definitionId);
      setJ4Results([result]);
      setCurrentness("current");
      setOutcome("idle");
      return true;
    } catch (error) {
      setCurrentness("current");
      setOutcome("idle");
      setMessage(describe(error, "The cross-table summary could not be refreshed."));
      return false;
    } finally {
      end();
    }
  }

  async function close(): Promise<void> {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setBusy(true);
    try {
      await runtime.close();
    } catch (error) {
      setMessage(describe(error, "The work could not be released cleanly."));
      throw new Error(describe(error, "The work could not be closed."));
    } finally {
      viewRef.current = null;
      setView(null);
      installJ4DefinitionIds([]);
      clearJ4Results();
      recoveryDraftRef.current = recoveryDraftAfterBoundary(recoveryDraftRef.current, "close");
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      savedRevisionRef.current = null;
      setSaveStatus("not-saved");
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
      installView(next);
      await discoverJ4Results(next);
      syncDirty();
      if (savedRevisionRef.current !== next.revision) markNotSaved();
      setCurrentness("current");
      setOutcome("idle");
      if (recoveryDraftRef.current !== null) {
        setMessage(`An unconfirmed input was retained for review: ${recoveryDraftRef.current}`);
      }
    } catch (error) {
      viewRef.current = null;
      setView(null);
      if (error instanceof NoResidentWorkError) {
        // The authoritative reobserve proved that the uncertain occurrence is
        // gone. Discard its dirty/recovery context so normal Open routes can
        // safely establish a fresh occurrence without replaying anything.
        const recovered = noResidentRecoveryState();
        pendingDirtyRef.current = recovered.dirty;
        draftDirtyRef.current = false;
        syncDirty();
        recoveryDraftRef.current = recovered.recoveryDraft;
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

  return (
    <div
      className="ts-app-root"
      data-work-dirty={dirty ? "true" : "false"}
      data-work-currentness={view ? currentness : undefined}
    >
      <SheetShell
        view={view}
        busy={busy}
        dirty={dirty}
        currentness={currentness}
        outcome={outcome}
        saveStatus={saveStatus}
        message={message}
        copies={savedCopies}
        onOpenFiles={openFiles}
        onOpenExample={openExample}
        onOpenSaved={openSaved}
        onSelectCollection={selectCollection}
        onCommit={commit}
        onCreateCopy={createCopy}
        onClose={close}
        onRefresh={refresh}
        onDraftChange={onDraftChange}
        j4Results={j4Results}
        j4DefinitionIds={j4DefinitionIds}
        onPrepareJ4Bindings={prepareJ4Bindings}
        onCreateJ4={createJ4}
        onRefreshJ4={refreshJ4}
        onOpenJ4Canary={openJ4Canary}
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
      <footer className="ts-notices">
        <span>Tachiko Sheet · experimental core kit notices: </span>
        <a href="/core-kit/notices/THIRD_PARTY_LICENSES.md">third-party licenses</a>
        <span aria-hidden="true"> · </span>
        <a href="/core-kit/notices/LICENSE-MIT">MIT</a>
        <span aria-hidden="true"> · </span>
        <a href="/core-kit/notices/LICENSE-APACHE">Apache-2.0</a>
      </footer>
    </div>
  );
}
