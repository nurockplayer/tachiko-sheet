import type { A1TranslationNote } from "../../public/core-kit/runtime/protocol.js";
import { A1_HEADER_ROW } from "./a1-geometry.js";

/**
 * Tachiko references are always bracketed (`[.field]`), so any text without a
 * `[` is Excel's A1 syntax and needs Work's read-only translation first.
 */
export function isTachikoFormulaSource(text: string): boolean {
  return text.includes("[");
}

/**
 * Map Work's half-open UTF-8 byte span onto this string's UTF-16 indices, so
 * the bar can select exactly the offending text. An offset inside a character
 * clamps to that character's start; past the end clamps to the string length.
 */
export function utf8SpanToUtf16(text: string, span: { start: number; end: number }): [number, number] {
  const encoder = new TextEncoder();
  const toIndex = (byte: number): number => {
    if (byte <= 0) return 0;
    let used = 0;
    let index = 0;
    for (const character of text) {
      const next = used + encoder.encode(character).length;
      if (byte < next) return index;
      if (byte === next) return index + character.length;
      used = next;
      index += character.length;
    }
    return text.length;
  };
  const start = toIndex(span.start);
  return [start, Math.max(start, toIndex(span.end))];
}

/** Work's notes as one line, or nothing when the formula has none. */
export function a1NoteText(notes: readonly A1TranslationNote[]): string | null {
  return notes.length ? notes.map((note) => A1_NOTE_TEXT[note]).join(" ") : null;
}

/**
 * Whether an in-cell translation still belongs to the cell, text, focus and
 * editor instance it was requested for. Typing, moving focus to another cell,
 * a changed revision, cancelling and retyping the same text, or closing the
 * editor while Work reads makes the pending answer obsolete.
 */
export function a1EditorStillCurrent(
  expected: { entity: string; field: string; value: string; identity: string; instance: number },
  live: {
    editor: { entity: string; field: string; value: string; instance: number } | null;
    focus: { entity: string; field: string } | null;
    identity: string;
  },
): boolean {
  return live.editor !== null && live.focus !== null &&
    live.editor.entity === expected.entity && live.editor.field === expected.field &&
    live.editor.value === expected.value && live.editor.instance === expected.instance &&
    live.focus.entity === expected.entity && live.focus.field === expected.field &&
    live.identity === expected.identity;
}

/** The A1 row numbers the text names outside string literals, and whether it has a range. */
export function a1References(text: string): { rows: number[]; range: boolean } {
  const outsideStrings = text.replace(/"(?:[^"]|"")*"?/g, '""');
  const rows = [...outsideStrings.matchAll(/(?<![\p{L}\p{N}_.])\$?[A-Za-z]{1,3}\$?(\d+)(?![\p{L}\p{N}_(])/gu)].map((match) => Number(match[1]));
  return { rows, range: outsideStrings.includes(":") };
}

/** A1 column letters as a 0-based index: "A" → 0, "Z" → 25, "AA" → 26. */
export function a1ColumnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

// A cell address that is a whole token: not the tail of a longer name (LOG10,
// Amount*2) and not the name of a function (SUM(), LOG10()).
const A1_CELL_START = String.raw`(?<![\p{L}\p{N}_.!])\$?([A-Za-z]{1,3})\$?(\d+)`;
const A1_CELL_END = String.raw`(?![\p{L}\p{N}_(])`;
const A1_ONE_CELL = new RegExp(`${A1_CELL_START}${A1_CELL_END}`, "gu");
const A1_CELL_RANGE = new RegExp(`${A1_CELL_START}:\\$?([A-Za-z]{1,3})\\$?(\\d+)${A1_CELL_END}`, "gu");
// A name followed by `!` refers to another sheet's cell (or range), which this
// sheet can't outline: `Items!B3`, `'My items'!B3`, `Items!B3:D4`.
const A1_OTHER_SHEET = /(?:'(?:[^']|'')*'|[\p{L}_][\p{L}\p{N}_.]*)![^\s+\-*/^&<>=,();]*/gu;

/**
 * The cells a formula drafts refers to, as A1 rectangles: 1-based rows and
 * 0-based columns, one per address, with a reversed range (D4:B2) put in order.
 * A quoted "B2" is literal text, another sheet's cells and whole columns (B:B)
 * are not this grid's, and neither is an address outside it (A0).
 */
export function a1ReferencedRanges(text: string): { top: number; bottom: number; left: number; right: number }[] {
  if (!text.trimStart().startsWith("=")) return [];
  const blank = (matched: string): string => " ".repeat(matched.length);
  // Strings first, so their contents never read as addresses, then the cells
  // of other sheets, wherever they sit in the formula.
  const source = text.replace(/"(?:[^"]|"")*"?/g, blank).replace(A1_OTHER_SHEET, blank);
  const ranges: { top: number; bottom: number; left: number; right: number }[] = [];
  const rectangleOf = (match: RegExpMatchArray): { top: number; bottom: number; left: number; right: number } | null => {
    const [firstRow, secondRow] = [Number(match[2]), Number(match[4])];
    if (firstRow < 1 || secondRow < 1) return null;
    return {
      top: Math.min(firstRow, secondRow), bottom: Math.max(firstRow, secondRow),
      left: Math.min(a1ColumnIndex(match[1]), a1ColumnIndex(match[3])),
      right: Math.max(a1ColumnIndex(match[1]), a1ColumnIndex(match[3])),
    };
  };
  for (const match of source.matchAll(A1_CELL_RANGE)) {
    const rectangle = rectangleOf(match);
    if (rectangle) ranges.push(rectangle);
  }
  // A range is one reference; its endpoints must not also outline alone.
  for (const match of source.replace(A1_CELL_RANGE, blank).matchAll(A1_ONE_CELL)) {
    const row = Number(match[2]);
    if (row < 1) continue;
    const column = a1ColumnIndex(match[1]);
    ranges.push({ top: row, bottom: row, left: column, right: column });
  }
  return ranges;
}

