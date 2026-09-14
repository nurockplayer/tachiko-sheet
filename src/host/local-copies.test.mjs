// Focused host tests for durable local copies: real browser IndexedDB through
// the installed Playwright Chromium, with the production module compiled by the
// installed TypeScript (no new dependencies). No test server is used: the page
// is fulfilled through request interception so no listening socket is needed.
import test, {after} from "node:test";
import assert from "node:assert/strict";
import {readFile, mkdtemp, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

// The pinned `typescript` package is a native compiler build, so its JS entry
// point may expose no `transpileModule`. Prefer the JS API when it exists and
// otherwise drive the installed `tsc` CLI, so the real production source is what
// runs. `node:module.stripTypeScriptTypes` is deliberately avoided: project
// `engines` allow Node 22.12, which predates that API.
const TSC_CLI = fileURLToPath(new URL("../../node_modules/typescript/lib/tsc.js", import.meta.url));

async function transpileWithCli(source) {
  const dir = await mkdtemp(path.join(tmpdir(), "tachiko-transpile-"));
  try {
    const input = path.join(dir, "local-copies.ts");
    const outDir = path.join(dir, "out");
    await writeFile(input, source);
    const result = spawnSync(
      process.execPath,
      [TSC_CLI, "--noCheck", "--target", "es2022", "--module", "esnext", "--outDir", outDir, input],
      {encoding: "utf8", cwd: dir},
    );
    const emitted = path.join(outDir, "local-copies.js");
    if (result.status !== 0 || !existsSync(emitted)) {
      throw new Error(`tsc did not emit local-copies.js (status ${result.status}): ${result.stderr || result.stdout}`);
    }
    return await readFile(emitted, "utf8");
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

async function compileProductionModule() {
  const source = await readFile(new URL("./local-copies.ts", import.meta.url), "utf8");
  try {
    const ts = await import("typescript");
    if (typeof ts.transpileModule === "function") {
      return ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
      }).outputText;
    }
  } catch {
    // No JS API in the installed package; the CLI fallback below handles it.
  }
  return transpileWithCli(source);
}

const compiled = await compileProductionModule();

const pageHtml = `<!doctype html><meta charset="utf-8"><title>local copies host test</title>
<script type="module">
${compiled}
window.createLocalCopiesUnderTest = createLocalCopies;
window.localCopiesDbName = LOCAL_COPIES_DB_NAME;
window.localOpaqueCopiesStore = LOCAL_OPAQUE_COPIES_STORE;
</script>`;

const origin = "https://tachiko-sheet-host.test/";

async function installRoutes(router) {
  await router.route("**/*", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({status: 200, contentType: "text/html; charset=utf-8", body: pageHtml});
    }
    return route.fulfill({status: 404, contentType: "text/plain", body: "not found"});
  });
}

// Default Chromium (multiprocess). `--single-process` is required only because
// this sandbox denies Chromium's macOS mach-port rendezvous registration, so it
// is an explicit opt-in for confined worker runs and never the test default.
const singleProcess = process.env.TACHIKO_TEST_SINGLE_PROCESS === "1";
const launchOptions = singleProcess ? {args: ["--single-process"]} : {};
console.log(`[local-copies] Chromium launch mode: ${singleProcess ? "single-process (TACHIKO_TEST_SINGLE_PROCESS=1 sandbox override)" : "default multiprocess"}`);

let sharedBrowser;

/**
 * --single-process also makes a browser exit when its last context closes, so
 * each test owns its browser process. In default multiprocess mode one browser
 * is shared across tests and released by the `after` hook.
 */
async function acquireBrowser() {
  if (singleProcess) return {browser: await chromium.launch(launchOptions), owned: true};
  if (!sharedBrowser) sharedBrowser = chromium.launch(launchOptions);
  return {browser: await sharedBrowser, owned: false};
}

after(async () => {
  if (!sharedBrowser) return;
  try {
    await (await sharedBrowser).close();
  } catch {
    // The browser never launched or is already gone; nothing to release.
  }
  sharedBrowser = undefined;
});

async function withBrowser(run) {
  const {browser, owned} = await acquireBrowser();
  try {
    return await run(browser);
  } finally {
    if (owned) await browser.close().catch(() => {});
  }
}

