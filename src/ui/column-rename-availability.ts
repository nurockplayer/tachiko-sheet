import type { InteropMetadata, WorkbookView } from "../contracts.js";
import { tableColumns } from "./projection-access.js";
import { sourceNames } from "./source-names.js";

// Work #560: https://github.com/nurockplayer/tachiko-work/issues/560
// Remove the imported-heading gate when the pin exposes explicit display-name
// presence. Do not guess that presence from the flattened display name or key.
export function canRenameColumns(table: WorkbookView["table"] | null, metadata: InteropMetadata | null): boolean {
  if (!table?.native_table_profile) return false;
  const names = sourceNames(metadata, null);
  return !tableColumns(table).some(column => names.column(table.collection.id, column.id) !== null);
}

export const IMPORTED_RENAME_UNAVAILABLE = "Renaming columns is not available for this imported table yet.";
