// Producer adoption only: real vendored Worker/WASM, no product explanation UI.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { verifyCoreKit } from '../../scripts/verify-core-kit.mjs';

await verifyCoreKit();
const root = fileURLToPath(new URL('../../', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8'));
const kitRoot = path.resolve(root, lock.defaultKit);
const fixtureRoot = path.join(root, 'tests/fixtures/release-plan.roproj');
const expected = JSON.parse(await readFile(path.join(root, 'tests/fixtures/expected.json'), 'utf8'));
const entries = [];
async function collect(relative = '') {
  for (const entry of await readdir(path.join(fixtureRoot, relative), {withFileTypes: true})) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await collect(name);
    else entries.push({path: name, bytes: [...await readFile(path.join(fixtureRoot, name))]});
  }
}
await collect();
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html>'); return; }
    if (!pathname.startsWith('/kit/')) throw new Error('bad path');
    const file = path.resolve(kitRoot, pathname.slice(5));
    if (!file.startsWith(kitRoot + path.sep)) throw new Error('escape');
    response.writeHead(200, {'Content-Type': path.extname(file) === '.js' ? 'text/javascript' : path.extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream'});
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless: true, ...(process.env.WORK_CHROMIUM ? {executablePath: process.env.WORK_CHROMIUM} : {})});
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  const result = await page.evaluate(async ({entries, expected}) => {
    const kit = await import('/kit/experimental-client.js');
    const client = kit.createExperimentalDesignerClient();
    const priority = {entity: expected.entity, field: expected.priority};
    const impact = {entity: expected.entity, field: expected.impact};
    try {
      const opened = await client.openProject(kit.projectTransferFromEntries(entries.map(entry => ({path: entry.path, bytes: new Uint8Array(entry.bytes).buffer}))));
      const initial = await client.explainField(opened.bootstrap.revision, priority);
      const input = await client.explainField(opened.bootstrap.revision, impact);
      const edit = await client.editNumber(opened.bootstrap.revision, impact, String(expected.editedImpact));
      const beforeRefusal = await client.observeOccurrence();
      const beforeBytes = [...new Uint8Array((await client.exportProject(edit.resulting_revision)).bytes)];
      let stale;
      try { await client.explainField(opened.bootstrap.revision, priority); }
      catch (error) { stale = error.failure; }
      const afterRefusal = await client.observeOccurrence();
      const afterBytes = [...new Uint8Array((await client.exportProject(edit.resulting_revision)).bytes)];
      const current = await client.explainField(edit.resulting_revision, priority);
      const undone = await client.trackerCommand({type: 'undo', expected_revision: edit.resulting_revision});
      const undoValue = await client.explainField(undone.resulting_revision, priority);
      return {initial, input, edit, current, stale, beforeRefusal, afterRefusal, beforeBytes, afterBytes, undoValue};
    } finally { await client.close(); }
  }, {entries, expected});
  const priority = {entity: expected.entity, field: expected.priority};
  const impact = {entity: expected.entity, field: expected.impact};
  const friction = {entity: expected.entity, field: '6b529d6d-f003-42ff-aa22-5e317a3e5f37'};
  const formula = '([release_scope.impact] + [release_scope.friction])';
  for (const [projection, value, impactValue] of [[result.initial, 10, 5], [result.current, 8, 3], [result.undoValue, 10, 5]]) {
    assert.deepEqual(projection.target, priority);
    assert.deepEqual(projection.value.target, priority);
    assert.equal(projection.formula_source, formula);
    assert.deepEqual(projection.value.formula, {source: formula});
    assert.deepEqual(projection.value.calculated, {status: 'value', value});
    assert.deepEqual(projection.direct_dependencies.map(dependency => dependency.target), [impact, friction]);
    assert.deepEqual(projection.direct_dependencies.map(dependency => dependency.value.target), [impact, friction]);
    assert.deepEqual(projection.direct_dependencies.map(dependency => dependency.value.stored), [{kind: 'number', value: impactValue}, {kind: 'number', value: 5}]);
    assert.deepEqual(projection.downstream_impacts, []);
    assert.deepEqual(projection.diagnostics, []);
  }
  assert.deepEqual(result.input.target, impact);
  assert.equal(result.input.formula_source, null);
  assert.deepEqual(result.input.value.stored, {kind: 'number', value: 5});
  assert.deepEqual(result.input.direct_dependencies, []);
  assert.deepEqual(result.input.downstream_impacts, [priority]);
  assert.deepEqual(result.input.diagnostics, []);
  assert.deepEqual(result.edit.affected_calculations, [priority]);
  assert.equal(result.current.revision, result.edit.resulting_revision);
  assert.notEqual(result.initial.revision, result.current.revision);
  assert.equal(result.stale?.code, 'stale_revision');
  assert.deepEqual(result.afterRefusal, result.beforeRefusal);
  assert.deepEqual(result.afterBytes, result.beforeBytes);
  console.log(JSON.stringify({case: 'real-kit-worker-explain-field', status: 'PASS', sourceCommit: lock.sourceCommit, artifactManifestSha256: lock.artifactManifestSha256, formula, directInputs: [impact, friction], staleRefusal: result.stale.code, refusalPreservesOccurrenceBytesAndUndo: true}));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
