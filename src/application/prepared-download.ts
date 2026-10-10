import type { SpreadsheetFormat, WorkbookView } from "../contracts.js";

/** Host-only consent binding; bytes remain the unmodified producer output. */
export interface PreparedDownload {
  format: SpreadsheetFormat;
  occurrence: string;
  revision: string;
  collectionId: string;
  bytes: ArrayBuffer;
}

export function preparedDownloadIsCurrent(
  prepared: PreparedDownload | null,
  live: WorkbookView | null,
  format: SpreadsheetFormat,
): boolean {
  return prepared !== null && live !== null && prepared.format === format &&
    prepared.occurrence === live.occurrence && prepared.revision === live.revision &&
    (format !== "csv" || prepared.collectionId === live.table.collection.id);
}
