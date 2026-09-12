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
import type { SheetShellProps, ViewWitness } from "../contracts.js";
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
import "./sheet-shell.css";

type EditableKind = "number" | "text" | "boolean" | "date";
type ActiveTab = "table" | "brief";

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
    onCommit,
    onCreateCopy,
    onClose,
    onRefresh,
  } = props;

  const [tab, setTab] = useState<ActiveTab>("table");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notesDraft, setNotesDraft] = useState<NotesDraft | null>(null);
  const [commitPending, setCommitPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const fileInputId = useId();
  const copyNameId = useId();
  const copyErrorId = useId();
  const lockNoteId = useId();
  const notesId = useId();
  const tabId = (name: ActiveTab) => `ts-tab-${name}`;
  const panelId = (name: ActiveTab) => `ts-panel-${name}`;

  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const lastCellRef = useRef<HTMLTableCellElement | null>(null);
  const saveCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const onDraftChangeRef = useRef(props.onDraftChange);
  const viewKey = view ? `${view.occurrence}\u0000${view.revision}` : null;

  useEffect(() => {
    onDraftChangeRef.current = props.onDraftChange;
  }, [props.onDraftChange]);

  useEffect(() => {
    setEditor(null);
    setNotesDraft(null);
    setCommitPending(false);
    setLocalError(null);
    if (!viewKey) {
      setCopyOpen(false);
      setCloseOpen(false);
      setTab("table");
    }
  }, [viewKey]);

  useEffect(() => {
    if (!view) {
      setSelectedEntity(null);
      return;
    }
    const entities = view.table.rows.map(rowEntity);
    setSelectedEntity((previous) => (previous && entities.includes(previous) ? previous : entities[0] ?? null));
  }, [view]);

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
  const notesDraftBound = Boolean(
    notesDraft &&
      view &&
      selectedRow &&
      notesDraft.occurrence === view.occurrence &&
      notesDraft.revision === view.revision &&
      notesDraft.entity === rowEntity(selectedRow),
  );
  const notesValue = notesDraftBound ? (notesDraft?.value ?? notesCommitted) : notesCommitted;
  const notesDirty = notesDraftBound && notesDraft !== null && notesDraft.value !== notesCommitted;
  const notesEditable = Boolean(notesField && notesField.editable_scalar === "text");

  const controlsLocked = busy || commitPending || currentness === "unknown";
  const draftActive =
    (editor !== null && editor.value !== editor.original) || notesDirty || (copyOpen && copyName.trim() !== "");
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
    if (accepted) setLocalError(null);
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

  async function openExample(): Promise<void> {
    setLocalError(null);
    try {
      await onOpenExample();
    } catch (error) {
      setLocalError(explain(error, "Could not open the example work."));
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
    if (controlsLocked) return;
    if (dirty || draftActive) {
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
            <h2 className="ts-h2">Recovery required; freshness unconfirmed</h2>
            <p className="ts-subtle">Resident work is not confirmed. Refresh to re-read it.</p>
            <div className="ts-status-strip" aria-label="Recovery status">
              <span className="ts-chip" data-testid="currentness" data-currentness={currentness}>
                {currentnessLabel(currentness)}
              </span>
              <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
                {outcomeLabel(outcome)}
              </span>
            </div>
            <button type="button" className="ts-button" onClick={() => void refresh()} disabled={busy || commitPending}>
              Refresh
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
          <p className="ts-subtle">
            {table ? `${table.collection.key} · ${table.rows.length} rows` : ""}
            {view ? ` · revision ${view.revision}` : ""}
          </p>
        </div>
        <div className="ts-status-strip">
          <span className="ts-chip" data-testid="currentness" data-currentness={currentness}>
            {currentnessLabel(currentness)}
          </span>
          <span className={`ts-chip ts-chip--${saveStatus}`} data-testid="save-status">
            {saveLabel(saveStatus)}
          </span>
          <span className={`ts-chip ts-chip--${outcome}`} data-testid="operation-outcome">
            {outcomeLabel(outcome)}
          </span>
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
                  <th key={column.id} scope="col" className="ts-col-head" title={column.field_type}>
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
                      {row.key}
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
          <h2 className="ts-h2">
            Brief · {selectedRow.key}
            <span className="ts-subtle"> {entity}</span>
          </h2>
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
            Notes on {selectedRow.key}. They are saved with the work, not with a copy.
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
                setNotesDraft({
                  occurrence: view.occurrence,
                  revision: view.revision,
                  entity: rowEntity(selectedRow),
                  value: event.currentTarget.value,
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
              disabled={!notesEditable || controlsLocked || !notesDirty}
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

  function renderWorkbook(): ReactNode {
    if (!view || !table) return null;
    return (
      <div className="ts-workbook" data-testid="project-ready" aria-busy={busy}>
        {renderToolbar()}
        <nav className="ts-actions" aria-label="Workbook actions">
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
        </div>
        {tab === "table" ? renderTablePanel() : renderBriefPanel()}
      </div>
    );
  }

  function onTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectTab(tab === "table" ? "brief" : "table");
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
  if (currentness === "current") return "Current";
  if (currentness === "pending") return "Updating…";
  return "Freshness unknown";
}

function freshnessNotice(currentness: SheetShellProps["currentness"]): string {
  return currentness === "pending"
    ? "These values are not confirmed current: a change is still being applied."
    : "These values are not confirmed current, and shown results may be out of date.";
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

function outcomeLabel(outcome: SheetShellProps["outcome"]): string {
  if (outcome === "pending") return "Applying changes…";
  if (outcome === "unknown") return "Outcome unknown";
  return "No pending operation";
}

function explain(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return `${fallback} (${error.message})`;
  return fallback;
}