/** A rectangle of displayed cells (0-based rows and columns) and the range's two ends. */
export interface A1GoToTarget {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** The rectangle's first address: the range's active cell. */
  anchor: { row: number; column: number };
  end: { row: number; column: number };
}

const A1_GOTO = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/u;

/**
 * The displayed cells a Name Box entry names: one address (`C3`, `$C$3`, `c3`)
 * or one `address:address` range, in 0-based display positions. The range keeps
 * its first address as the anchor even when it is reversed. Null when the text
 * is not exactly an address or range, or names a cell outside the grid; the
 * header row (A1) is not a cell.
 */
export function a1GoToTarget(text: string, rowCount: number, columnCount: number): A1GoToTarget | null {
  const match = A1_GOTO.exec(text.trim());
  if (!match) return null;
  const first = { column: a1ColumnIndex(match[1]!), row: Number(match[2]) - A1_HEADER_ROW - 1 };
  const last = match[3] !== undefined
    ? { column: a1ColumnIndex(match[3]), row: Number(match[4]!) - A1_HEADER_ROW - 1 }
    : first;
  const inBounds = (cell: { row: number; column: number }): boolean =>
    cell.row >= 0 && cell.row < rowCount && cell.column >= 0 && cell.column < columnCount;
  if (!inBounds(first) || !inBounds(last)) return null;
  return {
    top: Math.min(first.row, last.row),
    bottom: Math.max(first.row, last.row),
    left: Math.min(first.column, last.column),
    right: Math.max(first.column, last.column),
    anchor: first,
    end: last,
  };
}

export const A1_TOO_MANY_ROWS = "This formula's cell references span too many rows for a table this large. Use references closer to this row; ranges over a whole column need a smaller table for now.";

/** Work's notes in plain words; the sheet never re-derives their meaning. */
export const A1_NOTE_TEXT: Record<A1TranslationNote, string> = {
  relative_copy_semantics_changed: "A reference to another row now points at that exact row. Copying this formula to other rows will not move it the way Excel does.",
  range_tracks_collection: "SUM, AVERAGE or COUNT over the whole column now covers the entire column, including rows added later.",
};

/**
 * One line saying what Work refused, quoting the offending text when its span
 * names something. Anything the sheet does not name falls back to Work's own
 * message verbatim.
 */
export function a1RefusalText(input: {
  code: string;
  message: string;
  spanText: string;
  /** The last displayed data row's A1 number. */
  lastRow: number;
  /** The last column's A1 letter. */
  lastColumn: string;
}): string {
  // Work quotes the offending text only when its span names something; the
  // sentence still needs a subject, which never starts with a stray space.
  const subject = (fallback: string) => `${input.spanText ? `“${input.spanText}”` : fallback} `;
  switch (input.code) {
    case "out_of_bounds":
      return `${subject("This cell reference")}is outside the table: it has rows 2–${input.lastRow} and columns A–${input.lastColumn}.`;
    case "header_reference":
      return `${subject("That reference")}is the row of column names. Refer to a data row (2–${input.lastRow}).`;
    case "unsupported_range":
      return `${subject("That range")}isn't supported: SUM, AVERAGE and COUNT work only over a whole column (for example B2:B${input.lastRow}) while no filter hides rows.`;
    case "unsupported_criterion":
      return `${subject("That condition")}isn't supported. Use a written number, a blank condition, or a cell reference in SUMIF, SUMIFS, AVERAGEIF, AVERAGEIFS, COUNTIF or COUNTIFS.`;
    case "unsupported_function":
      return `${subject("That function")}isn't available. Formulas can use IF, AND, OR, NOT, ROUND, ISBLANK, MIN, MAX, SUM, AVERAGE or COUNT over a whole column, and SUMIF, SUMIFS, AVERAGEIF, AVERAGEIFS, COUNTIF or COUNTIFS over whole columns.`;
    case "unsupported_operator":
      return `${subject("That operator")}isn't supported in formulas.`;
    case "unknown_sheet":
      return `${subject("That reference")}refers to another table. References to other tables aren't available yet.`;
    case "formula_syntax":
      return input.spanText ? `The formula can't be read near “${input.spanText}”.` : "The formula can't be read.";
    case "formula_type_mismatch":
      return ["This column can't hold the result of this formula.", input.message].filter(Boolean).join(" ");
    case "formula_cycle":
      return "This formula would depend on its own result.";
    case "invalid_geometry":
      return "To use cell references like B3, show this row first: clear the filter and try again.";
    case "stale_revision":
      return "The table changed while the formula was checked. Press Enter to check it again.";
    default:
      return input.message;
  }
}
