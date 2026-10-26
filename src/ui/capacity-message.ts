import type { CapacityFailureProjection } from "../../public/core-kit/runtime/protocol.js";

/** Explain a Work capacity refusal without estimating or pre-checking limits in Sheet. */
export function capacityMessage(failure: CapacityFailureProjection): string {
  const maximum = failure.maximum.toLocaleString("en-US");
  const attempted = failure.attempted.toLocaleString("en-US");
  switch (failure.limit) {
    case "table_rows":
      return `This table can hold up to ${maximum} rows; this change would make ${attempted}. Nothing was changed.`;
    case "table_fields":
      return `This table can hold up to ${maximum} columns; this change would make ${attempted}. Nothing was changed.`;
    case "populated_cells":
      return `This workbook can hold up to ${maximum} filled cells; this change would make ${attempted}. Nothing was changed.`;
    case "total_entities":
      return `This workbook can hold up to ${maximum} rows across all tables; this change would make ${attempted}. Nothing was changed.`;
    case "collections":
      return `This workbook can hold up to ${maximum} tables; this change would make ${attempted}. Nothing was changed.`;
    case "formulas":
      return `This workbook can hold up to ${maximum} formulas; this change would make ${attempted}. Nothing was changed.`;
    case "formula_ast_nodes":
    case "dependency_edges":
      return `This change makes the formulas too large for one workbook (limit ${failure.maximum}). Nothing was changed.`;
  }
}
