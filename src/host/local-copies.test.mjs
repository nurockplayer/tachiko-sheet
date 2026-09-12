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
  assert.deepEqual(result.listed, [{name: "Sample A", savedAt: result.receipt.savedAt}]);
  assert.equal(result.revision, "core-rev-7");
  assert.deepEqual(result.paths, ["manifest.json", "entities/0.jsonl"]);
  assert.deepEqual(result.first, [1, 2, 3, 4]);
  assert.deepEqual(result.second, [9, 8, 7]);
  assert.equal(result.missing, null);
  const writes = result.transactions.filter((tx) => tx.mode === "readwrite");
  assert.deepEqual(writes, [{store: "copies", mode: "readwrite", options: {durability: "strict"}}]);
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

test("close releases the connection and copies survive a browser restart", async () => {
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
      await host.close();
      // Same host object must reopen the connection for the next operation.
      const reopened = await host.read("Persisted");
      return reopened && {revision: reopened.revision, bytes: Array.from(new Uint8Array(reopened.files[0].bytes))};
    });
    assert.deepEqual(afterClose, {revision: "rev-persist", bytes: [42, 43]});

    // Full browser-process restart against the same persistent profile.
    await context.close();
    context = undefined;
    context = await chromium.launchPersistentContext(userDataDir, {...launchOptions, headless: true});
    const restarted = await openPage(context, {reset: false});
    const afterRestart = await restarted.evaluate(async () => {
      const host = window.createLocalCopiesUnderTest();
      const copy = await host.read("Persisted");
      return copy && {
        revision: copy.revision,
        bytes: Array.from(new Uint8Array(copy.files[0].bytes)),
        names: (await host.list()).map((entry) => entry.name),
      };
    });
    assert.deepEqual(afterRestart, {revision: "rev-persist", bytes: [42, 43], names: ["Persisted"]});
  } finally {
    if (context) await context.close().catch(() => {});
    await rm(userDataDir, {recursive: true, force: true});
  }
});
