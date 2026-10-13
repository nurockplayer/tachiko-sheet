// Independent fixed-source + separate Work-client oracle shared by #131 lanes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { archiveEntries } from "./work-file-archive.mjs";
const shards = [..."0123456789abcdef"].map(shard => `entities/${shard}.jsonl`);
export const releaseSourceFiles = Object.fromEntries(await Promise.all(["manifest.json", "schemas.json", ...shards].map(async file =>
  [file, await readFile(new URL(`../fixtures/release-plan.roproj/${file}`, import.meta.url), "utf8")])));
function fixtureInventory(files, fieldEdit) {
  const schemas = JSON.parse(files["schemas.json"]);
  const entities = shards.flatMap(file => files[file].trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
  if (fieldEdit) entities.find(entity => entity.id === fieldEdit.entity).fields[fieldEdit.field].value = fieldEdit.value;
  return { schemas, entities };
}
export async function independentOracle(page, file, source, fieldEdit, withSummary = false) {
  const entries = archiveEntries(file.bytes);
  const payload = Object.fromEntries(entries.map(entry => [entry.name.replace(/^payload\//, ""), entry.body.toString("utf8")]));
  assert.deepEqual(entries.map(entry => entry.name), ["package.json", ...["manifest.json", "schemas.json", "definitions.json", ...shards].map(file => `payload/${file}`)]);
  assert.equal(JSON.parse(payload["package.json"]).payload_format_version, 3);
  const { schemas, entities } = fixtureInventory(source, fieldEdit);
  const persistedSchemas = JSON.parse(payload["schemas.json"]);
  assert.deepEqual(persistedSchemas.map(schema => ({ id: schema.id, key: schema.key, fields: schema.fields.map(({ id, key, field_type, required }) => ({ id, key, field_type, required })) })), schemas);
  const persistedEntities = shards.flatMap(file => payload[file].trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
  const sortRows = rows => rows.slice().sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sortRows(persistedEntities), sortRows(entities), "all stored values, formula expressions and identities match the fixed source + explicit edit");
  const definitions = JSON.parse(payload["definitions.json"]);
  if (!withSummary) assert.deepEqual(definitions, []);
  else {
    assert.equal(definitions.length, 1);
    assert.deepEqual({ orders: definitions[0].orders, products: definitions[0].products }, {
      orders: { schema: "10000000-0000-4000-8000-000000000001", lookup_key_field: "10000000-0000-4000-8000-000000000101", quantity_field: "10000000-0000-4000-8000-000000000102" },
      products: { schema: "20000000-0000-4000-8000-000000000001", key_field: "20000000-0000-4000-8000-000000000201", category_field: "20000000-0000-4000-8000-000000000202", price_field: "20000000-0000-4000-8000-000000000203" },
    }, "summary bindings are independently specified, never read from Sheet UI state");
  }
  // A separate unwrapped client, not Sheet's runtime/session/UI snapshot.
  const oracle = await page.evaluate(async ({ bytes, definitions }) => {
    const kit = await import("/core-kit/experimental-client.js");
    const client = kit.createExperimentalDesignerClient();
    try {
      const buffer = new Uint8Array(bytes).buffer;
      await client.verifyPortableRo(buffer.slice(0));
      const opened = await client.openPortableRo(buffer);
      const tables = await Promise.all(opened.bootstrap.collections.map(collection => client.queryTable(collection.key)));
      const groups = await Promise.all(definitions.map(definition => client.queryKeyedGroupedSum(definition.id)));
      return { bootstrap: opened.bootstrap, tables, groups };
    } finally { await client.close(); }
  }, { bytes: [...file.bytes], definitions });
  assert.equal(oracle.bootstrap.title, JSON.parse(source["manifest.json"]).document.title);
  assert.deepEqual(oracle.bootstrap.collections.map(({ id, key, entity_count }) => ({ id, key, entity_count })).sort((a,b) => a.key.localeCompare(b.key)),
    schemas.map(schema => ({ id: schema.id, key: schema.key, entity_count: entities.filter(entity => entity.schema === schema.id).length })).sort((a,b) => a.key.localeCompare(b.key)));
  for (const table of oracle.tables) {
    const schema = schemas.find(schema => schema.id === table.collection.id);
    assert.deepEqual(table.columns.map(({ id, key, field_type }) => ({ id, key, field_type })).sort((a,b) => a.id.localeCompare(b.id)),
      schema.fields.map(field => ({ id: field.id, key: field.key, field_type: field.field_type.type })).sort((a,b) => a.id.localeCompare(b.id)));
    const rows = entities.filter(entity => entity.schema === schema.id);
    assert.equal(table.rows.length, rows.length);
    for (const row of table.rows) {
      const sourceRow = rows.find(entity => entity.id === row.id);
      assert.equal(row.key, sourceRow.key);
      assert.equal(row.fields.length, schema.fields.length);
      for (const projected of row.fields) {
        const value = sourceRow.fields[projected.target.field];
        assert.deepEqual(projected.diagnostics, []);
        if (value.kind !== "formula") assert.deepEqual(projected.stored, value);
        else {
          assert.ok(projected.formula?.source, "formula survives fresh independent Work open");
          assert.equal(value.value.op, "add");
          const { left, right } = value.value.args;
          const sum = entities.find(entity => entity.id === left.args.entity).fields[left.args.field].value + entities.find(entity => entity.id === right.args.entity).fields[right.args.field].value;
          assert.deepEqual(projected.calculated, { status: "value", value: sum }, "expected formula result computed by test arithmetic");
        }
      }
    }
  }
  if (withSummary) {
    const prices = new Map(entities.filter(entity => entity.schema.startsWith("2000")).map(entity => [entity.fields["20000000-0000-4000-8000-000000000201"].value, entity.fields["20000000-0000-4000-8000-000000000203"].value]));
    const totals = new Map();
    for (const entity of entities.filter(entity => entity.schema.startsWith("1000"))) {
      const code = entity.fields["10000000-0000-4000-8000-000000000101"].value;
      const quantity = entity.fields["10000000-0000-4000-8000-000000000102"].value;
      totals.set(code, (totals.get(code) ?? 0) + quantity * prices.get(code));
    }
    assert.deepEqual(oracle.groups[0].diagnostics, []);
    assert.deepEqual(oracle.groups[0].groups.map(({ category, value }) => ({ category, value })).sort((a,b) => a.category.localeCompare(b.category)),
      [...totals].map(([category, value]) => ({ category, value })).sort((a,b) => a.category.localeCompare(b.category)));
  }
  return definitions;
}
