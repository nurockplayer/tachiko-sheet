import { useId, useRef, useState } from "react";
import type { CellAlignment } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";
import { Modal } from "./Modal.js";

export function ColumnAlignmentDialog({ columnName, alignment, composing, onSubmit, onCancel, onSuccess }: {
  columnName: string; alignment: CellAlignment | null; composing(): boolean;
  onSubmit(value: CellAlignment | null): Promise<RowCommandOutcome>;
  onCancel(): void; onSuccess(confirmed: boolean): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<CellAlignment | null>(alignment);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const focusRef = useRef<HTMLHeadingElement>(null);
  const selectedRef = useRef<HTMLInputElement>(null);
  const choices: Array<[CellAlignment | null, string]> = [[null, "Default (by type)"], ["left", "Left"], ["center", "Center"], ["right", "Right"]];
  async function save() {
    if (pendingRef.current || composing()) return;
    if (draft === alignment) { onSuccess(false); return; }
    focusRef.current?.focus();
    pendingRef.current = true; setPending(true); setError(null);
    let restoreFocus = false;
    try {
      const result = await onSubmit(draft);
      if (result.kind === "refused" && result.refusalCode === "no_change") onSuccess(false);
      else if (result.kind === "refused") { setError(result.message); restoreFocus = true; }
      else onSuccess(result.kind === "confirmed");
    } catch {
      setError("The alignment could not be sent. Your choice is kept; try again.");
      restoreFocus = true;
    } finally {
      pendingRef.current = false; setPending(false);
      if (restoreFocus) requestAnimationFrame(() => selectedRef.current?.focus());
    }
  }
  return <Modal label="Column alignment" variant="save" onCancel={onCancel} dismissDisabled={pending}>
    <div className="ts-dialog-intro"><h2 ref={focusRef} tabIndex={-1} className="ts-h2">Alignment for “{columnName}”</h2></div>
    <fieldset className="ts-dialog-field"><legend>Alignment</legend>{choices.map(([value, label]) => <label key={label} style={{ display: "block" }}><input ref={draft === value ? selectedRef : undefined} data-autofocus={alignment === value ? "true" : undefined} type="radio" name={id} checked={draft === value} disabled={pending} onChange={() => { setDraft(value); setError(null); }} /> {label}</label>)}</fieldset>
    {error !== null ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
    <div className="ts-dialog-actions"><button type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="ts-button ts-button--primary" disabled={pending} aria-busy={pending} onClick={() => void save()}>{pending ? "Working…" : "Save alignment"}</button></div>
  </Modal>;
}
