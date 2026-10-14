import { useEffect, useRef, type KeyboardEvent } from "react";
import type { WorkbookView } from "../contracts.js";

export interface RowDraft { occurrence: string; collection: string; values: Record<string, string>; needsReview?: boolean }

export function RowEntry({ columns, names, values, disabled, needsReview, error, onChange, onAdd, onClear }: {
  columns: WorkbookView["table"]["columns"];
  names: string[];
  values: Record<string, string>;
  disabled: boolean;
  needsReview: boolean;
  error: { message: string; fields?: string[] } | null;
  onChange(field: string, value: string): void;
  onAdd(): void;
  onClear(): void;
}) {
  const root = useRef<HTMLTableRowElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    if (!error?.fields?.length || disabled) return;
    const input = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-entry-field]") ?? []).find(input => input.dataset.entryField === error.fields![0]);
    input?.focus();
  }, [error, disabled]);
  const unsetBoolean = columns.some(column => column.field_type === "boolean" && values[column.id] !== "true" && values[column.id] !== "false");
  function keyDown(event: KeyboardEvent, index: number) {
    if (event.key === "Enter" && !event.repeat && index === columns.length - 1 && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault();
      if (!disabled && !needsReview && !unsetBoolean) onAdd();
    }
  }
  return <tr ref={root} role="presentation" className="ts-entry-row" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { window.setTimeout(() => { composing.current = false; }, 0); }}>
    <th role="presentation" className="ts-row-head"><span>Add<br />row</span></th>
    {columns.map((column, index) => <td key={column.id} role="presentation" className="ts-cell">
      {column.field_type === "boolean" ? <select className="ts-text-input" data-entry-field={column.id} aria-label={`New row ${names[index]} (Yes/No)`} value={Object.hasOwn(values, column.id) ? values[column.id] ?? "" : ""} disabled={disabled} onChange={event => onChange(column.id, event.currentTarget.value)} onKeyDown={event => keyDown(event, index)}><option value="">Choose Yes/No</option><option value="true">Yes</option><option value="false">No</option></select> : <input className="ts-text-input" data-entry-field={column.id} aria-label={`New row ${names[index]} (${column.field_type === "number" ? "Number" : column.field_type === "date" ? "Date" : "Text"})`} aria-invalid={error?.fields?.includes(column.id) ? true : undefined} aria-describedby={error?.fields?.includes(column.id) ? "ts-row-error" : undefined} placeholder={column.field_type === "date" ? "YYYY-MM-DD" : undefined} value={Object.hasOwn(values, column.id) ? values[column.id] ?? "" : ""} disabled={disabled} onChange={event => onChange(column.id, event.currentTarget.value)} onKeyDown={event => keyDown(event, index)} />}
      {index === columns.length - 1 ? <div className="ts-entry-actions"><button type="button" className="ts-button ts-button--primary" disabled={disabled || needsReview || unsetBoolean} onClick={onAdd}>Add</button><button type="button" className="ts-button ts-button--ghost" disabled={disabled} onClick={onClear}>Clear</button>{needsReview ? <span className="ts-hint">Review the row, then clear this draft before adding another.</span> : null}</div> : null}
    </td>)}
  </tr>;
}
