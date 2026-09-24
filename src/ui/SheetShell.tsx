import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { appearanceDensity } from "../application/appearance-preference.js";
import { sameAppearanceChoice } from "../application/appearance-model.js";
import type {
  AppearanceDensity,
  AppearancePreferenceSnapshot,
  AppearanceProfileId,
} from "../application/appearance-preference.js";
import type {
  Currentness,
  ImportSelection,
  KeyedGroupedSumBindingCatalog,
  KeyedGroupedSumBindingChoice,
  KeyedGroupedSumResult,
  ReportConfiguration,
  ReportPresentationTextField,
  SheetShellProps,
  ViewWitness,
  WorkbookView,
} from "../contracts.js";
import type { InterfaceProfileV1 } from "../application/interface-profile-contract.js";
import { reportPresentationTextLimitViolation } from "../contracts.js";
import { BriefFacts } from "./BriefFacts.js";
import { AppearanceSelector } from "./AppearanceSelector.js";
import { fieldDisplay, parseBooleanDraft, scalarEditOf, seedTextOf } from "./field-display.js";
import {
  cellKey,
  fieldForColumn,
  notesFieldFor,
  rowEntity,
  tableColumns,
  type TableColumn,
  type TableRow,
} from "./projection-access.js";
import { ReportCanvas } from "./ReportCanvas.js";
import "./sheet-shell.css";

type EditableKind = "number" | "text" | "boolean" | "date";
type ActiveTab = "table" | "summary" | "report" | "brief" | "interop";

interface EditorState {
  entity: string;
  field: string;
  kind: EditableKind;
  value: string;
  original: string;
}

interface NotesDraft {
  occurrence: string;
  revision: string;
  entity: string;
  value: string;
}

interface GridPosition {
  entity: string;
  field: string;
}

interface ReportTextDraft {
  occurrence: string;
  definitionId: string;
  type: ReportConfiguration["type"];
  values: Partial<Record<ReportPresentationTextField, string>>;
}

/** Definitions without a visible result still need an explicit refresh path. */
export function missingKeyedGroupedSumDefinitionIds(
  definitionIds: readonly string[],
  results: readonly Pick<import("../contracts.js").KeyedGroupedSumResult, "definitionId">[],
): string[] {
  const resultIds = new Set(results.map((result) => result.definitionId));
  return definitionIds.filter((definitionId) => !resultIds.has(definitionId));
}

/** Directory selection is a host-level capability; the attribute is not in the React types. */
const directoryInputAttributes: Record<string, string> = { webkitdirectory: "", directory: "" };

/** Report pixels follow their source result, not the selected table. */
export function reportRenderResetKey(
  view: Pick<WorkbookView, "occurrence" | "revision"> | null,
  report: ReportConfiguration | null,
  results: readonly KeyedGroupedSumResult[],
  currentness: Currentness,
): string {
  if (!view || !report || currentness !== "current") return "unavailable";
  const source = results.find((candidate) => candidate.definitionId === report.definitionId);
  return JSON.stringify({
    occurrence: view.occurrence,
    revision: view.revision,
    report,
    source: source
      ? { revision: source.revision, groups: source.groups, diagnostics: source.diagnostics }
      : null,
  });
}

/** Publish queued appearance state only after the controller commits that same complete choice. */
export function shouldPublishAppearanceCompositionEnd(
  queued: AppearancePreferenceSnapshot["pendingSelection"],
  snapshot: AppearancePreferenceSnapshot,
): boolean {
  return queued !== null && snapshot.pendingSelection === null &&
    sameAppearanceChoice(snapshot.selection, queued);
}

/** Available grid viewport inside the active panel, before the panel itself must scroll. */
function availableGridScrollHeight(gridTop: number, panelBottom: number): number {
  return Math.max(0, Math.floor(panelBottom - gridTop));
}

