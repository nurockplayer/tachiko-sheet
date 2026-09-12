// Qualification-only probe. It consumes a built experimental kit through its public entry.
// This supplements, and does not change, the immutable Steward acceptance seed.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const kit = process.env.WORK_CLIENT_KIT;
if (!kit) throw new Error('WORK_CLIENT_KIT is required.');
const kitRoot = path.resolve(kit);
await stat(path.join(kitRoot, 'experimental-client.js'));
await stat(path.join(kitRoot, 'designer_runtime.wasm'));
const fixture = fileURLToPath(new URL('../fixtures/release-plan.roproj', import.meta.url));
const expected = JSON.parse(await readFile(new URL('../fixtures/expected.json', import.meta.url), 'utf8'));
const pageSource = `<!doctype html><meta charset="utf-8"><input id="fixture" type="file" webkitdirectory multiple><button id="run">Run</button><pre id="result"></pre>
<script type="module">
import {createExperimentalDesignerClient,projectTransferFromFiles} from '/kit/experimental-client.js';
const E=${JSON.stringify(expected.entity)}, N=${JSON.stringify(expected.notes)}, V=${JSON.stringify(expected.editedNotes)};
const target={entity:E,field:N};
const notes=batch=>batch.fields.find(field=>field.target.entity===E&&field.target.field===N)?.stored?.value;
const exposed=value=>Object.keys(value).filter(key=>/occurrence/i.test(key));
const methods=value=>Object.getOwnPropertyNames(Object.getPrototypeOf(value)).filter(name=>name!=='constructor').sort();
document.querySelector('#run').onclick=async()=>{
 let client=createExperimentalDesignerClient(); let reopened;
 try {
  const clientMethods=methods(client);
  const opened=await client.openProject(await projectTransferFromFiles(document.querySelector('#fixture').files));
  const initial=await client.queryFields(opened.bootstrap.revision,[target]);
  const published=await client.editText(opened.bootstrap.revision,target,V);
  const changed=await client.queryFields(published.resulting_revision,[target]);
  const exported=await client.exportProject(published.resulting_revision);
  const exportByteLength=exported.bytes.byteLength;
  const roundTripBytes=exported.bytes.slice(0);
  const exposure={opened:exposed(opened),bootstrap:exposed(opened.bootstrap),publication:exposed(published),exported:exposed(exported)};
  await client.closeProject(); await client.close();
  client=createExperimentalDesignerClient();
  reopened=await client.openProject(roundTripBytes);
  const fresh=await client.queryFields(reopened.bootstrap.revision,[target]);
  document.querySelector('#result').textContent=JSON.stringify({initialNotes:notes(initial),changedNotes:notes(changed),reopenedNotes:notes(fresh),exportByteLength,clientMethods,occurrenceFields:exposure,reopenedOccurrenceFields:exposed(reopened)});
 } catch (error) { document.querySelector('#result').dataset.status='failed'; document.querySelector('#result').textContent=String(error.stack??error); }
 finally { await client.closeProject().catch(()=>{}); await client.close(); }
};
</script>`;
const mime = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(pageSource); return; }
    if (!pathname.startsWith('/kit/')) { response.writeHead(404); response.end(); return; }
    const file = path.resolve(kitRoot, pathname.slice('/kit/'.length));
    if (!file.startsWith(`${kitRoot}${path.sep}`)) throw new Error('outside kit');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(400); response.end('unavailable'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#fixture').setInputFiles(fixture);
  await page.locator('#run').click();
  await page.locator('#result').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#result').textContent.length > 0);
  assert.notEqual(await page.locator('#result').getAttribute('data-status'), 'failed', await page.locator('#result').textContent());
  const result = JSON.parse(await page.locator('#result').textContent());
  assert.equal(result.initialNotes, expected.initialNotes);
  assert.equal(result.changedNotes, expected.editedNotes);
  assert.equal(result.reopenedNotes, expected.editedNotes);
  assert.ok(result.exportByteLength > 0);
  assert.ok(result.clientMethods.includes('exportProject'));
  for (const unsupported of ['exportCanonicalTree', 'exportRo', 'verifyRoUsingCore']) assert.equal(result.clientMethods.includes(unsupported), false);
  assert.deepEqual(result.occurrenceFields, { opened: [], bootstrap: [], publication: [], exported: [] });
  assert.deepEqual(result.reopenedOccurrenceFields, []);
  console.log(JSON.stringify({ case: 'real-kit-public-notes-round-trip', status: 'PASS', observation: result }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
