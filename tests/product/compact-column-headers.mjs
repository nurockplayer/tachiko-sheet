import assert from "node:assert/strict";
import path from "node:path";

// #218: measure real headers, including the final + column control, rather
// than mirroring the CSS layout. Exercise both the fitted catalog and sales'
// horizontally scrolling grid through the normal Appearance/table controls.
export async function assertCompactColumnHeaders(page, screens) {
  const observations = [];
  const profiles = ["Tachiko", "Familiar Spreadsheet", "Minimal-Focus"];
  const densities = ["Compact", "Comfortable"];
  const tablePicker = page.getByRole("combobox", { name: "Table", exact: true });
  const headers = page.locator('.ts-grid th[scope="col"]');
  const height = () => page.locator(".ts-grid thead").evaluate(node => node.getBoundingClientRect().height);
  async function selectTable(table) {
    await tablePicker.selectOption({ label: table });
    await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll(".ts-col-head")].map(node => node.textContent)) === JSON.stringify(expected),
      table === "catalog" ? ["code", "category", "price"] : ["product_code", "quantity"]);
  }
  async function choose(profile, density) {
    const trigger = page.getByRole("button", { name: "Appearance", exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    await page.locator(".ts-appearance-profile-option").filter({ hasText: profile }).click();
    await page.locator(".ts-appearance-density-option").filter({ hasText: density }).click();
    await page.keyboard.press("Escape");
  }
  async function touchTarget(control, label) {
    await control.scrollIntoViewIfNeeded();
    const hit = await control.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const header = node.closest("th")?.getBoundingClientRect();
      const pseudo = getComputedStyle(node, "::after");
      const width = Math.max(rect.width, parseFloat(pseudo.minWidth), parseFloat(pseudo.width));
      const height = Math.max(rect.height, parseFloat(pseudo.height));
      const top = rect.top + rect.height / 2 - height / 2;
      const left = rect.right - width;
      const points = [[left + 1, top + 1], [left + 2, top + height / 2], [rect.right - 1, top + height - 1]];
      const hits = points.map(([x, y]) => ({ x, y, target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 200), reachable: node.contains(document.elementFromPoint(x, y)) }));
      // A tap just below the header must reach the first data row, not this control.
      const below = header ? document.elementFromPoint(rect.right - 2, header.bottom + 2) : null;
      return {
        width, height, reachable: hits.every(hit => hit.reachable), hits,
        contained: Boolean(header) && top >= header.top - 0.5 && top + height <= header.bottom + 0.5,
        bodyBelow: Boolean(below && !node.contains(below) && below.closest("tbody, tfoot")),
        styles: (() => {
          const label = node.closest("th")?.querySelector(".ts-col-head");
          const ls = label ? getComputedStyle(label) : null;
          return { label: ls && { position: ls.position, zIndex: ls.zIndex, transform: ls.transform, opacity: ls.opacity }, pseudo: { position: pseudo.position, zIndex: pseudo.zIndex, left: pseudo.left, right: pseudo.right, width: pseudo.width } };
        })(),
      };
    });
    assert.ok(hit.width >= 44 && hit.height >= 24 && hit.reachable, `${label} has a reachable touch area at least 44px wide and 24px tall: ${JSON.stringify(hit)}`);
    assert.ok(hit.contained && hit.bodyBelow, `${label} touch area stays inside the header; the first row stays tappable: ${JSON.stringify(hit)}`);
    return hit;
  }
  for (const profile of profiles) {
    for (const density of densities) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await choose(profile, density);
      for (const table of ["catalog", "sales"]) {
        await selectTable(table);
        const text = await headers.allTextContents();
        for (const forcedColors of ["none", "active"]) {
          await page.emulateMedia({ forcedColors });
          await page.setViewportSize({ width: 1440, height: 900 });
          const desktop = await height();
          const capture = profile === "Tachiko" && density === "Compact" && forcedColors === "none";
          if (capture) await page.screenshot({ path: path.join(screens, `after-${table}-1440x900.png`) });
          await page.setViewportSize({ width: 390, height: 844 });
          const compact = await height();
          const label = `${profile}/${density}/${table}/${forcedColors}`;
          assert.ok(Math.abs(compact - desktop) <= 2, `${label}: compact ${compact}px must stay within 2px of desktop ${desktop}px`);
          assert.ok(compact <= 36, `${label}: header stays one line, at most 36px`);
          assert.deepEqual(await headers.allTextContents(), text, `${label}: frozen header text is unchanged`);
          const labels = await page.locator(".ts-col-head").evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node);
            return { text: node.textContent, width: node.clientWidth, overflow: style.overflow, ellipsis: style.textOverflow, wrap: style.whiteSpace };
          }));
          assert.ok(labels.every(item => item.width > 0 && item.overflow === "hidden" && item.ellipsis === "ellipsis" && item.wrap === "nowrap"), `${label}: labels remain visible and truncate on one line: ${JSON.stringify(labels)}`);
          const add = page.getByRole("button", { name: "+ column", exact: true });
          await touchTarget(add, `${label}/add`);
          const addRect = await add.boundingBox();
          // Click the widened part beside the visual, still inside the header.
          await page.mouse.click(addRect.x + addRect.width - 42, addRect.y + addRect.height / 2);
          await page.getByRole("dialog", { name: "Add column", exact: true }).waitFor();
          await page.keyboard.press("Escape");
          const actions = page.locator(".ts-column-overflow > summary");
          for (const [index, action] of (await actions.all()).entries()) {
            await touchTarget(action, `${label}/disclosure`);
            // Click the widened part beside the visual, using ordinary input.
            const rect = await action.boundingBox();
            await page.mouse.click(rect.x + rect.width - 42, rect.y + rect.height / 2);
            const disclosure = action.locator("..");
            assert.equal(await disclosure.getAttribute("open"), "", `${label}: extended target opens disclosure`);
            const menu = disclosure.locator(".ts-command-menu");
            const bounds = await menu.evaluate(node => {
              const rect = node.getBoundingClientRect();
              const scroll = node.closest(".ts-grid-scroll").getBoundingClientRect();
              return { menu: rect.toJSON(), scroll: scroll.toJSON(), visible: rect.left >= Math.max(0, scroll.left) && rect.right <= Math.min(innerWidth, scroll.right) && rect.top >= scroll.top && rect.bottom <= Math.min(innerHeight, scroll.bottom) };
            });
            assert.ok(bounds.visible, `${label}: open menu fits the viewport and grid scroller: ${JSON.stringify(bounds)}`);
            for (const button of await menu.locator("button").all()) {
              const box = await button.boundingBox();
              assert.ok(box.width >= 44 && box.height >= 44, `${label}: menu action retains 44px touch area`);
            }
            if (capture && index === 0) await page.screenshot({ path: path.join(screens, `after-${table}-menu-390x844.png`) });
            await menu.getByRole("button", { name: "Rename…", exact: true }).click();
            await page.getByRole("dialog", { name: "Rename column", exact: true }).waitFor();
            await page.keyboard.press("Escape");
          }
          await page.locator(".ts-grid-scroll").evaluate(node => { node.scrollLeft = 0; });
          if (capture) await page.screenshot({ path: path.join(screens, `after-${table}-390x844.png`) });
          observations.push({ profile, density, table, forcedColors, desktop, compact });
        }
      }
    }
  }
  await page.emulateMedia({ forcedColors: "none" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await choose("Tachiko", "Compact");
  await selectTable("catalog");
  return observations;
}
