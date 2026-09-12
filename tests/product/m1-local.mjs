// Local re-execution of the six M1 product outcomes against the real
// acceptance build (real kit/WASM/Worker/IndexedDB and the acceptance hooks),
// using the Steward oracles and the unchanged fixture/expected values.
//
// Transports differ from the canonical run: assets are fulfilled from disk
// instead of a listening socket, because this confined sandbox denies binding
// one. This is supporting evidence, NOT a substitute for the unchanged
// tests/browser.mjs acceptance.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { linked, rejected, saveFailed, reopened, unknown } from "../oracles.mjs";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const dist = process.env.WORK_DIST;
if (!dist) {
  console.error("BLOCKED: WORK_DIST must name the acceptance build for the local M1 run.");
  process.exit(78);
}
let chromium;
try {
  ({ chromium } = await import(process.env.WORK_PLAYWRIGHT_MODULE ?? "playwright-core"));
} catch {
  console.error("BLOCKED: the pinned Playwright dependency is unavailable.");
  process.exit(78);
}

const fixture = fileURLToPath(new URL("../fixtures/release-plan.roproj", import.meta.url));
const expected = JSON.parse(await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const cell = (field) => `cell:${expected.entity}:${field}`;
const launchOptions = {
  headless: true,
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
};

async function sourceHash() {
  const hash = createHash("sha256");
  async function scan(directory, prefix = "") {
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix + name;
      if (name === "entities") {
        await scan(path.join(directory, name), `${relative}/`);
        continue;
      }
      hash.update(relative);
      hash.update("\0");
      hash.update(await readFile(path.join(directory, name)));
    }
  }
  await scan(fixture);
  return hash.digest("hex");
}

async function shown(page, id, value) {
  await page.waitForFunction(
    ({ id, value }) =>
      Array.from(document.querySelectorAll("[data-testid]")).some(
        (element) => element.dataset.testid === id && element.textContent.trim() === String(value),
      ),
    { id, value },
  );
}

async function open(page) {
  await page.goto(LOCAL_ORIGIN);
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor();
}

const snapshot = (page) => page.evaluate(() => window.__tachikoAcceptance.observe());

async function rendered(page, view) {
  const id = (field) => (view === "table" ? cell(field) : `brief:${expected.entity}:${field}`);
  const impact = page.getByTestId(id(expected.impact));
  const priority = page.getByTestId(id(expected.priority));
  await impact.waitFor();
  await priority.waitFor();
  const attributes = ["data-work-occurrence", "data-work-revision", "data-work-entity", "data-work-currentness"];
  const facts = {};
  for (const attribute of attributes) {
    facts[attribute] = await impact.getAttribute(attribute);
    assert.equal(await priority.getAttribute(attribute), facts[attribute], `Mixed ${attribute} within one view`);
  }
  return {
    occurrence: facts[attributes[0]],
    revision: facts[attributes[1]],
    entity: facts[attributes[2]],
    currentness: facts[attributes[3]],
    impact: Number((await impact.textContent()).trim()),
    priority: Number((await priority.textContent()).trim()),
  };
}

async function edit(page, value) {
  await page.getByTestId(cell(expected.impact)).dblclick();
  const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await input.fill(value);
  await input.press("Enter");
}

async function notes(page) {
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Decision notes", exact: true });
  await input.fill(expected.editedNotes);
  await page.getByRole("button", { name: "Apply notes", exact: true }).click();
  await page.waitForFunction(
    (text) => window.__tachikoAcceptance.observe().then((state) => state.notes === text),
    expected.editedNotes,
  );
}

async function save(page, name) {
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
}