/** A fresh page. Unless reset is disabled, its storage starts empty. */
async function openPage(context, {reset = true} = {}) {
  await installRoutes(context);
  const page = await context.newPage();
  await page.goto(origin);
  if (!reset) return page;
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(window.localCopiesDbName);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  return page;
}

/** Open a page whose context is always released, even when `run` throws. */
async function withPage(browser, run, options) {
  const context = await browser.newContext();
  try {
    const page = await openPage(context, options);
    return await run(page);
  } finally {
    await context.close().catch(() => {});
  }
}

test("create commits a durable copy; list/read return the stored bytes and core revision", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const transactions = [];
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (store, mode, options) {
      transactions.push({store, mode, options: options ? {...options} : null});
      return originalTransaction.call(this, store, mode, options);
    };
    try {
      const host = window.createLocalCopiesUnderTest();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const receipt = await host.create("Sample A", {
        revision: "core-rev-7",
        files: [
          {path: "manifest.json", bytes: bytes.buffer},
          {path: "entities/0.jsonl", bytes: new Uint8Array([9, 8, 7]).buffer},
        ],
      });
      bytes[0] = 99; // alias mutation after commit must not change durable bytes
      const listed = await host.list();
      const copy = await host.read("Sample A");
      new Uint8Array(copy.files[0].bytes)[1] = 77; // mutating returned bytes must not persist
      const reread = await host.read("Sample A");
      return {
        transactions,
        receipt,
        listed,
        revision: copy.revision,
        paths: copy.files.map((file) => file.path),
        first: Array.from(new Uint8Array(reread.files[0].bytes)),
        second: Array.from(new Uint8Array(reread.files[1].bytes)),
        missing: await host.read("absent"),
      };
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }
  }));
  assert.equal(result.receipt.name, "Sample A");
  assert.equal(result.receipt.revision, "core-rev-7");
  assert.match(result.receipt.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.deepEqual(result.listed, [{name: "Sample A", savedAt: result.receipt.savedAt, kind: "canonical"}]);
  assert.equal(result.revision, "core-rev-7");
  assert.deepEqual(result.paths, ["manifest.json", "entities/0.jsonl"]);
  assert.deepEqual(result.first, [1, 2, 3, 4]);
  assert.deepEqual(result.second, [9, 8, 7]);
  assert.equal(result.missing, null);
  const writes = result.transactions.filter((tx) => tx.mode === "readwrite");
  assert.deepEqual(writes, [{store: ["copies", "opaque-copies"], mode: "readwrite", options: {durability: "strict"}}]);
}));

test("a create-only conflict fails and preserves the existing destination", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    const snapshot = (revision, byte) => ({
      revision,
      files: [{path: "manifest.json", bytes: new Uint8Array([byte]).buffer}],
    });
    await host.create("Dup", snapshot("rev-1", 1));
    let failure = null;
    try {
      await host.create("Dup", snapshot("rev-2", 2));
    } catch (error) {
      failure = {name: error?.name ?? null, message: String(error?.message ?? error)};
    }
    const copy = await host.read("Dup");
    return {
      failure,
      revision: copy.revision,
      bytes: Array.from(new Uint8Array(copy.files[0].bytes)),
      names: (await host.list()).map((entry) => entry.name),
    };
  }));
  assert.ok(result.failure, "duplicate create must fail");
  assert.equal(result.failure.name, "ConstraintError");
  assert.equal(result.revision, "rev-1");
  assert.deepEqual(result.bytes, [1]);
  assert.deepEqual(result.names, ["Dup"]);
}));

