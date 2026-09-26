// A definition-bearing Save must not read table bindings that are irrelevant
// to selecting its opaque snapshot. Exercise the ordinary UI with a real
// imported source, published summary, report and local-copy store.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = process.env.WORK_DIST ?? path.join(root, "dist-acceptance");
const fixture = path.join(root, "acceptance", "web-save-closure", "fixtures", "date-only.csv");
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-save-read-fault-"));
const launchOptions = { headless: true, ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) };
let context;

async function savedFacts(page, name) {
  return page.evaluate(async (copyName) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tachiko-sheet-local-copies");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const row = await new Promise((resolve, reject) => {
        const request = db.transaction("opaque-copies", "readonly").objectStore("opaque-copies").get(copyName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!row) throw new Error(`Missing opaque copy ${copyName}`);
      const hash = async (bytes) => Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      return {
        kind: row.kind,
        revision: row.revision,
        coreHash: await hash(row.bytes),
        source: row.importedSource ? {
          hash: await hash(row.importedSource.bytes),
          metadata: row.importedSource.metadata,
          ledger: row.importedSource.ledger,
        } : null,
        presentation: row.presentation ?? null,
        savedAt: row.savedAt,
      };
    } finally {
      db.close();
    }
  }, name);
}

try {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await installDistRoutes(context, dist);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();

  await page.getByLabel("Choose CSV or XLSX", { exact: true }).setInputFiles(fixture);
  const importDialog = page.getByRole("dialog", { name: "Review import candidate", exact: true });
  await importDialog.waitFor();
  const columnTypes = importDialog.locator("select");
  for (let index = 0; index < 5; index += 1) await columnTypes.nth(index).selectOption(index === 2 || index === 3 ? "number" : "text");
  await importDialog.getByRole("button", { name: "Import candidate", exact: true }).click();
  await page.getByTestId("project-ready").waitFor();

  await page.getByRole("tab", { name: "Cross-table summary", exact: true }).click();
  await page.getByRole("button", { name: "Choose tables and fields", exact: true }).click();
  const binding = page.locator('[aria-label="Cross-table summary binding"] select');
  for (const [index, value] of ["sheet_1", "column_1", "column_3", "sheet_1", "column_1", "column_2", "column_4"].entries()) {
    await binding.nth(index).selectOption(value);
  }
  await page.getByRole("button", { name: "Create cross-table summary", exact: true }).click();
  await page.getByLabel("Cross-table groups", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create bar report", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Save read fault report");

  const save = async (name) => {
    await page.getByRole("button", { name: "Save a copy", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save a copy", exact: true });
    await dialog.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create copy", exact: true }).click();
    await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  };

  await save("save-read-fault-before");
  const previousCopy = await savedFacts(page, "save-read-fault-before");
  assert.equal(previousCopy.kind, "opaque");
  assert.ok(previousCopy.source, "the imported source attachment is retained");
  assert.equal(previousCopy.presentation?.report?.title, "Save read fault report");

  await page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
  await save("save-read-fault-after");
  const savedCopy = await savedFacts(page, "save-read-fault-after");
  assert.equal(savedCopy.kind, previousCopy.kind);
  assert.equal(savedCopy.revision, previousCopy.revision);
  assert.equal(savedCopy.coreHash, previousCopy.coreHash, "the opaque core snapshot is preserved");
  assert.equal(savedCopy.source.hash, previousCopy.source.hash, "the imported source bytes are preserved");
  assert.deepEqual(savedCopy.source.metadata, previousCopy.source.metadata);
  assert.deepEqual(savedCopy.source.ledger, previousCopy.source.ledger);
  assert.deepEqual(savedCopy.presentation, previousCopy.presentation, "the report attachment is preserved");
  assert.deepEqual(await savedFacts(page, "save-read-fault-before"), previousCopy, "the earlier saved copy remains unchanged");

  console.log(JSON.stringify({ status: "PASS", regression: "definition-bearing Save bypasses unrelated table-read fault", coreHash: savedCopy.coreHash, sourceHash: savedCopy.source.hash }));
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
