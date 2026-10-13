// #131 normal dirty Close/Save/reopen, cancellation, failed durable write,
// pending dismissal, suggested names and truthful unavailable export copy.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { openReleasePlanExample, waitForColdHome } from "./home-entry.mjs";

const dist = process.env.WORK_DIST;
if (!dist) {
  console.error("BLOCKED: WORK_DIST must name an acceptance build.");
  process.exit(78);
}
const expected = JSON.parse(await readFile(new URL("../fixtures/expected.json", import.meta.url), "utf8"));
const impactId = `cell:${expected.entity}:${expected.impact}`;
const priorityId = `cell:${expected.entity}:${expected.priority}`;
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-sheet-save-close-"));
let context;
const results = [];

async function edit(page, value) {
  await page.getByTestId(impactId).dblclick();
  const editor = page.getByRole("textbox", { name: "Edit cell", exact: true });
  await editor.fill(String(value));
  await editor.press("Enter");
  await page.getByTestId(impactId).filter({ hasText: String(value) }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false");
}

async function unsaved(page, value) {
  assert.equal(await page.getByTestId("project-ready").count(), 1, "work stays open");
  assert.equal((await page.getByTestId(impactId).textContent()).trim(), String(value), "edited value stays in the live work");
  assert.doesNotMatch(await page.getByTestId("save-status").textContent(), /Saved on this device/, "failed/cancelled Save never looks saved");
  assert.equal(await page.locator('[data-work-dirty="true"]').count(), 1, "work stays unsaved");
}

async function closeToSave(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await close.waitFor();
  assert.equal(await close.getByRole("button", { name: "Keep editing", exact: true }).count(), 1);
  assert.equal(await close.getByRole("button", { name: "Close without saving", exact: true }).count(), 1);
  await close.getByRole("button", { name: "Save a copy…", exact: true }).click();
  const save = page.getByRole("dialog", { name: "Save a copy", exact: true });
  await save.waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1, "Save replaces Close without nested modal traps");
  assert.match(await save.textContent(), /It does not update an existing one\./, "create-only remains explicit");
  return save;
}

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}),
  });
  await installDistRoutes(context, dist);
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(LOCAL_ORIGIN);
  await openReleasePlanExample(page);

  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const download = page.getByRole("region", { name: "Download spreadsheet", exact: true });
  for (const label of ["Prepare CSV", "Prepare XLSX"]) {
    const button = download.getByRole("button", { name: label, exact: true });
    assert.equal(await button.isDisabled(), true);
    const explanation = await button.getAttribute("aria-describedby");
    assert.ok(explanation, `${label} has an accessible explanation`);
    const reason = page.locator(`[id="${explanation}"]`);
    assert.equal(await reason.isVisible(), true, "explanation is visible beside the controls");
    assert.match(await reason.textContent(), /only for work opened from an imported spreadsheet/);
    assert.match(await reason.textContent(), /Examples cannot be downloaded in these formats yet/);
  }
  results.push("unavailable-export-visible-and-associated");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await edit(page, expected.editedImpact);

  let save = await closeToSave(page);
  let input = save.getByRole("textbox", { name: "Copy name", exact: true });
  const suggestion = await input.inputValue();
  const title = (await page.locator("h1.ts-title").textContent()).trim();
  assert.ok(suggestion.length > 0 && suggestion.startsWith(title), "prefill comes from the work name");
  await input.fill(`${suggestion} renamed`);
  assert.equal(await input.inputValue(), `${suggestion} renamed`, "suggestion is editable");
  await save.getByRole("button", { name: "Cancel", exact: true }).click();
  let close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await close.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Save a copy…");
  await unsaved(page, expected.editedImpact);
  await close.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction((id) => document.activeElement?.getAttribute("data-testid") === id, impactId);
  results.push("cancel-keeps-work-open-unsaved-and-restores-focus");

  // Inject an existing real-store failure, then retry the same suggested name.
  save = await closeToSave(page);
  input = save.getByRole("textbox", { name: "Copy name", exact: true });
  await page.evaluate(() => window.__tachikoAcceptance.failNextSave());
  await save.getByRole("button", { name: "Create copy", exact: true }).click();
  await save.getByRole("alert").waitFor();
  assert.equal(await input.inputValue(), suggestion, "failed Save retains the name");
  assert.equal(await input.evaluate((element) => document.activeElement === element), true, "failure leaves focus in Save");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await unsaved(page, expected.editedImpact);
  assert.equal(await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), suggestion), null, "failed transaction creates no copy");
  results.push("failed-save-retains-dialog-work-edits-and-unsaved-state");

  await page.evaluate(() => window.__tachikoAcceptance.deferNextCopyWrite());
  await save.getByRole("button", { name: "Create copy", exact: true }).click();
  await save.getByRole("button", { name: "Working…", exact: true }).waitFor();
  assert.equal(await save.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.locator(".ts-modal-backdrop").click({ position: { x: 1, y: 1 } });
  assert.equal(await save.count(), 1, "pending Save cannot be dismissed");
  await unsaved(page, expected.editedImpact);
  await page.evaluate(() => window.__tachikoAcceptance.releaseCopyWrite());
  await waitForColdHome(page);
  await page.getByRole("button", { name: `Open saved ${suggestion}`, exact: true }).waitFor();
  await page.reload();
  await waitForColdHome(page);
  await page.getByRole("button", { name: `Open saved ${suggestion}`, exact: true }).click();
  await page.getByTestId("project-ready").waitFor();
  assert.equal((await page.getByTestId(impactId).textContent()).trim(), String(expected.editedImpact));
  assert.equal((await page.getByTestId(priorityId).textContent()).trim(), String(expected.editedPriority), "reopened calculation includes the edit");
  results.push("confirmed-save-continues-close-and-fresh-reopen-preserves-edits");

  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  save = page.getByRole("dialog", { name: "Save a copy", exact: true });
  input = save.getByRole("textbox", { name: "Copy name", exact: true });
  const nextName = await input.inputValue();
  assert.ok(nextName.length > 0 && nextName !== suggestion, "next suggested name avoids the existing copy");
  assert.equal(await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), nextName), null);
  await save.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("dialog", { name: "Unsaved work", exact: true }).count(), 0, "toolbar Save Cancel has no Close continuation");
  assert.equal(await page.getByRole("button", { name: "Save a copy", exact: true }).evaluate((button) => document.activeElement === button), true);
  results.push("toolbar-prefill-avoids-existing-copy-and-cancel-has-no-close-intent");

  // A cancelled Close intent must not leak into a later ordinary Save.
  await edit(page, 4);
  save = await closeToSave(page);
  await page.keyboard.press("Escape");
  close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  await close.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  save = page.getByRole("dialog", { name: "Save a copy", exact: true });
  await save.getByRole("button", { name: "Create copy", exact: true }).click();
  await save.waitFor({ state: "detached" });
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  assert.equal(await page.getByTestId("project-ready").count(), 1, "later toolbar Save keeps work open");
  results.push("cancelled-close-intent-does-not-leak-into-toolbar-save");

  await page.getByTestId(impactId).dblclick();
  await page.getByRole("textbox", { name: "Edit cell", exact: true }).fill("6");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  const draftSave = close.getByRole("button", { name: "Save a copy…", exact: true });
  assert.equal(await draftSave.isDisabled(), true, "unapplied edits cannot be discarded by Save then Close");
  const draftReason = await draftSave.getAttribute("aria-describedby");
  assert.ok(draftReason);
  assert.equal(await page.locator(`[id="${draftReason}"]`).isVisible(), true);
  await close.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Edit cell", exact: true }).inputValue(), "6", "unfinished edit survives");
  results.push("unfinished-edits-kept-with-visible-save-guidance");

  console.log(JSON.stringify({ status: "PASS", lane: "save-close-local", results }));
} finally {
  if (context) await context.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
