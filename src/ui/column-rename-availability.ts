import type { InteropMetadata, WorkbookView } from "../contracts.js";
import { tableColumns } from "./projection-access.js";
import { sourceNames, supportsExplicitDisplayNames } from "./source-names.js";

// Work #560: https://github.com/nurockplayer/tachiko-work/issues/560
// Only rollback kits without explicit display-name presence need the old
// imported-heading gate. Do not infer capability or presence from spelling.
export function canRenameColumns(table: WorkbookView["table"] | null, metadata: InteropMetadata | null, explicitDisplayNames = supportsExplicitDisplayNames): boolean {
  if (!table?.native_table_profile) return false;
  if (explicitDisplayNames) return true;
  const names = sourceNames(metadata, null, null, false);
  return !tableColumns(table).some(column => names.column(table.collection.id, column.id) !== null);
}

export const IMPORTED_RENAME_UNAVAILABLE = "Renaming columns is not available for this imported table yet.";
