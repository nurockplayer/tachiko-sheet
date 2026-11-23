import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SheetShellProps, WorkbookView } from "../contracts.js";
import { a1ColumnLetter } from "./a1-geometry.js";
import { cellDisplay, seedTextOf } from "./field-display.js";
import { fieldForColumn } from "./projection-access.js";

/** Empty positions are UI addresses; only Work allocates records and fields. */
export function BlankWorksheet({ view, locked, onWrite, onDraftChange }: {
  view: WorkbookView;
  locked: boolean;
  onWrite: NonNullable<SheetShellProps["onWriteCellAt"]>;
  onDraftChange(active: boolean): void;
}) {
  const [active, setActive] = useState({ row: 0, column: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const composing = useRef(false);
  const { table } = view;
  const rows = Math.max(30, table.rows.length + 1);
  const columns = Math.max(10, table.columns.length + 1);
  const address = (row: number, column: number) => `${a1ColumnLetter(column)}${row + 1}`;
  const activeAddress = address(active.row, active.column);
  useEffect(() => { onDraftChange(draft !== null); }, [draft, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  useEffect(() => {
    if (draft === null && !locked) grid.current?.querySelector<HTMLElement>(`[data-address="${activeAddress}"]`)?.focus();
  }, [activeAddress, draft, locked]);

  function seed(row: number, column: number): string {
    const projectedRow = table.rows[row], projectedColumn = table.columns[column];
    const field = projectedRow && projectedColumn ? fieldForColumn(projectedRow, projectedColumn.id) : null;
    return field ? seedTextOf(field) : "";
  }

  async function commit(rowDelta: number, columnDelta: number) {
    if (draft === null || pending || locked) return;
    setPending(true);
    setError(null);
    try {
      const result = await onWrite({ occurrence: view.occurrence, revision: view.revision }, table.collection.key, active.row, active.column, draft);
      if (result.kind === "confirmed") {
        setDraft(null);
        setActive({ row: Math.max(0, Math.min(rows - 1, active.row + rowDelta)), column: Math.max(0, Math.min(columns - 1, active.column + columnDelta)) });
      } else setError("message" in result ? result.message : "The cell could not be confirmed. Refresh the work before continuing.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  }

  function keyDown(event: KeyboardEvent<HTMLTableCellElement>, row: number, column: number) {
    if (locked || pending || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (draft !== null) {
      if (event.key === "Escape") { event.preventDefault(); setDraft(null); setError(null); }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        void commit(event.key === "Enter" ? (event.shiftKey ? -1 : 1) : 0, event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0);
      }
      return;
    }
    const steps: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], Enter: [event.shiftKey ? -1 : 1, 0], Tab: [0, event.shiftKey ? -1 : 1] };
    const step = steps[event.key];
    if (step && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setActive({ row: Math.max(0, Math.min(rows - 1, row + step[0])), column: Math.max(0, Math.min(columns - 1, column + step[1])) });
    } else if (event.key === "F2" || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      event.preventDefault();
      setDraft(event.key === "F2" ? seed(row, column) : event.key);
    }
  }

  return <>
    {error ? <p role="alert">{error}</p> : null}
    <div className="ts-grid-scroll">
      <table ref={grid} className="ts-grid" role="grid" aria-label="Table" aria-busy={locked || pending}>
        <thead><tr><th scope="col" />{Array.from({ length: columns }, (_, column) => <th key={column} scope="col" className="ts-column-header">{a1ColumnLetter(column)}</th>)}</tr></thead>
        <tbody>{Array.from({ length: rows }, (_, row) => <tr key={row}>
          <th scope="row">{row + 1}</th>
          {Array.from({ length: columns }, (_, column) => {
            const selected = active.row === row && active.column === column;
            const projectedRow = table.rows[row], projectedColumn = table.columns[column];
            return <td key={column} role="gridcell" data-address={address(row, column)} data-testid={`worksheet:${address(row, column)}`} aria-label={address(row, column)} aria-selected={selected} tabIndex={selected ? 0 : -1}
              onClick={() => { if (!locked && !pending && draft === null) setActive({ row, column }); }}
              onDoubleClick={() => { if (!locked && !pending && draft === null) { setActive({ row, column }); setDraft(seed(row, column)); } }}
              onKeyDown={event => keyDown(event, row, column)}>
              {selected && draft !== null ? <input autoFocus data-testid="cell-editor" value={draft} disabled={locked || pending} onChange={event => setDraft(event.currentTarget.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
                : projectedRow && projectedColumn ? cellDisplay(projectedRow, projectedColumn).text : ""}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}
