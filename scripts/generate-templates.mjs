// Generates the Home templates as native work files with Work's own exporter.
//
// For each template it starts a fresh experimental Designer client, builds a
// native table with kit calls (newTable, trackerCommand/paste_cells,
// updateFormula, copyFormula, setColumnNumberFormat, setColumnConstraint),
// exports the result with exportPortableRo, and writes public/templates/<id>.ro.
// Sheet never writes work-file bytes itself; these files are opened like any
// other work file.
//
// `--check` reopens every committed file with openPortableRo, queries the
// table and asserts its row count and a calculated value, so a Work re-pin that
// changes the work-file format fails here rather than in the product.
//
// Re-run after a Work re-pin that changes the work-file format:
//   orb-test --local --image mcr.microsoft.com/playwright:v1.62.1-noble \
//     --out public/templates -- node scripts/generate-templates.mjs
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const kitRoot = path.join(root, 'public', 'core-kit');
const templatesRoot = path.join(root, 'public', 'templates');
const checkOnly = process.argv.includes('--check');

const usd = {decimals: 2, kind: {type: 'currency', code: 'USD'}, thousands_separator: true};
const list = values => ({kind: 'text_literal_set', values});

// Formula sources use {Column} placeholders; the runner replaces each with that
// column's real Work field key (never the display name).
const templates = [
  {
    id: 'budget',
    name: 'Monthly budget',
    columns: [
      {name: 'Category', type: 'text'},
      {name: 'Planned', type: 'number'},
      {name: 'Actual', type: 'number'},
      {name: 'Left', type: 'number'},
    ],
    rows: [
      ['Rent', '1200', '1200', '0'],
      ['Groceries', '400', '362.50', '37.5'],
      ['Utilities', '150', '138.20', '11.8'],
      ['Transport', '120', '96', '24'],
      ['Phone & internet', '60', '60', '0'],
      ['Eating out', '150', '184', '-34'],
      ['Savings', '300', '300', '0'],
      ['Other', '100', '45', '55'],
    ],
    formulas: [{column: 'Left', source: '[.{Planned}]-[.{Actual}]'}],
    number_formats: [
      {column: 'Planned', format: usd},
      {column: 'Actual', format: usd},
      {column: 'Left', format: usd},
    ],
    checks: [{row: 0, column: 'Left', value: 0}, {row: 1, column: 'Left', value: 37.5}],
  },
  {
    id: 'invoice',
    name: 'Invoice',
    columns: [
      {name: 'Item', type: 'text'},
      {name: 'Qty', type: 'number'},
      {name: 'Unit price', type: 'number'},
      {name: 'Amount', type: 'number'},
    ],
    rows: [
      ['Paper', '10', '3.50', '35'],
      ['Toner', '2', '48', '96'],
      ['Pens', '30', '0.80', '24'],
      ['Stapler', '1', '12.90', '12.9'],
      ['Folders', '25', '1.20', '30'],
    ],
    formulas: [{column: 'Amount', source: '[.{Qty}]*[.{Unit price}]'}],
    number_formats: [
      {column: 'Unit price', format: usd},
      {column: 'Amount', format: usd},
    ],
    checks: [{row: 0, column: 'Amount', value: 35}, {row: 1, column: 'Amount', value: 96}],
  },
  {
    id: 'tasks',
    name: 'Tasks',
    columns: [
      {name: 'Task', type: 'text'},
      {name: 'Owner', type: 'text'},
      {name: 'Due', type: 'date'},
      {name: 'Status', type: 'text'},
      {name: 'Priority', type: 'text'},
    ],
    rows: [
      ['Draft the quarterly update', 'Avery Chen', '2026-11-10', 'In progress', 'High'],
      ['Book the meeting room', 'Jordan Lee', '2026-11-12', 'Done', 'Medium'],
      ['Collect receipts', 'Sam Rivera', '2026-11-18', 'To do', 'Low'],
      ['Review the printer quote', 'Priya Nair', '2026-11-24', 'To do', 'Medium'],
      ['Send the holiday schedule', 'Morgan Ellis', '2026-12-01', 'To do', 'High'],
      ['Archive last month’s forms', 'Casey Wong', '2026-12-08', 'Done', 'Low'],
    ],
    formulas: [],
    number_formats: [],
    constraints: [
      {column: 'Status', constraint: list(['To do', 'In progress', 'Done'])},
      {column: 'Priority', constraint: list(['High', 'Medium', 'Low'])},
    ],
    checks: [],
  },
  {
    id: 'gradebook',
    name: 'Grades',
    columns: [
      {name: 'Student', type: 'text'},
      {name: 'Homework', type: 'number'},
      {name: 'Midterm', type: 'number'},
      {name: 'Final', type: 'number'},
      {name: 'Average', type: 'number'},
    ],
    rows: [
      ['Alex Kim', '85', '78', '92', '85'],
      ['Bailey Tran', '94', '88', '96', '92.7'],
      ['Casey Okafor', '72', '65', '74', '70.3'],
      ['Dev Patel', '98', '91', '95', '94.7'],
      ['Elliot Rossi', '55', '62', '58', '58.3'],
      ['Frankie Singh', '78', '84', '80', '80.7'],
    ],
    formulas: [{column: 'Average', source: 'ROUND(([.{Homework}]+[.{Midterm}]+[.{Final}])/3, 1)'}],
    number_formats: [],
    checks: [{row: 0, column: 'Average', value: 85}, {row: 4, column: 'Average', value: 58.3}],
  },
];