test("the v1 canonical store is readable after the format-2 schema upgrade", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(window.localCopiesDbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("copies", {keyPath: "name"});
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("copies", "readwrite");
        tx.objectStore("copies").add({
          name: "Legacy",
          savedAt: "2026-09-13T00:00:00.000Z",
          revision: "legacy-rev",
          files: [{path: "manifest.json", bytes: new Uint8Array([7, 8]).buffer}],
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    const host = window.createLocalCopiesUnderTest();
    const copy = await host.readAny("Legacy");
    return {copy: {kind: copy.kind, revision: copy.revision, bytes: Array.from(new Uint8Array(copy.files[0].bytes))}, listed: await host.list()};
  }));
  assert.equal(result.copy.kind, "canonical");
  assert.equal(result.copy.revision, "legacy-rev");
  assert.deepEqual(result.copy.bytes, [7, 8]);
  assert.deepEqual(result.listed, [{name: "Legacy", savedAt: "2026-09-13T00:00:00.000Z", kind: "canonical"}]);
}));

test("opaque format-2 bytes are cloned, persisted, and explicitly discriminated", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    const bytes = new Uint8Array([0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x32]);
    const receipt = await host.createOpaque("Opaque", {revision: "core-rev-2", bytes: bytes.buffer});
    bytes[0] = 0;
    const first = await host.readAny("Opaque");
    new Uint8Array(first.bytes)[1] = 0;
    const second = await host.readAny("Opaque");
    let legacyReadFailure = null;
    try {
      await host.read("Opaque");
    } catch (error) {
      legacyReadFailure = {name: error?.name ?? null};
    }
    return {
      receipt,
      legacyReadFailure,
      first: {kind: first.kind, formatVersion: first.formatVersion, revision: first.revision, bytes: Array.from(new Uint8Array(first.bytes)), hasFiles: "files" in first, hasImportedSource: "importedSource" in first},
      second: {kind: second.kind, formatVersion: second.formatVersion, bytes: Array.from(new Uint8Array(second.bytes))},
      listed: await host.list(),
    };
  }));
  assert.deepEqual(result.receipt, {name: "Opaque", savedAt: result.receipt.savedAt, kind: "opaque", revision: "core-rev-2"});
  assert.deepEqual(result.legacyReadFailure, {name: "TypeError"});
  assert.deepEqual(result.first, {kind: "opaque", formatVersion: 2, revision: "core-rev-2", bytes: [0x66, 0, 0x72, 0x6d, 0x61, 0x74, 0x32], hasFiles: false, hasImportedSource: false});
  assert.deepEqual(result.second, {kind: "opaque", formatVersion: 2, bytes: [0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x32]});
  assert.deepEqual(result.listed, [{name: "Opaque", savedAt: result.receipt.savedAt, kind: "opaque"}]);
}));

test("opaque copies preserve an optional imported-source attachment outside the raw bytes", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    const opaqueBytes = new Uint8Array([0x70, 0x72, 0x6f, 0x6a]);
    const sourceBytes = new Uint8Array([0x73, 0x72, 0x63]);
    const metadata = {version: 2, sheets: [{name: "原始", rows: 3}]};
    const ledger = [{category: "preserved_readable", code: "opaque-source", location: "A1", message: "retained", blocking: false}];
    await host.createOpaque("Opaque attached", {
      revision: "core-rev-attached",
      bytes: opaqueBytes.buffer,
      importedSource: {name: "source.csv", format: "csv", bytes: sourceBytes.buffer, metadata, ledger},
    });
    opaqueBytes[0] = 0;
    sourceBytes[0] = 0;
    metadata.sheets[0].rows = 99;
    ledger[0].message = "mutated";
    const first = await host.readAny("Opaque attached");
    new Uint8Array(first.bytes)[1] = 0;
    first.importedSource.bytes = new Uint8Array([0]).buffer;
    first.importedSource.metadata.sheets[0].rows = 0;
    const second = await host.readAny("Opaque attached");
    return {
      first: {
        kind: first.kind,
        bytes: Array.from(new Uint8Array(first.bytes)),
        sourceBytes: Array.from(new Uint8Array(first.importedSource.bytes)),
        sourceName: first.importedSource.name,
        sourceFormat: first.importedSource.format,
        metadata: first.importedSource.metadata,
        ledger: first.importedSource.ledger,
      },
      second: {
        bytes: Array.from(new Uint8Array(second.bytes)),
        sourceBytes: Array.from(new Uint8Array(second.importedSource.bytes)),
        metadata: second.importedSource.metadata,
        ledger: second.importedSource.ledger,
      },
    };
  }));
  assert.equal(result.first.kind, "opaque");
  assert.deepEqual(result.first.bytes, [0x70, 0, 0x6f, 0x6a]);
  assert.deepEqual(result.first.sourceBytes, [0]);
  assert.equal(result.first.sourceName, "source.csv");
  assert.equal(result.first.sourceFormat, "csv");
  assert.deepEqual(result.first.metadata, {version: 2, sheets: [{name: "原始", rows: 0}]});
  assert.equal(result.first.ledger[0].message, "retained");
  assert.deepEqual(result.second, {
    bytes: [0x70, 0x72, 0x6f, 0x6a],
    sourceBytes: [0x73, 0x72, 0x63],
    metadata: {version: 2, sheets: [{name: "原始", rows: 3}]},
    ledger: [{category: "preserved_readable", code: "opaque-source", location: "A1", message: "retained", blocking: false}],
  });
}));

