import type { SourceCell, SourceValue } from "../../public/core-kit/runtime/interop-protocol.js";

export type ImportColumnType = "text" | "number" | "boolean" | "date";

// Plain decimal numbers only, and only when the number is exactly the value
// written: trailing decimal zeros are allowed, so money amounts such as 4.50
// suggest Number, while -0, 0.0000001 and over-long values that would round
// stay Text. Leading zeros (IDs, postcodes), exponents and grouping
// separators stay Text so no identifier is silently reinterpreted.
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const MAX_SIGNIFICANT_DIGITS = 15;

function losslessNumberText(text: string): boolean {
  if (!PLAIN_NUMBER.test(text)) return false;
  if (text.replace(/^-/, "").replace(".", "").replace(/^0+/, "").length > MAX_SIGNIFICANT_DIGITS) return false;
  const value = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  return String(Number(text)) === value;
}

// A calendar date written as YYYY-MM-DD, the form Work stores and exports.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDateText(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // setUTCFullYear keeps years 0–99 as written; Date.UTC would read them as 19xx.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Work's MAX_DATA_ROWS: when any sheet has more rows, the import takes the
// large-table profile, which admits only Text and Number columns.
const TYPED_IMPORT_ROWS = 64;

/** Whether this source can import Date columns (no sheet over Work's 64 rows). */
export function importAdmitsDates(sheets: ReadonlyArray<{ rows: readonly unknown[] }>): boolean {
  return sheets.every(sheet => sheet.rows.length <= TYPED_IMPORT_ROWS);
}

/**
 * Advisory type for one source column: Number for plain decimals, Date for
 * YYYY-MM-DD dates where the import admits them, otherwise Text. The user
 * still confirms it, and the core remains the parser and validator.
 */
export function suggestColumnType(rows: readonly SourceCell[][], column: number, datesAdmitted = true): ImportColumnType {
  let numbers = 0, dates = 0;
  for (const row of rows) {
    const value = row[column]?.value;
    if (!value || value.kind === "empty") continue;
    if (value.kind === "number") {
      if (!Number.isFinite(value.value) || Object.is(value.value, -0)) return "text";
      numbers++;
    } else if (value.kind === "text" && losslessNumberText(value.value)) {
      numbers++;
    } else if (value.kind === "text" && isoDateText(value.value)) {
      dates++;
    } else {
      return "text";
    }
    if (numbers > 0 && dates > 0) return "text";
  }
  return numbers > 0 ? "number" : dates > 0 && datesAdmitted ? "date" : "text";
}

export function sourcePreviewText(value: SourceValue | undefined): string {
  if (!value || value.kind === "empty") return "";
  if (value.kind === "boolean") return value.value ? "TRUE" : "FALSE";
  return String(value.value);
}

const BEYOND_LIMITS = /\b(?:TableRows|TableFields|PopulatedCells|TotalEntities) capacity exceeded|Text capacity requires|capacity requires|exceeds 8,406|row exceeds 8,406|CSV exceeds|exceeds .*(row|column|cell) bounds|25,218|25218|logical cells|(?:cell column|worksheet row).*exceeds profile|bounded Text\/Number capacity rectangle/i;
const DAMAGED = /unclosed quoted field|Missing ZIP|invalid ZIP|not a valid|malformed|truncated/i;

/** Plain-language inspection refusal; the producer's detail stays visible. */
export function importRefusalMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.length > 0 ? error.message : "";
  // Work's typed capacity refusal (#588) is the authority; the patterns cover older producer wording.
  const capacity = (error as { failure?: { code?: unknown } } | null)?.failure?.code === "capacity_exceeded";
  const lead = capacity || BEYOND_LIMITS.test(detail)
    ? "This file is outside what this beta can open: one headered sheet with 1–16 plain Text or finite Number columns, up to 8,406 rows and 25,218 cells (including missing cells). Other file-size, style and feature limits also apply."
    : DAMAGED.test(detail)
      ? "This file could not be read. It may be damaged, or not a valid CSV or Excel (.xlsx) file."
      : "The spreadsheet could not be inspected.";
  return detail ? `${lead} Nothing was imported. (Details: ${detail})` : `${lead} Nothing was imported.`;
}

/** Format known confirmation refusals; retain recovery/unknown outcome wording. */
export function importConfirmationMessage(message: string): string {
  if (/unknown|refresh|recovery|could not be confirmed|stopped unexpectedly/i.test(message)) return message;
  if (BEYOND_LIMITS.test(message) || DAMAGED.test(message)) return importRefusalMessage(new Error(message));
  if (/conversion requires.*finite.*Number|source Number is not finite/i.test(message)) {
    return `A column could not be converted to Number. Check its values or choose Text. Nothing was imported. (Details: ${message})`;
  }
  return message;
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
