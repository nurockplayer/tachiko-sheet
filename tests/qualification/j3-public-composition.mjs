// J3-I08 public-kit composition qualification.  This is deliberately not UI,
// local-copy host durability, browser-process restart, or full-J3 evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const corpusRoot = path.join(root, 'acceptance/j3-interop');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const block = message => { const error = new Error(message); error.blocked = true; throw error; };
let browser, server, outputDirectory;

try {
  const corpus = JSON.parse(await readFile(path.join(corpusRoot, 'corpus.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8').catch(() => block('Missing repository/kit lock.')));
  if (lock.sourceCommit !== corpus.core_source || lock.artifactManifestSha256 !== corpus.core_manifest_sha256) {
    block('Kit pin changed: re-qualify with Steward; do not silently reuse this baseline.');
  }
  const kit = await realpath(path.join(root, lock.defaultKit));
  execFileSync(process.execPath, [path.join(root, 'scripts/verify-core-kit.mjs')], {cwd: root, stdio: 'inherit'});
  execFileSync('python3', [path.join(corpusRoot, 'check.py')], {stdio: 'inherit'});
  const inputs = {};
  for (const [name, expected] of Object.entries(corpus.files)) {
    const bytes = await readFile(path.join(corpusRoot, 'fixtures', name));
    assert.equal(sha256(bytes), expected.sha256, `Unexpected source hash: ${name}`);
    inputs[name] = [...bytes];
  }
  let chromium;
  try { ({chromium} = await import('playwright')); } catch { block('Install the repository-locked Playwright dependency.'); }
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') {
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        response.end('<!doctype html><meta charset="utf-8"><title>J3 public composition qualification</title>');
        return;
      }
      if (!pathname.startsWith('/kit/')) throw new Error('not a kit request');
      const file = await realpath(path.resolve(kit, pathname.slice('/kit/'.length)));
      if (!file.startsWith(kit + path.sep)) throw new Error('outside kit');
      response.writeHead(200, {'Content-Type': path.extname(file) === '.js' ? 'text/javascript' : path.extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream'});
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { browser = await chromium.launch({headless: true, ...(process.env.WORK_CHROMIUM ? {executablePath: process.env.WORK_CHROMIUM} : {})}); }
  catch (error) { block(`Real browser unavailable: ${error.message}`); }
  outputDirectory = await mkdtemp(path.join(tmpdir(), 'sheet-j3-public-composition-'));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    const kit = await import('/kit/experimental-client.js');
    window.__j3Kit = kit;
    window.__j3NewClient = () => kit.createExperimentalDesignerClient();
  });
  const required = ['newTracker', 'importSpreadsheet', 'previewCleanup', 'commitCleanup', 'queryTable', 'exportProject', 'exportCanonicalTree', 'openProject', 'inspectImportedProject', 'exportSpreadsheet', 'observeOccurrence', 'closeProject', 'close'];
  const absent = await page.evaluate(names => {
    const client = window.__j3NewClient();
    const missing = names.filter(name => typeof client[name] !== 'function');
    client.close();
    return missing;
  }, required);
  if (absent.length) block(`Missing public consumer methods: ${absent.join(', ')}`);

  const project = async (method, args) => page.evaluate(async ({method, args}) => window.__j3Client[method](...args), {method, args});
  const bytes = array => new Uint8Array(array).buffer;
  const projection = table => table.rows.map(row => table.columns.map(column => {
    const field = row.fields.find(item => item.target.field === column.id);
    assert.ok(field?.stored, 'Missing actual stored value');
    return {kind: field.stored.kind, value: field.stored.value};
  }));
  const expected = rows => rows.map(row => row.map(value => ({kind: typeof value === 'number' ? 'number' : 'text', value})));
  const closeClient = async () => page.evaluate(async () => {
    if (!window.__j3Client) return;
    try { await window.__j3Client.closeProject(); } catch {}
    await window.__j3Client.close();
    window.__j3Client = undefined;
  });

  for (const format of ['csv', 'xlsx']) {
    await closeClient();
    await page.evaluate(async () => { window.__j3Client = window.__j3NewClient(); await window.__j3Client.newTracker(); });
    const imported = await page.evaluate(async ({source, format}) => {
      const result = await window.__j3Client.importSpreadsheet(new Uint8Array(source).buffer, format, {delimiter: ',', header: true}, {column_types: [['text', 'number', 'number']], extra_columns: [[]]});
      // Retain the producer object; it is passed back to the exporter verbatim.
      window.__j3ImportedMetadata = result.metadata;
      return result;
    }, {source: inputs[`messy.${format}`], format});
    let table = imported.opened.table;
    assert.deepEqual(projection(table), expected(corpus.raw_rows.map(row => [row[0], Number(row[1]), Number(row[2])])));
    const trim = await project('previewCleanup', [table.revision, {kind: 'trim', fields: table.rows.map(row => ({entity: row.id, field: table.columns[0].id}))}]);
    await project('commitCleanup', [trim.revision, trim.preview_id]);
    table = await project('queryTable', [table.collection.key]);
    const deduplicate = await project('previewCleanup', [table.revision, {kind: 'deduplicate', entities: table.rows.map(row => row.id), key_fields: table.columns.map(column => column.id)}]);
    await project('commitCleanup', [deduplicate.revision, deduplicate.preview_id]);
    table = await project('queryTable', [table.collection.key]);
    assert.deepEqual(projection(table), expected(corpus.clean_rows));

    // Both are opaque producer results: preserve the returned bytes/metadata unchanged.
    const snapshot = await page.evaluate(async revision => {
      const project = await window.__j3Client.exportProject(revision);
      const canonical = await window.__j3Client.exportCanonicalTree(revision);
      return {
        projectRevision: project.revision,
        projectBytes: [...new Uint8Array(project.bytes)],
        canonicalRevision: canonical.revision,
        canonicalEntries: canonical.files.map(file => ({path: file.path, bytes: [...new Uint8Array(file.bytes)]})),
      };
    }, table.revision);
    assert.equal(snapshot.projectRevision, table.revision);
    assert.equal(snapshot.canonicalRevision, table.revision);
    assert.ok(snapshot.canonicalEntries.length > 0, 'Producer returned no canonical entries');

    // Positive fresh inspection uses the producer-returned spreadsheet metadata verbatim.
    const inspected = await page.evaluate(async snapshotBytes => {
      const client = window.__j3NewClient();
      try {
        const opened = await client.inspectImportedProject(new Uint8Array(snapshotBytes).buffer, window.__j3ImportedMetadata);
        return opened.table;
      } finally { await client.close(); }
    }, snapshot.projectBytes);
    assert.deepEqual(projection(inspected), expected(corpus.clean_rows), 'Fresh public inspect did not reconstruct clean values');

    // Rejected metadata must not install or change an already-open occurrence.
    const metadataRejection = await page.evaluate(async snapshotBytes => {
      const client = window.__j3NewClient();
      try {
        await client.newTracker();
        const before = await client.observeOccurrence();
        const rejected = [];
        for (const candidate of [undefined, {}]) {
          try { await client.inspectImportedProject(new Uint8Array(snapshotBytes).buffer, candidate); }
          catch { rejected.push(true); }
          const after = await client.observeOccurrence();
          if (after.scope !== before.scope || after.revision !== before.revision) throw new Error('Rejected metadata mutated active occurrence');
        }
        return rejected.length;
      } finally { await client.closeProject().catch(() => {}); await client.close(); }
    }, snapshot.projectBytes);
    assert.equal(metadataRejection, 2, 'Missing/malformed producer metadata was accepted');

    // Exercise the public host-transfer helper against a fresh client, without decoding it.
    const reopened = await page.evaluate(async entries => {
      const client = window.__j3NewClient();
      try {
        const transfer = window.__j3Kit.projectTransferFromEntries(entries.map(entry => ({path: entry.path, bytes: new Uint8Array(entry.bytes).buffer})));
        const opened = await client.openProject(transfer);
        const exported = {};
        for (const format of ['csv', 'xlsx']) {
          const result = await client.exportSpreadsheet(opened.table.revision, window.__j3ImportedMetadata, format, window.__j3ImportedMetadata.sheets[0].schema_id);
          exported[format] = [...new Uint8Array(result.bytes)];
        }
        return {table: opened.table, exported};
      } finally { await client.closeProject().catch(() => {}); await client.close(); }
    }, snapshot.canonicalEntries);
    assert.deepEqual(projection(reopened.table), expected(corpus.clean_rows), 'Fresh public transfer reopen did not reconstruct clean values');
    for (const exportFormat of ['csv', 'xlsx']) {
      const file = path.join(outputDirectory, `${format}-canonical-to-${exportFormat}.${exportFormat}`);
      await writeFile(file, new Uint8Array(reopened.exported[exportFormat]));
      execFileSync('python3', [path.join(corpusRoot, 'check.py'), '--export', file], {stdio: 'inherit'});
    }
    console.log(JSON.stringify({case: `J3 ${format} public composition`, status: 'PASS_COMPOSITION_SUBSET_ONLY', normalUI: 'NOT_TESTED', localCopyHostDurability: 'NOT_TESTED', browserProcessRestart: 'NOT_TESTED', fullJ3: 'NOT_PASS'}));
    await closeClient();
  }
  for (const [name, expectedFile] of Object.entries(corpus.files)) {
    assert.equal(sha256(await readFile(path.join(corpusRoot, 'fixtures', name))), expectedFile.sha256, `Source changed: ${name}`);
  }
  console.log(JSON.stringify({status: 'PASS_COMPOSITION_SUBSET_ONLY', source: lock.sourceCommit, manifest: lock.artifactManifestSha256, normalUI: 'NOT_TESTED', localCopyHostDurability: 'NOT_TESTED', browserProcessRestart: 'NOT_TESTED', fullJ3: 'NOT_PASS'}));
} catch (error) {
  const setup = error.blocked || ['ENOENT', 'ERR_MODULE_NOT_FOUND'].includes(error.code);
  console.error(JSON.stringify({status: setup ? 'BLOCKED' : 'FAIL_OR_UNQUALIFIED', message: String(error.stack ?? error), normalUI: 'NOT_TESTED'}));
  process.exitCode = setup ? 78 : 1;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (outputDirectory) await rm(outputDirectory, {recursive: true, force: true});
}
