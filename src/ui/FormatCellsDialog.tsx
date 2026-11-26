import { useId, useRef, useState } from "react";
import type { CellStyleChange, NumberFormat } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";
import { columnFormatDraft, columnFormatInput } from "./column-format.js";
import { Modal } from "./Modal.js";

type Setting = "" | "on" | "off";

export function FormatCellsDialog({ numberFormat, numberUnavailable, numberColumnCount, composing, onStyles, onNumber, onCancel, onSuccess }: {
  numberFormat?: NumberFormat;
  numberUnavailable: string | null;
  numberColumnCount: number;
  composing(): boolean;
  onStyles(changes: CellStyleChange[]): Promise<RowCommandOutcome>;
  onNumber(format: NumberFormat | null): Promise<RowCommandOutcome>;
  onCancel(): void;
  onSuccess(confirmed: boolean): void;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bold, setBold] = useState<Setting>("");
  const [italic, setItalic] = useState<Setting>("");
  const [border, setBorder] = useState<Setting>("");
  const [fill, setFill] = useState<"" | "colour" | "none">("");
  const [color, setColor] = useState("#ffff00");
  const [number, setNumber] = useState(() => columnFormatDraft(numberFormat));

  async function apply(command: () => Promise<RowCommandOutcome>) {
    if (pendingRef.current || composing()) return;
    formRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await command();
      if (result.kind === "refused" && result.refusalCode !== "no_change") setError(result.message);
      else onSuccess(result.kind === "confirmed");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function saveStyles() {
    const changes: CellStyleChange[] = [];
    if (bold) changes.push({ kind: "bold", value: bold === "on" });
    if (italic) changes.push({ kind: "italic", value: italic === "on" });
    if (fill) changes.push({ kind: "fill", color: fill === "colour" ? color.toUpperCase() : null });
    if (border) changes.push({ kind: "border", target: "all", value: border === "on" });
    if (changes.length) void apply(() => onStyles(changes));
  }

  return <Modal label="Format Cells" variant="format-cells" onCancel={onCancel} dismissDisabled={pending}>
    <h2 className="ts-h2">Format Cells</h2>
    <form ref={formRef} onSubmit={event => { event.preventDefault(); saveStyles(); }}>
      <fieldset disabled={pending}>
        <legend>Cell styles</legend>
        <label>Bold <select data-autofocus value={bold} onChange={event => setBold(event.currentTarget.value as Setting)}>
          <option value="">Keep</option><option value="on">On</option><option value="off">Off</option>
        </select></label>
        <label>Italic <select value={italic} onChange={event => setItalic(event.currentTarget.value as Setting)}>
          <option value="">Keep</option><option value="on">On</option><option value="off">Off</option>
        </select></label>
        <label>Fill <select value={fill} onChange={event => setFill(event.currentTarget.value as typeof fill)}>
          <option value="">Keep</option><option value="colour">Set colour</option><option value="none">No fill</option>
        </select></label>
        {fill === "colour" ? <label>Fill colour <input type="color" value={color} onChange={event => setColor(event.currentTarget.value)} /></label> : null}
        <label>Borders <select value={border} onChange={event => setBorder(event.currentTarget.value as Setting)}>
          <option value="">Keep</option><option value="on">All borders</option><option value="off">No borders</option>
        </select></label>
        <button className="ts-button" type="submit" disabled={!bold && !italic && !fill && !border}>Apply styles</button>
      </fieldset>
    </form>
    <form noValidate onSubmit={event => {
      event.preventDefault();
      if (numberUnavailable) return;
      const parsed = columnFormatInput(number);
      if ("error" in parsed) setError(parsed.error);
      else void apply(() => onNumber(parsed.input));
    }}>
      <fieldset disabled={pending || numberUnavailable !== null} aria-describedby={numberUnavailable ? id : undefined}>
        <legend>Number format</legend>
        <label>Format <select value={number.type} onChange={event => setNumber({ ...number, type: event.currentTarget.value as typeof number.type })}>
          <option value="plain">Number</option><option value="percent">Percent</option><option value="currency">Currency</option>
        </select></label>
        {number.type === "currency" ? <label>Currency code <input value={number.code} onChange={event => setNumber({ ...number, code: event.currentTarget.value })} /></label> : null}
        <label>Decimal places <input type="number" min="0" max="10" value={number.decimals} onChange={event => setNumber({ ...number, decimals: event.currentTarget.value })} /></label>
        <label><input type="checkbox" checked={number.thousandsSeparator} onChange={event => setNumber({ ...number, thousandsSeparator: event.currentTarget.checked })} /> Thousands separator</label>
        <button className="ts-button" type="submit">Apply number format</button>
        {numberFormat ? <button className="ts-button" type="button" onClick={() => void apply(() => onNumber(null))}>Reset to default</button> : null}
      </fieldset>
      {numberUnavailable ? <p id={id} className="ts-subtle">{numberUnavailable}</p> : numberColumnCount > 1 ? <p className="ts-subtle">Undo restores one column at a time.</p> : null}
    </form>
    {error ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
    <div className="ts-dialog-actions"><button className="ts-button" type="button" disabled={pending} onClick={onCancel}>Cancel</button></div>
  </Modal>;
}
