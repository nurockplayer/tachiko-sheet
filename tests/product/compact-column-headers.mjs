import assert from "node:assert/strict";
import path from "node:path";

const profiles = ["Tachiko", "Familiar Spreadsheet", "Minimal-Focus"];
const densities = ["Compact", "Comfortable"];
const widths = [320, 375, 390];
const toolbar = page => page.locator(".ts-column-toolbar");
const summary = page => toolbar(page).locator(":scope > summary");
const labels = page => page.locator(".ts-col-head").allTextContents();
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
async function choose(page, profile, density) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.locator(".ts-appearance-profile-option").filter({ hasText: profile }).click();
  await page.locator(".ts-appearance-density-option").filter({ hasText: density }).click();
  await page.keyboard.press("Escape");
}
async function focusedSummary(page) {
  await page.waitForFunction(() => document.querySelector(".ts-column-toolbar > summary") === document.activeElement);
  assert.equal(await toolbar(page).getAttribute("open"), null, "dialog returns to the closed Column summary");
}
async function cancel(page, title) {
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await focusedSummary(page);
}
async function openMenu(page, name) {
  await summary(page).click();
  const menu = toolbar(page).locator(".ts-command-menu");
  await menu.waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector(".ts-column-toolbar .ts-command-menu")?.style.left));
  assert.equal(await menu.getByRole("button", { name: `Rename “${name}”…`, exact: true }).count(), 1, "rename identifies the focused column");
  assert.equal(await menu.getByRole("button", { name: `Remove “${name}”…`, exact: true }).count(), 1, "remove identifies the focused column");
  const bounds = await menu.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight,
      buttons: [...node.querySelectorAll("button")].map(button => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height, receivesInput: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      }) };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height, `Column menu fits viewport: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.buttons.every(button => button.width >= 44 && button.height >= 44 && button.receivesInput), `all menu actions have reachable 44px targets: ${JSON.stringify(bounds)}`);
  return menu;
}
async function compactHeader(page, width, desktop, expected) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForFunction(() => Boolean(document.querySelector(".ts-column-toolbar")) && !document.querySelector(".ts-column-header summary"));
  assert.equal(await toolbar(page).count(), 1, "one Column disclosure outside the grid");
  assert.equal(await toolbar(page).evaluate(node => Boolean(node.closest(".ts-grid-scroll"))), false);
  const state = await page.locator(".ts-grid thead").evaluate(node => ({
    height: node.getBoundingClientRect().height,
    interactive: node.querySelectorAll('summary, button, input, select, a, [tabindex]:not([tabindex="-1"])').length,
    labels: [...node.querySelectorAll(".ts-col-head")].map(label => {
      const style = getComputedStyle(label);
      return { width: label.clientWidth, overflow: style.overflow, ellipsis: style.textOverflow, wrap: style.whiteSpace };
    }),
  }));
  assert.ok(state.height <= 36 && Math.abs(state.height - desktop) <= 2, `one-line compact header matches desktop: ${JSON.stringify(state)}`);
  assert.equal(state.interactive, 0, "compact headers have no interactive controls, including focusable labels");
  assert.ok(state.labels.every(label => label.width > 0 && label.overflow === "hidden" && label.ellipsis === "ellipsis" && label.wrap === "nowrap"));
  assert.deepEqual(await page.locator('.ts-grid th[scope="col"]').allTextContents(), ["Row", ...expected], "frozen header text remains unchanged");
  return state.height;
}

// Ordinary Sales entry, all responsive profiles/densities/colors. Cancel-only
// operations leave this fixture intact for the existing #212 semantic lane.
export async function assertCompactColumnHeaders(page, screens) {
  const observations = [];
  const picker = page.getByRole("combobox", { name: "Table", exact: true });
  for (const profile of profiles) for (const density of densities) {
    await choose(page, profile, density);
    for (const table of ["catalog", "sales"]) {
      await picker.selectOption({ label: table });
      const expected = table === "catalog" ? ["code", "category", "price"] : ["product_code", "quantity"];
      await page.waitForFunction(names => JSON.stringify([...document.querySelectorAll(".ts-col-head")].map(n => n.textContent)) === JSON.stringify(names), expected);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(".ts-column-header summary").first().waitFor();
      assert.equal(await toolbar(page).count(), 0, "desktop uses the existing per-header actions");
      const first = page.locator(".ts-column-header").first();
      await first.hover();
      assert.equal(await first.locator("summary").evaluate(n => getComputedStyle(n).opacity), "1", "desktop hover still reveals its disclosure");
      await first.locator(".ts-col-head").focus();
      await page.mouse.move(0, 0);
      assert.equal(await first.locator("summary").evaluate(n => getComputedStyle(n).opacity), "1", "desktop focus still reveals its disclosure");
      const desktop = await page.locator(".ts-grid thead").evaluate(n => n.getBoundingClientRect().height);
      if (profile === "Tachiko" && density === "Compact") {
        await page.screenshot({ path: path.join(screens, `${table}-1440x900.png`) });
        await first.locator("summary").click();
        await page.screenshot({ path: path.join(screens, `${table}-menu-1440x900.png`) });
        await page.keyboard.press("Escape");
      }
      for (const width of widths) for (const forcedColors of ["none", "active"]) {
        await page.emulateMedia({ forcedColors });
        const compact = await compactHeader(page, width, desktop, expected);
        if (table === "catalog") {
          const fit = await page.locator(".ts-grid-scroll").evaluate(n => ({ width: n.clientWidth, content: n.scrollWidth }));
          assert.ok(fit.content <= fit.width + 1, `fitted Sales stays inside ${width}px: ${JSON.stringify(fit)}`);
        }
        const index = Math.floor(expected.length / 2);
        await page.locator(".ts-grid tbody tr").first().locator(".ts-cell").nth(index).focus();
        const menu = await openMenu(page, expected[index]);
        if (profile === "Tachiko" && density === "Compact" && forcedColors === "none") {
          await page.screenshot({ path: path.join(screens, `${table}-menu-${width}x844.png`) });
        }
        await menu.getByRole("button", { name: `Rename “${expected[index]}”…`, exact: true }).click();
        assert.equal(await page.getByRole("dialog", { name: "Rename column", exact: true }).getByLabel("Column name", { exact: true }).inputValue(), expected[index]);
        await cancel(page, "Rename column");
        await (await openMenu(page, expected[index])).getByRole("button", { name: `Remove “${expected[index]}”…`, exact: true }).click();
        await cancel(page, "Remove column");
        await (await openMenu(page, expected[index])).getByRole("button", { name: "Add column…", exact: true }).click();
        await cancel(page, "Add column");
        await summary(page).press("Enter");
        await summary(page).press("Escape");
        await focusedSummary(page);
        assert.deepEqual(await labels(page), expected);
        if (profile === "Tachiko" && density === "Compact" && forcedColors === "none") await page.screenshot({ path: path.join(screens, `${table}-${width}x844.png`) });
        observations.push({ table, profile, density, width, forcedColors, desktop, compact });
      }
      await page.emulateMedia({ forcedColors: "none" });
    }
  }
  await choose(page, "Tachiko", "Compact");
  await picker.selectOption({ label: "catalog" });
  await page.waitForFunction(() => document.querySelectorAll(".ts-col-head").length === 3);
  return observations;
}

// Real New table / kit mutations, including a long first name and 20 columns
// at 320px. No fake projection or DOM columns supply the test's work.
export async function assertManyColumnHeaders(page, screens) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.locator('[data-testid="project-ready"]').count()) {
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved work", exact: true });
    if (await unsaved.count()) await unsaved.getByRole("button", { name: "Close without saving", exact: true }).click();
  }
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New table", exact: true });
  await dialog.getByLabel("Table name", { exact: true }).fill("Twenty columns");
  await dialog.getByLabel("Column 1 name", { exact: true }).fill("A long first column name that must wrap safely in the compact Column menu");
  for (let i = 1; i < 20; i++) await dialog.getByRole("button", { name: "Add column", exact: true }).click();
  await dialog.getByRole("button", { name: "Create table", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ts-column-header").length === 20);
  await ready(page);
  let expected = await labels(page);
  const observations = [];
  let sequence = 0;
  for (const profile of profiles) for (const density of densities) {
    await choose(page, profile, density);
    const desktop = await page.locator(".ts-grid thead").evaluate(n => n.getBoundingClientRect().height);
    for (const width of widths) for (const forcedColors of ["none", "active"]) {
      await page.emulateMedia({ forcedColors });
      const compact = await compactHeader(page, width, desktop, expected);
      // First-column fallback/context and a long name must not clip the menu.
      await page.locator(".ts-entry-row .ts-cell").first().focus();
      await openMenu(page, expected[0]);
      if (profile === "Tachiko" && density === "Compact" && forcedColors === "none") await page.screenshot({ path: path.join(screens, `many-menu-${width}x844.png`) });
      await page.keyboard.press("Escape");
      await focusedSummary(page);
      const middle = page.locator(".ts-entry-row .ts-cell").nth(9);
      const field = await middle.getAttribute("data-work-field");
      await middle.focus();
      await (await openMenu(page, expected[9])).getByRole("button", { name: `Rename “${expected[9]}”…`, exact: true }).click();
      let d = page.getByRole("dialog", { name: "Rename column", exact: true });
      const renamed = `Middle ${++sequence}`;
      await d.getByLabel("Column name", { exact: true }).fill(renamed);
      await d.getByRole("button", { name: "Rename column", exact: true }).click();
      await d.waitFor({ state: "detached" }); await ready(page); await focusedSummary(page);
      expected[9] = renamed;
      assert.deepEqual(await labels(page), expected, "only the focused middle column is renamed");
      assert.equal(await middle.getAttribute("data-work-field"), field, "rename preserves field identity");
      await page.locator(".ts-entry-row .ts-cell").last().focus();
      await (await openMenu(page, expected[19])).getByRole("button", { name: `Remove “${expected[19]}”…`, exact: true }).click();
      d = page.getByRole("dialog", { name: "Remove column", exact: true });
      await d.getByRole("button", { name: "Remove column", exact: true }).click();
      await d.waitFor({ state: "detached" }); await ready(page); await focusedSummary(page);
      expected = expected.slice(0, -1);
      assert.deepEqual(await labels(page), expected, "only the focused last column is removed");
      await summary(page).click();
      await toolbar(page).getByRole("button", { name: "Add column…", exact: true }).click();
      d = page.getByRole("dialog", { name: "Add column", exact: true });
      const added = `Added ${sequence}`;
      await d.getByLabel("Column name", { exact: true }).fill(added);
      await d.getByRole("button", { name: "Add column", exact: true }).click();
      await d.waitFor({ state: "detached" }); await ready(page); await focusedSummary(page);
      const afterAdd = await labels(page);
      assert.equal(afterAdd.filter(name => name === added).length, 1, "add reaches the real native table mutation");
      assert.deepEqual(afterAdd.filter(name => name !== added), expected, "add preserves every existing column and its relative order");
      expected = afterAdd;
      await compactHeader(page, width, desktop, expected);
      observations.push({ profile, density, width, forcedColors, desktop, compact, renamed, added });
    }
    await page.emulateMedia({ forcedColors: "none" });
  }
  const cell = page.locator(".ts-entry-row .ts-cell").first();
  await cell.evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "Draft");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector(".ts-column-toolbar > summary")?.getAttribute("aria-disabled") === "true");
  assert.equal(await summary(page).getAttribute("title"), "Finish the current input before changing columns.");
  const box = await summary(page).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await toolbar(page).getAttribute("open"), null, "unfinished row blocks the Column disclosure");
  await page.locator(".ts-entry-actions").getByRole("button", { name: "Discard", exact: true }).click();
  assert.equal(await summary(page).getAttribute("aria-disabled"), "false");
  return observations;
}
