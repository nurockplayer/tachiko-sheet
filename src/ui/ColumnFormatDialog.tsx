import { useId, useRef, useState } from "react";
import type { NumberFormat } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";
import { formatNumberFor } from "./field-display.js";
import { columnFormatDraft, columnFormatInput, columnFormatSettlement } from "./column-format.js";
import type { ColumnFormatDraft } from "./column-format.js";
import { Modal } from "./Modal.js";

export function ColumnFormatDialog({ columnName, format, composing, onSubmit, onCancel, onSuccess }: {
  columnName: string; format?: NumberFormat; composing(): boolean;
  onSubmit(format: NumberFormat | null): Promise<RowCommandOutcome>;
  onCancel(): void; onSuccess(confirmed: boolean): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => columnFormatDraft(format));
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = error !== null ? `${id}-error` : undefined;
  const previewType = draft.type;
  const decimals = Number(draft.decimals);
  const preview: NumberFormat = {
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 10 ? decimals : 2,
    kind: previewType === "currency" ? { type: "currency", code: /^[A-Z]{3}$/.test(draft.code.toUpperCase()) ? draft.code.toUpperCase() : "USD" } : { type: previewType },
    thousands_separator: draft.thousandsSeparator,
  };
  async function submit(value: NumberFormat | null) {
    if (pendingRef.current || composing()) return;
    pendingRef.current = true; setPending(true); setError(null);
    try {
      const settlement = columnFormatSettlement(await onSubmit(value));
      if (settlement.close) onSuccess(settlement.confirmed); else setError(settlement.error);
    } catch {
      setError("The format could not be sent. Your entry is kept; try again.");
    } finally { pendingRef.current = false; setPending(false); }
  }
  function save() {
    const parsed = columnFormatInput(draft);
    if ("error" in parsed) { setError(parsed.error); return; }
    void submit(parsed.input);
  }
  return <Modal label="Number format" variant="save" onCancel={onCancel} dismissDisabled={pending}>
    <div>
      <div className="ts-dialog-intro"><h2 className="ts-h2">Format for “{columnName}”</h2></div>
      <div className="ts-dialog-field"><label className="ts-field-label" htmlFor={`${id}-type`}>Format</label>
        <select id={`${id}-type`} className="ts-text-input" data-autofocus="true" disabled={pending} value={draft.type} onChange={event => {setDraft({...draft,type:event.currentTarget.value as ColumnFormatDraft["type"]});setError(null);}}>
          <option value="plain">Number</option><option value="percent">Percent</option><option value="currency">Currency</option>
        </select>
      </div>
      {draft.type === "currency" ? <div className="ts-dialog-field"><label className="ts-field-label" htmlFor={`${id}-code`}>Currency code</label><input id={`${id}-code`} className="ts-text-input" value={draft.code} readOnly={pending} aria-invalid={error !== null ? true : undefined} aria-describedby={errorId} onChange={event => {setDraft({...draft,code:event.currentTarget.value});setError(null);}} /></div> : null}
      <div className="ts-dialog-field"><label className="ts-field-label" htmlFor={`${id}-decimals`}>Decimal places</label><input id={`${id}-decimals`} className="ts-text-input" type="number" min="0" max="10" step="1" value={draft.decimals} readOnly={pending} aria-invalid={error !== null ? true : undefined} aria-describedby={errorId} onChange={event => {setDraft({...draft,decimals:event.currentTarget.value});setError(null);}} /></div>
      <div className="ts-dialog-field"><label><input type="checkbox" checked={draft.thousandsSeparator} disabled={pending} onChange={event => setDraft({...draft,thousandsSeparator:event.currentTarget.checked})} /> Thousands separator</label></div>
      <p className="ts-subtle">Preview: {formatNumberFor(1234.5, preview)}</p>
      {error !== null ? <p id={`${id}-error`} className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions">
        {format ? <button type="button" className="ts-button" disabled={pending} onClick={() => void submit(null)}>Reset to default</button> : null}
        <button type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="ts-button ts-button--primary" disabled={pending} aria-busy={pending} onClick={save}>{pending ? "Working…" : "Save format"}</button>
      </div>
    </div>
  </Modal>;
}
