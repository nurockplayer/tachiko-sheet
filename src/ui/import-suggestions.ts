import type { SourceCell, SourceValue } from "../../public/core-kit/runtime/interop-protocol.js";

export type ImportColumnType = "text" | "number" | "boolean" | "date";

// Plain decimal numbers only, and only when the text is exactly how the
// number prints back (so 4.50, -0, 0.0000001 and over-long values that would
// round stay Text). Leading zeros (IDs, postcodes), exponents and grouping
// separators stay Text so no identifier is silently reinterpreted.
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const MAX_SIGNIFICANT_DIGITS = 15;
// The pinned kit admits more than this many data rows only as an all-Text
// capacity table, so larger sources are never pre-set to Number.
export const MAX_TYPED_IMPORT_ROWS = 64;

function losslessNumberText(text: string): boolean {
  if (!PLAIN_NUMBER.test(text)) return false;
  if (text.replace(/^-/, "").replace(".", "").replace(/^0+/, "").length > MAX_SIGNIFICANT_DIGITS) return false;
  return String(Number(text)) === text;
}

/**
 * Advisory type for one source column. Only Number is ever suggested; the
 * user still confirms it, and the core remains the parser and validator.
 */
export function suggestColumnType(rows: readonly SourceCell[][], column: number): ImportColumnType {
  if (rows.length > MAX_TYPED_IMPORT_ROWS) return "text";
  let seen = 0;
  for (const row of rows) {
    const value = row[column]?.value;
    if (!value || value.kind === "empty") continue;
    if (value.kind === "number") {
      if (!Number.isFinite(value.value) || Object.is(value.value, -0)) return "text";
    } else if (value.kind !== "text" || !losslessNumberText(value.value)) {
      return "text";
    }
    seen++;
  }
  return seen > 0 ? "number" : "text";
}

export function sourcePreviewText(value: SourceValue | undefined): string {
  if (!value || value.kind === "empty") return "";
  if (value.kind === "boolean") return value.value ? "TRUE" : "FALSE";
  return String(value.value);
}

const BEYOND_LIMITS = /Text capacity requires|capacity requires|exceeds 8,406|row exceeds 8,406|CSV exceeds|exceeds .*(row|column) bounds/i;
const DAMAGED = /unclosed quoted field|Missing ZIP|invalid ZIP|not a valid|malformed|truncated/i;

/** Plain-language inspection refusal; the producer's detail stays visible. */
export function importRefusalMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.length > 0 ? error.message : "";
  const lead = BEYOND_LIMITS.test(detail)
    ? "This file is outside what this beta can open: up to 64 rows and 16 columns, or up to 8,406 rows when it is one sheet with exactly 3 plain text columns."
    : DAMAGED.test(detail)
      ? "This file could not be read. It may be damaged, or not a valid CSV or Excel (.xlsx) file."
      : "The spreadsheet could not be inspected.";
  return detail ? `${lead} Nothing was imported. (Details: ${detail})` : `${lead} Nothing was imported.`;
}

/**
 * The person's column types for one import inspection. A choice belongs to
 * the exact suggestions it was made from, so a newer inspection never shows
 * or submits types chosen for an earlier one, and the first render already
 * uses the current suggestions.
 */
export interface ImportTypeChoice {
  readonly basis: readonly (readonly string[])[];
  readonly types: string[][];
}

export function chosenImportTypes(choice: ImportTypeChoice | null, suggestions: string[][]): string[][] {
  return choice !== null && choice.basis === suggestions ? choice.types : suggestions;
}

export function chooseImportType(
  choice: ImportTypeChoice | null,
  suggestions: string[][],
  sheet: number,
  column: number,
  type: string,
): ImportTypeChoice {
  const current = chosenImportTypes(choice, suggestions);
  return {
    basis: suggestions,
    types: current.map((types, index) => index !== sheet ? types : types.map((value, index2) => index2 === column ? type : value)),
  };
}
