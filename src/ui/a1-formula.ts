import type { A1TranslationNote } from "../../public/core-kit/runtime/protocol.js";

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
    case "unsupported_function":
      return `${subject("That function")}isn't available. Formulas can use IF, AND, OR, NOT, ROUND, ISBLANK, MIN, MAX, and SUM, AVERAGE or COUNT over a whole column.`;
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
