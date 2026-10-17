// Actual pointer/wheel reachability; never force or programmatically scroll.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function revealWithWheel(page, locator, lineIndex = null) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const state = await locator.evaluate((node, lineIndex) => {
      const range = document.createRange(); range.selectNodeContents(node);
      const r = lineIndex === null ? node.getBoundingClientRect() : Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)[lineIndex];
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      let scroll = node.parentElement;
      while (scroll && !(/auto|scroll/.test(getComputedStyle(scroll).overflowY) && scroll.scrollHeight > scroll.clientHeight)) scroll = scroll.parentElement;
      const s = scroll?.getBoundingClientRect();
      return { hit: !!hit && (node === hit || node.contains(hit)), x, y,
        scroll: s ? { x: s.x + s.width / 2, y: Math.max(1, Math.min(innerHeight - 1, s.y + s.height / 2)), delta: y - (Math.max(0, s.top) + Math.min(innerHeight, s.bottom)) / 2 } : null };
    }, lineIndex);
    if (state.hit) return state;
    if (!state.scroll) break;
    await page.mouse.move(state.scroll.x, state.scroll.y);
    await page.mouse.wheel(0, state.scroll.delta);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  assert.equal(await locator.evaluate((node, lineIndex) => {
    const range = document.createRange(); range.selectNodeContents(node);
    const r = lineIndex === null ? node.getBoundingClientRect() : Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)[lineIndex];
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && (hit === node || node.contains(hit));
  }, lineIndex), true, "review content/action center is reachable by ordinary scrolling and hits its intended element");
  return locator.evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
}

export async function clickReviewAction(page, dialog, name) {
  const action = dialog.getByRole("button", { name, exact: true });
  const point = await revealWithWheel(page, action);
  assert.ok(point, `${name}: normal scrolling produced a hit-visible action`);
  await page.mouse.click(point.x, point.y);
}

export async function assertReviewReachable(page, dialog, label, fullMatrix = false) {
  const sizes = Array.isArray(fullMatrix) ? fullMatrix : fullMatrix
    ? [[1400, 1000], [800, 1000], [600, 640], [600, 639], [599, 640], [599, 639], [390, 1000], [320, 640]]
    : [[390, 1000], [320, 640]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const frame = await dialog.evaluate(node => ({ frameHeight: node.getBoundingClientRect().height, overflow: getComputedStyle(node).overflowY }));
    assert.equal(frame.overflow, "auto", "review uses bounded ordinary outer scrolling");
    assert.equal(frame.frameHeight <= height - 48, true, "review frame stays within the available viewport");
    console.log(JSON.stringify({ reviewLayout: label, width, height, ...frame }));
    for (const target of await dialog.locator(".ts-dialog-intro h2, .ts-dialog-intro p, .ts-dialog-scroll li, .ts-dialog-scroll > p").all()) {
      const lines = await target.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).length; });
      assert.ok(lines > 0, "review copy has actual rendered text lines");
      for (let line = 0; line < lines; line += 1) await revealWithWheel(page, target, line);
    }
    await revealWithWheel(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
    await revealWithWheel(page, dialog.getByRole("button", { name: "Download", exact: true }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "review does not overflow the viewport horizontally");
    if (process.env.REVIEW_REACHABILITY_OUT) {
      await mkdir(process.env.REVIEW_REACHABILITY_OUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.REVIEW_REACHABILITY_OUT, `${label}-${width}x${height}.png`), fullPage: true });
    }
  }
}
