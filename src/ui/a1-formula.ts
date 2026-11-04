import type { A1TranslationNote } from "../../public/core-kit/runtime/protocol.js";

/** Work's readable translation of one Excel A1 formula, and the text it came from. */
export interface A1TranslationPreview {
  typed: string;
  source: string;
  notes: A1TranslationNote[];
}

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

/** Whether a translation differs from the typed text, so it needs confirmation. */
export function a1TranslationNeedsPreview(
  text: string,
  outcome: { source: string; notes: readonly A1TranslationNote[] },
): boolean {
  return outcome.source !== text.trim() || outcome.notes.length > 0;
}

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
