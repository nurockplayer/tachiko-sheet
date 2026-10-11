import assert from "node:assert/strict";
import { it } from "vitest";
import type { WorkbookView } from "../contracts.js";
import { preparedDownloadIsCurrent, type PreparedDownload } from "./prepared-download.js";

const live: WorkbookView = {
  title: "Selected sheet", occurrence: "o1", revision: "r1", collections: [],
  table: { revision: "r1", collection: { id: "schema-second", key: "second", entity_count: 0 }, columns: [], rows: [] },
};
const prepared: PreparedDownload = {
  format: "csv", occurrence: "o1", revision: "r1", collectionId: "schema-second", bytes: new Uint8Array([1, 2]).buffer,
};

it("permits the exact reviewed CSV bytes for the same occurrence, revision and stable table", () => {
  assert.equal(preparedDownloadIsCurrent(prepared, live, "csv"), true);
  assert.deepEqual([...new Uint8Array(prepared.bytes)], [1, 2]);
});

it("refuses CSV consent after a same-revision table change", () => {
  const changed = { ...live, table: { ...live.table, collection: { ...live.table.collection, id: "schema-first" } } };
  assert.equal(preparedDownloadIsCurrent(prepared, changed, "csv"), false);
});

it("uses stable table identity rather than display/query key for prepared CSV", () => {
  const renamed = { ...live, table: { ...live.table, collection: { ...live.table.collection, key: "renamed" } } };
  assert.equal(preparedDownloadIsCurrent(prepared, renamed, "csv"), true);
});

it("refuses replaced occurrences even when revision and schema IDs coincide", () => {
  assert.equal(preparedDownloadIsCurrent(prepared, { ...live, occurrence: "o2" }, "csv"), false);
});

it("refuses publication, changed format or missing work/preparation", () => {
  assert.equal(preparedDownloadIsCurrent(prepared, { ...live, revision: "r2" }, "csv"), false);
  assert.equal(preparedDownloadIsCurrent(prepared, live, "xlsx"), false);
  assert.equal(preparedDownloadIsCurrent(null, live, "csv"), false);
  assert.equal(preparedDownloadIsCurrent(prepared, null, "csv"), false);
});

it("preserves whole-workbook XLSX consent across table selection, but not occurrence or revision changes", () => {
  const workbook = { ...prepared, format: "xlsx" as const };
  const changed = { ...live, table: { ...live.table, collection: { ...live.table.collection, id: "schema-first" } } };
  assert.equal(preparedDownloadIsCurrent(workbook, changed, "xlsx"), true);
  assert.equal(preparedDownloadIsCurrent(workbook, { ...changed, occurrence: "o2" }, "xlsx"), false);
  assert.equal(preparedDownloadIsCurrent(workbook, { ...changed, revision: "r2" }, "xlsx"), false);
});
