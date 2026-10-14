// #185 production UI, real kit and IndexedDB. Select cases separately so every
// new regression has a behavioral RED receipt on the unchanged base build.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { LOCAL_ORIGIN, installDistRoutes } from './dist-routes.mjs';
import { waitForColdHome, openReleasePlanExample } from './home-entry.mjs';
const dist = process.env.WORK_DIST;
if (!dist) throw new Error('BLOCKED: WORK_DIST must name a production build');
const work = await mkdtemp(path.join(tmpdir(), 'sheet185-'));
let profile = path.join(work, 'profile');
const checks = [], processes = [];
let context, pid;
const ready = p => p.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const button = (p, name) => p.getByRole('button', { name, exact: true });
const saved = p => p.getByTestId('save-status').filter({ hasText: 'Saved on this device' }).waitFor();
const conflict = 'This copy changed in another window. Save a copy instead.';
async function start() {
  assert.equal(context, undefined);
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === '1' ? { args: ['--single-process'] } : {}) });
  const cdp = await context.browser().newBrowserCDPSession();
  pid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser').id;
  await cdp.detach(); processes.push({ pid, profile });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__saveEvidence = { requests: [], tables: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', e => {
          if (e.data.response?.type === 'table') {
            if (window.__saveEvidence.failNextTable) {
              window.__saveEvidence.failNextTable = false;
              e.stopImmediatePropagation();
              this.dispatchEvent(new ErrorEvent('error', { message: 'Controlled lost observation' }));
              return;
            }
            window.__saveEvidence.tables.push(structuredClone(e.data.response.payload));
          }
          if (window.__saveEvidence.staleExport && ['canonical_tree_exported', 'project_exported', 'portable_ro_exported'].includes(e.data.status)) {
            window.__saveEvidence.staleExport = false;
            e.data.export.revision = 'controlled-stale-revision';
          }
        });
      }
      postMessage(message, ...rest) { window.__saveEvidence.requests.push(structuredClone(message)); super.postMessage(message, ...rest); }
    };
  });
  return newPage(context.pages()[0]);
}
async function newPage(p = undefined) {
  p ??= await context.newPage(); p.setDefaultTimeout(7000);
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(LOCAL_ORIGIN); await waitForColdHome(p); return p;
}
function exists(id) { try { process.kill(id, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } }
async function terminate() {
  if (!context) return;
  const owned = pid; await context.close();
  const deadline = Date.now() + 5000; while (exists(owned) && Date.now() < deadline) await delay(50);
  assert.equal(exists(owned), false, 'browser process must exit before same-profile restart');
  processes.at(-1).exitObserved = true; context = pid = undefined;
}
async function projection(p) { return p.evaluate(() => window.__saveEvidence.tables.at(-1)); }
async function edit(p, value) {
  await p.getByRole('tab', { name: 'Table', exact: true }).click();
  const table = await projection(p);
  const field = table.columns.find(c => c.field_type === 'number') ?? table.columns[0];
  const row = table.rows[0]; const id = `cell:${row.id}:${field.id}`;
  await p.getByTestId(id).dblclick(); const editor = p.getByRole('textbox', { name: 'Edit cell', exact: true });
  await editor.fill(String(value)); await editor.press('Enter'); await ready(p);
  assert.equal((await p.getByTestId(id).textContent()).trim(), String(value));
  return { row: row.id, field: field.id, collection: table.collection.key, value };
}
async function copy(p, name, primary = false) {
  await button(p, primary ? 'Save' : 'Save a copy').click();
  const dialog = p.getByRole('dialog', { name: 'Save a copy', exact: true });
  await dialog.getByRole('textbox', { name: 'Copy name', exact: true }).fill(name);
  await button(dialog, 'Create copy').click(); await dialog.waitFor({ state: 'detached' }); await saved(p);
}
async function close(p) {
  await button(p, 'Close project').click(); const d = p.getByRole('dialog', { name: 'Unsaved work', exact: true });
  if (await d.count()) await button(d, 'Close without saving').click(); await waitForColdHome(p);
}
async function open(p, name) { await button(p, `Open saved ${name}`).click(); await ready(p); }
async function records(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tachiko-sheet-local-copies', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = {};
    function plain(value) {
      if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
      if (Array.isArray(value)) return value.map(plain);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
      return value;
    }
    for (const name of ['copies', 'opaque-copies']) all[name] = plain(await new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }));
    db.close(); return all;
  });
}
async function oracle(p, name, expected) {
  await p.locator("#ts-active-table").selectOption(expected.collection); await ready(p);
  const observed = await projection(p);
  assert.equal(observed.rows.find(r => r.id === expected.row).fields.find(f => f.target.field === expected.field).stored.value, expected.value);
  const separate = await p.evaluate(async ({ name, collection }) => {
    const db = await new Promise(resolve => { const r = indexedDB.open('tachiko-sheet-local-copies', 2); r.onsuccess = () => resolve(r.result); });
    let record;
    for (const store of ['copies', 'opaque-copies']) { record = await new Promise(resolve => { const r = db.transaction(store).objectStore(store).get(name); r.onsuccess = () => resolve(r.result); }); if (record) break; }
    db.close(); const kit = await import('/core-kit/experimental-client.js'); const c = kit.createExperimentalDesignerClient();
    try {
      if (record.kind === 'work-file') await c.openPortableRo(record.bytes);
      else if (record.kind === 'opaque') await c.openProject(record.bytes);
      else await kit.openCanonicalTreeFromEntries(c, record.files);
      return await c.queryTable(collection);
    } finally { c.close(); }
  }, { name, collection: expected.collection });
  assert.deepEqual(separate.rows, observed.rows); assert.deepEqual(separate.columns, observed.columns);
}
async function seed(p, sales = true) {
  if (sales) { await button(p, 'Open sales example').click(); await ready(p); }
  else await openReleasePlanExample(p);
  await copy(p, 'Q4');
}
const cases = {
  async lifecycle(p) {
    await button(p, 'Open sales example').click(); await ready(p); await edit(p, 27);
    await copy(p, 'Q4', true); const expected = await edit(p, 31); await button(p, 'Save').click(); await saved(p);
    assert.equal(await p.getByRole('dialog').count(), 0);
    await terminate(); p = await start(); assert.equal(await button(p, 'Open saved Q4').count(), 1);
    assert.equal(Object.values(await records(p)).flat().length, 1); await open(p, 'Q4'); await oracle(p, 'Q4', expected);
    const next = await edit(p, 33); await p.keyboard.press('Meta+s'); await saved(p); await close(p); await open(p, 'Q4'); await oracle(p, 'Q4', next);
    await edit(p, 35); await p.keyboard.press('Control+s'); await saved(p);
  },
  async concurrency(p) {
    await seed(p); await close(p); await open(p, 'Q4'); const b = await newPage(); await open(b, 'Q4');
    await edit(p, 41); await button(p, 'Save').click(); await saved(p); const stored = await records(p);
    const draft = await edit(b, 43); await button(b, 'Save').click(); await b.getByText(conflict, { exact: true }).waitFor();
    assert.deepEqual(await records(p), stored); assert.equal(await b.locator('[data-work-dirty="true"]').count(), 1);
    assert.doesNotMatch(await b.getByTestId('save-status').textContent(), /Saved on this device/);
    await copy(b, 'B'); await edit(b, 45); await button(b, 'Save').click(); await saved(b); await close(b); await open(b, 'B'); await oracle(b, 'B', { ...draft, value: 45 });
    await close(p); await p.reload(); await waitForColdHome(p); await button(p, 'Delete saved B').click(); await button(p.getByRole('dialog', { name: 'Delete copy', exact: true }), 'Delete').click();
    await edit(b, 47); await button(b, 'Save').click(); await b.getByText(conflict, { exact: true }).waitFor();
  },
  async deletion(p) {
    await seed(p);
    assert.equal(await button(p, 'Delete saved Q4').count(), 0, 'Home Delete is unavailable while the bound work is presented');
    const unchanged = await records(p);
    await p.evaluate(() => { window.__saveEvidence.failNextTable = true; });
    await button(p, 'Refresh').click();
    await p.getByRole('heading', { name: 'Refresh required', exact: true }).waitFor();
    assert.equal(await button(p, 'Delete saved Q4').isDisabled(), true, 'the same-tab resident copy cannot be deleted from Recovery Home');
    assert.deepEqual(await records(p), unchanged);
    await p.reload(); await waitForColdHome(p); await open(p, 'Q4');
    await copy(p, 'Keep'); await close(p); const before = await records(p);
    await button(p, 'Delete saved Q4').click(); let d = p.getByRole('dialog', { name: 'Delete copy', exact: true });
    assert.match(await d.textContent(), /Q4/); assert.match(await d.textContent(), /cannot be undone/);
    await button(d, 'Cancel').click(); assert.deepEqual(await records(p), before);
    await button(p, 'Delete saved Q4').click(); await button(d, 'Delete').click(); await d.waitFor({ state: 'detached' });
    await terminate(); p = await start(); assert.equal(await button(p, 'Open saved Q4').count(), 0);
    const after = await records(p); for (const store of Object.keys(after)) assert.deepEqual(after[store], before[store].filter(r => r.name !== 'Q4'));
  },
  async closeDialog(p) {
    await button(p, 'Open sales example').click(); await ready(p); await edit(p, 51); await button(p, 'Close project').click();
    await button(p.getByRole('dialog', { name: 'Unsaved work', exact: true }), 'Save').click();
    let d = p.getByRole('dialog', { name: 'Save a copy', exact: true }); await d.getByRole('textbox', { name: 'Copy name', exact: true }).fill('Q4'); await button(d, 'Create copy').click(); await waitForColdHome(p);
    await open(p, 'Q4'); const expected = await edit(p, 53); await button(p, 'Close project').click();
    await button(p.getByRole('dialog', { name: 'Unsaved work', exact: true }), 'Save').click(); await waitForColdHome(p);
    assert.equal(Object.values(await records(p)).flat().length, 1); await open(p, 'Q4'); await oracle(p, 'Q4', expected);
  },
  async formats(p) {
    await seed(p, false); await close(p);
    await p.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('tachiko-sheet-local-copies', 2); r.onsuccess = () => resolve(r.result); });
      await new Promise((resolve, reject) => { const tx = db.transaction('copies', 'readwrite'); const s = tx.objectStore('copies'); const r = s.get('Q4'); r.onsuccess = () => { const v = r.result; v.name = 'Legacy'; delete v.kind; s.add(v); }; tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    });
    for (const name of ['Q4', 'Legacy']) { const before = await records(p); await open(p, name); const expected = await edit(p, 61); await button(p, 'Save').click(); await saved(p); await close(p); await open(p, name); await oracle(p, name, expected); await close(p); const after = await records(p); for (const store of Object.keys(after)) assert.deepEqual(after[store].filter(r => r.name !== name), before[store].filter(r => r.name !== name)); }
    await button(p, 'Open sales example').click(); await ready(p); await copy(p, 'Opaque'); const expected = await edit(p, 63); await button(p, 'Save').click(); await saved(p); await close(p); await open(p, 'Opaque'); await oracle(p, 'Opaque', expected);
    await p.getByRole('tab', { name: 'Import & export', exact: true }).click(); await button(p, 'Download work file (.ro)').click();
    const download = p.waitForEvent('download'); await button(p.getByRole('dialog', { name: 'Confirm download', exact: true }), 'Download').click(); const file = path.join(work, 'copy.ro'); await (await download).saveAs(file);
    await close(p); await p.getByTestId('open-work-file').setInputFiles(file); await ready(p); await copy(p, 'Work'); const workExpected = await edit(p, 65); await button(p, 'Save').click(); await saved(p); await close(p); await open(p, 'Work'); await oracle(p, 'Work', workExpected);
  },
  async failures(p) {
    await seed(p); await edit(p, 71); const before = await records(p);
    await p.evaluate(() => { window.__saveEvidence.staleExport = true; });
    await button(p, 'Save').click(); await p.getByTestId('save-status').filter({ hasText: /Save failed/ }).waitFor();
    assert.equal(await p.evaluate(() => window.__saveEvidence.staleExport), false, 'stale revision injection exercised');
    assert.deepEqual(await records(p), before);
    assert.equal(await p.locator('[data-work-dirty="true"]').count(), 1);
    for (const fault of ['quota', 'abort', 'lost']) {
      await p.evaluate(fault => {
        window.__restoreSaveFault?.();
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(stores, mode, options) {
          if (mode !== 'readwrite') return original.call(this, stores, mode, options);
          if (fault === 'quota') throw new DOMException('Controlled quota failure', 'QuotaExceededError');
          const tx = original.call(this, stores, mode, options);
          if (fault === 'abort') queueMicrotask(() => tx.abort());
          if (fault === 'lost') Object.defineProperty(tx, 'oncomplete', { set(handler) { tx.addEventListener('complete', () => tx.onabort?.(new Event('abort'))); } });
          return tx;
        };
        window.__restoreSaveFault = () => { IDBDatabase.prototype.transaction = original; window.__restoreSaveFault = null; };
      }, fault);
      await button(p, 'Close project').click(); const d = p.getByRole('dialog', { name: 'Unsaved work', exact: true }); await button(d, 'Save').click();
      await p.getByTestId('save-status').filter({ hasText: /Save failed/ }).waitFor();
      assert.equal(await p.getByTestId('project-ready').count(), 1); assert.equal(await p.locator('[data-work-dirty="true"]').count(), 1);
      await p.evaluate(() => window.__restoreSaveFault()); await button(d, 'Keep editing').click();
      const after = await records(p); if (fault !== 'lost') assert.deepEqual(after, before);
      else { const old = Object.values(before).flat()[0]; const next = Object.values(after).flat()[0]; assert.equal(next.name, old.name); assert.equal(next.kind, old.kind); assert.notEqual(next.revision, old.revision); }
    }
    await button(p, 'Save').click(); await p.getByText(conflict, { exact: true }).waitFor();
    await copy(p, 'Pending'); const pendingExpected = await edit(p, 73);
    const pendingBefore = await records(p);
    await p.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(stores, mode, options) {
        const tx = original.call(this, stores, mode, options);
        if (mode === 'readwrite') Object.defineProperty(tx, 'oncomplete', { set() {
          tx.addEventListener('complete', () => { window.__saveEvidence.completionLost = true; });
        } });
        return tx;
      };
      window.__restoreSaveFault = () => { IDBDatabase.prototype.transaction = original; };
    });
    await button(p, 'Save').click(); await p.waitForFunction(() => window.__saveEvidence.completionLost);
    assert.doesNotMatch(await p.getByTestId('save-status').textContent(), /Saved on this device/);
    assert.equal(await button(p, 'Close project').isDisabled(), true);
    assert.equal(await p.locator('[data-work-dirty="true"]').count(), 1);
    const pendingAfter = await records(p);
    for (const store of Object.keys(pendingAfter)) {
      assert.deepEqual(pendingAfter[store].filter(r => r.name !== 'Pending'), pendingBefore[store].filter(r => r.name !== 'Pending'));
    }
    const latest = Object.values(pendingAfter).flat().find(r => r.name === 'Pending');
    assert.equal(latest.kind, 'opaque'); assert.ok(latest.bytes.length); assert.equal(latest.presentation.snapshotRevision, latest.revision);
    const pendingReader = await newPage(); await open(pendingReader, 'Pending');
    await oracle(pendingReader, 'Pending', pendingExpected);
  }
};
try {
  const selected = process.env.SAVE_UPDATE_CASE ? [process.env.SAVE_UPDATE_CASE] : Object.keys(cases);
  for (const name of selected) { profile = path.join(work, `${name}-profile`); const p = await start(); await cases[name](p); checks.push(name); await terminate(); }
  const receipt = { status: 'PASS', dist, checks, processes, work }; await writeFile(path.join(work, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
} catch (error) { await writeFile(path.join(work, 'failure.json'), JSON.stringify({ error: String(error), checks, processes }, null, 2)); console.error(error); console.error({ work }); process.exitCode = 1; }
finally { await terminate(); }
