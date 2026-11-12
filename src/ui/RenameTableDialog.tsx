import { useEffect, useId, useRef, useState } from "react";
import type { RowCommandOutcome } from "../contracts.js";
import { duplicateOutcomeSettlement } from "./duplicate-table.js";
import { Modal } from "./Modal.js";

export function RenameTableDialog({ initialName, composing, onRename, onClose, onDraftChange }: {
  initialName: string;
  composing(): boolean;
  onRename(name: string): Promise<RowCommandOutcome>;
  onClose(): void;
  onDraftChange(active: boolean): void;
}) {
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { input.current?.select(); }, []);
  async function submit() {
    if (pendingRef.current || composing()) return;
    if (name === initialName) { onClose(); return; }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = duplicateOutcomeSettlement(await onRename(name));
      if (result.close) onClose(); else setError(result.error);
    } catch { onClose(); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <Modal label="Rename table" variant="save" onCancel={onClose} dismissDisabled={pending}>
    <form onSubmit={event => { event.preventDefault(); if (!composing()) void submit(); }}>
      <div className="ts-dialog-intro"><h2 className="ts-h2">Rename table</h2></div>
      <div className="ts-dialog-field">
        <label className="ts-field-label" htmlFor={id}>Table name</label>
        <input ref={input} id={id} data-autofocus="true" className="ts-text-input" value={name} readOnly={pending}
          aria-invalid={error !== null || undefined} aria-describedby={error ? `${id}-error` : undefined}
          onChange={event => { setName(event.currentTarget.value); onDraftChange(event.currentTarget.value !== initialName); setError(null); }} />
      </div>
      {error ? <p id={`${id}-error`} className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions">
        <button type="button" className="ts-button" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" className="ts-button ts-button--primary" disabled={pending}>{pending ? "Working…" : "Rename"}</button>
      </div>
    </form>
  </Modal>;
}
