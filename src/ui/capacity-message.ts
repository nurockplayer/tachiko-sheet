import type { CapacityFailureProjection } from "../../public/core-kit/runtime/protocol.js";

/**
 * Explain a Work capacity refusal without estimating or pre-checking limits in Sheet.
 * `subject` names the refused table when it is not the one on screen.
 */
export function capacityMessage(failure: CapacityFailureProjection, subject = "This table"): string {
  const maximum = failure.maximum.toLocaleString("en-US");
  const attempted = failure.attempted.toLocaleString("en-US");
  const tail = `this change would make ${attempted}. Nothing was changed.`;
  switch (failure.limit) {
    case "table_rows":
      return `${subject} can hold up to ${maximum} rows; ${tail}`;
    case "table_fields":
      return `${subject} can hold up to ${maximum} columns; ${tail}`;
    case "populated_cells":
      return `This workbook can hold up to ${maximum} filled cells; ${tail}`;
    case "total_entities":
      return `This workbook can hold up to ${maximum} rows across all tables; ${tail}`;
    case "collections":
      return `This workbook can hold up to ${maximum} tables; ${tail}`;
    case "formulas":
      return `This workbook can hold up to ${maximum} formulas; ${tail}`;
    case "formula_ast_nodes":
      return `The formulas in this workbook can hold up to ${maximum} parts in all; ${tail}`;
    case "dependency_edges":
      return `The formulas in this workbook can hold up to ${maximum} references in all; ${tail}`;
  }
}

/**
 * Explain Work's typed import refusal (#638/#639): the workbook is over the
 * admitted import profile. Work may stop counting early, so every count says
 * "at least" and never pretends to be exact. The sheet named by
 * `table_rows`/`table_fields` is Work's own sheet name.
 */
export function importCapacityMessage(failure: CapacityFailureProjection): string {
  const maximum = failure.maximum.toLocaleString("en-US");
  const attempted = failure.attempted.toLocaleString("en-US");
  const notImported = "The workbook was not imported.";
  switch (failure.limit) {
    case "table_rows":
      return `The sheet “${failure.collection}” has at least ${attempted} rows; Tachiko can import up to ${maximum} rows per sheet. ${notImported}`;
    case "table_fields":
      return `The sheet “${failure.collection}” has at least ${attempted} columns; Tachiko can import up to ${maximum} columns per sheet. ${notImported}`;
    case "collections":
      return `The workbook has at least ${attempted} sheets; Tachiko can import up to ${maximum}. ${notImported}`;
    case "total_entities":
      return `The workbook has at least ${attempted} rows in all; Tachiko can import up to ${maximum}. ${notImported}`;
    case "formulas":
      return `The workbook has at least ${attempted} formulas; Tachiko can import up to ${maximum}. ${notImported}`;
    case "populated_cells":
      return `The workbook has at least ${attempted} filled cells; Tachiko can import up to ${maximum}. ${notImported}`;
    case "formula_ast_nodes":
      return `The workbook's formulas have at least ${attempted} parts in all; Tachiko can import up to ${maximum}. ${notImported}`;
    case "dependency_edges":
      return `The workbook's formulas have at least ${attempted} references in all; Tachiko can import up to ${maximum}. ${notImported}`;
  }
}

/** Work's capacity usage for one table, bound to the view it was read for. */
export interface CapacityReading { occurrence: string; revision: string; collectionId: string; rows: number; maximum: number }

/** The reading to show for `view`, or null when it belongs to another table, revision or occurrence. */
export function capacityForView(
  reading: CapacityReading | null,
  view: { occurrence: string; revision: string; table: { collection: { id: string } } } | null,
): { rows: number; maximum: number } | null {
  if (!reading || !view || reading.occurrence !== view.occurrence || reading.revision !== view.revision ||
    reading.collectionId !== view.table.collection.id) return null;
  return { rows: reading.rows, maximum: reading.maximum };
}
