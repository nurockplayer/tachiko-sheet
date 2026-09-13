// J4 preparation proof over the retained public core kit. This is not product UI/host PASS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const block = message => { const error = new Error(message); error.blocked = true; throw error; };
const text = value => new TextEncoder().encode(value).buffer;
const catalogSchema = '20000000-0000-4000-8000-000000000001';
const salesSchema = '10000000-0000-4000-8000-000000000001';
const fields = { salesCode: '10000000-0000-4000-8000-000000000101', quantity: '10000000-0000-4000-8000-000000000102', code: '20000000-0000-4000-8000-000000000201', category: '20000000-0000-4000-8000-000000000202', price: '20000000-0000-4000-8000-000000000203' };
const definitionId = '50000000-0000-4000-8000-000000000010';
const entry = (id, key, schema, values) => JSON.stringify({id, key, schema, fields: values}) + '\n';
const fixtureText = {
  'manifest.json': JSON.stringify({format: 'tachiko.roproj', format_version: 1, document: {id: '50000000-0000-4000-8000-000000000001', title: 'Sheet J4 Catalog Sales'}}, null, 2) + '\n',
  'schemas.json': JSON.stringify([
    {id: salesSchema, key: 'sales', fields: [{id: fields.salesCode, key: 'product_code', field_type: {type: 'text'}, required: true}, {id: fields.quantity, key: 'quantity', field_type: {type: 'number'}, required: true}]},
    {id: catalogSchema, key: 'catalog', fields: [{id: fields.code, key: 'code', field_type: {type: 'text'}, required: true}, {id: fields.category, key: 'category', field_type: {type: 'text'}, required: true}, {id: fields.price, key: 'price', field_type: {type: 'number'}, required: true}]},
  ], null, 2) + '\n',
  'entities/1.jsonl': entry('30000000-0000-4000-8000-000000000002', 'catalog_note', catalogSchema, {[fields.code]: {kind: 'text', value: 'NOTE'}, [fields.category]: {kind: 'text', value: 'NOTE'}, [fields.price]: {kind: 'number', value: 500}}),
  'entities/4.jsonl': entry('40000000-0000-4000-8000-000000000002', 'sale_note', salesSchema, {[fields.salesCode]: {kind: 'text', value: 'NOTE'}, [fields.quantity]: {kind: 'number', value: 2}}),
  'entities/6.jsonl': entry('40000000-0000-4000-8000-000000000001', 'sale_pen_3', salesSchema, {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 3}}),
  'entities/a.jsonl': entry('40000000-0000-4000-8000-000000000003', 'sale_pen_1', salesSchema, {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 1}}),
  'entities/b.jsonl': entry('30000000-0000-4000-8000-000000000001', 'catalog_pen', catalogSchema, {[fields.code]: {kind: 'text', value: 'PEN'}, [fields.category]: {kind: 'text', value: 'PEN'}, [fields.price]: {kind: 'number', value: 200}}),
};
for (const shard of '0123456789abcdef') fixtureText[`entities/${shard}.jsonl`] ??= '';
const fixture = Object.entries(fixtureText).sort(([a], [b]) => a.localeCompare(b)).map(([path, body]) => ({path, bytes: text(body)}));
const fixtureSha256 = createHash('sha256').update(JSON.stringify(Object.entries(fixtureText).sort())).digest('hex');
const expectedFixtureSha256 = 'd8ab17b0bc84f89fbc996beb730f0842ec2bf848d1ab4afd315cc34fa1195d2b';
let browser, server;
try {
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
  const kit = await realpath(path.join(root, lock.defaultKit));
  let chromium; try { ({chromium} = await import('playwright')); } catch { block('Repository-locked Playwright is unavailable.'); }
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') { response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html>'); return; }
      if (!pathname.startsWith('/kit/')) throw new Error('bad path');
      const file = path.resolve(kit, pathname.slice(5));
      if (!file.startsWith(kit + path.sep)) throw new Error('escape');
      response.writeHead(200, {'Content-Type': path.extname(file) === '.js' ? 'text/javascript' : path.extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream'});
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless: true, ...(process.env.WORK_CHROMIUM ? {executablePath: process.env.WORK_CHROMIUM} : {})});
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  const expectedBeforeDefinition = {collections: [{key: 'catalog', id: catalogSchema}, {key: 'sales', id: salesSchema}], catalogKinds: {category: 'text', code: 'text', price: 'number'}, salesKinds: {product_code: 'text', quantity: 'number'}, catalogRows: {catalog_note: {[fields.code]: {kind: 'text', value: 'NOTE'}, [fields.category]: {kind: 'text', value: 'NOTE'}, [fields.price]: {kind: 'number', value: 500}}, catalog_pen: {[fields.code]: {kind: 'text', value: 'PEN'}, [fields.category]: {kind: 'text', value: 'PEN'}, [fields.price]: {kind: 'number', value: 200}}}, salesRows: {sale_note: {[fields.salesCode]: {kind: 'text', value: 'NOTE'}, [fields.quantity]: {kind: 'number', value: 2}}, sale_pen_1: {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 1}}, sale_pen_3: {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 3}}}};
  assert.equal(fixtureSha256, expectedFixtureSha256, 'Fixture provenance changed; obtain Steward reconciliation.');
  const result = await page.evaluate(async ({entries, fields, catalogSchema, salesSchema, definitionId, expectedBefore}) => {
    const kit = await import('/kit/experimental-client.js');
    const materialized = entries.map(entry => ({path: entry.path, bytes: new Uint8Array(entry.bytes).buffer}));
    const client = kit.createExperimentalDesignerClient();
    const groups = projection => Object.fromEntries(projection.groups.map(group => [group.category, group.value]));
    const rows = table => Object.fromEntries(table.rows.map(row => [row.key, Object.fromEntries(row.fields.map(field => [field.target.field, field.stored && {kind: field.stored.kind, value: field.stored.value}]))]));
    const definition = {id: definitionId, orders_schema: salesSchema, order_lookup_key_field: fields.salesCode, order_quantity_field: fields.quantity, products_schema: catalogSchema, product_key_field: fields.code, product_category_field: fields.category, product_price_field: fields.price};
    try {
      const opened = await client.openProject(kit.projectTransferFromEntries(materialized));
      const catalog = await client.queryTable('catalog'); const sales = await client.queryTable('sales');
      const columnKinds = table => Object.fromEntries(table.columns.map(column => [column.key, column.field_type]));
      const beforeDefinition = {collections: opened.bootstrap.collections.map(collection => ({key: collection.key, id: collection.id})).sort((left, right) => left.key.localeCompare(right)), catalogKinds: columnKinds(catalog), salesKinds: columnKinds(sales), catalogRows: rows(catalog), salesRows: rows(sales)};
      if (JSON.stringify(beforeDefinition) !== JSON.stringify(expectedBefore)) throw new Error('Materialized J4 fixture did not match the fixed schema, binding, and row provenance before definition evaluation.');
      const published = await client.createKeyedGroupedSum(opened.bootstrap.revision, definition);
      const initial = await client.queryKeyedGroupedSum(definitionId);
      const pen = catalog.rows.find(row => row.key === 'catalog_pen');
      const penPrice = pen.fields.find(field => field.target.field === fields.price).target;
      const edit = await client.editNumber(initial.revision, penPrice, '250');
      const current = await client.queryKeyedGroupedSum(definitionId);
      const exported = await client.exportProject(current.revision);
      const fresh = kit.createExperimentalDesignerClient();
      const reopened = await fresh.openProject(exported.bytes.slice(0));
      const reopenedGroups = await fresh.queryKeyedGroupedSum(definitionId);
      await fresh.closeProject(); await fresh.close();
      const note = (await client.queryTable('catalog')).rows.find(row => row.key === 'catalog_note');
      const noteCode = note.fields.find(field => field.target.field === fields.code).target;
      await client.editText(current.revision, noteCode, 'PEN');
      const duplicate = await client.queryKeyedGroupedSum(definitionId);
      const restored = await client.editText(duplicate.revision, noteCode, 'NOTE');
      const missingSale = (await client.queryTable('sales')).rows.find(row => row.key === 'sale_note');
      const missingCode = missingSale.fields.find(field => field.target.field === fields.salesCode).target;
      await client.editText(restored.resulting_revision, missingCode, 'MISSING');
      const missing = await client.queryKeyedGroupedSum(definitionId);
      await client.closeProject(); await client.close();
      return {beforeDefinition, initial: groups(initial), current: groups(current), reopened: groups(reopenedGroups), duplicate: {groups: duplicate.groups.length, diagnostics: duplicate.diagnostics.map(diagnostic => ({code: diagnostic.code, lookupKey: diagnostic.lookup_key}))}, missing: {groups: missing.groups.length, diagnostics: missing.diagnostics.map(diagnostic => ({code: diagnostic.code, lookupKey: diagnostic.lookup_key}))}, exportBytes: [...new Uint8Array(exported.bytes)], publicationRevision: published.publication.resulting_revision, editRevision: edit.resulting_revision};
    } catch (error) { try { await client.close(); } catch {} throw error; }
  }, {entries: fixture.map(file => ({path: file.path, bytes: [...new Uint8Array(file.bytes)]})), fields, catalogSchema, salesSchema, definitionId, expectedBefore: expectedBeforeDefinition});
  assert.deepEqual(result.beforeDefinition, expectedBeforeDefinition);
  assert.deepEqual(result.initial, {NOTE: 1000, PEN: 800});
  assert.deepEqual(result.current, {NOTE: 1000, PEN: 1000});
  assert.deepEqual(result.reopened, {NOTE: 1000, PEN: 1000});
  assert.equal(result.duplicate.groups, 0); assert.ok(result.duplicate.diagnostics.some(value => value.code === 'lookup.ambiguous_key' && value.lookupKey === 'PEN'));
  assert.equal(result.missing.groups, 0); assert.ok(result.missing.diagnostics.some(value => value.code === 'lookup.missing_key' && value.lookupKey === 'MISSING'));
  console.log(JSON.stringify({status: 'PASS_PREPARATION_CORE_BOUNDARY_ONLY', fixtureSha256, sourceCommit: lock.sourceCommit, manifest: lock.artifactManifestSha256, staticCheckerFacts: {lineTotals: [600, 1000, 200], total: 1800, afterPrice250: {lineTotals: [750, 1000, 250], total: 2000}}, normalUI: 'NOT_TESTED', hostDurability: 'NOT_TESTED', realImeAccessibility: 'NOT_TESTED'}));
} catch (error) {
  console.error(JSON.stringify({status: error.blocked ? 'BLOCKED' : 'FAIL_OR_UNQUALIFIED', message: String(error.stack ?? error)})); process.exitCode = error.blocked ? 78 : 1;
} finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
