import type { FidelityFinding } from "../../public/core-kit/runtime/interop-protocol.js";

/** Display copy only. The original finding, category and blocking flag stay
 * unchanged for import/export decisions, saved copies and diagnostic evidence. */
const FINDING_WORDING: Readonly<Record<string, string>> = Object.freeze({
  "CSV cannot distinguish an absent optional Text value from present empty Text; both export as an empty field. Retain the Tachiko source to preserve presence.":
    "CSV cannot preserve the difference between blank cells and empty text; both export as empty cells.",
  "CSV exports scalar lexical values only: typing and formatting are lost. Formula-leading Text or headers are refused; use typed XLSX.":
    "CSV includes text values without column types or formatting. Text or headings that could be read as formulas are refused; use XLSX to keep types.",
  "Keyed-grouped-sum definitions are excluded; retain the Tachiko source to preserve bindings.":
    "Summary settings are not included. Save a copy of your work to keep the summary and its table connections.",
  "Keyed-grouped-sum calculated results are excluded; no calculated snapshots are emitted.":
    "Calculated summary values are not included.",
  "Reports and charts are excluded; this export contains native source tables only.":
    "Reports and charts are not included. Only the source tables are exported.",
  "CSV exports scalar lexical values only: typing and formatting are lost, and missing values cannot be distinguished from empty Text. Formula-leading Text or headers are refused; use typed XLSX.":
    "CSV includes text values without column types or formatting. Blank cells and empty text look the same. Text or headings that could be read as formulas are refused; use XLSX to keep types.",
  "CSV values remain Text or missing until explicit type acceptance; no locale-sensitive inference is authoritative":
    "CSV values stay Text or blank until you choose column types. Numbers are not guessed from regional formatting.",
  "All bounded worksheets and scalar cells were inspected; formula sources require authoritative Rust binding":
    "All supported sheets and cell values were checked. Formulas still need to be checked and recalculated before use.",
  "Worksheet coordinates and selected types were accepted as stable semantic identities; formula export uses absolute references to those identities.":
    "The sheet’s cell positions and your column types were accepted. Exported formulas use absolute cell references.",
  "Export is rebuilt from current stable identities and authoritative values. Formula references use current absolute worksheet coordinates; deleted rows are omitted.":
    "The file uses current values. Formula references use current absolute cell addresses; deleted rows are left out.",
  "Surviving source columns and rows retain source order and identity-bound presentation. Added columns and rows append in current canonical order with default presentation; removed columns and deleted rows are omitted. Blank optional values are empty cells.":
    "Existing columns and rows keep their original order and formatting. New columns and rows are added at the end with default formatting. Removed columns and rows are left out. Blank cells stay empty.",
  "Unknown package part has no declared semantic mapping":
    "This file contains a part that Tachiko cannot read.",
  "Shared, empty, array or dynamic formula is safe-disabled; cached value is not semantic truth":
    "Shared, empty, array or dynamic formulas are disabled. Stored formula results are not confirmed calculation results.",
  "Only numeric arithmetic and binary MIN/MAX are admitted; Rust still validates binding":
    "Only numeric arithmetic and MIN/MAX with two inputs are supported. Formulas still need to be checked before use.",
  "Date mapped to Gregorian YYYY-MM-DD; source serial identity is adapter-only":
    "Dates use Gregorian YYYY-MM-DD rather than spreadsheet date numbers. Keep the source file for its original date numbers.",
  "Source scalar converted using the explicitly selected column type; original source remains available.":
    "The cell value was converted using the column type you chose. The original source is still available.",
  "CSV exports selected-sheet scalar values only. Formula definitions, presentation formatting, and other sheets are not preserved; retain the source project.":
    "CSV includes only cell values from the selected sheet. Formulas, formatting, and other sheets are not kept; keep the source work.",
  "Native scalar output: at most 32 collections, 32 columns, 128 rows per collection, 1,024 total rows, 8 MiB encoded bytes and 24 MiB expanded XLSX. The general incoming profile remains separate (4 sheets, 16 columns, 64 rows); its restricted Text-capacity exception is unchanged. Larger output is not promised reimportable.":
    "A download holds up to 32 tables, each with up to 32 columns and 128 rows (1,024 rows in all). Tachiko opens spreadsheets of up to 4 sheets, 16 columns and 64 rows (some larger text-only tables too), so a larger download may not open here again.",
  "Formula cells export their current computed Number values; formula definitions are not written to the spreadsheet. Retain the Tachiko source to keep the formulas.":
    "Formula cells download as their current values, not as formulas. Save a copy or download the work file (.ro) to keep the formulas.",
  "Session Undo/Redo history is excluded.":
    "Undo history is not included.",
  "Sheet presentation, view sorting/filtering and per-cell formatting are excluded; Dates use yyyy-mm-dd.":
    "Sheet layout, sorting, filters and cell formatting are not included. Dates are written as YYYY-MM-DD.",
  "CSV exports selected-sheet scalar values only. Blank and present empty Text both become empty CSV fields. Formula definitions, presentation formatting, and other sheets are not preserved; retain the source project.":
    "CSV includes only cell values from the selected sheet. Blank cells and empty text both become empty CSV cells. Formulas, formatting, and other sheets are not kept; keep the source work.",
});