const pageSource = `<!doctype html><meta charset="utf-8">
<script type="module">
import {createExperimentalDesignerClient} from '/kit/experimental-client.js';
const failure = error => {
  const detail = error?.failure;
  const parts = [error?.message ?? String(error)];
  if (detail?.code) parts.push(detail.code);
  if (detail?.message) parts.push(detail.message);
  return parts.filter(Boolean).join(': ');
};
const keyed = table => display => {
  const column = table.columns.find(candidate => candidate.display_name === display);
  if (!column) throw new Error('The template column ' + display + ' was not created.');
  return column.key;
};
const resolve = (source, keyFor) => source.replace(/\{([^}]+)\}/g, (_, display) => keyFor(display));
const valuesOf = table => table.rows.map(row => Object.fromEntries(
  row.fields.map(field => [field.target.field, field.stored?.value ?? field.calculated?.value ?? null])));
const observe = table => ({
  table: table.collection.display_name,
  collection: table.collection.key,
  revision: table.revision,
  row_count: table.rows.length,
  columns: table.columns.map(column => ({
    id: column.id,
    key: column.key,
    display_name: column.display_name,
    field_type: column.field_type,
    number_format: column.number_format ?? null,
    constraint: column.constraint ?? null,
  })),
  values: valuesOf(table),
});
window.__runPlan = async plan => {
  const client = createExperimentalDesignerClient();
  try {
    const opened = await client.newTable(plan.name, plan.columns.map(column => ({
      name: column.name, field_type: column.type, required: false,
    })));
    let table = opened.table;
    const collection = table.collection.id;
    const keyFor = keyed(table);
    const pasted = await client.trackerCommand({
      type: 'paste_cells',
      expected_revision: table.revision,
      collection,
      start_entity: null,
      start_field: table.columns[0].id,
      rows: plan.rows,
    });
    let revision = pasted.resulting_revision;
    table = await client.queryTable(collection);
    for (const formula of plan.formulas ?? []) {
      const column = table.columns.find(candidate => candidate.display_name === formula.column);
      if (!column) throw new Error('The formula column ' + formula.column + ' was not created.');
      const source = {entity: table.rows[0].id, field: column.id};
      const updated = await client.updateFormula(revision, source, resolve(formula.source, keyFor));
      revision = updated.resulting_revision;
      const destinations = table.rows.slice(1).map(row => ({entity: row.id, field: column.id}));
      if (destinations.length) {
        const copied = await client.copyFormula(revision, {
          source, destinations, fixed_references: [], relative_rows: true, relative_columns: false,
        });
        revision = copied.resulting_revision;
      }
    }
    for (const item of plan.number_formats ?? []) {
      const column = table.columns.find(candidate => candidate.display_name === item.column);
      if (!column) throw new Error('The number format column ' + item.column + ' was not created.');
      const updated = await client.setColumnNumberFormat(revision, collection, column.id, item.format);
      revision = updated.resulting_revision;
    }
    for (const item of plan.constraints ?? []) {
      const column = table.columns.find(candidate => candidate.display_name === item.column);
      if (!column) throw new Error('The constraint column ' + item.column + ' was not created.');
      const updated = await client.setColumnConstraint(revision, collection, column.id, item.constraint);
      revision = updated.resulting_revision;
    }
    table = await client.queryTable(collection);
    const exported = await client.exportPortableRo(revision);
    const bytes = new Uint8Array(exported.bytes);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return {...observe(table), exported_revision: exported.revision, base64: btoa(binary)};
  } catch (error) {
    throw new Error(failure(error));
  } finally {
    await client.closeProject().catch(() => {});
    await client.close();
  }
};
window.__checkPlan = async base64 => {
  const client = createExperimentalDesignerClient();
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const opened = await client.openPortableRo(bytes.buffer);
    const table = await client.queryTable(opened.table.collection.id);
    return observe(table);
  } catch (error) {
    throw new Error(failure(error));
  } finally {
    await client.closeProject().catch(() => {});
    await client.close();
  }
};
window.__templatesReady = true;
</script>`;