const cases = [
  [
    "M1-01 linked views and restart durability",
    async (env) => {
      let { page } = env;
      const initial = await snapshot(page);
      await edit(page, "3");
      await shown(page, cell(expected.priority), 8);
      await notes(page);
      const confirmed = await snapshot(page);
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      const sheet = await rendered(page, "table");
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      const brief = await rendered(page, "brief");
      linked({
        sheet,
        brief,
        occurrence: confirmed.occurrence,
        revision: confirmed.revision,
        baseRevision: initial.revision,
        entity: expected.entity,
        notes: confirmed.notes,
        sourceHashBefore: env.source,
        sourceHashAfter: await sourceHash(),
      });
      await save(page, "review-copy");
      await shown(page, "save-status", "Saved on this device");
      const saved = await page.evaluate(() => window.__tachikoAcceptance.savedHash("review-copy"));
      assert.equal(saved, confirmed.canonicalHash, "Durable copy bytes do not match the exported revision");
      await env.restart();
      page = env.page;
      await page.goto(LOCAL_ORIGIN);
      await page.getByRole("button", { name: "Open saved review-copy", exact: true }).click();
      await page.getByTestId("project-ready").waitFor();
      reopened({ before: confirmed, after: await snapshot(page), browserProcessRestarted: true, authoritativeRead: true });
    },
  ],
  [
    "M1-02 invalid edit is atomic and retains draft",
    async ({ page }) => {
      const before = await snapshot(page);
      await edit(page, "not a number");
      await page.getByRole("alert").waitFor();
      const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
      assert.equal(
        await page.getByRole("alert").textContent(),
        "The work did not accept this value. The draft was kept so you can correct it.",
      );
      rejected({ before, after: await snapshot(page), draftRetained: (await input.inputValue()) === "not a number" });
      await input.press("Escape");
      await shown(page, cell(expected.impact), 5);
    },
  ],
  [
    "M1-03 IME composition does not publish",
    async ({ page }) => {
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      const before = await snapshot(page);
      const input = page.getByRole("textbox", { name: "Decision notes", exact: true });
      await input.focus();
      await input.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        element.value = "試玩";
        element.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "試玩", isComposing: true }),
        );
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, isComposing: true }));
      });
      assert.deepEqual(await snapshot(page), before);
      assert.equal(await input.inputValue(), "試玩");
      await input.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "試玩" })));
    },
  ],
  [
    "M1-04 failed save keeps work and destination",
    async ({ page }) => {
      await edit(page, "3");
      await shown(page, cell(expected.priority), 8);
      const before = await snapshot(page);
      const destination = await page.evaluate(() => window.__tachikoAcceptance.savedHash("quota-copy"));
      await page.evaluate(() => window.__tachikoAcceptance.failNextSave());
      await save(page, "quota-copy");
      await page.getByRole("alert").waitFor();
      const after = await snapshot(page);
      const ui = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
      saveFailed({
        ...ui,
        semanticRevision: after.revision,
        publishedRevision: before.revision,
        destinationHashBefore: destination,
        destinationHashAfter: await page.evaluate(() => window.__tachikoAcceptance.savedHash("quota-copy")),
      });
      assert.equal(after.canonicalHash, before.canonicalHash);
    },
  ],
  [
    "M1-05 lost Execute reply is unknown, not retried",
    async ({ page }) => {
      const start = await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount());
      await page.evaluate(() => window.__tachikoAcceptance.loseNextExecuteReply());
      await edit(page, "3");
      await shown(page, "operation-outcome", "Outcome unknown");
      await page.evaluate(() => window.__tachikoAcceptance.settleFaultWindow());
      const observation = await page.evaluate(() => window.__tachikoAcceptance.unknownObservation());
      unknown({
        ...observation,
        executeRequests: (await page.evaluate(() => window.__tachikoAcceptance.executeRequestCount())) - start,
      });
    },
  ],
  [
    "M1-06 keyboard cancel and safe close",
    async ({ page }) => {
      const before = await snapshot(page);
      await page.getByTestId(cell(expected.impact)).focus();
      await page.keyboard.press("Enter");
      const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
      await input.fill("7");
      await input.press("Escape");
      assert.deepEqual(await snapshot(page), before);
      assert.equal(await page.getByTestId(cell(expected.impact)).evaluate((element) => element === document.activeElement), true);
      await edit(page, "3");
      await shown(page, cell(expected.priority), 8);
      await page.getByRole("button", { name: "Close project", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
      await shown(page, cell(expected.impact), 3);
    },
  ],
];

let failures = 0;
for (const [name, run] of cases) {
  const profile = await mkdtemp(path.join(tmpdir(), "tachiko-sheet-m1-local-"));
  let context;
  try {
    const env = {
      source: await sourceHash(),
      page: null,
      restart: async () => {
        if (context) await context.close();
        context = await chromium.launchPersistentContext(profile, launchOptions);
        await installDistRoutes(context, dist);
        env.page = context.pages()[0] ?? (await context.newPage());
      },
    };
    await env.restart();
    await open(env.page);
    const wired = await env.page.evaluate(() => Boolean(window.__tachikoAcceptance?.observe));
    if (!wired) throw new Error("UNQUALIFIED HARNESS: the acceptance driver is missing; not behavioral RED.");
    await run(env);
    assert.equal(await sourceHash(), env.source, "Opening/editing changed the source fixture");
    console.log(JSON.stringify({ case: name, status: "PASS" }));
  } catch (error) {
    failures += 1;
    console.error(JSON.stringify({ case: name, status: "FAIL", message: String(error.stack ?? error) }));
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}
if (failures) process.exit(1);
