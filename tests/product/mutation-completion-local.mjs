// #189 characterization: normal production controls + real Worker/WASM replies.
// Faults discard a real acknowledgement/observation; no semantic reply is invented.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { LOCAL_ORIGIN, installDistRoutes } from './dist-routes.mjs';
import { waitForColdHome, homeImportInput } from './home-entry.mjs';
const dist = process.env.WORK_DIST ?? 'dist';
const root = await mkdtemp(path.join(tmpdir(), 'sheet189-characterization-'));
const checks = [];
const button = (p, name) => p.getByRole('button', { name, exact: true });
const ready = p => p.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
async function unload(p) { return p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }); }
async function table(p) { return p.evaluate(() => window.__completion.tables.at(-1)); }
async function count(p, type) { return p.evaluate(type => window.__completion.requests.filter(r => r.request?.type === type).length, type); }
async function scalar(p, value) {
  await p.getByRole('tab', { name: 'Table', exact: true }).click();
  const t = await table(p), col = t.columns.find(c => c.field_type === 'number'), row = t.rows[0];
  const cell = p.getByTestId(`cell:${row.id}:${col.id}`);
  await cell.dblclick(); const input = p.getByRole('textbox', { name: 'Edit cell', exact: true });
  await input.fill(String(value)); await input.press('Enter'); return cell;
}
async function binding(p, invalid = false) {
  await p.getByRole('tab', { name: 'Cross-table summary', exact: true }).click();
  const choose = button(p, 'Choose tables and fields'); if (await choose.count()) await choose.click();
  for (const [label, value] of Object.entries({ 'Orders table': 'sales', 'Order lookup key': 'product_code', 'Order quantity': invalid ? 'product_code' : 'quantity', 'Products table': 'catalog', 'Product key': 'code', 'Product category': 'category', 'Product price': 'price' })) await p.getByLabel(label, { exact: true }).selectOption(value);
}
async function close(p) {
  await button(p, await button(p, 'Close project').count() ? 'Close project' : 'Close and abandon recovery').click();
  const d = p.getByRole('dialog', { name: 'Unsaved work', exact: true });
  if (await d.count()) await button(d, 'Close without saving').click();
  await waitForColdHome(p);
}
async function save(p) {
  await button(p, 'Save a copy').click(); const d = p.getByRole('dialog', { name: 'Save a copy', exact: true });
  await d.getByLabel('Copy name', { exact: true }).fill('characterized'); await button(d, 'Create copy').click();
  await p.getByTestId('save-status').filter({ hasText: 'Saved on this device' }).waitFor();
  assert.equal(await unload(p), false, 'settled Save removes unload protection');
}
async function run(name, action) {
  if (process.env.MUTATION_CASE && name !== process.env.MUTATION_CASE) return;
  const context = await chromium.launchPersistentContext(path.join(root, name), { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === '1' ? { args: ['--single-process'] } : {}) });
  try {
    await installDistRoutes(context, dist);
    await context.addInitScript(() => {
      const e = window.__completion = { requests: [], tables: [], replies: [] };
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args); e.worker = this;
          this.addEventListener('message', event => {
            const data = event.data, req = e.requests.find(r => r.id === data.id);
            e.replies.push(structuredClone(data));
            if (data.response?.type === 'table') e.tables.push(structuredClone(data.response.payload));
            if (e.arm?.type === req?.request?.type && ['published', 'opened', 'keyed_grouped_sum_published'].includes(data.response?.type)) {
              const mode = e.arm.mode; e.arm = null;
              if (mode === 'hold') { event.stopImmediatePropagation(); e.held = data; return; }
              if (mode === 'unknown') {
                event.stopImmediatePropagation(); this.dispatchEvent(new ErrorEvent('error', { message: 'Characterization: lost real acknowledgement' }));
              } else e.loseTable = true;
            } else if (e.loseTable && req?.request?.type === 'query_table') {
              e.loseTable = false; event.stopImmediatePropagation();
              this.dispatchEvent(new ErrorEvent('error', { message: 'Characterization: lost real projection' }));
            }
          });
        }
        postMessage(data, ...args) { e.requests.push(structuredClone(data)); return super.postMessage(data, ...args); }
      };
    });
    const p = context.pages()[0]; p.setDefaultTimeout(8000); await p.goto(LOCAL_ORIGIN); await waitForColdHome(p);
    await action(p); checks.push(name); console.log(`PASS ${name}`);
  } catch (error) { console.error(`FAIL ${name}`); throw error; }
  finally { await context.close(); }
}
for (const mode of ['published', 'known', 'unknown', 'refused']) {
  for (const command of ['scalar', 'insert', 'delete', 'undo', 'redo', 'cleanup', 'summary']) {
    // Delete and history have no ordinary UI input which can provoke a trusted
    // refusal. Adapter unit tests cover those refusals; don't fabricate core data.
    if (mode === 'refused' && ['delete', 'undo', 'redo', 'cleanup'].includes(command)) continue;
    await run(`${command}-${mode}`, async p => {
      if (command === 'cleanup') {
        await homeImportInput(p);
        await p.locator('input[type=file][accept*=".csv"]').setInputFiles({ name: 'trim.csv', mimeType: 'text/csv', buffer: Buffer.from('item,amount\n Tea ,4\n Train ,12\n') });
        await button(p, 'Import candidate').click(); await ready(p);
        await p.getByRole('tab', { name: 'Import & export', exact: true }).click();
        await button(p, 'Preview trimming spaces').click(); await p.getByTestId('cleanup-preview').waitFor();
      } else {
        await button(p, 'Open sales example').click(); await ready(p);
        if (['undo', 'redo'].includes(command)) {
          await scalar(p, 250); await ready(p);
          if (command === 'redo') { await button(p, 'Undo').click(); await ready(p); }
        }
        if (command === 'summary') await binding(p, mode === 'refused');
      }
      const before = await table(p);
      // Capture occurrence markers before dispatch, and inspect completion
      // before Refresh can repair missing marker effects.
      const markerSnapshot = () => p.locator('.ts-app-root').evaluate(node => ({
        initial: node.getAttribute('data-sales-initial-occurrence'),
        changed: node.getAttribute('data-sales-changed-occurrence'),
      }));
      const priorMarkers = await markerSnapshot();
      if (command !== 'cleanup') assert.ok(priorMarkers.initial ?? priorMarkers.changed,
        'Sales occurrence marker must exist before dispatch; missing marker attributes cannot pass vacuously');
      const type = { scalar: 'edit_scalar', insert: 'insert_row', delete: 'remove_table_rows', undo: 'undo', redo: 'redo', cleanup: 'commit_cleanup', summary: 'create_keyed_grouped_sum' }[command];
      const n = await count(p, type);
      if (['known', 'unknown'].includes(mode)) await p.evaluate(arm => { window.__completion.arm = arm; }, { type, mode });
      if (command === 'scalar') await scalar(p, mode === 'refused' ? 'abc' : 250);
      if (command === 'insert') {
        const entry = p.locator('.ts-entry-row');
        for (const col of before.columns) {
          const input = entry.locator(`[data-entry-field="${col.id}"]`);
          if (col.field_type === 'number') await input.fill(mode === 'refused' ? 'abc' : '5');
          else await input.fill('NEW');
        }
        await button(entry, 'Add').click();
      }
      if (command === 'delete') { await p.getByTestId(`cell:${before.rows[0].id}:${before.columns[0].id}`).focus(); await button(p, 'Delete row').click(); }
      if (['undo', 'redo'].includes(command)) await button(p, command === 'undo' ? 'Undo' : 'Redo').click();
      if (command === 'cleanup') await button(p, 'Apply preview').click();
      if (command === 'summary') await button(p, 'Create cross-table summary').click();
      if (['known', 'unknown'].includes(mode)) {
        await p.getByRole('heading', { name: 'Refresh required', exact: true }).waitFor();
        assert.equal(await p.locator('[data-work-dirty]').getAttribute('data-work-dirty'), 'true');
        assert.equal(await unload(p), true);
        assert.equal(await p.locator('td[data-testid^="cell:"]').count(), 0);
        assert.equal(await p.getByTestId('operation-outcome').count(), mode === 'unknown' ? 1 : 0);
        const markers = await markerSnapshot();
        if (mode === 'unknown') assert.deepEqual(markers, priorMarkers, 'unknown completion preserves unconfirmed onboarding markers before Refresh');
        else {
          assert.equal(markers.initial, null, 'known publication ends initial onboarding at completion');
          assert.equal(markers.changed, command === 'cleanup' || command === 'summary' ? priorMarkers.changed : priorMarkers.initial ?? priorMarkers.changed,
            'known scalar/row/history publication marks Sales changed before Refresh');
        }
        await button(p, 'Refresh').click(); await ready(p);
        assert.equal(await count(p, type), n + 1, 'Refresh observes without replay');
        assert.equal(await unload(p), true, 'Refresh cannot invent a Save receipt');
        if (command === 'scalar' && mode === 'unknown') assert.match(await p.locator('body').textContent(), /Input.*retained|input was retained/);
      } else {
        await ready(p);
        if (mode === 'refused') {
          assert.equal((await table(p)).revision, before.revision, 'trusted refusal preserves revision');
          assert.equal(await (command === 'summary' ? p.locator('[data-testid^="j4-result-"]') : p.getByTestId('results-pane').locator('.ts-result-card')).count(), 1, 'refusal restores summary');
          if (command === 'scalar') assert.equal(await p.getByRole('textbox', { name: 'Edit cell', exact: true }).inputValue(), 'abc');
          if (command === 'insert') assert.equal(await p.locator('.ts-entry-row [aria-invalid=true]').first().inputValue(), 'abc');
          return;
        }
        assert.notEqual((await table(p)).revision, before.revision);
        assert.equal(await unload(p), true);
      }
      const after = await table(p);
      if (command === 'insert') assert.equal(after.rows.length, before.rows.length + 1);
      if (command === 'delete') assert.equal(after.rows.length, before.rows.length - 1);
      if (command === 'scalar') assert.match(await p.getByTestId('results-pane').textContent(), /1,?000/);
      if (command === 'cleanup') assert.equal(await p.getByTestId('cleanup-preview').count(), 0);
      if (['scalar', 'insert', 'delete', 'undo', 'redo'].includes(command)) {
        assert.equal(await p.getByTestId('work-state').textContent(), 'Edited — not saved');
        assert.equal(await p.getByTestId('results-pane').locator('.ts-result-card').count(), 1);
        assert.equal(await button(p, 'Undo').isEnabled(), mode === 'published' && command !== 'undo');
      }
      await button(p, 'Close project').click(); await p.getByRole('dialog', { name: 'Unsaved work', exact: true }).waitFor();
      await button(p, 'Keep editing').click(); assert.equal(await p.getByTestId('project-ready').count(), 1);
    });
  }
}
for (const mode of ['published', 'known', 'unknown']) await run(`new-table-${mode}`, async p => {
  await button(p, 'New table').click(); const d = p.getByRole('dialog', { name: 'New table', exact: true });
  await d.getByLabel('Table name', { exact: true }).fill('Characterized');
  if (mode !== 'published') await p.evaluate(arm => { window.__completion.arm = arm; }, { type: 'new_table', mode });
  await button(d, 'Create table').click();
  if (mode !== 'published') {
    await d.getByRole('alert').waitFor(); assert.equal(await d.getByLabel('Table name', { exact: true }).inputValue(), 'Characterized');
    assert.equal(await p.getByTestId('project-ready').count(), 0); assert.equal(await unload(p), true);
    assert.equal(await count(p, 'new_table'), 1); return;
  }
  await ready(p); await d.waitFor({ state: 'detached' });
  await p.waitForFunction(() => document.activeElement?.matches('.ts-entry-row [data-entry-field]'));
  assert.equal(await unload(p), true); await save(p); await close(p);
  await button(p, 'Open saved characterized').click(); await ready(p);
  await p.locator('.ts-entry-row input').fill('Tea'); await button(p.locator('.ts-entry-row'), 'Add').click(); await ready(p);
  assert.equal(await unload(p), true); await button(p, 'Save').click();
  await p.getByTestId('save-status').filter({ hasText: 'Saved on this device' }).waitFor(); assert.equal(await unload(p), false);
});
await run('scalar-newer-focus-intent', async p => {
  await button(p, 'Open sales example').click(); await ready(p);
  await p.evaluate(() => { window.__completion.arm = { type: 'edit_scalar', mode: 'hold' }; });
  const cell = await scalar(p, 250);
  await p.waitForFunction(() => Boolean(window.__completion.held));
  const destination = button(p, 'Appearance'); await destination.focus();
  await p.evaluate(() => { const e = window.__completion; const data = e.held; e.held = null; e.worker.dispatchEvent(new MessageEvent('message', { data })); });
  await ready(p);
  assert.equal(await destination.evaluate(e => e === document.activeElement), true);
  assert.equal(await cell.getAttribute('tabindex'), '0', 'roving target remains valid without stealing DOM focus');
});
await run('summary-targeted-refresh', async p => {
  await button(p, 'Open sales example').click(); await ready(p);
  await binding(p); await button(p, 'Create cross-table summary').click(); await ready(p);
  const before = await table(p), dirty = await p.locator('[data-work-dirty]').getAttribute('data-work-dirty');
  const results = p.locator('[data-testid^="j4-result-"]');
  assert.equal(await results.count(), 2);
  await button(p, 'Refresh summary').first().click(); await ready(p);
  assert.equal((await table(p)).revision, before.revision, 'targeted Refresh publishes nothing');
  assert.equal(await results.count(), 2, 'targeted Refresh retains siblings');
  assert.equal(await p.locator('[data-work-dirty]').getAttribute('data-work-dirty'), dirty);
});
// Exercise App's real recovery/Refresh/Save adapters. The seam's mock port
// cannot prove openedFromWorkFile survives into the persisted carrier.
for (const mode of ['published', 'known', 'unknown']) await run(`work-file-origin-after-mutation-${mode}`, async p => {
  const bytes = await p.evaluate(async () => {
    const kit = await import('/core-kit/experimental-client.js'), client = kit.createExperimentalDesignerClient();
    try {
      await client.newTable('Portable', [{ name: 'Amount', field_type: 'number' }]);
      const w = await client.observeOccurrence(); return Array.from(new Uint8Array((await client.exportPortableRo(w.revision)).bytes));
    } finally { client.close(); }
  });
  await p.getByTestId('open-work-file').setInputFiles({ name: 'source.ro', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }); await ready(p);
  const before = await table(p), inserts = await count(p, 'insert_row');
  const entry = p.locator('.ts-entry-row'); await entry.locator('input').fill('4');
  if (mode !== 'published') await p.evaluate(mode => { window.__completion.arm = { type: 'insert_row', mode }; }, mode);
  await button(entry, 'Add').click();
  if (mode !== 'published') {
    await p.getByRole('heading', { name: 'Refresh required', exact: true }).waitFor();
    assert.equal(await p.getByTestId('currentness').getAttribute('data-currentness'), 'unknown');
    assert.equal(await p.getByTestId('operation-outcome').count(), mode === 'unknown' ? 1 : 0,
      'only a lost acknowledgement reports an unknown operation outcome');
    const message = await p.locator('body').textContent();
    if (mode === 'known') assert.match(message, /The change was applied, but the current values could not be confirmed/);
    else assert.match(message, /The row change request was dispatched but could not be confirmed/);
    assert.equal(await button(p, 'Save a copy').count(), 0, 'recovery withholds Save until Refresh confirms the resident work');
    await button(p, 'Refresh').click();
  }
  await ready(p);
  assert.equal(await p.getByTestId('currentness').getAttribute('data-currentness'), 'current');
  assert.equal(await count(p, 'insert_row'), inserts + 1, 'Refresh observes without replaying the mutation');
  const after = await table(p);
  assert.notEqual(after.revision, before.revision, 'Refresh confirms the real publication');
  assert.equal(after.rows.length, before.rows.length + 1);
  assert.equal(after.rows[0].fields.find(field => field.target.field === after.columns[0].id).stored.value, 4);
  assert.equal(await unload(p), true, 'confirmed publication still needs a durable Save');
  // Recovery retains the row draft for review; explicitly discard it before Save.
  if (mode !== 'published') await button(p.locator('.ts-entry-row'), 'Clear').click();
  await save(p);
  const kind = await p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tachiko-sheet-local-copies', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise((resolve, reject) => { const r = db.transaction('opaque-copies').objectStore('opaque-copies').get('characterized'); r.onsuccess = () => resolve(r.result?.kind); r.onerror = () => reject(r.error); }); }
    finally { db.close(); }
  });
  assert.equal(kind, 'work-file', `openedFromWorkFile survives ${mode} completion and selects the real Save carrier`);
});
await rm(root, { recursive: true, force: true });
console.log(JSON.stringify({ status: 'PASS', checks, dist }));
