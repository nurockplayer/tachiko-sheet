import { describe, expect, it } from "vitest";
import type { InteropMetadata, KeyedGroupedSumBindingCatalog } from "../contracts.js";
import { bindingCatalogNames } from "./binding-catalog-names.js";

const metadata = {
  version: 1,
  sheets: [{
    schema_id: "table-id",
    name: "Items",
    has_header: true,
    columns: [
      { field_id: "field-imported", name: "Item", width: null },
      { field_id: "field-fallback", name: "", width: null },
      { field_id: "field-explicit", name: "Old heading", width: null },
    ],
    rows: [],
  }],
} as InteropMetadata;

const catalog: KeyedGroupedSumBindingCatalog = {
  collections: [{
    id: "table-id",
    key: "table_1",
    displayName: "Items",
    fields: [
      { id: "field-imported", key: "column_1", displayName: "column_1", displayNameExplicit: false, fieldType: "text" },
      { id: "field-fallback", key: "quantity", displayName: "Quantity", displayNameExplicit: false, fieldType: "number" },
      { id: "field-explicit", key: "column_3", displayName: "column_3", displayNameExplicit: true, fieldType: "text" },
    ],
  }],
};

describe("binding catalog presentation names", () => {
  it("uses explicit name, then imported heading, then projected name while preserving binding identity", () => {
    const resolved = bindingCatalogNames(catalog, metadata, "items.csv");
    expect(resolved.collections[0]?.fields.map(({ displayName }) => displayName)).toEqual(["Item", "Quantity", "column_3"]);
    expect(resolved.collections[0]?.id).toBe("table-id");
    expect(resolved.collections[0]?.key).toBe("table_1");
    expect(resolved.collections[0]?.fields.map(({ id, key }) => ({ id, key }))).toEqual([
      { id: "field-imported", key: "column_1" },
      { id: "field-fallback", key: "quantity" },
      { id: "field-explicit", key: "column_3" },
    ]);
  });
});
