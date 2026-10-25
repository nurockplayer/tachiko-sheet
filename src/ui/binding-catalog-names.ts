import type { InteropMetadata, KeyedGroupedSumBindingCatalog } from "../contracts.js";
import { sourceNames, supportsExplicitDisplayNames } from "./source-names.js";

/** Add presentation labels to runtime bindings without changing their stable keys or IDs. */
export function bindingCatalogNames(
  catalog: KeyedGroupedSumBindingCatalog,
  metadata: InteropMetadata | null,
  fileName: string | null,
): KeyedGroupedSumBindingCatalog {
  const names = sourceNames(metadata, fileName, null, supportsExplicitDisplayNames);
  return {
    collections: catalog.collections.map((collection) => ({
      ...collection,
      fields: collection.fields.map((field) => ({
        ...field,
        displayName: names.catalogColumn(collection.id, field.id, field.displayName, field.displayNameExplicit) ?? field.displayName,
      })),
    })),
  };
}