export function SheetShell(props: SheetShellProps) {
  const {
    view,
    busy,
    dirty,
    currentness,
    outcome,
    saveStatus,
    message,
    copies,
    onOpenFiles,
    onOpenExample,
    onOpenSaved,
    onSelectCollection = async () => {},
    onCommit,
    onCreateCopy,
    onClose,
    onRefresh,
    interop = null,
    onInspectImport = async () => { throw new Error("Spreadsheet import is unavailable."); },
    onImportCandidate = async () => false,
    onCancelImport = () => undefined,
    onPreviewTrim = async () => null,
    onPreviewDeduplicate = async () => null,
    onCommitCleanup = async () => false,
    onCancelCleanup = () => undefined,
    onPrepareDownload = async () => false,
    onDownload = async () => false,
    j4Results = [],
    j4DefinitionIds = [],
    onPrepareJ4Bindings = async () => ({ collections: [] }),
    onCreateJ4 = async () => false,
    onRefreshJ4 = async () => false,
    onOpenJ4Canary = async () => { throw new Error("The Catalog/Sales canary is unavailable."); },
    report = null,
    onCreateReport = () => undefined,
    onUpdateReport = () => undefined,
    onExportReportPng = () => false,
    onRemoveReport = () => false,
  } = props;

  const [appearanceSnapshot, setAppearanceSnapshot] = useState(() =>
    props.appearancePreference.getSnapshot(),
  );
  const compositionEndTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (compositionEndTimer.current !== null) window.clearTimeout(compositionEndTimer.current);
  }, []);

  function selectAppearanceProfile(profileId: AppearanceProfileId): AppearancePreferenceSnapshot {
    const current = props.appearancePreference.getSnapshot();
    const choice = current.pendingSelection ?? current.selection;
    const snapshot = props.appearancePreference.selectBuiltIn(profileId, appearanceDensity(choice));
    if (!current.composing) setAppearanceSnapshot(snapshot);
    return snapshot;
  }

  function selectAppearanceDensity(density: AppearanceDensity): AppearancePreferenceSnapshot {
    const current = props.appearancePreference.getSnapshot();
    const snapshot = props.appearancePreference.selectDensity(density);
    if (!current.composing) setAppearanceSnapshot(snapshot);
    return snapshot;
  }

  function selectImportedAppearanceProfile(profile: InterfaceProfileV1): AppearancePreferenceSnapshot {
    const current = props.appearancePreference.getSnapshot();
    const snapshot = props.appearancePreference.selectImported(profile);
    if (!current.composing) setAppearanceSnapshot(snapshot);
    return snapshot;
  }

  function beginAppearanceComposition(): void {
    if (compositionEndTimer.current !== null) {
      window.clearTimeout(compositionEndTimer.current);
      compositionEndTimer.current = null;
    }
    props.appearancePreference.beginComposition();
  }

  function scheduleAppearanceCompositionEnd(): void {
    if (compositionEndTimer.current !== null) window.clearTimeout(compositionEndTimer.current);
    compositionEndTimer.current = window.setTimeout(() => {
      compositionEndTimer.current = null;
      const queued = props.appearancePreference.getSnapshot().pendingSelection;
      const snapshot = props.appearancePreference.endComposition();
      if (shouldPublishAppearanceCompositionEnd(queued, snapshot)) {
        setAppearanceSnapshot(snapshot);
      }
    }, 0);
  }

  function renderAppearanceSelector(): ReactNode {
    return (
      <AppearanceSelector
        preference={appearanceSnapshot}
        onSelectProfile={selectAppearanceProfile}
        onSelectDensity={selectAppearanceDensity}
        onSelectImported={selectImportedAppearanceProfile}
      />
    );
  }

  const [tab, setTab] = useState<ActiveTab>("table");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<NotesDraft[]>([]);
  const [commitPending, setCommitPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyParentFailureMessage, setCopyParentFailureMessage] = useState<string | null>(null);
  const [captureCopyParentFailure, setCaptureCopyParentFailure] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<"csv" | "xlsx" | null>(null);
  const [importTypes, setImportTypes] = useState<string[][]>([]);
  const [j4Catalog, setJ4Catalog] = useState<KeyedGroupedSumBindingCatalog | null>(null);
  const [j4Binding, setJ4Binding] = useState<KeyedGroupedSumBindingChoice | null>(null);
  const [j4Pending, setJ4Pending] = useState(false);
  const [reportRenderReady, setReportRenderReady] = useState(false);
  const [reportRenderReadyKey, setReportRenderReadyKey] = useState("unavailable");
  const [reportTextDraft, setReportTextDraft] = useState<ReportTextDraft | null>(null);

  const fileInputId = useId();
  const spreadsheetInputId = useId();
  const copyNameId = useId();
  const copyErrorId = useId();
  const lockNoteId = useId();
  const notesId = useId();
  const tabId = (name: ActiveTab) => `ts-tab-${name}`;
  const panelId = (name: ActiveTab) => `ts-panel-${name}`;

  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const spreadsheetInputRef = useRef<HTMLInputElement | null>(null);
  const lastNotesOccurrenceRef = useRef<string | null>(null);
  const lastCellRef = useRef<HTMLTableCellElement | null>(null);
  const saveCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyNameInputRef = useRef<HTMLInputElement | null>(null);
  const copyParentMessageAtAttemptRef = useRef<string | null>(message);
  const downloadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDraftChangeRef = useRef(props.onDraftChange);
  const onReportDraftChangeRef = useRef(props.onReportDraftChange);
  const viewKey = view ? `${view.occurrence}\u0000${view.revision}` : null;
  const collectionIdentity = view ? `${view.occurrence}\u0000${view.table.collection.key}` : null;
  const lastCollectionIdentityRef = useRef(collectionIdentity);
  const reportRenderKey = reportRenderResetKey(view, report, j4Results, currentness);
  // A Refresh recovery can temporarily remove the projection without proving
  // that its resident work was replaced. Keep the local-only draft attached
  // to its report until a non-null different occurrence, removal, or Close.
  const reportDraftRetained = Boolean(
    reportTextDraft && report &&
    reportTextDraft.definitionId === report.definitionId &&
    reportTextDraft.type === report.type &&
    (!view || reportTextDraft.occurrence === view.occurrence),
  );
  const activeReportTextDraft = reportDraftRetained && view ? reportTextDraft : null;
  const hasInvalidReportDraft = Boolean(reportDraftRetained && reportTextDraft && Object.keys(reportTextDraft.values).length > 0);
  const reportCanvasReady = reportRenderReady && reportRenderReadyKey === reportRenderKey;
  const onReportRenderState = useCallback((ready: boolean) => {
    setReportRenderReady(ready);
    setReportRenderReadyKey(ready ? reportRenderKey : "unavailable");
  }, [reportRenderKey]);

  useEffect(() => {
    onDraftChangeRef.current = props.onDraftChange;
  }, [props.onDraftChange]);

  useEffect(() => {
    onReportDraftChangeRef.current = props.onReportDraftChange;
  }, [props.onReportDraftChange]);

  useEffect(() => {
    setEditor(null);
    const occurrence = view?.occurrence ?? null;
    if (occurrence !== null && lastNotesOccurrenceRef.current !== null && lastNotesOccurrenceRef.current !== occurrence) {
      setNotesDrafts([]);
    }
    if (occurrence !== null) lastNotesOccurrenceRef.current = occurrence;
    setCommitPending(false);
    setLocalError(null);
    setJ4Catalog(null);
    setJ4Binding(null);
    setJ4Pending(false);
    if (!viewKey) {
      setCopyOpen(false);
      setCloseOpen(false);
      setTab("table");
    }
  }, [viewKey]);

  useEffect(() => {
    setReportTextDraft((current) => {
      if (!current || !report) return null;
      if (current.definitionId !== report.definitionId || current.type !== report.type) return null;
      return !view || current.occurrence === view.occurrence ? current : null;
    });
  }, [view?.occurrence, report?.definitionId, report?.type]);

  // The callback only requests a collection; the installed projection is the
  // authority for a real switch. Reset roving focus before the new grid paints
  // so an old table key cannot leave this grid with no tab stop.
  useLayoutEffect(() => {
    if (lastCollectionIdentityRef.current !== collectionIdentity) {
      setFocusedKey(null);
      lastCellRef.current = null;
    }
    lastCollectionIdentityRef.current = collectionIdentity;
  }, [collectionIdentity]);

  useEffect(() => {
    if (!view) {
      setSelectedEntity(null);
      return;
    }
    const entities = view.table.rows.map(rowEntity);
    setSelectedEntity((previous) => (previous && entities.includes(previous) ? previous : entities[0] ?? null));
  }, [view]);

  useEffect(() => {
    const inspection = interop?.importInspection;
    setImportTypes(inspection ? inspection.source.sheets.map((sheet) => sheet.columns.map(() => "text")) : []);
  }, [interop?.importInspection]);

  const table = view?.table ?? null;
  const columns = useMemo(() => (table ? tableColumns(table) : []), [table]);
  const gridOrder = useMemo(() => {
    if (!table) return [] as GridPosition[];
    const tableCols = tableColumns(table);
    return table.rows.flatMap((row) => {
      const entity = rowEntity(row);
      return tableCols.map((column) => ({
        entity,
        field: column.id,
      }));
    });
  }, [table]);
  const selectedRow = useMemo(() => {
    if (!table) return null;
    const rows = table.rows;
    return rows.find((row) => rowEntity(row) === selectedEntity) ?? rows[0] ?? null;
  }, [table, selectedEntity]);
  const notesField = useMemo(() => {
    if (!selectedRow) return null;
    return notesFieldFor(selectedRow, columns);
  }, [selectedRow, columns]);

  const notesCommitted = notesField ? seedTextOf(notesField) : "";
  const activeNotesDraft = notesDrafts.find(
    (draft) =>
      view &&
      selectedRow &&
      draft.occurrence === view.occurrence &&
      draft.entity === rowEntity(selectedRow),
  );
  const notesDraftBound = Boolean(
    activeNotesDraft && view && activeNotesDraft.revision === view.revision,
  );
  const notesValue = activeNotesDraft?.value ?? notesCommitted;
  const notesDirty = activeNotesDraft !== undefined && activeNotesDraft.value !== notesCommitted;
  const anyNotesDraft = notesDrafts.length > 0;
  const notesEditable = Boolean(notesField && notesField.editable_scalar === "text");

  useEffect(() => {
    if (captureCopyParentFailure) {
      if (message === null) {
        copyParentMessageAtAttemptRef.current = null;
      } else if (message !== copyParentMessageAtAttemptRef.current) {
        setCopyParentFailureMessage(message);
        setCaptureCopyParentFailure(false);
      }
      return;
    }
    if (copyParentFailureMessage !== null && message !== copyParentFailureMessage) {
      setCopyParentFailureMessage(null);
    }
  }, [captureCopyParentFailure, copyParentFailureMessage, message]);

  const controlsLocked = busy || commitPending || currentness === "unknown";
  const cellDraftActive = editor !== null && editor.value !== editor.original;
  const draftActive =
    cellDraftActive || anyNotesDraft || (copyOpen && copyName.trim() !== "");
  const errorMessage = localError ?? copyError ?? (message && message.length > 0 ? message : null);
  const importErrorMessage = interop?.importInspection
    ? (importError && message && message.length > 0 ? message : importError)
    : importError;
  const copyErrorIsInline = copyOpen && localError === null && (
    copyError !== null || (copyParentFailureMessage !== null && message === copyParentFailureMessage)
  );
  const importErrorIsInline = Boolean(
    importError && (!view || (message && errorMessage === message && importErrorMessage === message)),
  );
  const downloadErrorIsInline = Boolean(
    tab === "interop" && interop?.downloadStatus === "failed" &&
      interop.downloadError !== null && errorMessage === message && message === interop.downloadError,
  );

  useLayoutEffect(() => {
    const grid = gridScrollRef.current;
    const appRoot = grid?.closest<HTMLElement>(".ts-app");
    const panel = grid?.closest<HTMLElement>(".ts-panel");
    if (!grid || !appRoot || !panel || !view || tab !== "table") return;

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const gridTop = grid.getBoundingClientRect().top;
      grid.style.setProperty(
        "--ts-grid-available-height",
        `${availableGridScrollHeight(gridTop, panel.getBoundingClientRect().bottom)}px`,
      );
    };
    const scheduleMeasure = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    if (resizeObserver) {
      resizeObserver.observe(panel);
      appRoot.querySelectorAll<HTMLElement>(
        ".ts-workbook-head, .ts-work-context, .ts-workspace-footer, .ts-hint, .ts-notice, .ts-error",
      ).forEach((element) => resizeObserver.observe(element));
    }
    const profileObserver = new MutationObserver(scheduleMeasure);
    profileObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-ts-profile-color-scheme",
        "data-ts-profile-typography",
        "data-ts-profile-density",
        "data-ts-profile-chrome",
      ],
    });
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleMeasure);
    visualViewport?.addEventListener("resize", scheduleMeasure);

    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      visualViewport?.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      profileObserver.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      grid.style.removeProperty("--ts-grid-available-height");
    };
  }, [view, tab, currentness, errorMessage, busy, commitPending]);

  useEffect(() => {
    onDraftChangeRef.current(draftActive);
  }, [draftActive]);

  useEffect(() => {
    onReportDraftChangeRef.current(hasInvalidReportDraft);
  }, [hasInvalidReportDraft]);

  useEffect(
    () => () => {
      onDraftChangeRef.current(false);
      onReportDraftChangeRef.current(false);
    },
    [],
  );

  const witness: ViewWitness | null = useMemo(
    () => (view ? { occurrence: view.occurrence, revision: view.revision } : null),
    [view?.occurrence, view?.revision],
  );

  const runCommit = useCallback(
    async (target: FieldProjection["target"], edit: Parameters<SheetShellProps["onCommit"]>[2]): Promise<boolean> => {
      if (!witness) return false;
      setCommitPending(true);
      try {
        const accepted = await onCommit(witness, target, edit);
        if (!accepted) {
          setLocalError("The work did not accept this value. The draft was kept so you can correct it.");
        }
        return accepted;
      } catch (error) {
        setLocalError(explain(error, "The work could not apply this change. The draft was kept."));
        return false;
      } finally {
        setCommitPending(false);
      }
    },
    [onCommit, witness],
  );

  function beginEdit(entity: string, field: FieldProjection | null, seed?: string): void {
    if (!field || !field.editable_scalar || controlsLocked) return;
    if (editor && editor.value !== editor.original && (editor.entity !== entity || editor.field !== field.target.field)) {
      setLocalError("Apply or cancel the value you are editing before you edit another cell.");
      focusCell(editor.entity, editor.field);
      return;
    }
    const original = seedTextOf(field);
    setLocalError(null);
    setSelectedEntity(entity);
    setEditor({
      entity,
      field: field.target.field,
      kind: field.editable_scalar,
      value: seed === undefined ? original : seed,
      original,
    });
  }

  function cancelEdit(): void {
    const cancelled = editor;
    setEditor(null);
    setLocalError(null);
    if (cancelled) focusCell(cancelled.entity, cancelled.field);
  }

  function focusCell(entity: string, field: string): void {
    const node = cellRefs.current.get(cellKey(entity, field));
    node?.focus();
  }

  function moveFocus(event: ReactKeyboardEvent<HTMLElement>, position: GridPosition, step: number): void {
    const index = gridOrder.findIndex((item) => item.entity === position.entity && item.field === position.field);
    if (index < 0) return;
    const next = index + step;
    if (next < 0 || next >= gridOrder.length) return;
    const target = gridOrder[next];
    if (!target) return;
    event.preventDefault();
    setSelectedEntity(target.entity);
    focusCell(target.entity, target.field);
  }

  function submitEditor(): void {
    void commitEditor();
  }

  async function commitEditor(): Promise<boolean> {
    if (!editor || commitPending || controlsLocked) return false;
    const field = currentEditorField(editor);
    if (!field) {
      setEditor(null);
      return false;
    }
    let edit: Parameters<SheetShellProps["onCommit"]>[2];
    if (editor.kind === "boolean") {
      const parsed = parseBooleanDraft(editor.value);
      if (parsed === null) {
        setLocalError("Enter true or false for this boolean cell. The draft was kept.");
        return false;
      }
      edit = { kind: "boolean", value: parsed };
    } else {
      edit = scalarEditOf(editor.kind, editor.value);
    }
    const accepted = await runCommit(field.target, edit);
    if (accepted) {
      setEditor(null);
      setLocalError(null);
      focusCell(editor.entity, editor.field);
    }
    return accepted;
  }

  function onCellKeyDown(
    event: ReactKeyboardEvent<HTMLTableCellElement>,
    entity: string,
    field: FieldProjection | null,
    position: GridPosition,
  ): void {
    if (isComposingEvent(event)) return;
    const editable = Boolean(field?.editable_scalar) && !controlsLocked;
    if (event.key === "Enter" || event.key === "F2") {
      if (!editable) return;
      event.preventDefault();
      beginEdit(entity, field);
      return;
    }
    if (event.key === "Tab") {
      moveFocus(event, position, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      moveFocus(event, position, event.key === "ArrowUp" ? -columns.length : columns.length);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      moveFocus(event, position, event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (
      editable &&
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      beginEdit(entity, field, event.key);
    }
  }

  function onEditorKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (isComposingEvent(event)) return;
    if (event.key === "Enter") {
      event.stopPropagation();
      event.preventDefault();
      submitEditor();
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === "Tab" && editor) {
      event.stopPropagation();
      event.preventDefault();
      const position = { entity: editor.entity, field: editor.field };
      const step = event.shiftKey ? -1 : 1;
      void commitEditor().then((accepted) => {
        if (accepted) moveFocus(event, position, step);
      });
    }
  }

  async function applyNotes(): Promise<void> {
    if (!notesField || !notesEditable || !notesDirty || !notesDraftBound || controlsLocked) return;
    const accepted = await runCommit(notesField.target, { kind: "text", value: notesValue });
    if (accepted) {
      setNotesDrafts((drafts) => drafts.filter((draft) => draft !== activeNotesDraft));
      setLocalError(null);
    }
  }

  function onNotesKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (isComposingEvent(event)) return;
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      void applyNotes();
    }
  }

  async function openSaved(name: string): Promise<void> {
    setLocalError(null);
    try {
      await onOpenSaved(name);
    } catch (error) {
      setLocalError(explain(error, `Could not open the saved copy “${name}”.`));
    }
  }

  async function selectCollection(next: string): Promise<void> {
    if (!witness || next === view?.table.collection.key) return;
    if (cellDraftActive) {
      setLocalError("Apply or cancel the value you are editing before switching tables.");
      if (editor) focusCell(editor.entity, editor.field);
      return;
    }
    if (editor && editor.value === editor.original) setEditor(null);
    setLocalError(null);
    try {
      await onSelectCollection(witness, next);
    } catch (error) {
      setLocalError(explain(error, "Could not switch to that table."));
    }
  }

  async function openExample(): Promise<void> {
    setLocalError(null);
    try {
      await onOpenExample();
    } catch (error) {
      setLocalError(explain(error, "Could not open the example work."));
    }
  }

  async function openJ4Canary(): Promise<void> {
    setLocalError(null);
    try {
      await onOpenJ4Canary();
    } catch (error) {
      setLocalError(explain(error, "Could not open the Catalog/Sales canary."));
    }
  }

  async function openFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setLocalError(null);
    try {
      await onOpenFiles(files);
    } catch (error) {
      setLocalError(explain(error, "The selected folder could not be opened."));
    }
  }

  async function inspectSpreadsheet(file: File | null): Promise<void> {
    if (!file) return;
    setLocalError(null);
    setImportError(null);
    try { await onInspectImport(file); }
    catch (error) { setImportError(explain(error, "The spreadsheet could not be inspected.")); }
  }

  async function importCandidate(): Promise<void> {
    const inspection = interop?.importInspection;
    if (!inspection || importPending) return;
    setImportError(null);
    setImportPending(true);
    const selection: ImportSelection = {
      column_types: importTypes as ImportSelection["column_types"],
      extra_columns: inspection.source.sheets.map(() => []),
    };
    try {
      const accepted = await onImportCandidate(selection);
      if (!accepted) setImportError("The import was not applied. Your source selection is still available.");
    } catch (error) {
      setImportError(explain(error, "The import was not applied. Your source selection is still available."));
    } finally {
      setImportPending(false);
    }
  }

  function cancelImport(): void {
    if (importPending) return;
    setImportError(null);
    onCancelImport();
    // Wait for React to remove the dialog; focusing before that commit would
    // lose focus with the unmounted modal control.
    window.setTimeout(() => spreadsheetInputRef.current?.focus(), 0);
  }

  async function prepareDownload(format: "csv" | "xlsx", trigger: HTMLButtonElement): Promise<void> {
    downloadTriggerRef.current = trigger;
    setLocalError(null);
    if (await onPrepareDownload(format)) setDownloadFormat(format);
  }

  function cancelDownload(): void {
    setDownloadFormat(null);
    window.requestAnimationFrame(() => downloadTriggerRef.current?.focus());
  }

  async function refresh(): Promise<void> {
    setLocalError(null);
    try {
      await onRefresh();
    } catch (error) {
      setLocalError(explain(error, "The work could not be refreshed."));
    }
  }

  function openCopyDialog(): void {
    setCopyError(null);
    setLocalError(null);
    setCopyName("");
    setCaptureCopyParentFailure(false);
    setCopyOpen(true);
  }

  function closeCopyDialog(): void {
    if (copyPending) return;
    setCopyOpen(false);
    setCopyError(null);
    setCopyName("");
    setCaptureCopyParentFailure(false);
    saveCopyButtonRef.current?.focus();
  }

  async function createCopy(): Promise<void> {
    const name = copyName.trim();
    if (name === "" || copyPending) return;
    if (hasInvalidReportDraft) {
      setCopyError("Correct the invalid report presentation text before creating a copy.");
      return;
    }
    copyNameInputRef.current?.focus();
    setCopyError(null);
    copyParentMessageAtAttemptRef.current = message;
    setCaptureCopyParentFailure(true);
    setCopyPending(true);
    setLocalError(null);
    try {
      const created = await onCreateCopy(name);
      if (created) {
        setCaptureCopyParentFailure(false);
        setCopyParentFailureMessage(null);
        setCopyOpen(false);
        setCopyError(null);
        setCopyName("");
        saveCopyButtonRef.current?.focus();
      } else {
        setCopyError(`The copy “${name}” was not created. The name is still here; adjust it and try again.`);
      }
    } catch (error) {
      setCopyError(explain(error, `The copy “${name}” was not created. The name is still here.`));
    } finally {
      setCopyPending(false);
    }
  }

  async function requestClose(): Promise<void> {
    if (busy || commitPending) return;
    if (dirty || draftActive || hasInvalidReportDraft || currentness === "unknown") {
      setCloseOpen(true);
      return;
    }
    await closeWork();
  }

  async function closeWork(): Promise<void> {
    setCloseOpen(false);
    setLocalError(null);
    try {
      await onClose();
    } catch (error) {
      setLocalError(explain(error, "The work could not be closed."));
    }
  }

  function keepEditing(): void {
    setCloseOpen(false);
    requestAnimationFrame(() => {
      const prior = lastCellRef.current;
      if (prior?.isConnected && prior.closest('table[aria-label="Table"]')) {
        prior.focus();
        return;
      }
      const first = gridOrder[0];
      if (first) {
        const cell = cellRefs.current.get(cellKey(first.entity, first.field));
        if (cell?.isConnected) {
          cell.focus();
          return;
        }
      }
      document.getElementById(tabId(tab))?.focus();
    });
  }

  function currentEditorField(state: EditorState): FieldProjection | null {
    if (!table) return null;
    const row = table.rows.find((candidate) => rowEntity(candidate) === state.entity);
    if (!row) return null;
    return fieldForColumn(row, state.field);
  }

  function renderHome(): ReactNode {
    const recoveryLocked = currentness === "unknown";
    return (
      <main className="ts-home">
        {currentness === "unknown" ? (
          <section className="ts-card" aria-label="Recovery">
            <h2 className="ts-h2">Refresh required</h2>
            <p className="ts-subtle">The open work could not be confirmed. Refresh to read it again.</p>
            <div className="ts-status-strip" aria-label="Recovery status">
              <span className="ts-chip" data-testid="currentness" data-currentness={currentness}>
                {currentnessLabel(currentness)}
              </span>
              {outcome !== "idle" ? (
                <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
                  {outcomeLabel(outcome)}
                </span>
              ) : null}
            </div>
            <button type="button" className="ts-button" onClick={() => void refresh()} disabled={busy || commitPending}>
              Refresh
            </button>
            <button type="button" className="ts-button ts-button--ghost" onClick={() => void requestClose()} disabled={busy || commitPending}>
              Close and abandon recovery
            </button>
          </section>
        ) : null}
        <header className="ts-home-head">
          <div className="ts-home-heading">
            <h1 className="ts-brand">Tachiko Sheet</h1>
            <p className="ts-subtle">Open a project folder, or reopen a copy saved in this browser profile.</p>
          </div>
          {renderAppearanceSelector()}
        </header>
        <section className="ts-card" aria-label="Open project">
          <h2 className="ts-h2">Open</h2>
          <label className="ts-field-label" htmlFor={fileInputId}>
            Open project folder
          </label>
          <input
            id={fileInputId}
            className="ts-file-input"
            data-testid="open-project"
            type="file"
            multiple
            disabled={controlsLocked || recoveryLocked}
            aria-describedby={busy ? lockNoteId : undefined}
            onChange={(event) => {
              const input = event.currentTarget;
              const files = input.files;
              void openFiles(files).finally(() => {
                input.value = "";
              });
            }}
            {...directoryInputAttributes}
          />
          <div className="ts-row-actions">
              <button
              type="button"
              className="ts-button"
              onClick={() => void openExample()}
                disabled={controlsLocked || recoveryLocked}
              aria-describedby={busy ? lockNoteId : undefined}
            >
              Try example
            </button>
            <button
              type="button"
              className="ts-button"
              onClick={() => void openJ4Canary()}
              disabled={controlsLocked || recoveryLocked}
              aria-describedby={busy ? lockNoteId : undefined}
            >
              Try Catalog/Sales canary
            </button>
            {busy ? (
              <span className="ts-status" role="status">
                Opening…
              </span>
            ) : null}
          </div>
          {busy ? (
            <p className="ts-hint" id={lockNoteId} role="note">
              An operation is in progress; controls are disabled until it finishes.
            </p>
          ) : null}
        </section>
        <section className="ts-card" aria-label="Import spreadsheet">
          <h2 className="ts-h2">Import CSV or XLSX</h2>
          <p className="ts-subtle">Sheet asks the core kit to inspect the source before creating an import candidate.</p>
          <label className="ts-field-label" htmlFor={spreadsheetInputId}>Choose CSV or XLSX</label>
          <input ref={spreadsheetInputRef} id={spreadsheetInputId} className="ts-file-input" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={controlsLocked || recoveryLocked} onChange={(event) => { const input = event.currentTarget; void inspectSpreadsheet(input.files?.[0] ?? null).finally(() => { input.value = ""; }); }} />
          {importError && !interop?.importInspection ? <p className="ts-dialog-error" role="alert">{importError}</p> : null}
        </section>
        <section className="ts-card" aria-label="Saved copies">
          <h2 className="ts-h2">Saved copies</h2>
          <p className="ts-subtle">Stored in this browser profile on this device.</p>
          {copies.length === 0 ? (
            <p className="ts-empty">No saved copies yet.</p>
          ) : (
            <ul className="ts-copy-list">
              {copies.map((copy) => (
                <li key={copy.name} className="ts-copy-item">
                  <button
                    type="button"
                    className="ts-button ts-button--ghost"
                    onClick={() => void openSaved(copy.name)}
                    disabled={controlsLocked || recoveryLocked}
                    aria-describedby={busy ? lockNoteId : undefined}
                  >
                    {`Open saved ${copy.name}`}
                  </button>
                  <span className="ts-copy-meta">{copy.savedAt}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

  function renderToolbar(): ReactNode {
    return (
      <header className="ts-workbook-head">
        <div className="ts-document-identity">
          <img className="ts-document-mark" src="/tachiko-sheet-mark.svg" alt="" aria-hidden="true" />
          <div className="ts-title-block">
            <span className="ts-wordmark">Tachiko Sheet</span>
            <h1 className="ts-title">{view ? view.title : ""}</h1>
          </div>
        </div>
        {renderAppearanceSelector()}
        <div className="ts-header-commands">
          {renderWorkbookActions()}
        </div>
      </header>
    );
  }

  function renderWorkbookActions(): ReactNode {
    const closeButton = (className = "ts-button") => (
      <button
        type="button"
        className={className}
        onClick={() => void requestClose()}
        disabled={busy}
        aria-describedby={busy ? lockNoteId : undefined}
      >
        Close project
      </button>
    );
    return (
      <div className="ts-actions ts-header-actions" role="group" aria-label="Document commands">
        <button
          type="button"
          className="ts-button"
          onClick={() => void refresh()}
          disabled={busy || commitPending}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Refresh
        </button>
        <div className={`ts-save-status ts-save-status--${saveStatus}`} role="status">
          <span className={`ts-save-indicator ts-chip--${saveStatus}`} data-testid="save-status">
            {saveLabel(saveStatus)}
          </span>
          <span className="ts-save-scope">Copies: this browser on this device</span>
        </div>
        <button
          type="button"
          className="ts-button ts-button--primary"
          ref={saveCopyButtonRef}
          onClick={openCopyDialog}
          disabled={controlsLocked || saveStatus === "saving"}
          aria-describedby={controlsLocked ? lockNoteId : undefined}
        >
          Save a copy
        </button>
        {closeButton("ts-button ts-close-project-desktop")}
        <details className="ts-command-overflow">
          <summary aria-label="More document commands">…</summary>
          {closeButton("ts-button ts-button--ghost")}
        </details>
      </div>
    );
  }

  function renderStatusStrip(): ReactNode {
    return (
        <div className="ts-status-strip">
          <span className="ts-status-pair">
            <span className="ts-status-label">Work:</span>
            <span
              className={`ts-chip ${dirty ? "ts-chip--edited" : "ts-chip--unchanged"}`}
              data-testid="work-state"
              data-work-state={dirty ? "edited" : "unchanged"}
            >
              {workStateLabel(dirty)}
            </span>
          </span>
          <span className="ts-status-pair">
            <span className="ts-status-label">Values:</span>
            <span className={`ts-chip ts-chip--${currentness}`} data-testid="currentness" data-currentness={currentness}>
            {currentnessLabel(currentness)}
            </span>
          </span>
          {outcome !== "idle" ? (
            <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
              {outcomeLabel(outcome)}
            </span>
          ) : null}
          <span className="ts-workbook-row-count">
            {table ? `${table.rows.length} rows · ${columns.length} columns` : ""}
          </span>
        </div>
    );
  }

  function renderTablePanel(): ReactNode {
    if (!table) return null;
    return (
      <div role="tabpanel" id={panelId("table")} aria-labelledby={tabId("table")} className="ts-panel">
        {currentness === "current" ? null : <p className="ts-notice">{freshnessNotice(currentness)}</p>}
        <div className="ts-grid-scroll" ref={gridScrollRef}>
          <table className="ts-grid" role="grid" aria-label="Table" aria-busy={busy}>
            <thead>
              <tr>
                <th scope="col" className="ts-gutter-head">
                  Row
                </th>
                {columns.map((column) => (
                  <th key={column.id} scope="col" className="ts-col-head">
                    {column.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const entity = rowEntity(row);
                const isSelectedRow = entity === selectedEntity;
                return (
                  <tr key={row.id || entity} className={isSelectedRow ? "ts-row ts-row--selected" : "ts-row"}>
                    <th scope="row" className="ts-row-head">
                      {table.rows.indexOf(row) + 1}
                    </th>
                    {columns.map((column) => renderCell(row, entity, column))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderCell(row: TableRow, entity: string, column: TableColumn): ReactNode {
    if (!view) return null;
    const field = fieldForColumn(row, column.id);
    const display = fieldDisplay(field);
    const key = cellKey(entity, column.id);
    const editing = editor !== null && editor.entity === entity && editor.field === column.id;
    const editable = Boolean(field?.editable_scalar) && !controlsLocked;
    const classes = ["ts-cell", `ts-cell--${display.tone}`];
    if (editing) classes.push("ts-cell--editing");
    if (focusedKey === key) classes.push("ts-cell--focused");
    return (
      <td
        key={column.id}
        ref={(node) => {
          if (node) cellRefs.current.set(key, node);
          else cellRefs.current.delete(key);
        }}
        className={classes.join(" ")}
        data-testid={`cell:${entity}:${column.id}`}
        data-work-occurrence={view.occurrence}
        data-work-revision={view.revision}
        data-work-entity={entity}
        data-work-currentness={currentness}
        tabIndex={focusedKey === key || (!focusedKey && isFirstCell(entity, column)) ? 0 : -1}
        aria-selected={entity === selectedEntity}
        aria-readonly={!editable}
        title={display.title ?? undefined}
        onClick={() => setSelectedEntity(entity)}
        onDoubleClick={() => beginEdit(entity, field)}
        onFocus={() => {
          setSelectedEntity(entity);
          setFocusedKey(key);
          lastCellRef.current = cellRefs.current.get(key) ?? null;
        }}
        onKeyDown={(event) => onCellKeyDown(event, entity, field, { entity, field: column.id })}
      >
        {editing && editor ? (
          <input
            className="ts-cell-input"
            aria-label="Edit cell"
            aria-busy={commitPending}
            data-testid="cell-editor"
            disabled={controlsLocked}
            value={editor.value}
            ref={focusEditorInput}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setLocalError(null);
              setEditor((previous) => (previous ? { ...previous, value } : previous));
            }}
            onKeyDown={onEditorKeyDown}
          />
        ) : (
          <span className="ts-cell-value">{display.text}</span>
        )}
      </td>
    );
  }

  function isFirstCell(entity: string, column: TableColumn): boolean {
    if (!table) return false;
    const firstRow = table.rows[0];
    if (!firstRow) return false;
    return rowEntity(firstRow) === entity && columns[0]?.id === column.id;
  }

  function renderBriefPanel(): ReactNode {
    if (!view || !selectedRow) return null;
    const entity = rowEntity(selectedRow);
    const tableCols = tableColumns(view.table);
    return (
      <div role="tabpanel" id={panelId("brief")} aria-labelledby={tabId("brief")} className="ts-panel ts-brief">
        {currentness === "current" ? null : <p className="ts-notice">{freshnessNotice(currentness)}</p>}
        <section className="ts-card" aria-label="Linked Brief facts">
          <h2 className="ts-h2">Brief</h2>
          <BriefFacts
            entity={entity}
            occurrence={view.occurrence}
            revision={view.revision}
            currentness={currentness}
            row={selectedRow}
            columns={tableCols}
          />
        </section>
        <section className="ts-card" aria-label="Decision notes">
          <h2 className="ts-h2">Decision notes</h2>
          <p className="ts-subtle">
            Notes on the selected record. They are saved with the work, not with a copy.
          </p>
          <label className="ts-field-label" htmlFor={notesId}>
            Decision notes
          </label>
          <textarea
            id={notesId}
            className="ts-notes"
            data-testid="notes-input"
            rows={5}
            value={notesValue}
            disabled={!notesEditable}
            aria-describedby={notesEditable ? undefined : `${notesId}-hint`}
            onChange={(event) => {
              setLocalError(null);
              if (view && selectedRow) {
                const draft = {
                  occurrence: view.occurrence,
                  revision: view.revision,
                  entity: rowEntity(selectedRow),
                  value: event.currentTarget.value,
                };
                setNotesDrafts((drafts) => {
                  const remaining = drafts.filter(
                    (candidate) =>
                      candidate.occurrence !== draft.occurrence || candidate.entity !== draft.entity,
                  );
                  return draft.value === notesCommitted ? remaining : [...remaining, draft];
                });
              }
            }}
            onKeyDown={onNotesKeyDown}
          />
          {notesEditable ? null : (
            <p className="ts-hint" id={`${notesId}-hint`}>
              {notesField
                ? "This notes field is not editable in the current work."
                : "This work has no notes column to write to."}
            </p>
          )}
          <div className="ts-row-actions">
            <button
              type="button"
              className="ts-button ts-button--primary"
              onClick={() => void applyNotes()}
              disabled={!notesEditable || controlsLocked || !notesDirty || !notesDraftBound}
              title={notesDirty ? undefined : "Change the notes before applying."}
            >
              Apply notes
            </button>
            <span className="ts-hint">{notesDirty ? "Unapplied notes draft" : "No unapplied notes"}</span>
          </div>
        </section>
      </div>
    );
  }

  function renderInteropPanel(): ReactNode {
    if (!view || !table) return null;
    const allFields = table.rows.flatMap((row) => row.fields.filter((field) => field.editable_scalar === "text").map((field) => field.target));
    const entities = table.rows.map(rowEntity);
    const keyFields = columns.map((column) => column.id);
    const preview = interop?.cleanupPreview ?? null;
    return <div role="tabpanel" id={panelId("interop")} aria-labelledby={tabId("interop")} className="ts-panel ts-brief">
      <section className="ts-card" aria-label="Source fidelity ledger">
        <h2 className="ts-h2">Source fidelity ledger</h2>
        {interop?.ledger.length ? <ul className="ts-ledger">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{finding.category}</strong>: {finding.message}</li>)}</ul> : <p className="ts-empty">No imported-source ledger is available for this work.</p>}
      </section>
      <section className="ts-card" aria-label="Cleanup preview">
        <h2 className="ts-h2">Cleanup</h2>
        <p className="ts-subtle">Previews are produced by the core kit. Nothing changes until you commit this exact preview.</p>
        <div className="ts-row-actions">
          <button type="button" className="ts-button" disabled={controlsLocked || allFields.length === 0} onClick={() => witness && void onPreviewTrim(witness, allFields)}>Preview trim</button>
          <button type="button" className="ts-button" disabled={controlsLocked || entities.length < 2 || keyFields.length === 0} onClick={() => witness && void onPreviewDeduplicate(witness, entities, keyFields)}>Preview whole-row deduplication</button>
        </div>
        {preview ? <div className="ts-preview" data-testid="cleanup-preview"><p>{preview.changes.length} cell changes and {preview.removed_entities.length} rows would change.</p>{preview.changes.length ? <ul aria-label="Cleanup targets">{preview.changes.map((change, index) => { const row = table.rows.findIndex((candidate) => rowEntity(candidate) === change.target.entity); const column = columns.find((candidate) => candidate.id === change.target.field); return <li key={`${change.target.entity}-${change.target.field}-${index}`}>{`Row ${row + 1}, ${column?.key ?? change.target.field}`}</li>; })}</ul> : null}<div className="ts-row-actions"><button type="button" className="ts-button" onClick={onCancelCleanup}>Cancel preview</button><button type="button" className="ts-button ts-button--primary" disabled={controlsLocked || !witness} onClick={() => witness && void onCommitCleanup(witness, preview.preview_id)}>Commit preview</button></div></div> : null}
      </section>
      <section className="ts-card" aria-label="Download spreadsheet">
        <h2 className="ts-h2">Download</h2>
        <p className="ts-subtle">Exports use the imported source metadata and the current core revision. Review the ledger before downloading.</p>
        <div className="ts-row-actions"><button type="button" className="ts-button" disabled={controlsLocked || !interop?.metadata} onClick={(event) => void prepareDownload("csv", event.currentTarget)}>Prepare CSV</button><button type="button" className="ts-button" disabled={controlsLocked || !interop?.metadata} onClick={(event) => void prepareDownload("xlsx", event.currentTarget)}>Prepare XLSX</button></div>
        {interop?.downloadStatus === "failed" ? <p className="ts-dialog-error" role="alert">{interop.downloadError ?? "The download failed; the current work is still open and unsaved changes were preserved."}</p> : null}
      </section>
    </div>;
  }

  function renderSummaryPanel(): ReactNode {
    if (!view) return null;
    const liveWitness: ViewWitness = { occurrence: view.occurrence, revision: view.revision };
    const collection = (key: string) => j4Catalog?.collections.find((candidate) => candidate.key === key) ?? null;
    const fields = (key: string) => collection(key)?.fields ?? [];
    const choose = (key: keyof KeyedGroupedSumBindingChoice, value: string) => {
      setJ4Binding((current) => {
        if (!current) return current;
        if (key === "ordersCollection") return { ...current, ordersCollection: value, orderLookupKeyField: "", orderQuantityField: "" };
        if (key === "productsCollection") return { ...current, productsCollection: value, productKeyField: "", productCategoryField: "", productPriceField: "" };
        return { ...current, [key]: value };
      });
    };
    const prepare = async () => {
      if (controlsLocked || j4Pending) return;
      setJ4Pending(true);
      setLocalError(null);
      try {
        const catalog = await onPrepareJ4Bindings(liveWitness);
        const first = catalog.collections[0];
        setJ4Catalog(catalog);
        setJ4Binding(first ? {
          ordersCollection: first.key,
          orderLookupKeyField: first.fields[0]?.key ?? "",
          orderQuantityField: first.fields[0]?.key ?? "",
          productsCollection: first.key,
          productKeyField: first.fields[0]?.key ?? "",
          productCategoryField: first.fields[0]?.key ?? "",
          productPriceField: first.fields[0]?.key ?? "",
        } : null);
      } catch (error) {
        setLocalError(explain(error, "Could not read the current table and field names."));
      } finally {
        setJ4Pending(false);
      }
    };
    const create = async () => {
      if (!j4Binding || controlsLocked || j4Pending) return;
      if (cellDraftActive) {
        setLocalError("Apply or cancel the value you are editing before creating a cross-table summary.");
        // The editor is only mounted in the Table panel. Returning there lets
        // its existing autofocus callback retain the draft for correction.
        setTab("table");
        return;
      }
      setJ4Pending(true);
      setLocalError(null);
      try {
        await onCreateJ4(liveWitness, j4Binding);
      } finally {
        setJ4Pending(false);
      }
    };
    const selector = (label: string, key: keyof KeyedGroupedSumBindingChoice, values: Array<{ key: string }>) => (
      <><label className="ts-field-label" htmlFor={`j4-${key}`}>{label}</label>
      <select id={`j4-${key}`} value={j4Binding?.[key] ?? ""} onChange={(event) => choose(key, event.currentTarget.value)} disabled={controlsLocked || j4Pending}>
        <option value="">Choose a field</option>
        {values.map((value) => <option key={value.key} value={value.key}>{value.key}</option>)}
      </select></>
    );
    const hasField = (collectionKey: string, fieldKey: string) => fields(collectionKey).some((field) => field.key === fieldKey);
    const bindingReady = Boolean(j4Binding && j4Catalog &&
      [j4Binding.ordersCollection, j4Binding.productsCollection].every(Boolean) &&
      hasField(j4Binding.ordersCollection, j4Binding.orderLookupKeyField) &&
      hasField(j4Binding.ordersCollection, j4Binding.orderQuantityField) &&
      hasField(j4Binding.productsCollection, j4Binding.productKeyField) &&
      hasField(j4Binding.productsCollection, j4Binding.productCategoryField) &&
      hasField(j4Binding.productsCollection, j4Binding.productPriceField));
    const missingDefinitionIds = missingKeyedGroupedSumDefinitionIds(j4DefinitionIds, j4Results);
    return <div role="tabpanel" id={panelId("summary")} aria-labelledby={tabId("summary")} className="ts-panel ts-brief">
      <section className="ts-card" aria-label="Cross-table summary binding">
        <h2 className="ts-h2">Cross-table summary</h2>
        <p className="ts-subtle">Choose visible table and field names. The core binds their stable identities and remains the only calculator.</p>
        {!j4Catalog ? <button type="button" className="ts-button" onClick={() => void prepare()} disabled={controlsLocked || j4Pending}>{j4Pending ? "Loading names…" : "Choose tables and fields"}</button> : <>
          {selector("Orders table", "ordersCollection", j4Catalog.collections)}
          {selector("Order lookup key", "orderLookupKeyField", fields(j4Binding?.ordersCollection ?? ""))}
          {selector("Order quantity", "orderQuantityField", fields(j4Binding?.ordersCollection ?? ""))}
          {selector("Products table", "productsCollection", j4Catalog.collections)}
          {selector("Product key", "productKeyField", fields(j4Binding?.productsCollection ?? ""))}
          {selector("Product category", "productCategoryField", fields(j4Binding?.productsCollection ?? ""))}
          {selector("Product price", "productPriceField", fields(j4Binding?.productsCollection ?? ""))}
          <p className="ts-hint">Creating this summary uses the core’s format-2 project representation. Canonical and portable v1 exits remain unsupported for definition-bearing work.</p>
          <button type="button" className="ts-button ts-button--primary" onClick={() => void create()} disabled={controlsLocked || j4Pending || !bindingReady}>{j4Pending ? "Creating…" : "Create cross-table summary"}</button>
        </>}
      </section>
      <section className="ts-card" aria-label="Cross-table summary result">
        <h2 className="ts-h2">Authoritative result</h2>
        {j4Results.length === 0 && j4DefinitionIds.length === 0 ? <p className="ts-empty">No current cross-table result is available. Create a summary after choosing its fields.</p> : null}
        {j4Results.map((result, index) => <div key={result.definitionId} className="ts-preview" data-testid={`j4-result-${index}`}>
          {result.diagnostics.length > 0 ? <><p role="status">The core reported diagnostics; no current group values are shown.</p><ul className="ts-ledger" aria-label="Cross-table diagnostics">{result.diagnostics.map((diagnostic, diagnosticIndex) => <li key={`${diagnostic.code}-${diagnosticIndex}`}>{diagnostic.code}: {diagnostic.lookup_key ?? "(no lookup key)"}</li>)}</ul></> : <><ul aria-label="Cross-table groups">{result.groups.map((group) => <li key={group.category}>{group.category}: {group.value}</li>)}</ul><div className="ts-row-actions"><button type="button" className="ts-button" onClick={() => createReportFromSummary(result.definitionId, "bar")} disabled={controlsLocked}>Create bar report</button><button type="button" className="ts-button" onClick={() => createReportFromSummary(result.definitionId, "line")} disabled={controlsLocked}>Create line report</button></div></>}
          <button type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, result.definitionId)} disabled={controlsLocked || j4Pending}>Refresh core result</button>
        </div>)}
        {missingDefinitionIds.length > 0 ? <div className="ts-preview">
          <p className="ts-empty">Source data changed, so the previous result is not current.</p>
          {missingDefinitionIds.map((definitionId) => {
            const index = j4DefinitionIds.indexOf(definitionId);
            return <button key={definitionId} type="button" className="ts-button" onClick={() => void onRefreshJ4(liveWitness, definitionId)} disabled={controlsLocked || j4Pending}>Refresh cross-table summary {index + 1}</button>;
          })}
        </div> : null}
      </section>
    </div>;
  }

  function createReportFromSummary(definitionId: string, type: ReportConfiguration["type"]): void {
    if (hasInvalidReportDraft) {
      setLocalError("Correct the invalid report presentation text before replacing this report.");
      selectTab("report");
      return;
    }
    onCreateReport(definitionId, type);
    selectTab("report");
  }

  function renderReportPanel(): ReactNode {
    if (!view) return null;
    const result = report && j4Results.find((candidate) =>
      candidate.definitionId === report.definitionId &&
      candidate.revision === view.revision &&
      candidate.diagnostics.length === 0,
    );
    const update = (patch: Partial<NonNullable<typeof report>>) => {
      if (report) {
        setReportRenderReady(false);
        onUpdateReport({ ...report, ...patch });
      }
    };
    const textValue = (field: ReportPresentationTextField): string =>
      activeReportTextDraft?.values[field] ?? report?.[field] ?? "";
    const textViolation = (field: ReportPresentationTextField) =>
      reportPresentationTextLimitViolation(field, textValue(field));
    const updateText = (field: ReportPresentationTextField, value: string): void => {
      if (!report || !view) return;
      if (reportPresentationTextLimitViolation(field, value)) {
        setReportTextDraft((current) => ({
          occurrence: view.occurrence,
          definitionId: report.definitionId,
          type: report.type,
          values: {
            ...(current && current.occurrence === view.occurrence && current.definitionId === report.definitionId && current.type === report.type
              ? current.values
              : {}),
            [field]: value,
          },
        }));
        return;
      }
      setReportTextDraft((current) => {
        if (!current || current.occurrence !== view.occurrence || current.definitionId !== report.definitionId || current.type !== report.type) return current;
        const { [field]: _discarded, ...remaining } = current.values;
        return Object.keys(remaining).length > 0 ? { ...current, values: remaining } : null;
      });
      update({ [field]: value });
    };
    const exportPng = async () => {
      if (!report || !result || controlsLocked) return;
      if (hasInvalidReportDraft) {
        setLocalError("Correct the invalid report presentation text before exporting PNG.");
        return;
      }
      if (!onExportReportPng({ occurrence: view.occurrence, revision: view.revision }, report)) return;
      const canvas = reportCanvasRef.current;
      if (!canvas || canvas.dataset.reportReady !== "true") {
        setLocalError("The current report image could not be rendered, so no PNG was downloaded.");
        return;
      }
      try {
        const href = canvas.toDataURL("image/png");
        if (href === "data:," || !href.startsWith("data:image/png;base64,")) throw new Error("PNG encoding failed.");
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = "tachiko-sheet-report.png";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } catch {
        setLocalError("The current report image could not be encoded, so no PNG was downloaded.");
      }
    };
    const removeReport = () => {
      if (!onRemoveReport()) return;
      setReportTextDraft(null);
      window.setTimeout(() => document.getElementById(tabId("report"))?.focus(), 0);
    };
    return <div role="tabpanel" id={panelId("report")} aria-labelledby={tabId("report")} className="ts-panel ts-brief">
      <section className="ts-card ts-report-card" aria-label="Current report">
        <h2 className="ts-h2">Current report</h2>
        {!report ? <p className="ts-empty">Create a bar or line report from a current cross-table result.</p> : <>
          {!result ? <p role="status">This report source is not current. Refresh the cross-table summary before viewing or sharing it, or remove this report configuration before saving.</p> : <>
          <div className="ts-report-controls">
            {(["title", "categoryLabel", "valueLabel"] as const).map((field) => {
              const labels = { title: "Title", categoryLabel: "Category label", valueLabel: "Value label" };
              const ids = { title: "report-title", categoryLabel: "report-category-label", valueLabel: "report-value-label" };
              const violation = textViolation(field);
              const errorId = `${ids[field]}-error`;
              return <div key={field}>
                <label className="ts-field-label" htmlFor={ids[field]}>{labels[field]}</label>
                <input id={ids[field]} value={textValue(field)} onChange={(event) => updateText(field, event.currentTarget.value)} disabled={controlsLocked} aria-invalid={violation ? true : undefined} aria-describedby={violation ? errorId : undefined} />
                {violation ? <p id={errorId} className="ts-subtle" role="status">{labels[field]} must be {violation.limit} Unicode code points or fewer ({violation.length} entered). This value has not been applied.</p> : null}
              </div>;
            })}
            <label className="ts-check"><input type="checkbox" checked={report.legendVisible} onChange={(event) => update({ legendVisible: event.currentTarget.checked })} disabled={controlsLocked} /> Show legend</label>
          </div>
          <p className="ts-subtle">This {report.type} report renders the complete current core group result. It does not calculate or persist group values.</p>
          {result.groups.length === 0 ? <p role="status">No groups in the current result.</p> : null}
          <dl className="ts-report-data" aria-label="Current report data">{result.groups.map((group) => <div key={group.category}><dt>{group.category}</dt><dd>{group.value}</dd></div>)}</dl>
          <div role="region" aria-label="Report chart" tabIndex={0} className="ts-report-scroll"><ReportCanvas key={reportRenderKey} canvasRef={reportCanvasRef} report={report} groups={result.groups} onRenderState={onReportRenderState} /></div>
          {!reportCanvasReady ? <p role="status">The current report image could not be rendered. PNG export is unavailable.</p> : null}
          {hasInvalidReportDraft ? <p role="status">Correct the invalid report presentation text before saving or exporting. The current report has not been changed.</p> : null}
          <button type="button" className="ts-button ts-button--primary" onClick={exportPng} disabled={controlsLocked || !reportCanvasReady || hasInvalidReportDraft}>Export current PNG</button>
          </>}
          <div className="ts-row-actions">
            <button type="button" className="ts-button" onClick={removeReport} disabled={controlsLocked}>Remove report</button>
            <p className="ts-subtle">This removes only the report configuration{hasInvalidReportDraft ? " and discards the uncommitted presentation text" : ""}. Table data and the cross-table definition stay available.</p>
          </div>
        </>}
      </section>
    </div>;
  }

  function renderWorkbook(): ReactNode {
    if (!view || !table) return null;
    return (
      <div className="ts-workbook" data-testid="project-ready" aria-busy={busy}>
        {renderToolbar()}
        <nav className="ts-work-context" aria-label="Workbook actions">
          <div className="ts-context-table">
            <label className="ts-field-label" htmlFor="ts-active-table">Table</label>
            <select id="ts-active-table" value={view.table.collection.key} onChange={(event) => void selectCollection(event.currentTarget.value)} disabled={controlsLocked || cellDraftActive}>
              {view.collections.map((collection) => <option key={collection.key} value={collection.key}>{collection.key}</option>)}
            </select>
          </div>
        </nav>
        {controlsLocked ? (
          <p className="ts-hint" id={lockNoteId} role="note">
            An operation is in progress; editing is disabled until it finishes.
          </p>
        ) : null}
        <footer className="ts-workspace-footer">
          <div className="ts-tabs" role="tablist" aria-label="Workbook views" onKeyDown={onTabListKeyDown}>
            <span className="ts-views-label" aria-hidden="true">Views</span>
            <button
            type="button"
            role="tab"
            id={tabId("table")}
            aria-selected={tab === "table"}
            aria-controls={panelId("table")}
            tabIndex={tab === "table" ? 0 : -1}
            className={tab === "table" ? "ts-tab ts-tab--active" : "ts-tab"}
            onClick={() => selectTab("table")}
          >
            Table
            </button>
            <button type="button" role="tab" id={tabId("summary")} aria-selected={tab === "summary"} aria-controls={panelId("summary")} tabIndex={tab === "summary" ? 0 : -1} className={tab === "summary" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("summary")}>Cross-table summary</button>
            <button type="button" role="tab" id={tabId("report")} aria-selected={tab === "report"} aria-controls={panelId("report")} tabIndex={tab === "report" ? 0 : -1} className={tab === "report" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("report")}>Report</button>
            <button
            type="button"
            role="tab"
            id={tabId("brief")}
            aria-selected={tab === "brief"}
            aria-controls={panelId("brief")}
            tabIndex={tab === "brief" ? 0 : -1}
            className={tab === "brief" ? "ts-tab ts-tab--active" : "ts-tab"}
            onClick={() => selectTab("brief")}
          >
            Brief
            </button>
            <button type="button" role="tab" id={tabId("interop")} aria-selected={tab === "interop"} aria-controls={panelId("interop")} tabIndex={tab === "interop" ? 0 : -1} className={tab === "interop" ? "ts-tab ts-tab--active" : "ts-tab"} onClick={() => selectTab("interop")}>Import & export</button>
          </div>
          <div className="ts-workbook-status">{renderStatusStrip()}</div>
        </footer>
        {tab === "table" ? renderTablePanel() : tab === "summary" ? renderSummaryPanel() : tab === "report" ? renderReportPanel() : tab === "brief" ? renderBriefPanel() : renderInteropPanel()}
      </div>
    );
  }

  function onTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs: ActiveTab[] = ["table", "summary", "report", "brief", "interop"];
    const focused = (event.target as HTMLElement).id;
    const index = Math.max(0, tabs.findIndex((name) => tabId(name) === focused));
    selectTab(tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]!);
  }

  function selectTab(next: ActiveTab): void {
    setTab(next);
    window.setTimeout(() => document.getElementById(tabId(next))?.focus(), 0);
  }

  return (
    <div
      className="ts-app"
      data-view={view ? "workbook" : "home"}
      onCompositionStartCapture={beginAppearanceComposition}
      onCompositionEndCapture={scheduleAppearanceCompositionEnd}
    >
      {errorMessage && !copyErrorIsInline && !importErrorIsInline && !downloadErrorIsInline ? (
        <div className="ts-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {view ? renderWorkbook() : renderHome()}
      {copyOpen ? (
        <Modal variant="save" label="Save a copy" onCancel={closeCopyDialog} dismissDisabled={copyPending}>
          <div className="ts-dialog-intro">
            <h2 className="ts-h2">Save a copy</h2>
            <p className="ts-subtle">Creates a new copy in this browser profile.<br />It does not update an existing one.</p>
          </div>
          <div className="ts-dialog-field">
            <label className="ts-field-label" htmlFor={copyNameId}>Copy name</label>
            <input
              id={copyNameId}
              className="ts-text-input"
              ref={copyNameInputRef}
              data-autofocus="true"
              value={copyName}
              aria-describedby={copyError ? copyErrorId : undefined}
              onChange={(event) => {
                setCopyError(null);
                setCopyName(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isComposingEvent(event)) {
                  event.preventDefault();
                  void createCopy();
                }
              }}
            />
          </div>
          {copyError ? (
            <p className="ts-dialog-error" id={copyErrorId} role="alert">
              {copyError}
            </p>
          ) : null}
          <div className="ts-dialog-actions">
            <button
              type="button"
              className="ts-button"
              onClick={closeCopyDialog}
              disabled={copyPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ts-button ts-button--primary"
              onClick={() => void createCopy()}
              disabled={copyPending || copyName.trim() === "" || hasInvalidReportDraft}
              aria-busy={copyPending}
            >
              {copyPending ? "Working…" : "Create copy"}
            </button>
          </div>
        </Modal>
      ) : null}
      {interop?.importInspection ? (
        <Modal variant="import" label="Review import candidate" onCancel={cancelImport} dismissDisabled={importPending}>
          <div className="ts-dialog-intro">
            <h2
              className="ts-h2"
              tabIndex={interop.importInspection.source.ledger.length ? 0 : undefined}
              data-autofocus={interop.importInspection.source.ledger.length ? "true" : undefined}
            >Review import candidate</h2>
            <p className="ts-subtle">{interop.importInspection.name}: {interop.importInspection.source.sheets.length} sheet(s). Each column is imported as Text; recognition is advisory and does not change stored values.</p>
          </div>
          <div className="ts-dialog-scroll">
            {interop.importInspection.source.ledger.length ? <ul className="ts-ledger" aria-label="Candidate source fidelity ledger">{interop.importInspection.source.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.location}: {finding.message}</li>)}</ul> : <p className="ts-hint ts-dialog-success">No source-fidelity findings were reported for this candidate.</p>}
            <div className="ts-import-columns">{interop.importInspection.source.sheets.map((sheet, sheetIndex) => <section key={sheet.name}><h3 className="ts-h2">{sheet.name}</h3>{sheet.columns.map((column, columnIndex) => <label className="ts-import-column" key={column.name}>{column.name}<select value={importTypes[sheetIndex]?.[columnIndex] ?? "text"} onChange={(event) => { const nextType = event.currentTarget.value; setImportTypes((current) => current.map((types, index) => index !== sheetIndex ? types : types.map((type, index2) => index2 === columnIndex ? nextType : type))); }}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="date">Date</option></select></label>)}</section>)}</div>
          </div>
          {importErrorMessage ? <p className="ts-dialog-error ts-dialog-error--import" role="alert">{importErrorMessage}</p> : null}
          <div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelImport} disabled={importPending}>Cancel</button><button type="button" className="ts-button ts-button--primary" data-autofocus={interop.importInspection.source.ledger.length ? undefined : "true"} onClick={() => void importCandidate()} disabled={controlsLocked || importPending} aria-busy={importPending}>Import candidate</button></div>
        </Modal>
      ) : null}
      {downloadFormat ? <Modal variant="review" label="Confirm download" onCancel={cancelDownload}><div className="ts-dialog-intro"><h2 className="ts-h2" tabIndex={0} data-autofocus="true">Review and download {downloadFormat.toUpperCase()}</h2><p>The actual exporter produced this revision. Review its source-fidelity ledger before consenting to the browser download.</p></div><div className="ts-dialog-scroll">{interop?.ledger.length ? <ul className="ts-ledger" aria-label="Export fidelity ledger">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{finding.category}</strong>: {finding.message}</li>)}</ul> : <p className="ts-hint ts-dialog-success">The exporter reported no fidelity findings for this output.</p>}</div><div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelDownload}>Cancel</button><button type="button" className="ts-button ts-button--primary" onClick={() => { void onDownload(downloadFormat).then(() => cancelDownload(), () => cancelDownload()); }}>Download</button></div></Modal> : null}
      {closeOpen ? (
        <Modal variant="close" label="Unsaved work" onCancel={keepEditing}>
          <div className="ts-dialog-intro">
            <h2 className="ts-h2">Unsaved work</h2>
            <p>This work has changes that are not saved. Keep editing to return to the sheet, or close without saving.</p>
          </div>
          <div className="ts-dialog-actions">
            <button type="button" className="ts-button" data-autofocus="true" onClick={keepEditing}>
              Keep editing
            </button>
            <button type="button" className="ts-button ts-button--danger" onClick={() => void closeWork()}>
              Close without saving
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({ label, onCancel, children, variant = "review", dismissDisabled = false }: { label: string; onCancel: () => void; children: ReactNode; variant?: "save" | "close" | "import" | "review"; dismissDisabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>("[data-autofocus]") ?? focusableElements(root)[0] ?? null;
    target?.focus();
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!dismissDisabled) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const root = ref.current;
    if (!root) return;
    const nodes = focusableElements(root);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = root.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="ts-modal-backdrop"
      onMouseDown={(event) => {
        if (!dismissDisabled && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        className={`ts-modal ts-modal--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  );
}

function focusEditorInput(node: HTMLInputElement | null): void {
  if (!node) return;
  if (node.ownerDocument.activeElement !== node) {
    node.focus();
    node.select();
  }
}

function isComposingEvent(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const native = event.nativeEvent as KeyboardEvent;
  return native.isComposing === true || native.keyCode === 229;
}

function currentnessLabel(currentness: SheetShellProps["currentness"]): string {
  if (currentness === "current") return "Up to date";
  if (currentness === "pending") return "Updating…";
  return "Needs refresh";
}

function freshnessNotice(currentness: SheetShellProps["currentness"]): string {
  return currentness === "pending"
    ? "These values are being updated; wait for confirmation before editing."
    : "These values could not be confirmed. Refresh before editing.";
}

function saveLabel(saveStatus: SheetShellProps["saveStatus"]): string {
  switch (saveStatus) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved on this device";
    case "failed":
      return "Save failed";
    default:
      return "Not saved yet";
  }
}

function workStateLabel(dirty: boolean): string {
  return dirty ? "Edited — not saved" : "Unchanged";
}

function outcomeLabel(outcome: SheetShellProps["outcome"]): string {
  if (outcome === "pending") return "Applying changes…";
  if (outcome === "unknown") return "Outcome needs review";
  return "";
}

function explain(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (${error.message})`;
  return fallback;
}
