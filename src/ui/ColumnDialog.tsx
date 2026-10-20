import { useId, useRef, useState } from "react";
import type { RowCommandOutcome } from "../contracts.js";
import { supportsOptional, REQUIRED_HELP, REQUIRED_TYPE_NOTE } from "./column-requiredness.js";
import { Modal } from "./Modal.js";
import { isComposingEvent } from "./composition-event.js";
import { columnRefusal, fillChoiceRequired, initialColumnDraft, type ColumnDialogState, type ColumnDraft } from "./column-operations.js";

export function ColumnDialog({ state, onSubmit, onCancel, onComplete, composing }: {
  state: ColumnDialogState;
  onSubmit(draft: ColumnDraft): Promise<RowCommandOutcome>;
  onCancel(): void;
  onComplete(confirmed: boolean, focusInside: boolean): void;
  composing(): boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => initialColumnDraft(state));
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const title = state.kind === "add" ? "Add column" : state.kind === "rename" ? "Rename column" : "Remove column";
  function change(update: Partial<ColumnDraft>) { setDraft(current => ({ ...current, ...update })); setError(null); }
  const required = !supportsOptional(draft.fieldType) || draft.required === true;
  const needsFill = required || draft.fillExisting === true;
  async function submit() {
    if (pendingRef.current || composing()) return;
    if (state.kind === "add" && needsFill && fillChoiceRequired(draft.fieldType, state.rowEntities.length, draft.fill)) {
      setError("Choose a fill value for every existing row before adding this column."); return;
    }
    pendingRef.current = true;
    if (state.kind === "remove") cancelRef.current?.closest<HTMLElement>(".ts-modal")?.focus();
    else nameRef.current?.focus();
    setPending(true); setError(null);
    try {
      const result = await onSubmit(draft);
      if (result.kind === "refused") setError(columnRefusal(result.message, result.fieldType));
      else onComplete(result.kind === "confirmed", Boolean(cancelRef.current?.closest(".ts-modal")?.contains(document.activeElement)));
    } catch {
      // A thrown transport/application outcome is never a retryable refusal.
      onComplete(false, false);
    } finally { pendingRef.current = false; setPending(false); }
  }
  return <Modal label={title} variant={state.kind === "remove" ? "close" : "save"} dismissDisabled={pending} onCancel={onCancel}>
    <div onKeyDown={event => {
      if (event.key === "Enter" && !isComposingEvent(event) && !composing() && event.target instanceof HTMLInputElement && event.target.type !== "checkbox") {
        event.preventDefault(); void submit();
      }
    }}>
      <div className="ts-dialog-intro"><h2 className="ts-h2">{title}</h2>
        <p className="ts-subtle">{state.kind === "remove" ? `Remove “${state.name}” and its values from ${state.rowEntities.length} existing ${state.rowEntities.length === 1 ? "row" : "rows"}? One Undo restores the column and its values.` : "Update this table. Nothing is saved until you choose Save."}</p></div>
      {state.kind !== "remove" ? <label className="ts-dialog-field"><span className="ts-field-label">Column name</span><input ref={nameRef} className="ts-text-input" data-autofocus="true" value={draft.name} readOnly={pending} onChange={event => change({ name: event.currentTarget.value })} /></label> : null}
      {state.kind === "add" ? <>
        <label className="ts-dialog-field"><span className="ts-field-label">Column type</span><select aria-label="Column type" aria-describedby={!supportsOptional(draft.fieldType) ? `${id}-type` : undefined} className="ts-text-input" value={draft.fieldType} disabled={pending} onChange={event => change({ fieldType: event.currentTarget.value as ColumnDraft["fieldType"], fill: "" })}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Yes/No</option></select></label>
        {supportsOptional(draft.fieldType) ? <div className="ts-dialog-field">
          <label><input type="checkbox" checked={draft.required === true} disabled={pending} aria-describedby={`${id}-required`} onChange={event => change({ required: event.currentTarget.checked })} /> Required</label>
          <p className="ts-hint" id={`${id}-required`}>{REQUIRED_HELP}</p>
        </div> : <p id={`${id}-type`} className="ts-hint" role="note">{REQUIRED_TYPE_NOTE}</p>}
        {state.rowEntities.length > 0 && !required ? <div className="ts-dialog-field">
          <p id={`${id}-blank`} className="ts-hint">Existing rows start blank</p>
          <label><input type="checkbox" checked={draft.fillExisting === true} disabled={pending} aria-describedby={`${id}-blank`} onChange={event => change({ fillExisting: event.currentTarget.checked })} /> Fill existing rows</label>
        </div> : null}
        {state.rowEntities.length > 0 && needsFill ? <><label className="ts-dialog-field"><span className="ts-field-label">Fill all {state.rowEntities.length} existing rows with…</span>{draft.fieldType === "boolean" ? <select className="ts-text-input" value={draft.fill} disabled={pending} onChange={event => change({ fill: event.currentTarget.value })}><option value="">Choose Yes or No</option><option value="yes">Yes</option><option value="no">No</option></select> : <input className="ts-text-input" value={draft.fill} readOnly={pending} placeholder={draft.fieldType === "date" ? "YYYY-MM-DD" : undefined} onChange={event => change({ fill: event.currentTarget.value })} />}</label>
          <p className="ts-hint">{draft.fieldType === "text" ? "An empty fill sets every existing row to empty text. " : "Choose the fill value explicitly. "}This sets existing rows only; it is not a default for future rows.</p></> : null}
      </> : null}
      {error ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions"><button ref={cancelRef} data-autofocus={state.kind === "remove" ? true : undefined} type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="ts-button ts-button--primary" disabled={pending} aria-busy={pending} onClick={() => void submit()}>{pending ? "Working…" : title}</button></div>
    </div>
  </Modal>;
}