const CATEGORY_WORDING: Record<FidelityFinding["category"], string> = {
  native_equivalent: "Kept",
  preserved_readable: "Kept for reference",
  converted: "Changed",
  unsupported_safe_disabled: "Unsupported — disabled",
  lossy_on_export: "Export limitations",
};

export function findingCategoryLabel(category: FidelityFinding["category"]): string {
  return CATEGORY_WORDING[category];
}

export function findingMessage(message: string, code?: string): string {
  // Exact producer wording is required for a translation. A new/changed
  // warning remains verbatim rather than inheriting an inaccurate promise.
  if (code === "imported_spreadsheet_unrepresentable") {
    return `The original workbook layout cannot represent this table. ${message}`;
  }
  if (code === "imported_current_header") {
    const header = /^Current header ("(?:[^"\\]|\\.)*") exports as ("(?:[^"\\]|\\.)*"); the source header was ("(?:[^"\\]|\\.)*")\.$/.exec(message);
    if (header) return `The current column heading ${header[1]} will download as ${header[2]}. The original heading was ${header[3]}.`;
  }
  if (code === "native_tables_csv_collection_excluded") {
    const excluded = /^CSV excludes collection ("(?:[^"\\]|\\.)*") \(.*\); only the requested collection is exported\.$/.exec(message);
    if (excluded) return `CSV downloads only the selected table, so “${quoted(excluded[1]!)}” is left out.`;
  }
  if (code === "native_tables_header_name") {
    const header = /^Header ("(?:[^"\\]|\\.)*") mapped to ("(?:[^"\\]|\\.)*"); headers are never truncated\.$/.exec(message);
    if (header) return `The column heading “${quoted(header[1]!)}” downloads as “${quoted(header[2]!)}”.`;
  }
  if (code === "native_tables_worksheet_name") {
    const names = /^Worksheet name ("(?:[^"\\]|\\.)*") mapped to ("(?:[^"\\]|\\.)*")\.$/.exec(message);
    if (names) {
      const [table, sheet] = [quoted(names[1]!), quoted(names[2]!)];
      return table === sheet ? `The table downloads as the sheet “${sheet}”.` : `The table “${table}” downloads as the sheet “${sheet}”, because spreadsheet sheet names are limited.`;
    }
  }
  if (/^Saved keyed-grouped-sum definition .+ and its calculated results are excluded\.$/.test(message)) {
    return "The saved summary and its calculated values are not included. Save a copy of your work to keep them.";
  }
  return Object.hasOwn(FINDING_WORDING, message) ? FINDING_WORDING[message]! : message;
}

/** A Rust-quoted name without its quotes; the quoted text when it cannot be read. */
function quoted(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "string" ? value : text;
  } catch {
    return text;
  }
}

/**
 * Where a finding applies, in the person's words: table and column names for
 * Work's `collection <id>/field <id>/…` paths (or a bare table id), nothing for
 * the whole workbook, and any other location (an imported sheet or cell)
 * unchanged. Ids never reach the page.
 */
export function findingLocation(
  location: string | undefined,
  tableName: (collection: string) => string | null | undefined,
  columnName: (collection: string, field: string) => string | null | undefined = () => undefined,
  code?: string,
): string | null {
  if (!location || location === "workbook") return null;
  const bare = tableName(location);
  if (bare) return bare;
  // A native header finding is located as `<table id>/<field id>`.
  const pair = /^([^/\s]+)\/([^/\s]+)$/.exec(location);
  const pairTable = pair ? tableName(pair[1]!) : null;
  if (pair && pairTable) {
    const name = columnName(pair[1]!, pair[2]!);
    return `${pairTable}, ${name ? `column “${name}”` : "a column"}`;
  }
  const path = /^collection ([^/\s]+)((?:\/.*)?)$/.exec(location);
  // Native table downloads locate findings by ids only (a table, a saved
  // summary); one that names nothing the person can see is left out.
  if (!path) return code?.startsWith("native_tables_") ? null : location;
  const [, collection, rest] = path as unknown as [string, string, string];
  const parts = [tableName(collection) ?? "A table"];
  const field = /\/field ([^/\s]+)/.exec(rest)?.[1];
  if (field) {
    const name = columnName(collection, field);
    parts.push(name ? `column “${name}”` : "a column");
  } else if (/\/entity /.test(rest)) parts.push("a row");
  else if (/\/sheet-name$/.test(rest)) parts.push("sheet name");
  return parts.join(", ");
}
