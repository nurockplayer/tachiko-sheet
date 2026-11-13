import { useRef, useState } from "react";
import type { RowCommandOutcome } from "../contracts.js";
import { Modal } from "./Modal.js";
import { tableRefusal } from "./table-refusals.js";

export function DeleteTableDialog({ name, onDelete, onClose }: {
  name: string;
  onDelete(): Promise<RowCommandOutcome>;
  onClose(): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  async function submit() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onDelete();
      if (result.kind === "refused") setError(tableRefusal(result));
      else onClose();
    } catch { onClose(); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <Modal label="Delete sheet" variant="save" onCancel={onClose} dismissDisabled={pending}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="ts-dialog-intro"><h2 className="ts-h2">Delete sheet</h2></div>
      <p>Delete sheet “{name}” and all its rows? You can undo this while this work is open.</p>
      {error ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions">
        <button type="button" data-autofocus="true" className="ts-button" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" className="ts-button ts-button--primary" disabled={pending}>Delete sheet</button>
      </div>
    </form>
  </Modal>;
}
