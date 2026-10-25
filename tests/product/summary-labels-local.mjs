import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { LOCAL_ORIGIN, installDistRoutes } from './dist-routes.mjs';
import { waitForColdHome, homeImportInput } from './home-entry.mjs';

const dist = process.env.WORK_DIST;
assert.ok(dist, 'WORK_DIST must name a production build');
const work = await mkdtemp(path.join(tmpdir(), 'sheet235-'));
const profile = path.join(work, 'profile');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === '1' ? { args: ['--single-process'] } : {}),
  });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__summaryLabels = { tables: [], requests: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.response?.type === 'table') window.__summaryLabels.tables.push(structuredClone(event.data.response.payload));
        });
      }
      postMessage(message, ...args) {
        window.__summaryLabels.requests.push(structuredClone(message));
        return super.postMessage(message, ...args);
      }
    };
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const projection = () => page.evaluate(() => window.__summaryLabels.tables.at(-1));

  await (await homeImportInput(page)).setInputFiles({
    name: 'summary-labels.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Item,Quantity,Price\nTea,2,3\n'),
  });
  const preview = page.getByRole('dialog', { name: 'Review import preview', exact: true });
  for (const [index, type] of ['text', 'number', 'number'].entries()) await preview.locator('select').nth(index).selectOption(type);
  await preview.getByRole('button', { name: 'Import file', exact: true }).click();
  await preview.waitFor({ state: 'detached' });
  await ready();
  const imported = await projection();

  const rename = async name => {
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await page.locator('.ts-col-head').first().dblclick();
    const dialog = page.getByRole('dialog', { name: 'Rename column', exact: true });
    await dialog.getByLabel('Column name', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Rename column', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await ready();
  };
  const assertLabels = async firstLabel => {
    await page.getByRole('tab', { name: 'Cross-table summary', exact: true }).click();
    const prepare = page.getByRole('button', { name: 'Choose tables and fields', exact: true });
    if (await prepare.count()) await prepare.click();
    await page.locator('.ts-summary-fields select option[value="column_1"]').first().waitFor({ state: 'attached' });
    const expected = imported.columns.map((column, index) => ({ value: column.key, text: [firstLabel, 'Quantity', 'Price'][index] }));
    for (const [label, index] of [
      ['Order lookup key', 1], ['Order quantity', 2], ['Product key', 4], ['Product category', 5], ['Product price', 6],
    ]) {
      const actual = await page.locator('.ts-summary-fields select').nth(index).locator('option').evaluateAll(options => options.filter(option => option.value).map(option => ({ value: option.value, text: option.textContent })));
      assert.deepEqual(actual, expected, `${label}: display labels change while binding keys stay stable`);
    }
  };

  await rename('Chosen item');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready();
  assert.equal(await page.locator('.ts-col-head').first().textContent(), 'Item');
  assert.deepEqual((await projection()).columns, imported.columns);
  await assertLabels('Item');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready();
  await assertLabels('Chosen item');
  await rename('column_1');
  assert.equal((await projection()).columns[0].display_name_explicit, true);
  await assertLabels('column_1');

  for (const [label, name] of [
    ['Order lookup key', 'column_1'], ['Order quantity', 'Quantity'], ['Product key', 'column_1'],
    ['Product category', 'column_1'], ['Product price', 'Price'],
  ]) await page.getByLabel(label, { exact: true }).selectOption({ label: name });
  await page.getByRole('button', { name: 'Create cross-table summary', exact: true }).click();
  await ready();
  const request = await page.evaluate(() => window.__summaryLabels.requests.findLast(message => message.request?.type === 'create_keyed_grouped_sum')?.request);
  assert.ok(request, 'summary creation reaches Work');
  assert.deepEqual([request.definition.orders_schema, request.definition.products_schema], [imported.collection.id, imported.collection.id]);
  assert.deepEqual([
    request.definition.order_lookup_key_field, request.definition.order_quantity_field, request.definition.product_key_field,
    request.definition.product_category_field, request.definition.product_price_field,
  ], [imported.columns[0].id, imported.columns[1].id, imported.columns[0].id, imported.columns[0].id, imported.columns[2].id]);
  assert.deepEqual(await page.getByLabel('Cross-table groups', { exact: true }).locator('tbody tr').allTextContents(), ['Tea6']);
  await writeFile(path.join(work, 'receipt.json'), JSON.stringify({ status: 'PASS', result: 'import-rename-undo-redo-labels-and-stable-summary-identities' }));
  console.log(JSON.stringify({ status: 'PASS', work, result: 'import-rename-undo-redo-labels-and-stable-summary-identities' }));
} catch (error) {
  if (context) {
    const page = context.pages()[0];
    if (page && !page.isClosed()) {
      await writeFile(path.join(work, 'failure.json'), JSON.stringify(await page.evaluate(() => ({
        body: document.body.innerText,
        selects: [...document.querySelectorAll('select')].map(select => ({ id: select.id, className: select.className, html: select.outerHTML })),
        summary: document.querySelector('[aria-label="Cross-table summary setup"]')?.outerHTML,
        evidence: window.__summaryLabels,
      })), null, 2));
    }
  }
  console.error({ work });
  throw error;
} finally {
  await context?.close();
}
