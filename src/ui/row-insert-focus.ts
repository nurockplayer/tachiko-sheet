import type { WorkbookView } from "../contracts.js";
import { DRAFT_ROW } from "./row-entry-model.js";
import { rowEntity, tableColumns } from "./projection-access.js";
import { rowSource } from "./row-source.js";

/** Resolve completion focus from the confirmed projection, after the draft may
 * have disappeared. Intent/current-occurrence checks belong to the caller. */
export function rowInsertFocusTarget(
  table: WorkbookView["table"],
  hasDraftRow: boolean,
  previousEntities: readonly string[],
  field: string,
): { entity: string; field: string } | null {
  const columns = tableColumns(table);
  const first = columns[0];
  if (!first) return null;
  // Preserve the existing below-limit behavior: return to the first draft cell.
  if (hasDraftRow) return { entity: DRAFT_ROW, field: first.id };
  const source = rowSource(table);
  const inserted = source.allRowsForNow().find(row => !previousEntities.includes(rowEntity(row)));
  if (inserted && columns.some(column => column.id === field)) return { entity: rowEntity(inserted), field };
  const last = source.rowAt(source.total - 1);
  return last ? { entity: rowEntity(last), field: first.id } : null;
}
