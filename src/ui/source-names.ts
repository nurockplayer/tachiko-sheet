import kitManifest from "../../public/core-kit/artifact-manifest.json";
import { tableColumns } from "./projection-access.js";
import type { InteropMetadata, WorkbookView } from "../contracts.js";

// Display names for imported work, taken from the producer's interop metadata
// and the user's file name. Keys and ids remain the only identities; these
// labels never feed commands, bindings or storage.
export interface SourceNames {
  title: string | null;
  table(collectionId: string): string | null;
  column(collectionId: string, fieldId: string): string | null;
}

// This is a projection feature marker, not a method. A rollback kit must keep
// metadata precedence and the imported-heading Rename gate.
export const supportsExplicitDisplayNames = kitManifest.capabilities?.includes("columnDisplayNameExplicit") ?? false;

function label(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function sourceNames(
  metadata: InteropMetadata | null, fileName: string | null,
  table: WorkbookView["table"] | null = null,
  explicitDisplayNames = supportsExplicitDisplayNames,
): SourceNames {
  const sheets = new Map(metadata?.sheets.map((sheet) => [sheet.schema_id, sheet]));
  const columns = new Map(table ? tableColumns(table).map(column => [column.id, column]) : []);
  // CSV has one sheet whose name is a producer placeholder; the file is the
  // user's own name for it.
  const singleCsvLike = metadata?.sheets.length === 1;
  return {
    title: metadata ? label(fileName) : null,
    table(collectionId) {
      const sheet = sheets.get(collectionId);
      if (!sheet) return null;
      return singleCsvLike && /\.csv$/i.test(fileName ?? "") ? label(fileName?.replace(/\.csv$/i, "")) : label(sheet.name);
    },
    column(collectionId, fieldId) {
      const current = table?.collection.id === collectionId ? columns.get(fieldId) : undefined;
      // Work owns stored name presence, including an explicit name equal to its
      // generated key. Never infer it from spelling. Preserve its exact text.
      if (explicitDisplayNames && current && "display_name_explicit" in current && current.display_name_explicit === true) return current.display_name;
      const sheet = sheets.get(collectionId);
      const metadataName = sheet?.has_header ? sheet.columns.find(column => column.field_id === fieldId)?.name : null;
      // With the qualified rule, keep the metadata spelling exactly as export
      // does. Older kits retain their historical trimmed-label fallback.
      const imported = explicitDisplayNames ? metadataName : label(metadataName);
      return imported ?? current?.display_name ?? null;
    },
  };
}
