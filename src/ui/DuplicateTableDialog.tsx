import { useEffect, useId, useRef, useState } from "react";
import type { RowCommandOutcome } from "../contracts.js";
import { isComposingEvent } from "./composition-event.js";
import { duplicateNameEnterAction, duplicateOutcomeSettlement, suggestedDuplicateName } from "./duplicate-table.js";
import { Modal } from "./Modal.js";

export function DuplicateTableDialogView({ name, pending, error, composing, onNameChange, onDuplicate, onCancel }: {
  name: string;
  pending: boolean;
  error: string | null;
  composing(): boolean;
  onNameChange(value: string): void;
  onDuplicate(): void;
  onCancel(): void;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  return <Modal label="Duplicate table" variant="save" onCancel={onCancel} dismissDisabled={pending}>
    <div onKeyDown={event => {
      if (!(event.target instanceof HTMLInputElement)) return;
      // A composing Enter confirms an IME candidate, not this dialog.
      const action = duplicateNameEnterAction({
        key: event.key,
        composing: isComposingEvent(event) || composing(),
        keyCode: event.nativeEvent.keyCode,
      });
      if (action !== "submit") return;
      event.preventDefault();
      onDuplicate();
    }}>
      <div className="ts-dialog-intro">
        <h2 className="ts-h2">Duplicate table</h2>
        <p className="ts-subtle">Work copies this table and its values into a new table. Nothing is saved until you choose Save a copy.</p>
      </div>
      <div className="ts-dialog-field">
        <label className="ts-field-label" htmlFor={`${id}-name`}>Table name</label>
        <input ref={nameRef} id={`${id}-name`} className="ts-text-input" data-autofocus="true" value={name} readOnly={pending}
          aria-invalid={error !== null ? true : undefined} aria-describedby={error !== null ? `${id}-error` : undefined}
          onChange={event => onNameChange(event.currentTarget.value)} />
      </div>
      {error !== null ? <p id={`${id}-error`} className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions">
        <button type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="ts-button ts-button--primary" disabled={pending} aria-busy={pending} onClick={() => { nameRef.current?.focus(); onDuplicate(); }}>{pending ? "Working…" : "Duplicate"}</button>
      </div>
    </div>
  </Modal>;
}

export function DuplicateTableDialog({ tableName, composing, onDuplicate, onCancel, onSuccess, onDraftChange }: {
  tableName: string;
  composing(): boolean;
  onDuplicate(name: string): Promise<RowCommandOutcome>;
  onCancel(): void;
  onSuccess(): void;
  onDraftChange(active: boolean): void;
}) {
  const initialName = suggestedDuplicateName(tableName);
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const draftActive = name !== initialName;
  useEffect(() => { onDraftChange(draftActive); }, [draftActive, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  async function duplicate() {
    if (pendingRef.current || composing()) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      // A refusal keeps this dialog and its name; nothing is retried here.
      const settlement = duplicateOutcomeSettlement(await onDuplicate(name));
      if (settlement.close) onSuccess();
      else setError(settlement.error);
    } catch {
      onCancel();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return <DuplicateTableDialogView
    name={name}
    pending={pending}
    error={error}
    composing={composing}
    onNameChange={value => { setError(null); setName(value); }}
    onDuplicate={() => void duplicate()}
    onCancel={onCancel}
  />;
}
