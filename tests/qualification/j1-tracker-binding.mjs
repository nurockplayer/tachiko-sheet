// Qualification-only: establish whether the fixed J1 inputs bind to the pinned
// public Tracker runtime. This is not a J1 product/acceptance test.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {inspectQualifiedKit} from './qualified-kit.mjs';

const coreSourceCommit = '8bba9b09cea3c011df383216ba3846ccd003dece';
const kit = process.env.WORK_CLIENT_KIT;
if (!kit) throw new Error('WORK_CLIENT_KIT is required.');
const kitRoot = path.resolve(kit);
const evidenceFile = fileURLToPath(new URL('../../evidence/j1-tracker-binding.json', import.meta.url));
const fixedInputFile = fileURLToPath(new URL('../../acceptance/mvp-v1/scenarios.json', import.meta.url));
const writeEvidence = record => writeFile(evidenceFile, `${JSON.stringify(record, null, 2)}\n`);

const kitInventory = await inspectQualifiedKit(kitRoot);
if (!kitInventory.qualified) {
  const record = {
    case: 'J1-native-tracker-binding',
    status: 'BLOCKED',
    reason: 'The supplied kit does not match the complete recorded 21-asset qualification inventory.',
    kit_inventory: kitInventory,
  };
  await writeEvidence(record);
  console.error(JSON.stringify(record));
  process.exit(78);
}

const scenarios = JSON.parse(await readFile(fixedInputFile, 'utf8'));
const j1 = scenarios.journeys.find(journey => journey.id === 'J1');
assert.ok(j1, 'J1 fixed input is missing.');
const candidateRows = j1.tasks.map(([name, _status, priority]) => [name, String(priority), 'false']);
const pageSource = `<!doctype html><meta charset="utf-8"><button id="run">Run</button><pre id="result"></pre>
<script type="module">
import {createExperimentalDesignerClient} from '/kit/experimental-client.js';
const candidateRows=${JSON.stringify(candidateRows)};
const editTarget=${JSON.stringify(j1.edit_target)};
const acceptedPriority=${JSON.stringify(String(j1.accepted_priority))};
const rejectedPriority=${JSON.stringify(String(j1.rejected_priority))};
const rowValues=table=>table.rows.map(({fields})=>Object.fromEntries(fields.map(({target,stored})=>[target.field,stored?.value??null])));
const targetFor=(table,name)=>{
 const row=table.rows.find(item=>item.fields.find(field=>field.target.field==='task')?.stored?.value===name);
 const field=row?.fields.find(item=>item.target.field==='estimate');
 if(!field)throw new Error('Native Tracker did not expose an estimate target for the fixed J1 name.');
 return field.target;
};
document.querySelector('#run').onclick=async()=>{
 const client=createExperimentalDesignerClient();
 try {
  const opened=await client.newTracker();
  const initial=opened.table;
  await client.trackerCommand({type:'paste_cells',expected_revision:initial.revision,collection:initial.collection.id,start_entity:null,start_field:'task',rows:candidateRows});
  let table=await client.queryTable(initial.collection.id);
  const seeded=rowValues(table);
  const target=targetFor(table,editTarget);
  const beforeAccepted=table.revision;
  const accepted=await client.editNumber(beforeAccepted,target,acceptedPriority);
  table=await client.queryTable(initial.collection.id);
  const beforeRejected=table.revision;
  const six=await client.editNumber(beforeRejected,target,rejectedPriority);
  const afterSix=await client.queryTable(initial.collection.id);
  document.querySelector('#result').textContent=JSON.stringify({
   methods:['newTracker','trackerCommand','queryTable'].map(name=>typeof client[name]==='function'),
   initial:{tracker_profile:initial.tracker_profile,columns:initial.columns.map(column=>({id:column.id,key:column.key,field_type:column.field_type,dropdown_options:column.dropdown_options??null}))},
   seeded,
   accepted:{revision_changed:accepted.resulting_revision!==beforeAccepted,resulting_estimate:rowValues(table).find(row=>row.task===editTarget)?.estimate},
   rejected_candidate:{published:six.resulting_revision!==beforeRejected,resulting_estimate:rowValues(afterSix).find(row=>row.task===editTarget)?.estimate},
  });
 }catch(error){document.querySelector('#result').dataset.status='failed';document.querySelector('#result').textContent=String(error?.stack??error);}
 finally{await client.closeProject().catch(()=>{});await client.close();}
};
</script>`;
const mime = {'.js': 'text/javascript', '.wasm': 'application/wasm'};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(pageSource);
      return;
    }
    if (!pathname.startsWith('/kit/')) throw new Error('unknown asset');
    const file = path.resolve(kitRoot, pathname.slice('/kit/'.length));
    if (!file.startsWith(`${kitRoot}${path.sep}`)) throw new Error('outside kit');
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('unavailable');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const {port} = server.address();
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#result').textContent.length > 0);
  assert.notEqual(await page.locator('#result').getAttribute('data-status'), 'failed', await page.locator('#result').textContent());
  const observation = JSON.parse(await page.locator('#result').textContent());
  assert.deepEqual(observation.methods, [true, true, true]);
  assert.equal(observation.initial.tracker_profile, true);
  assert.deepEqual(observation.initial.columns, [
    {id: 'task', key: 'task', field_type: 'text', dropdown_options: null},
    {id: 'estimate', key: 'estimate', field_type: 'number', dropdown_options: null},
    {id: 'done', key: 'done', field_type: 'boolean', dropdown_options: ['true', 'false']},
  ]);
  assert.deepEqual(observation.seeded.map(row => [row.task, row.estimate]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), j1.tasks.map(([name, _status, priority]) => [name, priority]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  assert.equal(observation.accepted.revision_changed, true);
  assert.equal(observation.accepted.resulting_estimate, j1.accepted_priority);
  assert.equal(observation.rejected_candidate.published, true);
  assert.equal(observation.rejected_candidate.resulting_estimate, j1.rejected_priority);
  const record = {
    case: 'J1-native-tracker-binding',
    status: 'CANDIDATE_BINDING_INSUFFICIENT',
    fixed_input: {
      source: 'acceptance/mvp-v1/scenarios.json#J1',
      task_names: j1.tasks.map(([name]) => name),
      status_values_not_sent_to_native_boolean: j1.allowed_status,
      priority_range_required_by_J1: j1.priority_range,
      accepted_priority_candidate: j1.accepted_priority,
      rejected_priority_candidate: j1.rejected_priority,
    },
    qualified_kit: {
      source_commit: coreSourceCommit,
      inventory: kitInventory,
    },
    observation,
    conclusion: {
      native_boolean_column_does_not_represent_status_enum: true,
      out_of_J1_range_number_published_as_native_estimate: true,
      J1_status_and_priority_rule_bound_without_semantic_reinterpretation: false,
    },
  };
  await writeEvidence(record);
  console.log(JSON.stringify(record, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
