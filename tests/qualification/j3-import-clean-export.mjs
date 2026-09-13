// ChatGPT Steward acceptance preparation for #17; real kit/Worker/WASM only.
// This is NOT normal Sheet UX, durable Save, full J3, or release acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdtemp, rm, realpath} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const corpusRoot = path.join(root, 'acceptance/j3-interop');
const block = message => { const e = new Error(message); e.blocked = true; throw e; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let browser, server, outputs;
try {
  const corpus = JSON.parse(await readFile(path.join(corpusRoot, 'corpus.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'core-kit.lock.json'), 'utf8').catch(() => block('Missing repository/kit lock.')));
  if (lock.sourceCommit !== corpus.core_source || lock.artifactManifestSha256 !== corpus.core_manifest_sha256) block('Kit pin changed: re-qualify with Steward; do not silently reuse this baseline.');
  const kit = await realpath(path.join(root, lock.defaultKit));
  execFileSync(process.execPath, [path.join(root, 'scripts/verify-core-kit.mjs')], {cwd: root, stdio: 'inherit'});
  execFileSync('python3', [path.join(corpusRoot, 'check.py')], {stdio: 'inherit'});
  const inputs = {};
  for (const [name, expected] of Object.entries(corpus.files)) {
    const bytes = await readFile(path.join(corpusRoot, 'fixtures', name));
    assert.equal(hash(bytes), expected.sha256); inputs[name] = [...bytes];
  }
  let chromium;
  try { ({chromium} = await import('playwright')); } catch { block('Install the repository-locked Playwright dependency.'); }
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') { response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); response.end('<!doctype html><meta charset="utf-8"><title>J3 kit qualification only</title>'); return; }
      if (!pathname.startsWith('/kit/')) { response.writeHead(404); response.end(); return; }
      const file = await realpath(path.resolve(kit, pathname.slice(5)));
      if (!file.startsWith(kit + path.sep)) throw new Error('outside kit');
      const mime = path.extname(file) === '.js' ? 'text/javascript' : path.extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream';
      response.writeHead(200, {'Content-Type':mime}); response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { browser = await chromium.launch({headless:true, ...(process.env.WORK_CHROMIUM ? {executablePath:process.env.WORK_CHROMIUM} : {})}); }
  catch (e) { block(`Real browser unavailable: ${e.message}`); }
  outputs = await mkdtemp(path.join(tmpdir(), 'sheet-j3-exports-'));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    const {createExperimentalDesignerClient} = await import('/kit/experimental-client.js');
    window.makeClient = createExperimentalDesignerClient;
    window.client = createExperimentalDesignerClient();
  });
  const required = ['newTracker','inspectSpreadsheet','importSpreadsheet','previewCleanup','commitCleanup','exportSpreadsheet','exportProject','openProject','observeOccurrence','queryTable','editText','editNumber','closeProject','close'];
  const absent = await page.evaluate(names => names.filter(name => typeof window.client[name] !== 'function'), required);
  if (absent.length) block(`Missing public consumer methods: ${absent.join(', ')}`);
  const inspect = async (name, format) => page.evaluate(async ({bytes,format}) => window.client.inspectSpreadsheet(new Uint8Array(bytes).buffer, format, {delimiter:',',header:true}), {bytes:inputs[name], format});
  const importFile = async (name, format, types) => page.evaluate(async ({bytes,format,types}) => {
    const result = await window.client.importSpreadsheet(new Uint8Array(bytes).buffer, format, {delimiter:',',header:true}, {column_types:[types],extra_columns:[[]]});
    window.imported = result; window.table = result.opened.table; return result;
  }, {bytes:inputs[name],format,types});
  const observe = async () => page.evaluate(async () => {
    const c = window.client, occurrence = await c.observeOccurrence();
    const exported = await c.exportProject(occurrence.revision);
    return {occurrence, bytes:[...new Uint8Array(exported.bytes)]};
  });
  const projection = table => table.rows.map(row => table.columns.map(column => {
    const field = row.fields.find(f => f.target.field === column.id);
    assert.ok(field?.stored, 'Missing actual stored value');
    return {kind:field.stored.kind, value:field.stored.value};
  }));
  const expected = rows => rows.map(row => row.map(value => ({kind:typeof value === 'number' ? 'number' : 'text',value})));
  const refresh = async () => page.evaluate(async () => window.table = await window.client.queryTable(window.table.collection.key));
  const previewTrim = async () => page.evaluate(async () => {
    const t = window.table;
    return window.client.previewCleanup(t.revision, {kind:'trim',fields:t.rows.map(row => ({entity:row.id,field:t.columns[0].id}))});
  });
  const commit = async preview => page.evaluate(p => window.client.commitCleanup(p.revision,p.preview_id), preview);
  const editItem = async (rowIndex,value) => page.evaluate(async ({rowIndex,value}) => {
    const t=window.table; return window.client.editText(t.revision,{entity:t.rows[rowIndex].id,field:t.columns[0].id},value);
  }, {rowIndex,value});
  for (const format of ['csv','xlsx']) {
    await page.evaluate(async () => { await window.client.close(); window.client=window.makeClient(); await window.client.newTracker(); });
    const before = await observe();
    const source = await inspect(`messy.${format}`, format);
    assert.deepEqual(source.sheets[0].rows.map(row => row.map(cell => cell.value)), expected(corpus.raw_rows));
    assert.deepEqual(await observe(), before, 'Inspection mutated the current occurrence');
    let invalidRejected = false;
    try { await importFile(`messy.${format}`,format,['number','number','number']); } catch { invalidRejected=true; }
    assert.ok(invalidRejected, 'Invalid Text->Number admission accepted');
    assert.deepEqual(await observe(), before, 'Failed candidate import replaced/mutated current work');
    const imported = await importFile(`messy.${format}`,format,['text','number','number']);
    const typed = corpus.raw_rows.map(row => [row[0],Number(row[1]),Number(row[2])]); // fixed input expectation, not product logic
    assert.deepEqual(projection(imported.opened.table), expected(typed));
    let beforePreview=await observe();
    const trim=await previewTrim();
    assert.deepEqual(await observe(),beforePreview,'Trim preview published');
    const itemField=imported.opened.table.columns[0].id;
    const targetKey=t=>`${t.entity}\0${t.field}`;
    assert.deepEqual(trim.changes.map(c=>targetKey(c.target)).sort(),[0,2].map(i=>targetKey({entity:imported.opened.table.rows[i].id,field:itemField})).sort());
    await commit(trim); let table=await refresh();
    assert.deepEqual(projection(table),expected([['PEN',3,200],['NOTE',2,500],['PEN',3,200]]));
    beforePreview=await observe();
    const dedup=await page.evaluate(async () => {
      const t=window.table; return window.client.previewCleanup(t.revision,{kind:'deduplicate',entities:t.rows.map(r=>r.id),key_fields:t.columns.map(c=>c.id)});
    });
    assert.deepEqual(await observe(),beforePreview,'Dedup preview published');
    assert.equal(dedup.removed_entities.length,1);
    assert.ok([table.rows[0].id,table.rows[2].id].includes(dedup.removed_entities[0]));
    await commit(dedup); table=await refresh();
    assert.deepEqual(projection(table),expected(corpus.clean_rows));
    for (const exportFormat of ['csv','xlsx']) {
      const beforeExport=await observe();
      const exported=await page.evaluate(async format => {
        const result=await window.client.exportSpreadsheet(window.table.revision,window.imported.metadata,format,window.imported.metadata.sheets[0].schema_id);
        return {revision:result.revision,bytes:[...new Uint8Array(result.bytes)],ledger:result.ledger};
      }, exportFormat);
      assert.equal(exported.revision,table.revision);
      assert.deepEqual(await observe(),beforeExport,'Export mutated canonical work');
      const file=path.join(outputs,`${format}-to-${exportFormat}.${exportFormat}`);
      await writeFile(file,new Uint8Array(exported.bytes));
      execFileSync('python3',[path.join(corpusRoot,'check.py'),'--export',file],{stdio:'inherit'});
      console.log(JSON.stringify({case:`${format} -> ${exportFormat} actual exporter ledger`,ledger:exported.ledger}));
    }
    const stableBefore=projection(table), idsBefore=table.rows.map(r=>[r.id,...r.fields.map(f=>f.target.field)]);
    await page.evaluate(async () => {
      const c=window.client; const saved=await c.exportProject(window.table.revision); const bytes=saved.bytes.slice(0);
      await c.closeProject(); await c.close(); window.client=window.makeClient();
      window.table=(await window.client.openProject(bytes)).table;
    });
    table=await refresh(); assert.deepEqual(projection(table),stableBefore);
    assert.deepEqual(table.rows.map(r=>[r.id,...r.fields.map(f=>f.target.field)]),idsBefore);
    await editItem(0,' PEN '); await refresh();
    const stale=await previewTrim();
    await editItem(1,'NOTE changed'); await refresh(); const afterEdit=await observe();
    let staleRejected=false;
    try { await commit(stale); } catch { staleRejected=true; }
    assert.ok(staleRejected,'Stale cleanup preview accepted');
    assert.deepEqual(await observe(),afterEdit,'Stale cleanup changed already-published work');
    console.log(JSON.stringify({case:`J3 ${format} consumer subset`,status:'PASS_CONSUMER_SUBSET_ONLY',durableSave:'NOT_TESTED',normalSheetUI:'NOT_TESTED'}));
  }
  const sentinel = await inspect('text-sentinels.csv','csv');
  assert.deepEqual(sentinel.sheets[0].rows.map(row=>row[0].value),expected(corpus.text_sentinels.map(v=>[v])).map(r=>r[0]));
  const importedText=await importFile('text-sentinels.csv','csv',['text']);
  assert.deepEqual(projection(importedText.opened.table),expected(corpus.text_sentinels.map(v=>[v])));
  const beforeUnsupported=await observe();
  const unsupported=await inspect('merged-note.xlsx','xlsx');
  assert.deepEqual(await observe(),beforeUnsupported,'Unsupported inspection mutated current work');
  console.log(JSON.stringify({case:'J3 real merged-note disposition',ledger:unsupported.ledger}));
  const finding=unsupported.ledger.find(f=>/merg/i.test(`${f.code} ${f.location} ${f.message}`)&&['unsupported_safe_disabled','lossy_on_export'].includes(f.category));
  if(!finding) block('Merged-note disposition is not qualified unsupported evidence. Investigate actual preservation/loss and route to Steward; no silent waiver.');
  assert.ok(finding.location && finding.message,'Missing useful unsupported-content explanation');
  for(const [name,expectedHash] of Object.entries(corpus.files)) assert.equal(hash(await readFile(path.join(corpusRoot,'fixtures',name))),expectedHash.sha256,'Original source changed');
  console.log(JSON.stringify({status:'PASS_CONSUMER_SUBSET_ONLY',source:lock.sourceCommit,manifest:lock.artifactManifestSha256,browser:browser.version(),product:'NOT_TESTED',hostRestart:'NOT_TESTED',fullJ3:'NOT_PASS'}));
} catch(error) {
  const setup = error.blocked || ['ENOENT','ERR_MODULE_NOT_FOUND'].includes(error.code);
  console.error(JSON.stringify({status:setup?'BLOCKED':'FAIL_OR_UNQUALIFIED',message:String(error.stack??error),product:'NOT_TESTED'}));
  process.exitCode=setup?78:1;
} finally {
  if(browser) await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  if(outputs) await rm(outputs,{recursive:true,force:true});
}
