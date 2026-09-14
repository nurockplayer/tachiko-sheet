import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type {
  ImportSelection,
  KeyedGroupedSumBindingCatalog,
  KeyedGroupedSumBindingChoice,
  SheetShellProps,
  ViewWitness,
} from "../contracts.js";
import { BriefFacts } from "./BriefFacts.js";
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
  const [closeOpen, setCloseOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"csv" | "xlsx" | null>(null);
  const [importTypes, setImportTypes] = useState<string[][]>([]);
  const [j4Catalog, setJ4Catalog] = useState<KeyedGroupedSumBindingCatalog | null>(null);
  const [j4Binding, setJ4Binding] = useState<KeyedGroupedSumBindingChoice | null>(null);
  const [j4Pending, setJ4Pending] = useState(false);
  const [reportRenderReady, setReportRenderReady] = useState(false);

  const fileInputId = useId();
  const spreadsheetInputId = useId();
  const copyNameId = useId();
  const copyErrorId = useId();
  const lockNoteId = useId();
  const notesId = useId();
  const tabId = (name: ActiveTab) => `ts-tab-${name}`;
  const panelId = (name: ActiveTab) => `ts-panel-${name}`;

  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const spreadsheetInputRef = useRef<HTMLInputElement | null>(null);
  const lastNotesOccurrenceRef = useRef<string | null>(null);
  const lastCellRef = useRef<HTMLTableCellElement | null>(null);
  const saveCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const downloadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDraftChangeRef = useRef(props.onDraftChange);
  const viewKey = view ? `${view.occurrence}\u0000${view.revision}` : null;
  const viewCollectionKey = view?.table.collection.key ?? null;

  useEffect(() => {
    onDraftChangeRef.current = props.onDraftChange;
  }, [props.onDraftChange]);

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
    setReportRenderReady(false);
    if (!viewKey) {
      setCopyOpen(false);
      setCloseOpen(false);
      setTab("table");
    }
  }, [viewKey, viewCollectionKey]);

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

  const controlsLocked = busy || commitPending || currentness === "unknown";
  const cellDraftActive = editor !== null && editor.value !== editor.original;
  const draftActive =
    cellDraftActive || anyNotesDraft || (copyOpen && copyName.trim() !== "");
  const errorMessage = localError ?? copyError ?? (message && message.length > 0 ? message : null);

  useEffect(() => {
    onDraftChangeRef.current(draftActive);
  }, [draftActive]);

  useEffect(
    () => () => {
      onDraftChangeRef.current(false);
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
    setImportError(null);
    try { await onInspectImport(file); }
    catch (error) { setImportError(explain(error, "The spreadsheet could not be inspected.")); }
  }

  async function importCandidate(): Promise<void> {
    const inspection = interop?.importInspection;
    if (!inspection) return;
    const selection: ImportSelection = {
      column_types: importTypes as ImportSelection["column_types"],
      extra_columns: inspection.source.sheets.map(() => []),
    };
    const accepted = await onImportCandidate(selection);
    if (!accepted) setImportError("The import was not applied. Your source selection is still available.");
  }

  function cancelImport(): void {
    setImportError(null);
    onCancelImport();
    // Wait for React to remove the dialog; focusing before that commit would
    // lose focus with the unmounted modal control.
    window.setTimeout(() => spreadsheetInputRef.current?.focus(), 0);
  }

  async function prepareDownload(format: "csv" | "xlsx", trigger: HTMLButtonElement): Promise<void> {
    downloadTriggerRef.current = trigger;
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
    setCopyOpen(true);
  }

  function closeCopyDialog(): void {
    setCopyOpen(false);
    setCopyError(null);
    setCopyName("");
    saveCopyButtonRef.current?.focus();
  }

  async function createCopy(): Promise<void> {
    const name = copyName.trim();
    if (name === "" || copyPending) return;
    setCopyPending(true);
    setLocalError(null);
    try {
      const created = await onCreateCopy(name);
      if (created) {
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
    if (dirty || draftActive || currentness === "unknown") {
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
    const target = lastCellRef.current;
    if (target) requestAnimationFrame(() => target.focus());
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
          <h1 className="ts-brand">Tachiko Sheet</h1>
          <p className="ts-subtle">Open a project folder, or reopen a copy saved in this browser profile.</p>
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
        <div className="ts-title-block">
          <h1 className="ts-title">{view ? view.title : ""}</h1>
          <p className="ts-subtle">{table ? `${table.rows.length} rows` : ""}</p>
        </div>
        <div className="ts-status-strip">
          <span className="ts-chip" data-testid="currentness" data-currentness={currentness}>
            {currentnessLabel(currentness)}
          </span>
          <span
            className={`ts-chip ${dirty ? "ts-chip--edited" : "ts-chip--unchanged"}`}
            data-testid="work-state"
            data-work-state={dirty ? "edited" : "unchanged"}
          >
            {workStateLabel(dirty)}
          </span>
          <span className={`ts-chip ts-chip--${saveStatus}`} data-testid="save-status">
            {saveLabel(saveStatus)}
          </span>
          {outcome !== "idle" ? (
            <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
              {outcomeLabel(outcome)}
            </span>
          ) : null}
        </div>
      </header>
    );
  }

  function renderTablePanel(): ReactNode {
    if (!table) return null;
    return (
      <div role="tabpanel" id={panelId("table")} aria-labelledby={tabId("table")} className="ts-panel">
        {currentness === "current" ? null : <p className="ts-notice">{freshnessNotice(currentness)}</p>}
        <div className="ts-grid-scroll">
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
        {interop?.downloadStatus === "failed" ? <p className="ts-dialog-error" role="alert">The download failed; the current work is still open and unsaved changes were preserved.</p> : null}
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
          {result.diagnostics.length > 0 ? <><p role="status">The core reported diagnostics; no current group values are shown.</p><ul className="ts-ledger" aria-label="Cross-table diagnostics">{result.diagnostics.map((diagnostic, diagnosticIndex) => <li key={`${diagnostic.code}-${diagnosticIndex}`}>{diagnostic.code}: {diagnostic.lookup_key ?? "(no lookup key)"}</li>)}</ul></> : <><ul aria-label="Cross-table groups">{result.groups.map((group) => <li key={group.category}>{group.category}: {group.value}</li>)}</ul><div className="ts-row-actions"><button type="button" className="ts-button" onClick={() => { onCreateReport(result.definitionId, "bar"); selectTab("report"); }} disabled={controlsLocked}>Create bar report</button><button type="button" className="ts-button" onClick={() => { onCreateReport(result.definitionId, "line"); selectTab("report"); }} disabled={controlsLocked}>Create line report</button></div></>}
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
    const exportPng = async () => {
      if (!report || !result || controlsLocked) return;
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
      window.setTimeout(() => document.getElementById(tabId("report"))?.focus(), 0);
    };
    return <div role="tabpanel" id={panelId("report")} aria-labelledby={tabId("report")} className="ts-panel ts-brief">
      <section className="ts-card" aria-label="Current report">
        <h2 className="ts-h2">Current report</h2>
        {!report ? <p className="ts-empty">Create a bar or line report from a current cross-table result.</p> : <>
          {!result ? <p role="status">This report source is not current. Refresh the cross-table summary before viewing or sharing it, or remove this report configuration before saving.</p> : <>
          <div className="ts-report-controls">
            <label className="ts-field-label" htmlFor="report-title">Title</label><input id="report-title" value={report.title} onChange={(event) => update({ title: event.currentTarget.value })} disabled={controlsLocked} />
            <label className="ts-field-label" htmlFor="report-category-label">Category label</label><input id="report-category-label" value={report.categoryLabel} onChange={(event) => update({ categoryLabel: event.currentTarget.value })} disabled={controlsLocked} />
            <label className="ts-field-label" htmlFor="report-value-label">Value label</label><input id="report-value-label" value={report.valueLabel} onChange={(event) => update({ valueLabel: event.currentTarget.value })} disabled={controlsLocked} />
            <label className="ts-check"><input type="checkbox" checked={report.legendVisible} onChange={(event) => update({ legendVisible: event.currentTarget.checked })} disabled={controlsLocked} /> Show legend</label>
          </div>
          <p className="ts-subtle">This {report.type} report renders the complete current core group result. It does not calculate or persist group values.</p>
          {result.groups.length === 0 ? <p role="status">No groups in the current result.</p> : null}
          <dl className="ts-report-data" aria-label="Current report data">{result.groups.map((group) => <div key={group.category}><dt>{group.category}</dt><dd>{group.value}</dd></div>)}</dl>
          <div className="ts-report-scroll"><ReportCanvas key={`${report.definitionId}:${report.type}:${report.title}:${report.categoryLabel}:${report.valueLabel}:${report.legendVisible}:${result.revision}`} canvasRef={reportCanvasRef} report={report} groups={result.groups} onRenderState={setReportRenderReady} /></div>
          {!reportRenderReady ? <p role="status">The current report image could not be rendered. PNG export is unavailable.</p> : null}
          <button type="button" className="ts-button ts-button--primary" onClick={exportPng} disabled={controlsLocked || !reportRenderReady}>Export current PNG</button>
          </>}
          <div className="ts-row-actions">
            <button type="button" className="ts-button" onClick={removeReport} disabled={controlsLocked}>Remove report</button>
            <p className="ts-subtle">This removes only the report configuration. Table data and the cross-table definition stay available.</p>
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
        <nav className="ts-actions" aria-label="Workbook actions">
          <label className="ts-field-label" htmlFor="ts-active-table">Table</label>
          <select id="ts-active-table" value={view.table.collection.key} onChange={(event) => void selectCollection(event.currentTarget.value)} disabled={controlsLocked || cellDraftActive}>
            {view.collections.map((collection) => <option key={collection.key} value={collection.key}>{collection.key}</option>)}
          </select>
          <button
            type="button"
            className="ts-button"
            onClick={() => void refresh()}
            disabled={controlsLocked}
            aria-describedby={controlsLocked ? lockNoteId : undefined}
          >
            Refresh
          </button>
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
          <button
            type="button"
            className="ts-button"
            onClick={() => void requestClose()}
            disabled={busy}
            aria-describedby={busy ? lockNoteId : undefined}
          >
            Close project
          </button>
        </nav>
        {controlsLocked ? (
          <p className="ts-hint" id={lockNoteId} role="note">
            An operation is in progress; editing is disabled until it finishes.
          </p>
        ) : null}
        <div className="ts-tabs" role="tablist" aria-label="Workbook views" onKeyDown={onTabListKeyDown}>
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
    <div className="ts-app" data-view={view ? "workbook" : "home"}>
      {errorMessage ? (
        <div className="ts-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {view ? renderWorkbook() : renderHome()}
      {copyOpen ? (
        <Modal label="Save a copy" onCancel={closeCopyDialog}>
          <h2 className="ts-h2">Save a copy</h2>
          <p className="ts-subtle">Creates a new copy in this browser profile. It does not update an existing one.</p>
          <label className="ts-field-label" htmlFor={copyNameId}>
            Copy name
          </label>
          <input
            id={copyNameId}
            className="ts-text-input"
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
          {copyError ? (
            <p className="ts-dialog-error" id={copyErrorId}>
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
              disabled={copyPending || copyName.trim() === ""}
              aria-busy={copyPending}
            >
              Create copy
            </button>
          </div>
        </Modal>
      ) : null}
      {interop?.importInspection ? (
        <Modal label="Review import candidate" onCancel={cancelImport}>
          <h2 className="ts-h2">Review import candidate</h2>
          <p className="ts-subtle">{interop.importInspection.name}: {interop.importInspection.source.sheets.length} sheet(s). Each column is imported as Text; recognition is advisory and does not change stored values.</p>
          {interop.importInspection.source.ledger.length ? <ul className="ts-ledger" aria-label="Candidate source fidelity ledger">{interop.importInspection.source.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.location}: {finding.message}</li>)}</ul> : <p className="ts-hint">No source-fidelity findings were reported for this candidate.</p>}
          <div className="ts-import-columns">{interop.importInspection.source.sheets.map((sheet, sheetIndex) => <section key={sheet.name}><h3 className="ts-h2">{sheet.name}</h3>{sheet.columns.map((column, columnIndex) => <label className="ts-import-column" key={column.name}>{column.name}<select value={importTypes[sheetIndex]?.[columnIndex] ?? "text"} onChange={(event) => { const nextType = event.currentTarget.value; setImportTypes((current) => current.map((types, index) => index !== sheetIndex ? types : types.map((type, index2) => index2 === columnIndex ? nextType : type))); }}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="date">Date</option></select></label>)}</section>)}</div>
          {importError ? <p className="ts-dialog-error" role="alert">{importError}</p> : null}
          <div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelImport}>Cancel</button><button type="button" className="ts-button ts-button--primary" data-autofocus="true" onClick={() => void importCandidate()} disabled={controlsLocked}>Import candidate</button></div>
        </Modal>
      ) : null}
      {downloadFormat ? <Modal label="Confirm download" onCancel={cancelDownload}><h2 className="ts-h2">Review and download {downloadFormat.toUpperCase()}</h2><p>The actual exporter produced this revision. Review its source-fidelity ledger before consenting to the browser download.</p>{interop?.ledger.length ? <ul className="ts-ledger" aria-label="Export fidelity ledger">{interop.ledger.map((finding, index) => <li key={`${finding.code}-${index}`}><strong>{finding.category}</strong>: {finding.message}</li>)}</ul> : <p className="ts-hint">The exporter reported no fidelity findings for this output.</p>}<div className="ts-dialog-actions"><button type="button" className="ts-button" onClick={cancelDownload}>Cancel</button><button type="button" className="ts-button ts-button--primary" data-autofocus="true" onClick={() => { void onDownload(downloadFormat).then((ok) => { if (ok) cancelDownload(); }); }}>Download</button></div></Modal> : null}
      {closeOpen ? (
        <Modal label="Unsaved work" onCancel={keepEditing}>
          <h2 className="ts-h2">Unsaved work</h2>
          <p>This work has changes that are not saved. Keep editing to return to the sheet, or close without saving.</p>
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

function Modal({ label, onCancel, children }: { label: string; onCancel: () => void; children: ReactNode }) {
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
      onCancel();
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
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        className="ts-modal"
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
