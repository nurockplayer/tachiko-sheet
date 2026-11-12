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
    case "saved_bytes":
      return `This workbook holds more data than this beta can save; nothing was changed.`;
    case "source_bytes":
    case "expanded_bytes":
    case "serialized_source_bytes":
      return `This workbook holds more data than this beta can open; nothing was changed.`;
    case "xml_nodes":
      return `This workbook has more file details than this beta can open; nothing was changed.`;
    case "output_bytes":
      return `This workbook holds more data than this beta can download; nothing was changed.`;
    case "projection_bytes":
      return `${subject} holds more data than this beta can show; nothing was changed.`;
  }
}

/**
 * Explain Work's typed import refusal (#638/#639): the workbook is over the
 * admitted import profile. Work may stop counting early, so every count says
 * "at least" and never pretends to be exact. The sheet named by
 * `table_rows`/`table_fields` is Work's own sheet name. The message opens
 * with the same beta-limit sentence as every other import-size refusal.
 */
export function importCapacityMessage(failure: CapacityFailureProjection): string {
  const maximum = failure.maximum.toLocaleString("en-US");
  const attempted = failure.attempted.toLocaleString("en-US");
  const notImported = "The workbook was not imported.";
  const outside = "This file is outside what this beta can open:";
  switch (failure.limit) {
    case "table_rows":
      return `${outside} the sheet “${failure.collection}” has at least ${attempted} rows; Tachiko can import up to ${maximum} rows per sheet. ${notImported}`;
    case "table_fields":
      return `${outside} the sheet “${failure.collection}” has at least ${attempted} columns; Tachiko can import up to ${maximum} columns per sheet. ${notImported}`;
    case "collections":
      return `${outside} the workbook has at least ${attempted} sheets; Tachiko can import up to ${maximum}. ${notImported}`;
    case "total_entities":
      return `${outside} the workbook has at least ${attempted} rows in all; Tachiko can import up to ${maximum}. ${notImported}`;
    case "formulas":
      return `${outside} the workbook has at least ${attempted} formulas; Tachiko can import up to ${maximum}. ${notImported}`;
    case "populated_cells":
      return `${outside} the workbook has at least ${attempted} filled cells; Tachiko can import up to ${maximum}. ${notImported}`;
    case "formula_ast_nodes":
      return `${outside} the workbook's formulas have at least ${attempted} parts in all; Tachiko can import up to ${maximum}. ${notImported}`;
    case "dependency_edges":
      return `${outside} the workbook's formulas have at least ${attempted} references in all; Tachiko can import up to ${maximum}. ${notImported}`;
    case "saved_bytes":
      return `${outside} the workbook holds more data than this beta can save. ${notImported}`;
    case "source_bytes":
      return `${outside} the file has at least ${attempted} bytes; Tachiko can import up to ${maximum} bytes. ${notImported}`;
    case "expanded_bytes":
      return `${outside} the unpacked file has at least ${attempted} bytes; Tachiko can import up to ${maximum} bytes. ${notImported}`;
    case "serialized_source_bytes":
      return `${outside} the workbook's cell data takes at least ${attempted} bytes; Tachiko can import up to ${maximum} bytes. ${notImported}`;
    case "xml_nodes":
      return `${outside} the file has at least ${attempted} parts; Tachiko can import up to ${maximum}. ${notImported}`;
    case "output_bytes":
      return `${outside} the workbook holds more data than this beta can download. ${notImported}`;
    case "projection_bytes":
      return `${outside} the workbook has at least ${attempted} bytes of data where Tachiko can import up to ${maximum} bytes. ${notImported}`;
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
