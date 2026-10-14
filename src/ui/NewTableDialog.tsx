import { useEffect, useId, useRef, useState } from "react";
import type { NewTableColumn } from "../contracts.js";
import { Modal } from "./Modal.js";

// Current pinned-core limit (Work #525); remove with that capability change.
const validName = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.trim());
function columnLetter(ordinal: number): string {
  let name = "";
  for (let n = ordinal; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}

export function NewTableDialog({ onCreate, onCancel, onSuccess, onDraftChange }: {
  onCreate(name: string, columns: NewTableColumn[]): Promise<boolean>;
  onCancel(): void;
  onSuccess(): void;
  onDraftChange(active: boolean): void;
}) {
  const id = useId();
  const serial = useRef(1);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<Array<NewTableColumn & { id: number }>>([{ id: 0, name: "A", field_type: "text" }]);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const draftActive = name !== "" || columns.length !== 1 ||
    columns[0]?.name !== "A" || columns[0]?.field_type !== "text";
  useEffect(() => { onDraftChange(draftActive); }, [draftActive, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  async function create() {
    if (pendingRef.current) return;
    if (!validName(name) || columns.some(column => !validName(column.name))) {
      setError("Enter a name for the table and every column, starting with a letter or number. Names can use letters, numbers, - and _.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      if (await onCreate(name, columns.map(({ name, field_type }) => ({ name, field_type })))) onSuccess();
      else setError("The table could not be opened. Check the current work status before trying again.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The table could not be created."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <Modal label="New table" variant="save" onCancel={onCancel} dismissDisabled={pending}>
    <div className="ts-dialog-intro"><h2 className="ts-h2">New table</h2><p className="ts-subtle">Choose a name and columns for your table. Nothing is saved until you choose Save a copy.</p></div>
    <div className="ts-dialog-field"><label className="ts-field-label" htmlFor={`${id}-name`}>Table name</label><input id={`${id}-name`} className="ts-text-input" data-autofocus="true" value={name} readOnly={pending} aria-invalid={name !== "" && !validName(name) ? true : undefined} aria-describedby={`${id}-name-hint`} onChange={event => { setError(null); setName(event.currentTarget.value); }} /></div>
    <p id={`${id}-name-hint`} className="ts-hint">Names can use letters, numbers, - and _.</p>
    <div className="ts-dialog-scroll ts-new-columns" aria-label="Columns">
      {columns.map((column, index) => <div key={column.id} className="ts-new-column">
        <label className="ts-dialog-field"><span className="ts-field-label">Column {index + 1} name</span><input className="ts-text-input" value={column.name} readOnly={pending} aria-invalid={!validName(column.name) ? true : undefined} aria-describedby={`${id}-name-hint`} onChange={event => { const value = event.currentTarget.value; setError(null); setColumns(current => current.map(item => item.id === column.id ? { ...item, name: value } : item)); }} /></label>
        <label className="ts-dialog-field"><span className="ts-field-label">Column {index + 1} type</span><select className="ts-text-input" aria-label={`Column ${index + 1} type`} value={column.field_type} disabled={pending} onChange={event => { const value = event.currentTarget.value as NewTableColumn["field_type"]; setError(null); setColumns(current => current.map(item => item.id === column.id ? { ...item, field_type: value } : item)); }}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes/No</option></select></label>
        <button className="ts-button" type="button" aria-label={`Remove column ${index + 1}`} disabled={pending || columns.length === 1} onClick={() => { setError(null); setColumns(current => current.filter(item => item.id !== column.id)); }}>Remove</button>
      </div>)}
      <button type="button" className="ts-button" disabled={pending} onClick={() => { const next = serial.current++; setError(null); setColumns(current => {
        let ordinal = 1;
        while (current.some(column => column.name.trim().toUpperCase() === columnLetter(ordinal))) ordinal += 1;
        return [...current, { id: next, name: columnLetter(ordinal), field_type: "text" }];
      }); }}>Add column</button>
    </div>
    {error ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
    <div className="ts-dialog-actions"><button type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="ts-button ts-button--primary" disabled={pending} aria-busy={pending} onClick={() => void create()}>{pending ? "Working…" : "Create table"}</button></div>
  </Modal>;
}
