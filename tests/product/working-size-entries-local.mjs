// Real pinned Worker/WASM: New and Save a copy/reopen choose working size.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";

const dist = process.env.WORK_DIST;
if (!dist) { console.error("BLOCKED: WORK_DIST must name a built product."); process.exit(78); }
const work = await mkdtemp(path.join(tmpdir(), "sheet-working-size-"));
let context;
try {
  context = await chromium.launchPersistentContext(work, { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__workingSize = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          if (event.data.response) window.__workingSize.push(structuredClone(event.data.response));
        });
      }
    };
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(10000);
  const ready = () => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const dialog = name => page.getByRole("dialog", { name, exact: true });
  await page.goto(LOCAL_ORIGIN);
  await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const setup = dialog("New table");
  await setup.getByLabel("Table name", { exact: true }).fill("Working size");
  await setup.getByLabel("Column 1 name", { exact: true }).fill("Item");
  await setup.getByRole("button", { name: "Create table", exact: true }).click();
  await ready();

  async function editAndAssert(text) {
    await page.evaluate(() => { window.__workingSize = []; });
    await fillDraftCell(page, page.locator(".ts-entry-row").getByLabel("New row Item (Text)", { exact: true }), text);
    await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click();
    await ready();
    await page.waitForFunction(value => window.__workingSize.some(reply =>
      reply.type === "published" && reply.payload.changed?.some(field => field.stored?.value === value)), text);
    const receipt = await page.evaluate(() => window.__workingSize.find(reply => reply.type === "published")?.payload);
    assert.ok(receipt.changed.some(field => field.stored?.value === text), "the runtime publication carries working-size changed cells");
  }
  await editAndAssert("Before saving");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const save = dialog("Save a copy");
  await save.getByLabel("Copy name", { exact: true }).fill("Working size copy");
  await save.getByRole("button", { name: "Create copy", exact: true }).click();
  await save.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await waitForColdHome(page);
  await page.getByRole("button", { name: "Open saved Working size copy", exact: true }).click();
  await ready();
  await page.getByRole("gridcell").filter({ hasText: "Before saving" }).first().waitFor();
  await editAndAssert("After reopening");
  console.log("PASS: New and Save a copy/reopen edits carry working-size changed cells");
} finally {
  await context?.close();
  await rm(work, { recursive: true, force: true });
}
