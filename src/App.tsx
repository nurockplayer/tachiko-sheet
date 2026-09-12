import { useCallback, useEffect, useRef, useState } from "react";
import {
  UnknownOperationOutcomeError,
  type CanonicalProjectFile,
  type Currentness,
  type FieldTarget,
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
  PublishedProjectionRecoveryError,
  SheetSessionError,
} from "./runtime/session.js";
import { SheetShell } from "./ui/SheetShell.js";

/** Fixed same-origin transport inventory; bytes are opaque and never parsed. */
const EXAMPLE_BASE = "/examples/release-plan/";
const EXAMPLE_FILES: readonly string[] = [
  "manifest.json",
  "schemas.json",
  ...Array.from("0123456789abcdef", (shard) => `entities/${shard}.jsonl`),
];

export interface AppProps {
  runtime: SheetRuntime;
  copies: LocalCopies;
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (${error.message})`;
  return fallback;
}

async function loadExampleFiles(): Promise<CanonicalProjectFile[]> {
  return Promise.all(
    EXAMPLE_FILES.map(async (path) => {
      const response = await fetch(`${EXAMPLE_BASE}${path}`, { cache: "no-store" });
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

  const viewRef = useRef<WorkbookView | null>(null);
  const inflightRef = useRef(false);
  const pendingDirtyRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const dirtyRef = useRef(false);
  const savedRevisionRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);

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
    // Keep dirty as publication truth; the editor/projection itself is no
    // longer safe to present or retry until Refresh re-observes the resident work.
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    // Publication is known; only projection freshness remains unknown.
    setOutcome("idle");
    setMessage("The change was published, but the current work could not be confirmed. Refresh to re-read the work.");
  }

  function failClosedAfterUnknownEdit(): void {
    viewRef.current = null;
    setView(null);
    pendingDirtyRef.current = true;
    draftDirtyRef.current = false;
    syncDirty();
    markNotSaved();
    setCurrentness("unknown");
    setOutcome("unknown");
    setMessage("The change was dispatched but its outcome is unknown. Refresh to re-read the work.");
  }

  async function openFiles(files: FileList): Promise<void> {
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      const next = await runtime.openFiles(files);
      installView(next);
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      markNotSaved();
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
      const next = await runtime.openCanonical(await loadExampleFiles());
      installView(next);
      pendingDirtyRef.current = false;
      draftDirtyRef.current = false;
      syncDirty();
      markNotSaved();
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

  async function openSaved(name: string): Promise<void> {
    if (!begin()) return;
    try {
      guardReplacement();
      setMessage(null);
      setCurrentness("pending");
      const copy = await copies.read(name);
      if (!copy) throw new Error(`the saved copy “${name}” is no longer stored on this device`);
      const next = await runtime.openCanonical(copy.files);
      installView(next);
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
        failClosedAfterUnknownEdit();
        return true;
      } else {
        if (error instanceof SheetSessionError && (error.code === "not-open" || error.code === "stale-witness")) {
          failClosedAfterUnknownEdit();
          return true;
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
      const tree = await runtime.exportCanonical(witnessOf(live));
      const receipt = await copies.create(name, tree);
      void refreshCopies();
      const current = viewRef.current;
      const stillCurrent =
        current !== null &&
        current.occurrence === live.occurrence &&
        current.revision === tree.revision &&
        receipt.revision === tree.revision;
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
      const next = await runtime.read();
      installView(next);
      syncDirty();
      if (savedRevisionRef.current !== next.revision) markNotSaved();
      setCurrentness("current");
      setOutcome("idle");
    } catch (error) {
      viewRef.current = null;
      setView(null);
      setCurrentness("unknown");
      setOutcome("unknown");
      setMessage("The current work could not be confirmed. Its freshness stays unknown.");
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
        onCommit={commit}
        onCreateCopy={createCopy}
        onClose={close}
        onRefresh={refresh}
        onDraftChange={onDraftChange}
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
