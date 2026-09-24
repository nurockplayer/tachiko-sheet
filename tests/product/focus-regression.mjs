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
  await page.getByTestId("project-ready").waitFor();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page.getByTestId("open-project").waitFor();
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
    "product-focus-00 shared dialog geometry and profile-aware Save states follow references",
    async (page) => {
      await page.setViewportSize({ width: 1512, height: 982 });
      const saveTrigger = page.getByRole("button", { name: "Save a copy", exact: true });
      await saveTrigger.click();
      const save = page.getByRole("dialog", { name: "Save a copy", exact: true });
      const desktopSave = await save.boundingBox();
      assert.equal(Math.round(desktopSave.width), 600);
      assert.equal(Math.round(desktopSave.height), 360);
      assert.equal(Math.round(desktopSave.x), 456);
      assert.equal(Math.round(desktopSave.y), 311);
      const saveMaterial = await save.evaluate((element) => {
        const style = getComputedStyle(element);
        const title = getComputedStyle(element.querySelector("h2"));
        return { radius: style.borderRadius, border: style.borderColor, shadow: style.boxShadow, titleSize: title.fontSize, titleLine: title.lineHeight, titleWeight: title.fontWeight };
      });
      assert.deepEqual(saveMaterial, {
        radius: "12px",
        border: "rgb(223, 226, 234)",
        shadow: "rgba(37, 39, 53, 0.24) 0px 16px 48px -12px",
        titleSize: "20px",
        titleLine: "28px",
        titleWeight: "600",
      });
      assert.match(await save.locator(".ts-dialog-intro p").evaluate((paragraph) => paragraph.innerHTML), /profile\.<br>/);
      const desktopSaveActions = await save.locator(".ts-dialog-actions > button").evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
        }),
      );
      assert.equal(desktopSaveActions[0].x - Math.round(desktopSave.x), 25);
      assert.equal(desktopSaveActions[0].width, 88);
      assert.equal(desktopSaveActions[1].x + desktopSaveActions[1].width - Math.round(desktopSave.x), 577);
      assert.equal(desktopSaveActions[1].width, 144);
      assert.equal(desktopSaveActions[0].height, 32);
      await page.keyboard.press("Escape");
      assert.equal(await saveTrigger.evaluate((element) => element === document.activeElement), true);

      await editImpact(page, "3");
      await page.getByRole("button", { name: "Close project", exact: true }).click();
      const desktopClose = page.getByRole("dialog", { name: "Unsaved work", exact: true });
      const desktopClosePanel = await desktopClose.boundingBox();
      assert.equal(Math.round(desktopClosePanel.width), 600);
      assert.equal(Math.round(desktopClosePanel.height), 260);
      assert.equal(Math.round(desktopClosePanel.x), 456);
      assert.equal(Math.round(desktopClosePanel.y), 361);
      const closeMaterial = await desktopClose.evaluate((element) => {
        const style = getComputedStyle(element);
        return { radius: style.borderRadius, border: style.borderColor, shadow: style.boxShadow };
      });
      assert.equal(closeMaterial.radius, "12px");
      assert.equal(closeMaterial.border, "rgb(223, 226, 234)");
      assert.equal(closeMaterial.shadow, saveMaterial.shadow);
      const desktopCloseActions = await desktopClose.locator(".ts-dialog-actions > button").evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
        }),
      );
      assert.equal(desktopCloseActions[0].x - Math.round(desktopClosePanel.x), 25);
      assert.equal(desktopCloseActions[0].width, 128);
      assert.equal(desktopCloseActions[1].x + desktopCloseActions[1].width - Math.round(desktopClosePanel.x), 577);
      assert.equal(desktopCloseActions[1].width, 196);
      assert.equal(desktopCloseActions[0].height, 32);
      await desktopClose.getByRole("button", { name: "Keep editing", exact: true }).click();

      await page.setViewportSize({ width: 320, height: 640 });
      await saveTrigger.click();
      const compactSave = await save.boundingBox();
      assert.equal(Math.round(compactSave.x), 16);
      assert.equal(Math.round(compactSave.width), 288);
      const saveActions = await save.locator(".ts-dialog-actions > button").evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().top),
      );
      assert.ok(Math.abs(saveActions[0] - saveActions[1]) < 1, "Save actions remain side by side on phone");
      await save.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.setViewportSize({ width: 320, height: 350 });
      await saveTrigger.click();
      const shortSave = await save.boundingBox();
      assert.equal(Math.round(shortSave.x), 16);
      assert.ok(shortSave.height <= 302, `short Save fits the viewport's 302px modal area: ${JSON.stringify(shortSave)}`);
      assert.ok(shortSave.y >= 0 && shortSave.y + shortSave.height <= 350, `short Save frame remains in the viewport: ${JSON.stringify(shortSave)}`);
      await save.getByRole("textbox", { name: "Copy name", exact: true }).fill("short-viewport-copy");
      const shortSaveAction = save.getByRole("button", { name: "Create copy", exact: true });
      await shortSaveAction.focus();
      const reachedSaveAction = await shortSaveAction.boundingBox();
      const reachedSavePanel = await save.boundingBox();
      assert.ok(reachedSaveAction.y >= reachedSavePanel.y && reachedSaveAction.y + reachedSaveAction.height <= reachedSavePanel.y + reachedSavePanel.height, "short Save action is reachable inside its scrollable dialog");
      await save.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.setViewportSize({ width: 320, height: 640 });

      await page.locator(".ts-command-overflow > summary").click();
      await page.getByRole("button", { name: "Close project", exact: true }).click();
      const close = page.getByRole("dialog", { name: "Unsaved work", exact: true });
      const compactClose = await close.boundingBox();
      assert.equal(Math.round(compactClose.x), 16);
      assert.equal(Math.round(compactClose.width), 288);
      const closeActions = await close.locator(".ts-dialog-actions > button").evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().top),
      );
      assert.ok(closeActions[1] > closeActions[0], "Close choices stack on phone in approved order");
      await page.setViewportSize({ width: 320, height: 250 });
      const shortClose = await close.boundingBox();
      assert.ok(shortClose.height <= 202, `short Close fits the viewport's 202px modal area: ${JSON.stringify(shortClose)}`);
      assert.ok(shortClose.y >= 0 && shortClose.y + shortClose.height <= 250, `short Close frame remains in the viewport: ${JSON.stringify(shortClose)}`);
      const destructiveClose = close.getByRole("button", { name: "Close without saving", exact: true });
      await destructiveClose.focus();
      const reachedCloseAction = await destructiveClose.boundingBox();
      const reachedClosePanel = await close.boundingBox();
      assert.ok(reachedCloseAction.y >= reachedClosePanel.y && reachedCloseAction.y + reachedCloseAction.height <= reachedClosePanel.y + reachedClosePanel.height, "short Close action is reachable inside its scrollable dialog");
      await close.getByRole("button", { name: "Keep editing", exact: true }).click();

      await page.setViewportSize({ width: 1512, height: 982 });
      const pendingSaveTransitions = [];
      for (const profile of [
        { id: "tachiko", label: "Tachiko", chrome: "porcelain", border: "rgb(223, 226, 234)" },
        { id: "familiar-spreadsheet", label: "Familiar Spreadsheet", chrome: "structured", border: "rgb(204, 209, 216)" },
        { id: "minimal-focus", label: "Minimal-Focus", chrome: "quiet", border: "rgb(229, 229, 235)" },
      ]) {
        const appearance = page.getByRole("button", { name: "Appearance", exact: true });
        if (await appearance.getAttribute("aria-expanded") !== "true") await appearance.click();
        await page.locator(".ts-appearance-profile-option").filter({ hasText: profile.label }).click();
        await page.waitForFunction(({ chrome }) =>
          document.documentElement.getAttribute("data-ts-profile-chrome") === chrome,
        { chrome: profile.chrome });

        await saveTrigger.click();
        const profileSave = page.getByRole("dialog", { name: "Save a copy", exact: true });
        assert.equal(await page.getByRole("alert").count(), 0, `${profile.label} reopens Save without a stale parent failure alert`);
        assert.equal(
          await profileSave.evaluate((element) => getComputedStyle(element).borderColor),
          profile.border,
          `${profile.label} dialog border follows its resolved border.subtle role`,
        );
        const profileName = `issue97-${profile.id}-failure`;
        const nameInput = profileSave.getByRole("textbox", { name: "Copy name", exact: true });
        await nameInput.fill(profileName);
        const createButton = profileSave.getByRole("button", { name: "Create copy", exact: true });
        assert.equal(await createButton.getAttribute("aria-busy"), "false", `${profile.label} Save starts idle`);
        assert.equal(await createButton.isDisabled(), false, `${profile.label} idle Save is enabled for a valid name`);
        assert.equal(await profileSave.getByRole("alert").count(), 0, `${profile.label} idle Save has no error`);

        const beforeFailure = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
        const writesBeforeFailure = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
        await page.evaluate(() => window.__tachikoAcceptance.failNextSave());
        await profileSave.evaluate((dialog) => {
          const input = dialog.querySelector(".ts-text-input");
          const button = Array.from(dialog.querySelectorAll("button")).find((candidate) =>
            candidate.textContent.includes("Create copy") || candidate.textContent.includes("Working"),
          );
          const transitions = [];
          const capture = () => transitions.push({
            ariaBusy: button?.getAttribute("aria-busy"),
            inputDisabled: input?.disabled ?? false,
            focusInside: dialog.contains(document.activeElement),
            nameFocused: document.activeElement === input,
            workingLabel: button?.textContent.trim() === "Working…",
          });
          capture();
          const observer = new MutationObserver(capture);
          observer.observe(dialog, { attributes: true, childList: true, subtree: true, attributeFilter: ["aria-busy", "disabled"] });
          window.__issue97SavePendingProbe = { observer, transitions };
        });
        await createButton.click();
        const saveError = profileSave.getByRole("alert");
        await saveError.waitFor();
        assert.equal(await profileSave.getByRole("alert").count(), 1, `${profile.label} Save error remains inline and associated with the name`);
        assert.equal(await page.getByRole("alert").count(), 1, `${profile.label} failed Save exposes one accessible alert`);
        const transitions = await profileSave.evaluate(() => {
          const probe = window.__issue97SavePendingProbe;
          probe.observer.disconnect();
          delete window.__issue97SavePendingProbe;
          return probe.transitions;
        });
        pendingSaveTransitions.push({ profile: profile.label, transitions });
        assert.match(await saveError.textContent(), new RegExp(profileName));
        assert.equal(await nameInput.inputValue(), profileName, `${profile.label} keeps the failed destination available to correct`);
        assert.equal(await createButton.getAttribute("aria-busy"), "false", `${profile.label} Save returns from busy after the failed transaction`);
        assert.equal(await createButton.isDisabled(), false, `${profile.label} failed Save can be retried`);
        const afterFailure = await page.evaluate(() => window.__tachikoAcceptance.saveObservation());
        assert.equal(afterFailure.saved, false, `${profile.label} failure cannot claim the copy was saved`);
        assert.equal(afterFailure.dirty, beforeFailure.dirty, `${profile.label} failure preserves edit dirty state`);
        assert.equal(afterFailure.currentness, beforeFailure.currentness, `${profile.label} failure preserves fact currentness`);
        assert.deepEqual(
          await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), profileName),
          null,
          `${profile.label} failed transaction created no saved copy`,
        );
        const writesAfterFailure = await page.evaluate(() => window.__tachikoAcceptance.copyWriteDispatchCounts());
        assert.equal(writesAfterFailure.canonical, writesBeforeFailure.canonical + 1, `${profile.label} exercised one real canonical copy write`);
        await nameInput.fill(`${profileName}-corrected`);
        assert.equal(await profileSave.getByRole("alert").count(), 0, `${profile.label} correction clears only the inline Save failure`);
        assert.equal(await page.getByRole("alert").count(), 0, `${profile.label} correction does not reveal the stale parent Save failure behind the modal`);
        assert.equal(await nameInput.inputValue(), `${profileName}-corrected`);
        await profileSave.getByRole("button", { name: "Cancel", exact: true }).click();
        const restoredParentError = page.getByRole("alert");
        await restoredParentError.waitFor();
        assert.equal(await page.getByRole("alert").count(), 1, `${profile.label} closing Save restores the parent failure status`);
        assert.match(await restoredParentError.textContent(), /copy could not be saved/i);
        await saveTrigger.click();
        const reopenedSave = page.getByRole("dialog", { name: "Save a copy", exact: true });
        await reopenedSave.waitFor();
        assert.equal(await page.getByRole("alert").count(), 0, `${profile.label} reopening Save suppresses its stale parent failure for the modal lifetime`);
        await reopenedSave.getByRole("button", { name: "Cancel", exact: true }).click();
        assert.equal(await page.getByRole("alert").count(), 1, `${profile.label} closing reopened Save restores the parent failure status`);
      }
      for (const { profile, transitions } of pendingSaveTransitions) {
        assert.ok(transitions.some((transition) => transition.ariaBusy === "true"), `${profile} renders aria-busy while Create copy is pending: ${JSON.stringify(transitions)}`);
        assert.ok(transitions.some((transition) => transition.ariaBusy === "true" && !transition.inputDisabled), `${profile} keeps Copy name enabled while pending: ${JSON.stringify(transitions)}`);
        assert.ok(transitions.some((transition) => transition.ariaBusy === "true" && transition.focusInside && transition.nameFocused), `${profile} keeps keyboard focus in editable Copy name while pending: ${JSON.stringify(transitions)}`);
        assert.ok(transitions.some((transition) => transition.workingLabel), `${profile} renders the Working… label while pending: ${JSON.stringify(transitions)}`);
      }
    },
  ],
  [
    "product-focus-00 a published edit visibly distinguishes edited unsaved work",
    async (page) => {
      assert.equal(
        await page.getByTestId("work-state").textContent().then((text) => text.trim()),
        "Unchanged",
      );
      await editImpact(page, "3");
      await page.waitForFunction(
        () => document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true",
      );
      assert.equal(
        await page.getByTestId("work-state").textContent().then((text) => text.trim()),
        "Edited — not saved",
      );
    },
  ],
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
      await page.getByRole("heading", { name: "Refresh required", exact: true }).waitFor();
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
  [
    "product-focus-05 completed copy settles status while retaining notes draft",
    async (page) => {
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      const notes = page.getByRole("textbox", { name: "Decision notes", exact: true });
      const retainedDraft = "unapplied notes retained across copy creation";
      await notes.fill(retainedDraft);
      await page.waitForFunction(() => document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true");

      const saveTrigger = page.getByRole("button", { name: "Save a copy", exact: true });
      await saveTrigger.click();
      const dialog = page.getByRole("dialog", { name: "Save a copy", exact: true });
      const copyName = `retained-draft-${Date.now()}`;
      await dialog.getByRole("textbox", { name: "Copy name", exact: true }).fill(copyName);
      await dialog.getByRole("button", { name: "Create copy", exact: true }).click();
      await dialog.waitFor({ state: "detached" });

      const saveStatus = page.getByTestId("save-status");
      await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.textContent?.trim() === "Not saved yet");
      assert.equal(await saveStatus.textContent(), "Not saved yet", "completed copy with a retained draft does not claim saved or remain pending");
      assert.equal(await saveTrigger.isEnabled(), true, "completed copy re-enables Save a copy");
      assert.equal(await notes.inputValue(), retainedDraft, "the local notes draft remains available after copy creation");
      assert.ok(await page.evaluate((name) => window.__tachikoAcceptance.savedSnapshot(name), copyName), "the older committed work was durably copied");
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
