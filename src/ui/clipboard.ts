/** Clipboard transport and grid geometry only; Work owns value validation. */
import type { PasteCellInput } from "../contracts.js";
import { nativeInsertionFits, nativeInsertionLimitReached } from "../runtime/native-insertion-limit.js";

export const NATIVE_INSERTION_LIMIT_MESSAGE = "This table has reached the 128-row limit for adding rows here.";
export interface CellAddress { row: number; column: number }
export interface CellRectangle { top: number; left: number; bottom: number; right: number }
export function rectangle(anchor: CellAddress, end: CellAddress): CellRectangle {
  return { top: Math.min(anchor.row, end.row), left: Math.min(anchor.column, end.column), bottom: Math.max(anchor.row, end.row), right: Math.max(anchor.column, end.column) };
}
export function stepAddress(at: CellAddress, key: string, rows: number, columns: number): CellAddress {
  return { row: Math.max(0, Math.min(rows - 1, at.row + (key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0))),
    column: Math.max(0, Math.min(columns - 1, at.column + (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0))) };
}
export function encodeTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row, index) => row.map(value => (/[\t\r\n"]/.test(value) || (index === rows.length - 1 && rows.length > 1 && row.length === 1 && value === "")) ? `"${value.replaceAll('"', '""')}"` : value).join("\t")).join("\n");
}
/** Work's native paste bound; larger blocks are refused before they are materialized. */
export const PASTE_MAX_ROWS = 128;
export const EDIT_CELLS_MAX = 1_024;
export const PASTE_MAX_CHARS = 1_048_576;
const TOO_MANY_ROWS = `The pasted block exceeds the ${PASTE_MAX_ROWS}-row limit. Nothing was pasted.`;
/** A plain-language refusal of the clipboard text itself; shown as written. */
export class ClipboardRefusal extends Error {}
export function decodeTsv(text: string, maxRows = PASTE_MAX_ROWS, maxChars = PASTE_MAX_CHARS): string[][] {
  if (text.length > maxChars) throw new ClipboardRefusal("The pasted text is too large to paste here. Nothing was pasted.");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false, start = true, endedRecord = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    endedRecord = false;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      if (!start || closed) throw new ClipboardRefusal("The pasted text has malformed quotes. Use a rectangular block of tab-separated cells.");
      quoted = true; start = false; continue;
    }
    if (ch === "\t" || ch === "\n" || ch === "\r") {
      row.push(field); field = ""; start = true; closed = false;
      if (ch !== "\t") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        rows.push(row); row = []; endedRecord = true;
        if (rows.length > maxRows) throw new ClipboardRefusal(TOO_MANY_ROWS);
      }
      continue;
    }
    if (closed) throw new ClipboardRefusal("The pasted text has malformed quotes. Use a rectangular block of tab-separated cells.");
    field += ch; start = false;
  }
  if (quoted) throw new ClipboardRefusal("The pasted text has an unfinished quote. Nothing was pasted.");
  // Ignore exactly one final record separator, not any deliberate blank rows.
  if (!endedRecord) { row.push(field); rows.push(row); }
  if (rows.length > maxRows) throw new ClipboardRefusal(TOO_MANY_ROWS);
  return rows;
}
export function clipboardBoolean(value: string, type: string): string {
  return type === "boolean" && /^(true|false)$/i.test(value) ? value.toLowerCase() : value;
}
export interface PasteContext {
  native: boolean; draft: boolean; blocked: boolean; pendingDraft: boolean;
  start: CellAddress; rowCount: number; columnTypes: readonly string[]; columnRequired: readonly boolean[];
  editable(row: number, column: number): boolean;
}
export type PasteRoute = { kind: "refused"; message: string } | { kind: "draft" | "edit"; rows: string[][] } | { kind: "publish"; rows: PasteCellInput[][] };
export function routePaste(rows: string[][], context: PasteContext): PasteRoute {
  const refuse = (message: string): PasteRoute => ({ kind: "refused", message });
  if (context.blocked) return refuse("Finish the current edit or operation before pasting.");
  if (context.pendingDraft && !context.draft) return refuse("Add or discard the new row first.");
  if (!rows.length || !rows[0]?.length || rows.some(row => row.length !== rows[0]!.length)) return refuse("The pasted rows have different widths. Copy a rectangular block; nothing was pasted.");
  const { row, column } = context.start, width = rows[0].length;
  if (row < 0 || column < 0) return refuse("Select a current cell before pasting.");
  if (column + width > context.columnTypes.length) return refuse("The pasted block is too wide for this table. Nothing was pasted.");
  if (!context.native && (context.draft || row + rows.length > context.rowCount)) return refuse("Imported tables can't gain rows by paste. Nothing was pasted.");
  const insideExistingRows = !context.draft && row + rows.length <= context.rowCount;
  if (insideExistingRows && rows.length * width > EDIT_CELLS_MAX) return refuse("The pasted block exceeds the 1,024-cell limit. Nothing was pasted.");
  if (!insideExistingRows && !nativeInsertionFits(context.rowCount, Math.max(1, row + rows.length - context.rowCount))) {
    return refuse(nativeInsertionLimitReached(context.rowCount) ? `${NATIVE_INSERTION_LIMIT_MESSAGE} Nothing was pasted.` : "Pasting would exceed the 128-row limit. Nothing was pasted.");
  }
  if (context.draft) {
    if (rows.length !== 1) return refuse("Paste one row into the new row. To paste several rows, select a table cell first.");
  } else {
    if (row + rows.length > context.rowCount && (column !== 0 || width !== context.columnTypes.length)) return refuse("To append rows, paste from the first column and include every column. Nothing was pasted.");
    for (let r = row; r < Math.min(context.rowCount, row + rows.length); r++) {
      for (let c = column; c < column + width; c++) {
        if (!context.editable(r, c)) return refuse("The pasted block includes a calculated or non-editable cell. Nothing was pasted.");
      }
    }
  }
  // edit_cells carries typed booleans, so only the clipboard's exact tokens
  // can be represented. Numeric/date parsing remains entirely with Work.
  // Native empty inputs are handled by the requiredness pre-check when the
  // caller shapes edits; never convert empty Boolean text to false.
  if (insideExistingRows && rows.some(values => values.some((value, i) => context.columnTypes[column + i] === "boolean" && !(context.native && value === "") && !/^(true|false)$/i.test(value)))) return refuse(pasteRefusal("", "boolean"));
  const normalized = rows.map(values => values.map((value, i) => clipboardBoolean(value, context.columnTypes[column + i]!)));
  if (context.draft || insideExistingRows) return { kind: context.draft ? "draft" : "edit", rows: normalized };
  // Work 375da29f protocol.d.ts PasteCellInput + ADR-0045 §3: raw strings
  // always set values; explicit clear expresses absence in paste_cells.
  // Only newly appended optional Text/Number slots get that blank intent.
  return { kind: "publish", rows: normalized.map((values, r) => values.map((value, c): PasteCellInput => {
    const type = context.columnTypes[column + c];
    return row + r >= context.rowCount && value === "" && context.columnRequired[column + c] === false && (type === "text" || type === "number")
      ? { kind: "clear" } : value;
  })) };

}
/** A type-only core refusal cannot reliably identify one cell in a block. */
export function pasteRefusal(message: string, fieldType?: string, refusalCode?: string): string {
  if (refusalCode === "request_too_large") return "The pasted text is too large to paste here. Nothing was pasted.";
  if (fieldType === "number") return "A pasted value needs a number, such as 12 or 12.5. Do not include currency symbols or thousands separators. Nothing was pasted.";
  if (fieldType === "date") return "A pasted value needs a date in YYYY-MM-DD format. Nothing was pasted.";
  if (fieldType === "boolean") return "A pasted Yes/No value must be true or false. Nothing was pasted.";
  return message;
}