test("canonical and opaque names are create-only across both stores", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    await host.create("Shared", {revision: "canonical-rev", files: [{path: "manifest.json", bytes: new Uint8Array([1]).buffer}]});
    let failure = null;
    try {
      await host.createOpaque("Shared", {revision: "opaque-rev", bytes: new Uint8Array([2, 3]).buffer});
    } catch (error) {
      failure = {name: error?.name ?? null, message: String(error?.message ?? error)};
    }
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(window.localCopiesDbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const counts = await new Promise((resolve, reject) => {
      const tx = db.transaction(["copies", window.localOpaqueCopiesStore], "readonly");
      const canonical = tx.objectStore("copies").count();
      const opaque = tx.objectStore(window.localOpaqueCopiesStore).count();
      let values = [];
      canonical.onsuccess = () => { values[0] = canonical.result; if (values.length === 2) resolve(values); };
      opaque.onsuccess = () => { values[1] = opaque.result; if (values.length === 2) resolve(values); };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const canonical = await host.readAny("Shared");
    return {failure, counts, kind: canonical.kind, revision: canonical.revision};
  }));
  assert.equal(result.failure.name, "ConstraintError");
  assert.deepEqual(result.counts, [1, 0]);
  assert.deepEqual({kind: result.kind, revision: result.revision}, {kind: "canonical", revision: "canonical-rev"});
}));

test("private imported-source attachment is atomically stored beside, never inside, canonical entries", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    const source = new Uint8Array([0x61, 0x2c, 0x62, 0x0a]);
    await host.create("Imported", {
      revision: "rev-imported",
      files: [{path: "manifest.json", bytes: new Uint8Array([1]).buffer}],
    }, {
      name: "original.csv",
      format: "csv",
      bytes: source.buffer,
      metadata: {version: 1, sheets: []},
      ledger: [{category: "preserved_readable", code: "source", location: "A1", message: "source retained", blocking: false}],
    });
    source[0] = 0x78;
    const copy = await host.read("Imported");
    return {
      paths: copy.files.map((file) => file.path),
      bytes: Array.from(new Uint8Array(copy.importedSource.bytes)),
      metadata: copy.importedSource.metadata,
      ledger: copy.importedSource.ledger,
    };
  }));
  assert.deepEqual(result.paths, ["manifest.json"]);
  assert.deepEqual(result.bytes, [0x61, 0x2c, 0x62, 0x0a]);
  assert.deepEqual(result.metadata, {version: 1, sheets: []});
  assert.equal(result.ledger[0].code, "source");
}));

test("a real transaction abort leaves no copy behind", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = originalAdd.apply(this, args);
      const tx = this.transaction;
      queueMicrotask(() => {
        try {
          tx.abort();
        } catch {
          // Transaction already settled; nothing to abort.
        }
      });
      return request;
    };
    let failure = null;
    try {
      await host.create("Aborted", {
        revision: "rev-x",
        files: [{path: "manifest.json", bytes: new Uint8Array([5]).buffer}],
      });
    } catch (error) {
      failure = {name: error?.name ?? null, message: String(error?.message ?? error)};
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    return {failure, copy: await host.read("Aborted"), names: (await host.list()).map((e) => e.name)};
  }));
  assert.ok(result.failure, "aborted create must fail");
  assert.equal(result.copy, null);
  assert.deepEqual(result.names, []);
}));

