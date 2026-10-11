import type { InteropMetadata } from "../contracts.js";

// Display names for imported work, taken from the producer's interop metadata
// and the user's file name. Keys and ids remain the only identities; these
// labels never feed commands, bindings or storage.
export interface SourceNames {
  title: string | null;
  table(collectionId: string): string | null;
  column(collectionId: string, fieldId: string): string | null;
}

const EMPTY: SourceNames = { title: null, table: () => null, column: () => null };

function label(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function sourceNames(metadata: InteropMetadata | null, fileName: string | null): SourceNames {
  if (!metadata) return EMPTY;
  const sheets = new Map(metadata.sheets.map((sheet) => [sheet.schema_id, sheet]));
  // CSV has one sheet whose name is a producer placeholder; the file is the
  // user's own name for it.
  const singleCsvLike = metadata.sheets.length === 1;
  return {
    title: label(fileName),
    table(collectionId) {
      const sheet = sheets.get(collectionId);
      if (!sheet) return null;
      return singleCsvLike && /\.csv$/i.test(fileName ?? "") ? label(fileName?.replace(/\.csv$/i, "")) : label(sheet.name);
    },
    column(collectionId, fieldId) {
      const sheet = sheets.get(collectionId);
      if (!sheet?.has_header) return null;
      return label(sheet.columns.find((column) => column.field_id === fieldId)?.name);
    },
  };
}
