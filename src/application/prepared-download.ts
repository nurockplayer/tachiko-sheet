import type { SpreadsheetFormat, WorkbookView } from "../contracts.js";

/** Host-only consent binding; bytes remain the unmodified producer output. */
export interface PreparedDownload {
  format: SpreadsheetFormat | "ro";
  occurrence: string;
  revision: string;
  collectionId: string;
  bytes: ArrayBuffer;
  /** Host attachment losses disclosed for this prepared file only. */
  omissions?: string[];
}

export function preparedDownloadIsCurrent(
  prepared: PreparedDownload | null,
  live: WorkbookView | null,
  format: SpreadsheetFormat | "ro",
): boolean {
  return prepared !== null && live !== null && prepared.format === format &&
    prepared.occurrence === live.occurrence && prepared.revision === live.revision &&
    (format !== "csv" || prepared.collectionId === live.table.collection.id);
}
