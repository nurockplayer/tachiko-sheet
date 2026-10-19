// #213: Create table's current view precedes its deferred draft-focus handoff.
// Wait for that observable handoff; never retry an edit gesture.
import assert from "node:assert/strict";

export async function runCreateDraftReadinessCases({ page, projection, checks, closeWithoutSave }) {
  for (const humanDelay of [0, 250]) {
    await page.getByRole("button", { name: "New table", exact: true }).click();
    const form = page.getByRole("dialog", { name: "New table", exact: true });
    await form.getByLabel("Table name", { exact: true }).fill(`Draft readiness ${humanDelay}`);
    await form.getByLabel("Column 1 name", { exact: true }).fill("Item Name");
    await form.getByRole("button", { name: "Add column", exact: true }).click();
    await form.getByLabel("Column 2 name", { exact: true }).fill("項目");
    await page.evaluate(() => {
      const trace = [];
      const sample = () => {
        const first = document.querySelector('.ts-entry-row [data-entry-field]');
        if (!first) return;
        const state = { current: first.dataset.workCurrentness, readonly: first.getAttribute("aria-readonly"), focus: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName };
        if (JSON.stringify(trace.at(-1)) !== JSON.stringify(state)) trace.push(state);
      };
      const observer = new MutationObserver(sample);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      document.addEventListener("focusin", sample);
      window.__createDraftReadiness = { trace, stop: () => { observer.disconnect(); document.removeEventListener("focusin", sample); } };
    });
    await form.getByRole("button", { name: "Create table", exact: true }).click();
    // Do not focus the cell ourselves: its automatic focus is the signal that
    // SheetShell's post-Create requestAnimationFrame has actually completed.
    await page.waitForFunction(() => {
      const first = document.querySelector('.ts-entry-row [data-entry-field]');
      return !document.querySelector('[role="dialog"][aria-label="New table"]') &&
        document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false" &&
        first?.getAttribute("data-work-currentness") === "current" &&
        first?.getAttribute("aria-readonly") === "false" && document.activeElement === first;
    });
    const trace = await page.evaluate(() => { window.__createDraftReadiness.stop(); return window.__createDraftReadiness.trace; });
    console.log(JSON.stringify({ issue: 213, humanDelay, readinessTrace: trace }));
    const before = await projection(page);
    assert.equal(before.rows.length, 0);
    // The non-first column detects any late Create focus stealing the editor.
    const intended = page.locator('.ts-entry-row [data-entry-field]').nth(1);
    const identity = await intended.getAttribute("data-testid");
    const field = await intended.getAttribute("data-entry-field");
    assert.equal(field, before.columns[1].id);
    await intended.evaluate(node => { node.dataset.doubleClicks = "0"; node.addEventListener("dblclick", () => { node.dataset.doubleClicks = String(Number(node.dataset.doubleClicks) + 1); }); });
    if (humanDelay) await page.waitForTimeout(humanDelay); // explicit human-scale regression leg
    await intended.dblclick({ delay: 70 });
    const editor = page.getByTestId("cell-editor");
    await editor.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await editor.evaluate(node => ({ owner: node.closest("td")?.dataset.testid, focused: document.activeElement === node })), { owner: identity, focused: true });
    assert.equal(await intended.getAttribute("data-double-clicks"), "1", "exactly one realistic double-click opens the intended draft editor");
    await editor.fill("飲食");
    await intended.focus();
    await editor.waitFor({ state: "detached" });
    assert.equal(await intended.locator(".ts-cell-value").textContent(), "飲食");
    assert.deepEqual(await projection(page), before, "readiness/editing never publishes a draft");
    await page.locator('.ts-entry-actions').getByRole("button", { name: "Discard", exact: true }).click();
    await closeWithoutSave(page);
    checks.push(`213 Create → automatic editable/current draft focus → one double-click into exact second-column editor (${humanDelay}ms human delay); focus retained across frames`);
  }
}
