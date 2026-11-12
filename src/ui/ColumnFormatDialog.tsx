import { useId, useRef, useState } from "react";
import type { DateFormat, NumberFormat } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";
import { formatNumberFor } from "./field-display.js";
import { columnFormatDraft, columnFormatInput, columnFormatSettlement } from "./column-format.js";
import type { ColumnFormatDraft } from "./column-format.js";
import { Modal } from "./Modal.js";

export function ColumnFormatDialog({ columnName, format, dateFormat, composing, onSubmit, onSubmitDate, onCancel, onSuccess }: {
  columnName: string; format?: NumberFormat; dateFormat?: DateFormat; composing(): boolean;
  onSubmitDate?(format: DateFormat | null): Promise<RowCommandOutcome>;
  onSubmit(format: NumberFormat | null): Promise<RowCommandOutcome>;
  onCancel(): void; onSuccess(confirmed: boolean): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => columnFormatDraft(format));
  const [dateDraft, setDateDraft] = useState<DateFormat>(dateFormat ?? "iso");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const decimalsRef = useRef<HTMLInputElement | null>(null);
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
    // Disabling the activated button would drop focus to the page; keep it in the
    // dialog on the read-only decimals field, as the rule dialog does for Save.
    decimalsRef.current?.focus();
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
  if (dateFormat !== undefined) {
    const choices: Array<[DateFormat, string]> = [["iso", "2026-11-07"], ["ymd_slash", "2026/11/7"], ["ymd_cjk", "2026年11月7日"], ["mdy", "11/7/2026"], ["dmy", "7/11/2026"], ["month_day_year", "Nov 7, 2026"], ["day_month_year", "7 Nov 2026"]];
    const saveDate = async () => {
      if (pendingRef.current || composing()) return;
      if (dateDraft === dateFormat) { onSuccess(false); return; }
      pendingRef.current = true; setPending(true); setError(null);
      try {
        const result = await onSubmitDate!(dateDraft === "iso" ? null : dateDraft);
        if (result.kind === "refused" && result.refusalCode === "no_change") onSuccess(false);
        else if (result.kind === "refused") setError(result.refusalCode === "invalid_number_format" ? "Date formats are available for Date columns. Nothing was changed." : result.message);
        else onSuccess(result.kind === "confirmed");
      } catch { setError("The format could not be sent. Your entry is kept; try again."); }
      finally { pendingRef.current = false; setPending(false); }
    };
    return <Modal label="Date format" variant="save" onCancel={onCancel} dismissDisabled={pending}>
      <div className="ts-dialog-intro"><h2 className="ts-h2">Format for “{columnName}”</h2></div>
      <fieldset className="ts-dialog-field"><legend>Format</legend>{choices.map(([value, label]) => <label key={value} style={{display: "block"}}><input type="radio" name={id} value={value} checked={dateDraft === value} disabled={pending} onChange={() => { setDateDraft(value); setError(null); }} /> {label}</label>)}</fieldset>
      {error !== null ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
      <div className="ts-dialog-actions"><button type="button" className="ts-button" disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="ts-button ts-button--primary" disabled={pending} onClick={() => void saveDate()}>Save format</button></div>
    </Modal>;
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
      <div className="ts-dialog-field"><label className="ts-field-label" htmlFor={`${id}-decimals`}>Decimal places</label><input ref={decimalsRef} id={`${id}-decimals`} className="ts-text-input" type="number" min="0" max="10" step="1" value={draft.decimals} readOnly={pending} aria-invalid={error !== null ? true : undefined} aria-describedby={errorId} onChange={event => {setDraft({...draft,decimals:event.currentTarget.value});setError(null);}} /></div>
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
