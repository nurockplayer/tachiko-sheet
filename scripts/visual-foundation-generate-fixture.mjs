// Evidence-only generator: uses the vendored public client to author, export,
// and re-admit a deterministic Tracker corpus. It does not hand-author bytes.
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kitRoot = path.join(root, "public/core-kit");
const output = process.env.VF_FIXTURE_OUTPUT
  ? path.resolve(process.env.VF_FIXTURE_OUTPUT)
  : await mkdtemp("/tmp/tachiko-vf-fixture-");
const pageSource = `<!doctype html><meta charset="utf-8"><script type="module">
import { createExperimentalDesignerClient } from '/kit/experimental-client.js';
const client = createExperimentalDesignerClient();
try {
  let opened = await client.newTracker();
  let revision = opened.table.revision;
  const collection = opened.table.collection.id;
  for (let i = 0; i < 50; i++) {
    const publication = await client.trackerCommand({ type: 'append_row', expected_revision: revision, collection });
    revision = publication.resulting_revision;
  }
  let table = await client.queryTable(collection);
  if (table.rows.length !== 50) throw new Error('expected 50 rows, got ' + table.rows.length);
  const field = (row, key) => row.fields.find(candidate => candidate.target.field === key)?.target;
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const task = field(row, 'task'); const estimate = field(row, 'estimate'); const done = field(row, 'done');
    if (!task || !estimate || !done) throw new Error('Tracker fields missing at row ' + i);
    revision = (await client.editText(revision, task, i % 2 ? 'Review partner brief' : '整理試玩回饋')).resulting_revision;
    revision = (await client.editNumber(revision, estimate, String((i % 9) + 1))).resulting_revision;
    revision = (await client.editBoolean(revision, done, true)).resulting_revision;
    table = await client.queryTable(collection);
  }
  const exported = await client.exportCanonicalTree(revision);
  const reopened = await client.openCanonicalTree(exported.files);
  const finalTable = await client.queryTable(reopened.bootstrap.default_collection);
  if (finalTable.rows.length !== 50) throw new Error('reopen expected 50 rows, got ' + finalTable.rows.length);
  document.body.textContent = JSON.stringify({ revision, rows: finalTable.rows.length, files: exported.files.map(file => ({ path: file.path, bytes: Array.from(new Uint8Array(file.bytes)) })) });
} catch (error) { document.body.dataset.status = 'failed'; document.body.textContent = String(error?.stack ?? error); }
finally { await client.closeProject().catch(() => {}); await client.close(); }
</script>`;
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") return response.end(pageSource);
  if (!pathname.startsWith("/kit/")) return response.writeHead(404).end();
  const file = path.resolve(kitRoot, pathname.slice(5));
  if (!file.startsWith(`${kitRoot}${path.sep}`)) return response.writeHead(400).end();
  const mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  response.end(await (await import("node:fs/promises")).readFile(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error(`PAGE_ERROR: ${error.stack ?? error}`));
  page.on("console", message => console.error(`PAGE_CONSOLE: ${message.type()} ${message.text()}`));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => document.body.textContent?.length > 0, null, { timeout: 15000 });
  if (await page.locator("body").getAttribute("data-status") === "failed") throw new Error(await page.locator("body").textContent());
  const result = JSON.parse(await page.locator("body").textContent());
  await mkdir(output, { recursive: true });
  for (const file of result.files) {
    const target = path.join(output, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.bytes));
  }
  const digest = createHash("sha256");
  for (const file of result.files.sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(Buffer.from(file.bytes));
  console.log(JSON.stringify({ status: "PASS", rows: result.rows, revision: result.revision, files: result.files.length, sha256: digest.digest("hex"), output }, null, 2));
} finally { await browser.close(); server.close(); }