const mime = {'.js': 'text/javascript', '.wasm': 'application/wasm'};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      response.end(pageSource);
      return;
    }
    if (!pathname.startsWith('/kit/')) throw new Error('unknown asset');
    const file = path.resolve(kitRoot, pathname.slice('/kit/'.length));
    if (file !== kitRoot && !file.startsWith(`${kitRoot}${path.sep}`)) throw new Error('outside kit');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('unavailable');
  }
});

function checkValues(label, plan, observed) {
  assert.equal(observed.row_count, plan.rows.length, `${label} has ${plan.rows.length} rows`);
  const ids = new Map(observed.columns.map(column => [column.display_name, column.id]));
  for (const check of plan.checks) {
    const id = ids.get(check.column);
    assert.ok(id, `${label} still has the ${check.column} column`);
    assert.equal(observed.values[check.row][id], check.value,
      `${label} row ${check.row} ${check.column} calculates ${check.value}`);
  }
  if (plan.constraints) {
    for (const item of plan.constraints ?? []) {
      const column = observed.columns.find(candidate => candidate.display_name === item.column);
      assert.equal(column.constraint?.kind, item.constraint.kind, `${label} keeps the ${item.column} list`);
      // Work's projection orders an allowed-values list itself.
      assert.deepEqual([...column.constraint.values].sort(), [...item.constraint.values].sort(),
        `${label} keeps every ${item.column} list value`);
    }
  }
  for (const item of plan.number_formats ?? []) {
    const column = observed.columns.find(candidate => candidate.display_name === item.column);
    assert.deepEqual(column.number_format, item.format, `${label} keeps the ${item.column} format`);
  }
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const {port} = server.address();
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.__templatesReady === true);
  if (checkOnly) {
    for (const plan of templates) {
      const file = path.join(templatesRoot, `${plan.id}.ro`);
      const bytes = await readFile(file);
      const observed = await page.evaluate(base64 => window.__checkPlan(base64), bytes.toString('base64'));
      checkValues(`${plan.id}.ro`, plan, observed);
      console.log(JSON.stringify({check: plan.id, byte_length: bytes.byteLength, row_count: observed.row_count,
        columns: observed.columns.map(column => column.display_name)}));
    }
  } else {
    await mkdir(templatesRoot, {recursive: true});
    for (const plan of templates) {
      const observed = await page.evaluate(value => window.__runPlan(value), plan);
      assert.equal(observed.exported_revision, observed.revision, `${plan.id} exports its current revision`);
      checkValues(plan.id, plan, observed);
      const bytes = Buffer.from(observed.base64, 'base64');
      const file = path.join(templatesRoot, `${plan.id}.ro`);
      await writeFile(file, bytes);
      console.log(JSON.stringify({template: plan.id, file: path.relative(root, file),
        byte_length: bytes.byteLength, table: observed.table, row_count: observed.row_count}));
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
