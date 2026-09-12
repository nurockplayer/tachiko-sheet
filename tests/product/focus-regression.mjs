// Focused product regression for outcomes not covered by the six M1 journeys:
// dirty Close -> Keep editing restores the exact prior grid-cell focus, and a
// retained draft never leaves the save status claiming a saved state.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";

const url = process.env.WORK_CLIENT_URL ?? (process.env.WORK_DIST ? LOCAL_ORIGIN : undefined);
if (!url) {
  console.error("BLOCKED: WORK_CLIENT_URL (or WORK_DIST) is required for the product focus regression.");
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
const expected = JSON.parse(
  await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"),
);
const cell = (field) => `cell:${expected.entity}:${field}`;
const launchOptions = {
  headless: true,
  ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
  ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
};

async function open(page) {
  await page.goto(url);
  await page.getByTestId("open-project").setInputFiles(fixture);
  await page.getByTestId("project-ready").waitFor();
}

async function editImpact(page, value) {
  await page.getByTestId(cell(expected.impact)).dblclick();
  const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await input.fill(value);
  await input.press("Enter");
  await page.waitForFunction(
    ({ id, value }) =>
      Array.from(document.querySelectorAll("[data-testid]")).some(
        (element) => element.dataset.testid === id && element.textContent.trim() === String(value),
      ),
    { id: cell(expected.priority), value: 8 },
  );
}

const cases = [
  [
    "product-focus-01 dirty Close then Keep editing restores exact grid-cell focus",
    async (page) => {
      await editImpact(page, "3");
      const priorityCell = page.getByTestId(cell(expected.priority));
      await priorityCell.focus();
      assert.equal(await priorityCell.evaluate((element) => element === document.activeElement), true);
      await page.getByRole("button", { name: "Close project", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Unsaved work", exact: true });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
      await page.waitForFunction(
        (id) => {
          const element = document.querySelector(`[data-testid="${id}"]`);
          return element !== null && element === document.activeElement;
        },
        cell(expected.priority),
      );
      assert.equal(await priorityCell.textContent().then((text) => text.trim()), "8");
      assert.equal(
        await page.getByTestId(cell(expected.impact)).textContent().then((text) => text.trim()),
        "3",
      );
    },
  ],
  [
    "product-focus-02 a retained draft stops the saved status claim",
    async (page) => {
      await editImpact(page, "3");
      await page.getByRole("button", { name: "Save a copy", exact: true }).click();
      await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("draft-copy");
      await page.getByRole("button", { name: "Create copy", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="save-status"]')?.textContent?.trim() ===
          "Saved on this device",
      );
      assert.equal(
        await page.getByTestId("save-status").textContent().then((text) => text.trim()),
        "Saved on this device",
      );
      await page.getByTestId(cell(expected.impact)).dblclick();
      const input = page.getByRole("textbox", { name: "Edit cell", exact: true });
      await input.fill("4");
      await page.waitForFunction(
        () => document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true",
      );
      const savedChip = page.locator('[data-testid="save-status"]');
      if ((await savedChip.count()) > 0) {
        assert.notEqual(
          await savedChip.textContent().then((text) => text.trim()),
          "Saved on this device",
        );
      }
      const strip = await page.locator(".ts-status-strip").textContent();
      assert.ok(!strip.includes("Saved on this device"), "a retained draft still claimed a saved state");
      await input.press("Escape");
    },
  ],
  [
    "product-focus-03 notes drafts stay bound to their selected entity",
    async (page) => {
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      const notes = page.getByRole("textbox", { name: "Decision notes", exact: true });
      await notes.fill("draft-authored-for-row-A");
      await page.waitForFunction(
        () => document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true",
      );
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      const otherCell = page.locator(`[data-work-entity]:not([data-work-entity="${expected.entity}"])`).first();
      await otherCell.click();
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      assert.notEqual(await notes.inputValue(), "draft-authored-for-row-A");
      assert.equal(await page.getByRole("button", { name: "Apply notes", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Close project", exact: true }).click();
      await page.getByRole("dialog", { name: "Unsaved work", exact: true }).waitFor();
      await page.getByRole("dialog", { name: "Unsaved work", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
      await notes.fill("draft-authored-for-row-B");
      const bRevision = await otherCell.getAttribute("data-work-revision");
      await page.getByRole("button", { name: "Apply notes", exact: true }).click();
      await page.waitForFunction(
        ({ entity, revision }) => {
          const cell = document.querySelector(`[data-work-entity="${entity}"]`);
          return cell !== null && cell.getAttribute("data-work-revision") !== revision;
        },
        { entity: await otherCell.getAttribute("data-work-entity"), revision: bRevision },
      );
      assert.equal(await notes.inputValue(), "draft-authored-for-row-B");
      assert.equal(await page.getByRole("button", { name: "Apply notes", exact: true }).isDisabled(), true);
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      await page.getByTestId(`cell:${expected.entity}:${expected.notes}`).click();
      const aRevision = await page.getByTestId(`cell:${expected.entity}:${expected.notes}`).getAttribute("data-work-revision");
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      assert.equal(await notes.inputValue(), "draft-authored-for-row-A");
      assert.equal(await page.getByRole("button", { name: "Apply notes", exact: true }).isDisabled(), true);
      await notes.fill("rebased-A-notes");
      await page.getByRole("button", { name: "Apply notes", exact: true }).click();
      await page.waitForFunction(
        ({ entity, revision }) => document.querySelector(`[data-work-entity="${entity}"]`)?.getAttribute("data-work-revision") !== revision,
        { entity: expected.entity, revision: aRevision },
      );
      assert.equal(await notes.inputValue(), "rebased-A-notes");
    },
  ],
  [
    "product-focus-04 published B recovery preserves unpublished A draft",
    async (page) => {
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      const notes = page.getByRole("textbox", { name: "Decision notes", exact: true });
      await notes.fill("draft-authored-for-row-A");
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      const otherCell = page.locator(`[data-work-entity]:not([data-work-entity="${expected.entity}"])`).first();
      await otherCell.click();
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      await notes.fill("draft-authored-for-row-B");
      await page.evaluate(() => window.__tachikoAcceptance.failNextOpenProjection());
      await page.getByRole("button", { name: "Apply notes", exact: true }).click();
      await page.getByRole("heading", { name: "Recovery required; freshness unconfirmed", exact: true }).waitFor();
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByTestId("project-ready").waitFor();
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      await otherCell.click();
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      assert.equal(await notes.inputValue(), "draft-authored-for-row-B");
      await page.getByRole("tab", { name: "Table", exact: true }).click();
      await page.getByTestId(`cell:${expected.entity}:${expected.notes}`).click();
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      assert.equal(await notes.inputValue(), "draft-authored-for-row-A");
      assert.equal(await page.getByRole("button", { name: "Apply notes", exact: true }).isDisabled(), true);
    },
  ],
];

let failures = 0;
for (const [name, run] of cases) {
  // `--single-process` exits with its last context, so each case owns a browser.
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext();
    if (process.env.WORK_DIST) await installDistRoutes(context, process.env.WORK_DIST);
    const page = await context.newPage();
    try {
      await open(page);
      await run(page);
      console.log(JSON.stringify({ case: name, status: "PASS" }));
    } catch (error) {
      failures += 1;
      console.error(JSON.stringify({ case: name, status: "FAIL", message: String(error.stack ?? error) }));
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
if (failures) process.exit(1);
