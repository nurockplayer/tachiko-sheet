import type { RowCommandOutcome } from "../contracts.js";

export function tableRefusal(result: Extract<RowCommandOutcome, { kind: "refused" }>): string {
  switch (result.refusalCode) {
    case "last_table": return "Keep at least one sheet in this work. Add another sheet before deleting this one. Nothing was changed.";
    case "table_referenced": return "This sheet is used by a formula, reference or cross-table summary. Remove those references before deleting it. Nothing was changed.";
    case "missing_collection": return "This sheet is no longer available. Refresh the work before trying again.";
    default: return result.message;
  }
}
