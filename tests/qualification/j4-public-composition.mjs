// J4 preparation proof over the retained public core kit. This is not product UI/host PASS.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
const expectedCoreSourceCommit = '518aaa55e046a4e4676b4d5e05d8189c4c6343fe';
const expectedCoreManifestSha256 = 'ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b';
const expectedPersistedDefinition = [{
  id: definitionId,
  orders: {schema: salesSchema, lookup_key_field: fields.salesCode, quantity_field: fields.quantity},
  products: {schema: catalogSchema, key_field: fields.code, category_field: fields.category, price_field: fields.price},
}];
const expectedFormat2Paths = ['manifest.json', 'schemas.json', 'definitions.json', ...[...'0123456789abcdef'].map(shard => `entities/${shard}.jsonl`)].sort();
const assertPersistedDefinition = definitions => assert.deepEqual(definitions, expectedPersistedDefinition, 'Persisted J4 definition bindings changed.');
// Qualification-only inspection of the core-produced private transfer envelope.
// This is not a product codec and never rewrites the bytes passed to openProject.
const inspectOpaqueFormat2Transfer = input => {
  const bytes = new Uint8Array(input);
  assert.ok(bytes.byteLength >= 12, 'Format-2 transfer is truncated before its header.');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const magic = decoder.decode(bytes.slice(0, 8));
  assert.equal(magic, 'TWDPROJ1', 'Unexpected private transfer envelope magic.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8, true);
  assert.equal(count, 19, 'Format-2 transfer must retain all 19 expected entries.');
  const entries = [];
  const paths = new Set();
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    assert.ok(offset + 6 <= bytes.byteLength, 'Format-2 transfer is truncated in its entry header.');
    const pathLength = view.getUint16(offset, true); offset += 2;
    const byteLength = view.getUint32(offset, true); offset += 4;
    const end = offset + pathLength + byteLength;
    assert.ok(Number.isSafeInteger(end) && end <= bytes.byteLength, 'Format-2 transfer is truncated in an entry body.');
    const path = decoder.decode(bytes.slice(offset, offset + pathLength)); offset += pathLength;
    assert.ok(path.length > 0 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(component => component.length > 0 && component !== '.' && component !== '..') && !paths.has(path), 'Format-2 transfer has unsafe or duplicate paths.');
    paths.add(path);
    entries.push({path, text: decoder.decode(bytes.slice(offset, end))}); offset = end;
  }
  assert.equal(offset, bytes.byteLength, 'Format-2 transfer has trailing bytes.');
  const manifest = entries.find(entry => entry.path === 'manifest.json');
  const definitions = entries.find(entry => entry.path === 'definitions.json');
  assert.ok(manifest && definitions, 'Format-2 transfer is missing manifest.json or definitions.json.');
  assert.deepEqual({magic, count, paths: [...paths].sort(), manifest: JSON.parse(manifest.text)}, {
    magic: 'TWDPROJ1',
    count: 19,
    paths: expectedFormat2Paths,
    manifest: {format: 'tachiko.roproj', format_version: 2, document: {id: '50000000-0000-4000-8000-000000000001', title: 'Sheet J4 Catalog Sales'}},
  }, 'Persisted J4 format-2 envelope changed.');
  assertPersistedDefinition(JSON.parse(definitions.text));
};
let browser, server;
try {
  assert.equal(fixtureSha256, expectedFixtureSha256, 'Fixture provenance changed; obtain Steward reconciliation.');
  const lockPath = path.join(root, 'core-kit.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lock.sourceCommit, expectedCoreSourceCommit, 'J4 core source pin changed; obtain Steward reconciliation.');
  assert.equal(lock.artifactManifestSha256, expectedCoreManifestSha256, 'J4 core manifest pin changed; obtain Steward reconciliation.');
  const kit = await realpath(path.join(root, lock.defaultKit));
  execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-core-kit.mjs')], {
    cwd: root,
    env: {...process.env, WORK_CORE_KIT_LOCK: lockPath, WORK_CORE_KIT: kit},
    stdio: 'inherit',
  });
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
  const expectedBeforeDefinition = {collections: [{key: 'catalog', id: catalogSchema}, {key: 'sales', id: salesSchema}], catalogKinds: {category: 'text', code: 'text', price: 'number'}, salesKinds: {product_code: 'text', quantity: 'number'}, catalogColumns: [{id: fields.category, key: 'category', field_type: 'text'}, {id: fields.code, key: 'code', field_type: 'text'}, {id: fields.price, key: 'price', field_type: 'number'}], salesColumns: [{id: fields.salesCode, key: 'product_code', field_type: 'text'}, {id: fields.quantity, key: 'quantity', field_type: 'number'}], catalogRows: {catalog_note: {[fields.code]: {kind: 'text', value: 'NOTE'}, [fields.category]: {kind: 'text', value: 'NOTE'}, [fields.price]: {kind: 'number', value: 500}}, catalog_pen: {[fields.code]: {kind: 'text', value: 'PEN'}, [fields.category]: {kind: 'text', value: 'PEN'}, [fields.price]: {kind: 'number', value: 200}}}, salesRows: {sale_note: {[fields.salesCode]: {kind: 'text', value: 'NOTE'}, [fields.quantity]: {kind: 'number', value: 2}}, sale_pen_1: {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 1}}, sale_pen_3: {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 3}}}};
  const result = await page.evaluate(async ({entries, fields, catalogSchema, salesSchema, definitionId, expectedBefore}) => {
    const kit = await import('/kit/experimental-client.js');
    const materialized = entries.map(entry => ({path: entry.path, bytes: new Uint8Array(entry.bytes).buffer}));
    const client = kit.createExperimentalDesignerClient();
    const projection = value => ({
      revision: value.revision,
      groups: value.groups.map(group => ({category: group.category, value: group.value})).sort((left, right) => left.category.localeCompare(right.category) || left.value - right.value),
      diagnostics: value.diagnostics.map(diagnostic => ({code: diagnostic.code, lookupKey: diagnostic.lookup_key})).sort((left, right) => left.code.localeCompare(right.code) || left.lookupKey.localeCompare(right.lookupKey)),
    });
    const rows = table => Object.fromEntries(table.rows.map(row => [row.key, Object.fromEntries(row.fields.map(field => [field.target.field, field.stored && {kind: field.stored.kind, value: field.stored.value}]))]));
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)])) : value;
    const definition = {id: definitionId, orders_schema: salesSchema, order_lookup_key_field: fields.salesCode, order_quantity_field: fields.quantity, products_schema: catalogSchema, product_key_field: fields.code, product_category_field: fields.category, product_price_field: fields.price};
    try {
      const opened = await client.openProject(kit.projectTransferFromEntries(materialized));
      const catalog = await client.queryTable('catalog'); const sales = await client.queryTable('sales');
      const columnKinds = table => Object.fromEntries(table.columns.map(column => [column.key, column.field_type]));
      const columnIdentity = table => table.columns.map(column => ({id: column.id, key: column.key, field_type: column.field_type})).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      const beforeDefinition = {collections: opened.bootstrap.collections.map(collection => ({key: collection.key, id: collection.id})).sort((left, right) => left.key.localeCompare(right)), catalogKinds: columnKinds(catalog), salesKinds: columnKinds(sales), catalogColumns: columnIdentity(catalog), salesColumns: columnIdentity(sales), catalogRows: rows(catalog), salesRows: rows(sales)};
      if (JSON.stringify(canonical(beforeDefinition)) !== JSON.stringify(canonical(expectedBefore))) throw new Error('Materialized J4 fixture did not match the fixed schema, binding, and row provenance before definition evaluation.');
      const published = await client.createKeyedGroupedSum(opened.bootstrap.revision, definition);
      const initial = await client.queryKeyedGroupedSum(definitionId);
      const pen = catalog.rows.find(row => row.key === 'catalog_pen');
      const penPrice = pen.fields.find(field => field.target.field === fields.price).target;
      const edit = await client.editNumber(initial.revision, penPrice, '250');
      const current = await client.queryKeyedGroupedSum(definitionId);
      const captureRefusal = async operation => {
        try { await operation(); return null; }
        catch (error) { return {code: error?.failure?.code ?? null, message: String(error?.message ?? error)}; }
      };
      const canonicalRefusal = await captureRefusal(() => client.exportCanonicalTree(current.revision));
      const portableRefusal = await captureRefusal(() => client.exportPortableRo(current.revision));
      const exported = await client.exportProject(current.revision);
      const fresh = kit.createExperimentalDesignerClient();
      const reopened = await fresh.openProject(exported.bytes.slice(0));
      const reopenedGroups = await fresh.queryKeyedGroupedSum(definitionId);
      const reopenedExport = await fresh.exportProject(reopenedGroups.revision);
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
      return {beforeDefinition, initial: projection(initial), current: projection(current), canonicalRefusal, portableRefusal, reopened: projection(reopenedGroups), reopenedBootstrapRevision: reopened.bootstrap.revision, duplicate: projection(duplicate), missing: projection(missing), exportBytes: [...new Uint8Array(exported.bytes)], reopenedExportBytes: [...new Uint8Array(reopenedExport.bytes)], publicationRevision: published.publication.resulting_revision, editRevision: edit.resulting_revision};
    } catch (error) { try { await client.close(); } catch {} throw error; }
  }, {entries: fixture.map(file => ({path: file.path, bytes: [...new Uint8Array(file.bytes)]})), fields, catalogSchema, salesSchema, definitionId, expectedBefore: expectedBeforeDefinition});
  assert.deepEqual(result.beforeDefinition, expectedBeforeDefinition);
  assert.deepEqual(result.initial.groups, [{category: 'NOTE', value: 1000}, {category: 'PEN', value: 800}]);
  assert.deepEqual(result.initial.diagnostics, []);
  assert.equal(result.initial.revision, result.publicationRevision);
  assert.deepEqual(result.current.groups, [{category: 'NOTE', value: 1000}, {category: 'PEN', value: 1000}]);
  assert.deepEqual(result.current.diagnostics, []);
  assert.equal(result.current.revision, result.editRevision); assert.notEqual(result.current.revision, result.initial.revision);
  const expectedV1Refusal = {code: 'invalid_project', message: 'canonical project admission failed: invalid .roproj representation: saved keyed grouped-sum definitions require .roproj/v2'};
  assert.deepEqual(result.canonicalRefusal, expectedV1Refusal);
  assert.deepEqual(result.portableRefusal, expectedV1Refusal);
  assert.deepEqual(result.reopened.groups, [{category: 'NOTE', value: 1000}, {category: 'PEN', value: 1000}]);
  assert.deepEqual(result.reopened.diagnostics, []); assert.equal(result.reopened.revision, result.reopenedBootstrapRevision);
  assert.deepEqual(result.duplicate.groups, []);
  assert.deepEqual(result.duplicate.diagnostics, [
    {code: 'lookup.ambiguous_key', lookupKey: 'PEN'},
    {code: 'lookup.ambiguous_key', lookupKey: 'PEN'},
    {code: 'lookup.missing_key', lookupKey: 'NOTE'},
  ]);
  assert.deepEqual(result.missing.groups, []);
  assert.deepEqual(result.missing.diagnostics, [{code: 'lookup.missing_key', lookupKey: 'MISSING'}]);
  inspectOpaqueFormat2Transfer(result.exportBytes);
  inspectOpaqueFormat2Transfer(result.reopenedExportBytes);
  assert.throws(() => assertPersistedDefinition([{...expectedPersistedDefinition[0], products: {...expectedPersistedDefinition[0].products, category_field: fields.code}}]), /Persisted J4 definition bindings changed/);
  console.log(JSON.stringify({status: 'PASS_PREPARATION_CORE_BOUNDARY_ONLY', fixtureSha256, sourceCommit: lock.sourceCommit, manifest: lock.artifactManifestSha256, refusals: {canonical: result.canonicalRefusal, portable: result.portableRefusal}, staticCheckerFacts: {lineTotals: [600, 1000, 200], total: 1800, afterPrice250: {lineTotals: [750, 1000, 250], total: 2000}}, normalUI: 'NOT_TESTED', hostDurability: 'NOT_TESTED', realImeAccessibility: 'NOT_TESTED'}));
} catch (error) {
  console.error(JSON.stringify({status: error.blocked ? 'BLOCKED' : 'FAIL_OR_UNQUALIFIED', message: String(error.stack ?? error)})); process.exitCode = error.blocked ? 78 : 1;
} finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
