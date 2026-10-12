import type { FidelityFinding } from "../../public/core-kit/runtime/interop-protocol.js";

/** Display copy only. The original finding, category and blocking flag stay
 * unchanged for import/export decisions, saved copies and diagnostic evidence. */
const FINDING_WORDING: Readonly<Record<string, string>> = Object.freeze({
  "CSV values remain Text or missing until explicit type acceptance; no locale-sensitive inference is authoritative":
    "CSV values stay Text or blank until you choose column types. Numbers are not guessed from regional formatting.",
  "All bounded worksheets and scalar cells were inspected; formula sources require authoritative Rust binding":
    "All supported sheets and cell values were checked. Formulas still need to be checked and recalculated before use.",
  "Worksheet coordinates and selected types were accepted as stable semantic identities; formula export uses absolute references to those identities.":
    "The sheet’s cell positions and your column types were accepted. Exported formulas use absolute cell references.",
  "Export is rebuilt from current stable identities and authoritative values. Formula references use current absolute worksheet coordinates; deleted rows are omitted.":
    "The file uses current values. Formula references use current absolute cell addresses; deleted rows are left out.",
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

export function findingMessage(message: string): string {
  // Exact producer wording is required for a translation. A new/changed
  // warning remains verbatim rather than inheriting an inaccurate promise.
  return Object.hasOwn(FINDING_WORDING, message) ? FINDING_WORDING[message]! : message;
}