test("an opaque transaction abort leaves neither opaque data nor attachment behind", async () => withBrowser(async (browser) => {
  const result = await withPage(browser, (page) => page.evaluate(async () => {
    const host = window.createLocalCopiesUnderTest();
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = originalAdd.apply(this, args);
      const tx = this.transaction;
      queueMicrotask(() => {
        try {
          tx.abort();
        } catch {
          // Transaction already settled.
        }
      });
      return request;
    };
    let failure = null;
    try {
      await host.createOpaque("Opaque aborted", {
        revision: "rev-opaque-aborted",
        bytes: new Uint8Array([8, 9]).buffer,
        importedSource: {
          name: "aborted.csv",
          format: "csv",
          bytes: new Uint8Array([10]).buffer,
          metadata: {version: 1, sheets: []},
          ledger: [],
        },
      });
    } catch (error) {
      failure = {name: error?.name ?? null};
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    return {failure, copy: await host.readAny("Opaque aborted"), names: (await host.list()).map((e) => e.name)};
  }));
  assert.ok(result.failure, "aborted opaque create must fail");
  assert.equal(result.copy, null);
  assert.deepEqual(result.names, []);
}));

test("close releases the connection and canonical and opaque copies survive a browser restart", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "tachiko-local-copies-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {...launchOptions, headless: true});
    const page = await openPage(context);
    const afterClose = await page.evaluate(async () => {
      const host = window.createLocalCopiesUnderTest();
      await host.create("Persisted", {
        revision: "rev-persist",
        files: [{path: "manifest.json", bytes: new Uint8Array([42, 43]).buffer}],
      });
      await host.createOpaque("Persisted opaque", {
        revision: "rev-opaque-persist",
        bytes: new Uint8Array([44, 45]).buffer,
        importedSource: {
          name: "persisted.csv",
          format: "csv",
          bytes: new Uint8Array([46, 47]).buffer,
          metadata: {version: 1, sheets: []},
          ledger: [],
        },
      });
      await host.close();
      // Same host object must reopen the connection for the next operation.
      const reopened = await host.readAny("Persisted");
      const reopenedOpaque = await host.readAny("Persisted opaque");
      return reopened && reopenedOpaque && {
        revision: reopened.revision,
        bytes: Array.from(new Uint8Array(reopened.files[0].bytes)),
        opaqueRevision: reopenedOpaque.revision,
        opaqueBytes: Array.from(new Uint8Array(reopenedOpaque.bytes)),
        opaqueSourceBytes: Array.from(new Uint8Array(reopenedOpaque.importedSource.bytes)),
      };
    });
    assert.deepEqual(afterClose, {revision: "rev-persist", bytes: [42, 43], opaqueRevision: "rev-opaque-persist", opaqueBytes: [44, 45], opaqueSourceBytes: [46, 47]});

    // Full browser-process restart against the same persistent profile.
    await context.close();
    context = undefined;
    context = await chromium.launchPersistentContext(userDataDir, {...launchOptions, headless: true});
    const restarted = await openPage(context, {reset: false});
    const afterRestart = await restarted.evaluate(async () => {
      const host = window.createLocalCopiesUnderTest();
      const copy = await host.readAny("Persisted");
      const opaque = await host.readAny("Persisted opaque");
      return copy && {
        revision: copy.revision,
        bytes: Array.from(new Uint8Array(copy.files[0].bytes)),
        opaqueRevision: opaque.revision,
        opaqueBytes: Array.from(new Uint8Array(opaque.bytes)),
        opaqueSourceBytes: Array.from(new Uint8Array(opaque.importedSource.bytes)),
        names: (await host.list()).map((entry) => entry.name).sort(),
      };
    });
    assert.deepEqual(afterRestart, {revision: "rev-persist", bytes: [42, 43], opaqueRevision: "rev-opaque-persist", opaqueBytes: [44, 45], opaqueSourceBytes: [46, 47], names: ["Persisted", "Persisted opaque"]});
  } finally {
    if (context) await context.close().catch(() => {});
    await rm(userDataDir, {recursive: true, force: true});
  }
});
