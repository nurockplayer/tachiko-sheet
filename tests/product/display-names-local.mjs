import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";
// #195: normal production UI and a separate public core-client persistence oracle.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { LOCAL_ORIGIN, installDistRoutes } from './dist-routes.mjs';
import { waitForColdHome } from './home-entry.mjs';
const dist = process.env.WORK_DIST;
assert.ok(dist, 'WORK_DIST must name a production build');
const work = await mkdtemp(path.join(tmpdir(), 'sheet195-'));
const profile = path.join(work, 'profile');
const checks = [], processes = [];
let context, pid, currentPage;
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
async function start() {
  assert.equal(context, undefined);
  context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === '1' ? { args: ['--single-process'] } : {}),
  });
  const cdp = await context.browser().newBrowserCDPSession();
  pid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(row => row.type === 'browser')?.id;
  await cdp.detach(); assert.ok(pid > 0); processes.push({pid, profile});
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__names = { tables: [], messages: [], requests: [] };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', event => {
        window.__names.messages.push(structuredClone(event.data));
        if (event.data.response?.type === 'table') window.__names.tables.push(structuredClone(event.data.response.payload));
        const request = window.__names.requests.find(request => request.id === event.data.id);
        if (window.__names.loseAfterInsert && request?.request?.type === 'insert_row' && event.data.response?.type === 'published') {
          window.__names.loseAfterInsert = false; window.__names.loseTable = true;
        } else if (window.__names.loseTable && request?.request?.type === 'query_table') {
          window.__names.loseTable = false; event.stopImmediatePropagation();
          this.dispatchEvent(new ErrorEvent('error', { message: 'Controlled lost post-publication projection' }));
        }
      }); }
      postMessage(message, ...args) { window.__names.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
    };
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(10000); await page.setViewportSize({width:1400, height:1000});
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page); currentPage = page; return page;
}
function alive(id) { try { process.kill(id, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function terminate() {
  if (!context) return;
  const owned = pid; await context.close();
  const deadline = Date.now() + 10000;
  while (alive(owned) && Date.now() < deadline) await delay(50);
  assert.equal(alive(owned), false, 'actual browser process exit before same-profile restart');
  processes.at(-1).exitObserved = true; context = pid = undefined;
}
const projection = page => page.evaluate(() => window.__names.tables.at(-1));
try {
  let page = await start();
  await page.getByRole('button', {name:'New table', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'New table', exact:true});
  // Producer refusals retain the exact draft, locate each affected input, and
  // keep creation available. No copy of the Rust spelling rules in this test.
  for (const [value, message] of [['   ', /isn't only spaces/], ['x'.repeat(4097), /too long/], ['My\u0001Expenses', /control characters/]]) {
    await dialog.getByLabel('Table name', {exact:true}).fill(value);
    await dialog.getByRole('button', {name:'Create table', exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:message}).waitFor();
    assert.equal(await dialog.getByLabel('Table name', {exact:true}).inputValue(), value);
    assert.equal(await dialog.getByLabel('Table name', {exact:true}).getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByTestId('project-ready').count(), 0);
  }
  await dialog.getByLabel('Table name', {exact:true}).fill('My Expenses');
  await dialog.getByRole('button', {name:'Add column', exact:true}).click();
  await dialog.getByLabel('Column 2 name', {exact:true}).fill('A');
  await dialog.getByRole('button', {name:'Create table', exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:/distinct name/}).first().waitFor();
  for (const i of [1,2]) assert.equal(await dialog.getByLabel(`Column ${i} name`, {exact:true}).getAttribute('aria-invalid'), 'true');
  assert.equal(await dialog.getByLabel('Column 2 name', {exact:true}).inputValue(), 'A');
  await dialog.getByRole('button', {name:'Remove column 2', exact:true}).click();
  checks.push('producer-empty-long-control-duplicate-inline-refusals-retain-drafts');
  await dialog.getByLabel('Table name', {exact:true}).fill('My Expenses');
  const labels = ['Item Name', '項目', 'Amount'];
  for (let i=0; i<labels.length; i++) {
    if (i) await dialog.getByRole('button', {name:'Add column', exact:true}).click();
    await dialog.getByLabel(`Column ${i+1} name`, {exact:true}).fill(labels[i]);
    if (i===2) await dialog.getByLabel('Column 3 type', {exact:true}).selectOption('number');
  }
  await dialog.getByRole('button', {name:'Create table', exact:true}).click();
  await dialog.waitFor({state:'detached'}); await ready(page);
  assert.deepEqual((await projection(page)).columns.map(col=>col.display_name), labels);
  assert.equal((await projection(page)).collection.display_name, 'My Expenses');
  assert.deepEqual((await projection(page)).columns.map(col=>col.key), ['column_1','column_2','amount']);
  assert.deepEqual(await page.locator('.ts-col-head').allTextContents(), labels);
  assert.equal(await page.locator('#ts-active-table option:checked').textContent(), 'My Expenses');
  const expected = [['Tea','飲食',4], ['Train','交通',3]];
  for (const values of expected) {
    for (let i=0; i<3; i++) await fillDraftCell(page, page.locator('.ts-entry-row').getByLabel(`New row ${labels[i]} (${i===2?'Number':'Text'})`, {exact:true}), String(values[i]));
    if (values[0] === 'Train') await page.evaluate(() => { window.__names.loseAfterInsert = true; });
    await draftActions(page).getByRole('button', {name:'Add row',exact:true}).click();
    if (values[0] === 'Train') {
      await page.getByRole('heading',{name:'Refresh required',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Save a copy',exact:true}).count(),0);
      await page.getByRole('button',{name:'Refresh',exact:true}).click(); await ready(page);
      await draftActions(page).getByRole('button',{name:'Discard',exact:true}).click();
      const inserts = await page.evaluate(()=>window.__names.requests.filter(r=>r.request?.type==='insert_row').length);
      assert.equal(inserts,2,'recovery observes the published row without replaying insertion');
    } else await ready(page);
  }
  await saveCopy('Before summary');
  checks.push('new-table-recovery-refresh-save-without-summary-via-portable-carrier');
  const columns = (await projection(page)).columns;
  const first = (await projection(page)).rows[0];
  async function edit(value) {
    await page.getByRole('tab',{name:'Table',exact:true}).click();
    await page.getByTestId(`cell:${first.id}:${columns[2].id}`).dblclick();
    const editor=page.getByRole('textbox',{name:'Edit cell',exact:true});
    await editor.fill(String(value)); await editor.press('Enter'); await ready(page);
  }
  async function groups(values) {
    await page.getByRole('tab',{name:'Cross-table summary',exact:true}).click();
    await page.getByLabel('Cross-table groups',{exact:true}).waitFor();
    const actual=await page.getByLabel('Cross-table groups',{exact:true}).locator('tbody tr').allTextContents();
    for (const [name,value] of values) assert.ok(actual.some(row=>row.includes(name)&&row.includes(String(value))), JSON.stringify(actual));
  }
  await page.getByRole('tab',{name:'Cross-table summary',exact:true}).click();
  await page.getByRole('button',{name:'Choose tables and fields',exact:true}).click();
  for (const name of ['Orders table','Products table']) await page.getByLabel(name,{exact:true}).selectOption({label:'My Expenses'});
  for (const [name,label] of [['Order lookup key','Item Name'],['Order quantity','Amount'],['Product key','Item Name'],['Product category','項目'],['Product price','Amount']]) await page.getByLabel(name,{exact:true}).selectOption({label});
  await page.getByRole('button',{name:'Create cross-table summary',exact:true}).click(); await ready(page);
  await groups([['飲食',16],['交通',9]]);
  // Same native table can supply both ID-bound sides; these are the genuine
  // public cross-table definition and history commands, with no test fixture.
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await ready(page);
  assert.equal(await page.getByLabel('Cross-table groups',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Redo',exact:true}).click(); await ready(page);
  await groups([['飲食',16],['交通',9]]);
  await edit(5); await groups([['飲食',25],['交通',9]]);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await ready(page); await groups([['飲食',16],['交通',9]]);
  await page.getByRole('button',{name:'Redo',exact:true}).click(); await ready(page); await groups([['飲食',25],['交通',9]]);
  checks.push('named-summary-id-bindings-auto-update-edit-and-creation-undo-redo');
  async function saveCopy(name) {
    await page.getByRole('button',{name:'Save a copy',exact:true}).click();
    const d=page.getByRole('dialog',{name:'Save a copy',exact:true});
    await d.getByLabel('Copy name',{exact:true}).fill(name);
    await d.getByRole('button',{name:'Create copy',exact:true}).click(); await d.waitFor({state:'detached'});
    await page.getByTestId('save-status').filter({hasText:'Saved on this device'}).waitFor();
  }
  await saveCopy('Q4');
  const saved = await projection(page);
  async function oracle(page,name,baseline) {
    const result=await page.evaluate(async name=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('tachiko-sheet-local-copies',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const record=await new Promise((resolve,reject)=>{const r=db.transaction('opaque-copies','readonly').objectStore('opaque-copies').get(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
      const kit=await import('/core-kit/experimental-client.js');const core=kit.createExperimentalDesignerClient();
      try {
        const opened=await core.openPortableRo(record.bytes.slice(0));
        const table=await core.queryTable(opened.bootstrap.default_collection);
        const groups=await Promise.all(opened.bootstrap.keyed_grouped_sum_definition_ids.map(id=>core.queryKeyedGroupedSum(id)));
        return {kind:record.kind,version:record.envelopeVersion,table,groups};
      } finally {await core.close();}
    },name);
    assert.equal(result.kind,'work-file');
    assert.equal(result.table.collection.display_name,'My Expenses');
    assert.equal(result.table.collection.key,'table_1');
    assert.equal(result.table.collection.id,baseline.collection.id);
    assert.deepEqual(result.table.columns,baseline.columns,'independent saved-byte projection: every name, allocated key, type and stable ID');
    assert.deepEqual(result.table.rows,baseline.rows,'independent saved-byte projection: every row, field target and stored value');
    assert.deepEqual(result.table.rows.map(row=>columns.map(col=>row.fields.find(f=>f.target.field===col.id).stored.value)),[['Tea','飲食',5],['Train','交通',3]]);
    assert.equal(result.groups.length,1);assert.deepEqual(result.groups[0].diagnostics,[]);
    assert.deepEqual(result.groups[0].groups.map(({category,value})=>({category,value})),[{category:'交通',value:9},{category:'飲食',value:25}]);
    return result;
  }
  await oracle(page,'Q4',saved);
  await terminate(); page=await start();
  await page.getByRole('button',{name:'Open saved Q4',exact:true}).click(); await ready(page);
  assert.deepEqual((await projection(page)).columns,saved.columns); assert.deepEqual((await projection(page)).rows,saved.rows);
  await oracle(page,'Q4',saved);
  assert.deepEqual(await page.locator('.ts-col-head').allTextContents(), labels);
  checks.push('save-Q4-real-process-exit-same-profile-independent-core-names-keys-IDs-values-summary');
  await edit(6);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByTestId('save-status').filter({hasText:'Saved on this device'}).waitFor();
  await edit(5);
  await page.getByRole('button',{name:'Close project',exact:true}).click();
  await page.getByRole('dialog',{name:'Unsaved work',exact:true}).getByRole('button',{name:'Save',exact:true}).click();
  await waitForColdHome(page);
  await page.getByRole('button',{name:'Open saved Q4',exact:true}).click(); await ready(page);
  await oracle(page,'Q4',saved);
  checks.push('bound-copy-save-and-close-save-portable-route');
  await saveCopy('Q4 copy'); await oracle(page,'Q4 copy',saved);
  await page.getByRole('tab',{name:'Import & export',exact:true}).click();
  await page.getByRole('button',{name:'Download work file (.ro)',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Confirm download',exact:true});
  const pending=page.waitForEvent('download');await confirm.getByRole('button',{name:'Download',exact:true}).click();
  const download=await pending;assert.equal(await download.failure(),null);
  const filename=path.join(work,'Q4.ro');await download.saveAs(filename);await confirm.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Close project',exact:true}).click();await waitForColdHome(page);
  await page.getByTestId('open-work-file').setInputFiles(filename);await ready(page);
  assert.deepEqual((await projection(page)).columns,saved.columns);assert.deepEqual((await projection(page)).rows,saved.rows);
  await groups([['飲食',25],['交通',9]]);
  await saveCopy('Q4 ro copy');await oracle(page,'Q4 ro copy',saved);
  checks.push('download-open-ro-every-name-key-ID-value-summary-and-copy');
  await page.screenshot({path:path.join(work,'display-names.png'),fullPage:true});
  await terminate();
  await writeFile(path.join(work,'receipt.json'),JSON.stringify({checks,processes,saved},null,2));
  console.log(JSON.stringify({status:'PASS', checks, processes, work}));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await writeFile(path.join(work,'failure.json'),JSON.stringify(await currentPage.evaluate(()=>({text:document.body.innerText,evidence:window.__names})),null,2));
    await currentPage.screenshot({path:path.join(work,'failure.png'),fullPage:true});
  }
  console.error({work,checks}); throw error;
} finally { await terminate(); }
