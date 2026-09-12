// Read-only qualification of the committed opaque export. No files are written.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "evidence/visual-foundation/fixture-50.roproj");
const files = [];
for (const name of ["manifest.json", "schemas.json"]) files.push({ path: name, bytes: await readFile(path.join(fixture, name)) });
for (const shard of await readdir(path.join(fixture, "entities"))) files.push({ path: `entities/${shard}`, bytes: await readFile(path.join(fixture, "entities", shard)) });
files.sort((a, b) => a.path.localeCompare(b.path));
const digest = createHash("sha256");
for (const file of files) digest.update(file.path).update("\0").update(file.bytes);
const sha256 = digest.digest("hex");
const encoded = files.map(file => ({ path: file.path, bytes: Array.from(file.bytes) }));
const pageSource = `<!doctype html><script type="module">
import { createExperimentalDesignerClient } from '/kit/experimental-client.js';
const files = ${JSON.stringify(encoded)}.map(file => ({ path: file.path, bytes: Uint8Array.from(file.bytes).buffer }));
const client = createExperimentalDesignerClient();
try {
  const opened = await client.openCanonicalTree(files);
  const first = await client.queryTable(opened.bootstrap.default_collection);
  const values = first.rows.map(row => Object.fromEntries(row.fields.map(field => [field.target.field, field.stored?.value ?? null])));
  const reopened = await client.openCanonicalTree(files);
  const second = await client.queryTable(reopened.bootstrap.default_collection);
  const valuesAgain = second.rows.map(row => Object.fromEntries(row.fields.map(field => [field.target.field, field.stored?.value ?? null])));
  if (first.rows.length !== 50 || second.rows.length !== 50) throw new Error('expected 50 rows across repeated admission');
  if (JSON.stringify(values) !== JSON.stringify(valuesAgain)) throw new Error('re-open projection content changed');
  const text = values.map(row => row.task).filter(value => typeof value === 'string');
  if (!text.some(value => /[^\\x00-\\x7F]/u.test(value)) || !text.some(value => /[A-Za-z]/.test(value))) throw new Error('expected non-ASCII CJK and Latin task values');
  if (!values.every(row => typeof row.estimate === 'number' && typeof row.done === 'boolean')) throw new Error('expected numeric estimate and boolean done values');
  document.body.textContent = JSON.stringify({ rows: first.rows.length, rows_again: second.rows.length, values, revision: first.revision });
} catch (error) { document.body.dataset.status = 'failed'; document.body.textContent = String(error?.stack ?? error); }
finally { await client.closeProject().catch(() => {}); await client.close(); }
</script>`;
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") return response.end(pageSource);
  if (!pathname.startsWith("/kit/")) return response.writeHead(404).end();
  const file = path.resolve(root, "public/core-kit", pathname.slice(5));
  if (!file.startsWith(path.join(root, "public/core-kit") + path.sep)) return response.writeHead(400).end();
  response.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "application/wasm" });
  response.end(await readFile(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.body.textContent?.length > 0, null, { timeout: 15000 });
  if (await page.locator("body").getAttribute("data-status") === "failed") throw new Error(await page.locator("body").textContent());
  console.log(JSON.stringify({ status: "PASS", files: files.length, sha256, observation: JSON.parse(await page.locator("body").textContent()) }, null, 2));
} finally { await browser.close(); server.close(); }
