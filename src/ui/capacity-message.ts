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
