// #197: real producer v3 folders through Open, private copies and full browser exit.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { LOCAL_ORIGIN, installDistRoutes } from './dist-routes.mjs';
import { openFolder, waitForColdHome } from './home-entry.mjs';

const dist = process.env.WORK_DIST;
assert.ok(dist, 'WORK_DIST must name a built product');
const work = await mkdtemp(path.join(tmpdir(), 'sheet-v3-folder-'));
const profile = path.join(work, 'profile');
const results = [], processes = [];
let context, page, pid;
const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
function alive(id) { try { process.kill(id, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } }
async function stop() {
  if (!context) return;
  await context.close(); context = undefined;
  const deadline = Date.now() + 10000;
  while (alive(pid) && Date.now() < deadline) await delay(50);
  assert.equal(alive(pid), false, 'actual browser process exit');
  processes.at(-1).exitObserved = true;
}
async function start() {
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === '1' ? { args: ['--single-process'] } : {}),
  });
  const cdp = await context.browser().newBrowserCDPSession();
  pid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser')?.id;
  await cdp.detach(); assert.ok(pid > 0); processes.push({pid, profile});
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__v3 = {tables: [], requests: [], replies: []};
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', event => {
        window.__v3.replies.push(structuredClone(event.data));
        if (event.data.response?.type === 'table') window.__v3.tables.push(structuredClone(event.data.response.payload));
      }); }
      postMessage(message, ...args) { window.__v3.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
    };
  });
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8000); await page.setViewportSize({width: 1400, height: 1000});
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
}
const table = () => page.evaluate(() => window.__v3.tables.at(-1));
async function edit(amount) {
  await page.getByRole('tab', {name: 'Table', exact: true}).click();
  const t = await table(), col = t.columns.find(c => c.display_name === 'Amount');
  await page.getByTestId(`cell:${t.rows[0].id}:${col.id}`).dblclick();
  const editor = page.getByRole('textbox', {name: 'Edit cell', exact: true});
  await editor.fill(String(amount)); await editor.press('Enter'); await ready();
  const edited = await table();
  assert.equal(edited.rows[0].fields.find(f => f.target.field === col.id).stored.value, amount);
}
async function saved() {
  await page.getByTestId('save-status').filter({hasText: 'Saved on this device'}).waitFor();
  assert.equal(await page.locator('.ts-app-root').getAttribute('data-work-dirty'), 'false');
}
async function saveCopy(name) {
  await page.getByRole('button', {name: 'Save a copy', exact: true}).click();
  const d = page.getByRole('dialog', {name: 'Save a copy', exact: true});
  await d.getByLabel('Copy name', {exact: true}).fill(name);
  await d.getByRole('button', {name: 'Create copy', exact: true}).click();
  await d.waitFor({state: 'detached'}); await saved();
}
async function createSummary() {
  await page.getByRole('tab', {name: 'Cross-table summary', exact: true}).click();
  await page.getByRole('button', {name: 'Choose tables and fields', exact: true}).click();
  for (const label of ['Orders table', 'Products table']) await page.getByLabel(label, {exact: true}).selectOption({label: 'Folder Expenses'});
  for (const [label, value] of [['Order lookup key', 'Item Name'], ['Order quantity', 'Amount'], ['Product key', 'Item Name'], ['Product category', 'Category'], ['Product price', 'Amount']]) {
    await page.getByLabel(label, {exact: true}).selectOption({label: value});
  }
  await page.getByRole('button', {name: 'Create cross-table summary', exact: true}).click();
  await page.getByLabel('Cross-table groups', {exact: true}).waitFor(); await ready();
}
async function makeFolder(variant) {
  const generated = await page.evaluate(async ({date, summary}) => {
    const kit = await import('/core-kit/experimental-client.js');
    const core = kit.createExperimentalDesignerClient();
    try {
      const columns = [{name: 'Item Name', field_type: 'text'}, {name: 'Category', field_type: 'text'}, {name: 'Amount', field_type: 'number'}];
      if (date) columns.push({name: 'When', field_type: 'date'});
      const opened = await core.newTable('Folder Expenses', columns);
      let revision = opened.bootstrap.revision;
      const t = opened.table;
      const values = ['Tea', '飲食', '4', '2026-10-15'];
      const inserted = await core.trackerCommand({type: 'insert_row', expected_revision: revision, collection: t.collection.key,
        initializers: t.columns.map((col, i) => ({field: col.id, input: col.field_type === 'number' ? {kind: 'number', input: values[i]} : {kind: col.field_type, value: values[i]}})),
      });
      revision = inserted.resulting_revision;
      if (summary) {
        const s = await core.createKeyedGroupedSum(revision, {id: 'folder_summary', orders_schema: t.collection.id,
          order_lookup_key_field: t.columns[0].id, order_quantity_field: t.columns[2].id,
          products_schema: t.collection.id, product_key_field: t.columns[0].id,
          product_category_field: t.columns[1].id, product_price_field: t.columns[2].id});
        revision = s.publication.resulting_revision;
      }
      // Explicit producer v3 bytes, admitted again before asking the producer
      // for the actual canonical directory. No frontend manifest construction.
      const transfer = await core.exportProjectV3(revision);
      const reopened = await core.openProject(transfer.bytes);
      const tree = await core.exportCanonicalTree(reopened.bootstrap.revision);
      return {files: tree.files.map(f => ({path: f.path, bytes: Array.from(new Uint8Array(f.bytes))})), table: reopened.table};
    } finally { await core.close(); }
  }, variant);
  assert.equal(generated.files.length, 19, 'real complete .roproj/v3 directory');
  const folder = path.join(work, variant.name + '.roproj');
  for (const f of generated.files) {
    const filename = path.join(folder, f.path); await mkdir(path.dirname(filename), {recursive: true}); await writeFile(filename, Buffer.from(f.bytes));
  }
  return {folder, baseline: generated.table};
}
async function oracle(name, expectedTable, summary) {
  const actual = await page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tachiko-sheet-local-copies', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    let record;
    for (const store of ['copies', 'opaque-copies']) {
      if (!db.objectStoreNames.contains(store)) continue;
      const found = await new Promise((resolve, reject) => { const r = db.transaction(store, 'readonly').objectStore(store).get(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      if (found) record = found;
    }
    db.close(); if (!record) throw new Error('Missing saved copy');
    const kit = await import('/core-kit/experimental-client.js'); const core = kit.createExperimentalDesignerClient();
    try {
      const opened = record.kind === 'work-file' ? await core.openPortableRo(record.bytes.slice(0))
        : record.bytes ? await core.openProject(record.bytes.slice(0)) : await core.openCanonicalTree(record.files);
      const table = await core.queryTable(opened.bootstrap.default_collection);
      const groups = await Promise.all((opened.bootstrap.keyed_grouped_sum_definition_ids ?? []).map(id => core.queryKeyedGroupedSum(id)));
      return {table, groups};
    } finally {await core.close();}
  }, name);
  assert.deepEqual(actual.table.collection, expectedTable.collection, 'saved names, keys and collection identity');
  assert.deepEqual(actual.table.columns, expectedTable.columns, 'every saved column identity, type and name');
  assert.deepEqual(actual.table.rows, expectedTable.rows, 'every saved row, target and stored value');
  assert.equal(actual.groups.length, summary ? 1 : 0);
  if (summary) {
    assert.deepEqual(actual.groups[0].diagnostics, []);
    const amount = expectedTable.rows[0].fields.find(f => f.target.field === expectedTable.columns[2].id).stored.value;
    assert.deepEqual(actual.groups[0].groups.map(({category, value}) => ({category, value})), [{category: '飲食', value: amount * amount}]);
  }
}
try {
  for (const variant of [
    {name: 'summary-added', date: false, summary: false, addSummary: true},
    {name: 'date', date: true, summary: false},
    {name: 'summary-existing', date: false, summary: true},
    {name: 'date-summary', date: true, summary: true},
  ]) {
    try {
      await start();
      const {folder, baseline} = await makeFolder(variant);
      await openFolder(page, folder); // Actual Home folder input, not a runtime seam.
      const opened = await table(); assert.deepEqual(opened.rows, baseline.rows); assert.deepEqual(opened.columns, baseline.columns);
      if (variant.addSummary) await createSummary();
      const summary = variant.summary || variant.addSummary;
      await edit(5); await saveCopy(variant.name);
      const first = await table(); await oracle(variant.name, first, summary);
      await stop(); await start(); // Full process exit and same persistent profile.
      await page.getByRole('button', {name: `Open saved ${variant.name}`, exact: true}).click(); await ready();
      assert.deepEqual((await table()).rows, first.rows); assert.deepEqual((await table()).columns, first.columns);
      await oracle(variant.name, first, summary);
      // A cold Home reopen of the stored explicit-v3 opaque carrier must also
      // retry ordinary export, before any cached origin flag exists.
      await edit(6); await page.getByRole('button', {name: 'Save', exact: true}).click(); await saved();
      await oracle(variant.name, await table(), summary);
      await edit(7);
      const final = await table();
      await page.getByRole('button', {name: 'Close project', exact: true}).click();
      await page.getByRole('dialog', {name: 'Unsaved work', exact: true}).getByRole('button', {name: 'Save', exact: true}).click();
      await waitForColdHome(page);
      await stop(); await start();
      await page.getByRole('button', {name: `Open saved ${variant.name}`, exact: true}).click(); await ready();
      assert.deepEqual((await table()).rows, final.rows); assert.deepEqual((await table()).columns, final.columns);
      await oracle(variant.name, final, summary);
      results.push({variant: variant.name, status: 'PASS', checks: '19-file-folder-open-edit-copy-full-restart-Home-reopen-bound-Save-Close-Save-full-restart-independent-core-oracle'});
    } catch (error) {
      const text = page && !page.isClosed() ? await page.locator('body').innerText() : '';
      results.push({variant: variant.name, status: 'FAIL', error: String(error), text});
    } finally {await stop();}
  }
  const selection = 'REAL_DIRECTORY_SELECTION';
  console.log(JSON.stringify({work, selection, results, processes}));
  await writeFile(path.join(work, 'receipt.json'), JSON.stringify({selection, results, processes}, null, 2));
  assert.equal(results.filter(r => r.status === 'FAIL').length, 0, 'all v3 folder persistence scenarios pass');
} finally {await stop();}
