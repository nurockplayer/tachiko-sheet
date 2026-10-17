// Keyboard assertions shared by the real-operation #202 regressions.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function tabToDialogAction(page, dialog, action) {
  for (let step = 0; step < 24 && !await action.evaluate(node => node === document.activeElement); step += 1) {
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, "setup Tab stays inside the dialog");
  }
  assert.equal(await action.evaluate(node => node === document.activeElement), true, "submit reached through natural Tab traversal");
}

export async function assertPendingDialogFocus(page, dialog, label) {
  const inside = async message => assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, `${label}: ${message}`);
  await inside("immediate focus stays inside after keyboard activation disables submit");
  const targets = await dialog.locator("button").evaluateAll(nodes => nodes.every(node => node.disabled));
  assert.equal(targets, true, `${label}: pending actions remain disabled`);
  // Reverse immediately from the natural focus handoff, then cross both ends
  // repeatedly. A programmatically focusable but non-tabbable heading fails.
  await page.keyboard.press("Shift+Tab");
  await inside("immediate Shift+Tab stays inside");
  for (const direction of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press(direction);
      await inside(`${direction} stays inside through repeated wraparound (${step})`);
    }
  }
  // These real activation keys must reach only inert pending targets, never a
  // background control or a second operation. Callers assert operation counts.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await inside("activation remains inside");
  if (process.env.PENDING_FOCUS_OUT) {
    await mkdir(process.env.PENDING_FOCUS_OUT, { recursive: true });
    const viewport = page.viewportSize();
    for (const width of [1400, 800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: path.join(process.env.PENDING_FOCUS_OUT, `${label}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize(viewport);
  }
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 1, `${label}: pending Escape cannot dismiss`);
  for (const direction of ["Shift+Tab", "Tab"]) {
    await page.locator(".ts-modal-backdrop").click({ position: { x: 1, y: 1 } });
    assert.equal(await dialog.count(), 1, `${label}: pending backdrop cannot dismiss`);
    await inside(`fresh backdrop click preserves immediate focus before ${direction}`);
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press(direction);
      await inside(`after backdrop, ${direction} stays inside through wraparound (${step})`);
    }
  }
  for (const target of ["title", "description", "padding"]) {
    for (const direction of ["Shift+Tab", "Tab"]) {
      if (target === "padding") await dialog.click({ position: { x: 3, y: 3 } });
      else await dialog.locator(target === "title" ? ".ts-dialog-intro h2" : ".ts-dialog-intro p").first().click();
      await inside(`pending ${target} click retains immediate focus`);
      if (target !== "title") assert.equal(await dialog.evaluate(node => node === document.activeElement), true, `${label}: inert ${target} click focuses the dialog root`);
      await page.keyboard.press(direction);
      await inside(`fresh ${target} click then ${direction} stays inside`);
      if (target !== "title") {
        assert.equal(await dialog.evaluate((node, direction) => {
          const targets = Array.from(node.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex='-1'])"));
          return document.activeElement === (direction === "Tab" ? targets[0] : targets.at(-1));
        }, direction), true, `${label}: ${direction} from the root reaches the proper descendant edge`);
      }
    }
  }
  // Genuine pointer selection must remain possible; no child mousedown default
  // may be suppressed by the backdrop guard or root focus fallback.
  const title = dialog.locator(".ts-dialog-intro h2");
  const rect = await title.boundingBox();
  assert.ok(rect);
  await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + Math.min(rect.width - 2, 100), rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => (window.getSelection()?.toString().trim().length ?? 0) > 0), true, `${label}: actual pointer drag retains static text selection`);
  await inside("text selection retains focus inside");
  if (process.env.PENDING_FOCUS_OUT) {
    await dialog.click({ position: { x: 3, y: 3 } });
    const viewport = page.viewportSize();
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: path.join(process.env.PENDING_FOCUS_OUT, `${label}-root-focus-${width}.png`), fullPage: true });
    }
    await page.setViewportSize(viewport);
  }
}

// Install the established real-reply observer byte-for-byte in the .ro lane.
// Keep its single source in the New table harness; no product hook or fake reply.
export async function installRowObserver(context) {
  const source = await readFile(new URL("./new-table-rows-local.mjs", import.meta.url), "utf8");
  const start = "  await context.addInitScript(";
  const end = "\n  const page = context.pages()[0]";
  assert.equal(source.split(start).length, 2, "one established row observer");
  const block = source.slice(source.indexOf(start) + start.length, source.indexOf(end, source.indexOf(start))).trimEnd();
  assert.ok(block.endsWith(");"), "established observer boundary");
  await context.addInitScript({ content: `(${block.slice(0, -2)})();` });
}
