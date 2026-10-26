import { useId, useRef, useState } from "react";
import type { FieldConstraint, FieldConstraintInput } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";
import { isComposingEvent } from "./composition-event.js";
import { columnRuleDraft, columnRuleInput, columnRuleSettlement } from "./column-rule.js";
import type { ColumnRuleDraft } from "./column-rule.js";
import { Modal } from "./Modal.js";

export function ColumnRuleDialogView({ columnName, draft, hasRule, pending, error, composing, onDraftChange, onSave, onRemove, onCancel }: {
  columnName: string;
  draft: ColumnRuleDraft;
  hasRule: boolean;
  pending: boolean;
  error: string | null;
  composing(): boolean;
  onDraftChange(draft: ColumnRuleDraft): void;
  onSave(): void;
  onRemove(): void;
  onCancel(): void;
}) {
  const id = useId();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const errorId = error !== null ? `${id}-error` : undefined;
  return <Modal label="Column rule" variant="save" onCancel={onCancel} dismissDisabled={pending}>
    <div onKeyDown={event => {
      if (draft.kind !== "range" || !(event.target instanceof HTMLInputElement)) return;
      // A composing Enter confirms an IME candidate, not this dialog.
      if (event.key !== "Enter" || isComposingEvent(event) || composing() || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      onSave();
    }}>
      <div className="ts-dialog-intro">
        <h2 className="ts-h2">Rule for “{columnName}”</h2>
        <p className="ts-subtle">{draft.kind === "list"
          ? "Only these values can be entered in this column. One value per line."
          : "Only numbers in this range can be entered in this column."}</p>
      </div>
      {draft.kind === "list" ? <div className="ts-dialog-field">
        <label className="ts-field-label" htmlFor={`${id}-values`}>Allowed values</label>
        <textarea id={`${id}-values`} className="ts-text-input" rows={5} data-autofocus="true" value={draft.values} readOnly={pending}
          aria-invalid={error !== null ? true : undefined} aria-describedby={errorId}
          onChange={event => onDraftChange({ ...draft, values: event.currentTarget.value })} />
      </div> : <>
        <div className="ts-dialog-field">
          <label className="ts-field-label" htmlFor={`${id}-min`}>Lowest value</label>
          <input ref={element => { inputRefs.current[0] = element; }} id={`${id}-min`} className="ts-text-input" inputMode="decimal" data-autofocus="true" value={draft.min} readOnly={pending}
            aria-invalid={error !== null ? true : undefined} aria-describedby={errorId}
            onChange={event => onDraftChange({ ...draft, min: event.currentTarget.value })} />
        </div>
        <div className="ts-dialog-field">
          <label className="ts-field-label" htmlFor={`${id}-max`}>Highest value</label>
          <input ref={element => { inputRefs.current[1] = element; }} id={`${id}-max`} className="ts-text-input" inputMode="decimal" value={draft.max} readOnly={pending}
            aria-invalid={error !== null ? true : undefined} aria-describedby={errorId}
            onChange={event => onDraftChange({ ...draft, max: event.currentTarget.value })} />
        </div>
      </>}
      {error !== null ? <p id={`${id}-error`} className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions">
        {hasRule ? <button type="button" className="ts-button" disabled={pending} onClick={onRemove}>Remove rule</button> : null}
        <button type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="ts-button ts-button--primary" disabled={pending} aria-busy={pending} onClick={() => { inputRefs.current[0]?.focus(); onSave(); }}>{pending ? "Working…" : "Save rule"}</button>
      </div>
    </div>
  </Modal>;
}

export function ColumnRuleDialog({ column, composing, onSubmit, onCancel, onSuccess }: {
  column: { display_name: string; field_type: string; constraint?: FieldConstraint };
  composing(): boolean;
  onSubmit(input: FieldConstraintInput): Promise<RowCommandOutcome>;
  onCancel(): void;
  /** `confirmed` is false for a recovery, whose outcome is unknown. */
  onSuccess(confirmed: boolean): void;
}) {
  const initialDraft = columnRuleDraft(column);
  const [draft, setDraft] = useState<ColumnRuleDraft | null>(initialDraft);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  if (draft === null) return null;

  async function submit(input: FieldConstraintInput) {
    if (pendingRef.current || composing()) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      // Work's refusal keeps the dialog and the current draft open.
      const settlement = columnRuleSettlement(await onSubmit(input));
      if (settlement.close) onSuccess(settlement.confirmed);
      else setError(settlement.error);
    } catch {
      // The request never produced an outcome (App reports unknown dispatch
      // outcomes as a recovery), so keep the draft and say it was not sent.
      setError("The rule could not be sent. Your entry is kept; try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function save() {
    const parsed = columnRuleInput(draft!);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    void submit(parsed.input);
  }

  return <ColumnRuleDialogView
    columnName={column.display_name}
    draft={draft}
    hasRule={column.constraint !== undefined}
    pending={pending}
    error={error}
    composing={composing}
    onDraftChange={next => { setError(null); setDraft(next); }}
    onSave={save}
    onRemove={() => void submit({ kind: "none" })}
    onCancel={onCancel}
  />;
}
