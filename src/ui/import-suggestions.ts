import type { SourceCell, SourceValue } from "../../public/core-kit/runtime/interop-protocol.js";

export type ImportColumnType = "text" | "number" | "boolean" | "date";

// Plain decimal numbers only. Leading zeros (IDs, postcodes), more than 15
// significant digits (phone/account numbers), exponents and grouping
// separators stay Text so no identifier is silently reinterpreted.
const PLAIN_NUMBER = /^-?(0|[1-9]\d{0,14})(\.\d{1,15})?$/;

/**
 * Advisory type for one source column. Only Number is ever suggested; the
 * user still confirms it, and the core remains the parser and validator.
 */
export function suggestColumnType(rows: readonly SourceCell[][], column: number): ImportColumnType {
  let seen = 0;
  for (const row of rows) {
    const value = row[column]?.value;
    if (!value || value.kind === "empty") continue;
    if (value.kind === "number") {
      if (!Number.isFinite(value.value)) return "text";
    } else if (value.kind !== "text" || !PLAIN_NUMBER.test(value.value)) {
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

const BEYOND_LIMITS = /Text capacity requires|exceeds 8,406|row exceeds 8,406|CSV exceeds|exceeds .*(row|column) bounds/i;
const DAMAGED = /unclosed quoted field|Missing ZIP|invalid ZIP|not a valid|malformed|truncated/i;

/** Plain-language inspection refusal; the producer's detail stays visible. */
export function importRefusalMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.length > 0 ? error.message : "";
  const lead = BEYOND_LIMITS.test(detail)
    ? "This file is larger than this beta can open. Files with more than 64 rows must have exactly 3 text columns and at most 8,406 rows."
    : DAMAGED.test(detail)
      ? "This file could not be read. It may be damaged, or not a valid CSV or Excel (.xlsx) file."
      : "The spreadsheet could not be inspected.";
  return detail ? `${lead} Nothing was imported. (Details: ${detail})` : `${lead} Nothing was imported.`;
}
