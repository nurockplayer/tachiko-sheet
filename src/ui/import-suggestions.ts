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
