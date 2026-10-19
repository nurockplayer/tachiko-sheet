import assert from "node:assert/strict";
import path from "node:path";

async function touchTarget(control, label) {
  await control.scrollIntoViewIfNeeded();
  const hit = await control.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const header = node.closest("th").getBoundingClientRect();
    const style = getComputedStyle(node);
    const pseudo = getComputedStyle(node, "::after");
    const transform = new DOMMatrixReadOnly(pseudo.transform === "none" ? undefined : pseudo.transform);
    const width = parseFloat(pseudo.width);
    const height = parseFloat(pseudo.height);
    // Absolute pseudo-elements use the control's padding box, then transform.
    const pseudoLeft = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(pseudo.left) + transform.e;
    const pseudoTop = rect.top + parseFloat(style.borderTopWidth) + parseFloat(pseudo.top) + transform.f;
    const target = {
      left: Math.min(rect.left, pseudoLeft), top: Math.min(rect.top, pseudoTop),
      right: Math.max(rect.right, pseudoLeft + width), bottom: Math.max(rect.bottom, pseudoTop + height),
    };
    const points = [[target.left + 1, target.top + 1], [target.left + 2, (target.top + target.bottom) / 2], [target.right - 1, target.bottom - 1]];
    const hits = points.map(([x, y]) => ({ x, y, target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 200), reachable: node.contains(document.elementFromPoint(x, y)) }));
    const below = document.elementFromPoint(rect.right - 2, header.bottom + 2);
    return {
      width: target.right - target.left, height: target.bottom - target.top,
      target, header: header.toJSON(), hits, reachable: hits.every(hit => hit.reachable),
      contained: target.left >= header.left && target.right <= header.right && target.top >= header.top && target.bottom <= header.bottom,
      bodyBelow: Boolean(below && !node.contains(below) && below.closest("tbody, tfoot")),
    };
  });
  assert.ok(hit.width >= 44 && hit.height >= 28 && hit.reachable, `${label}: reachable >=44x28px target: ${JSON.stringify(hit)}`);
  assert.ok(hit.contained && hit.bodyBelow, `${label}: target stays inside its own header and leaves the first row tappable: ${JSON.stringify(hit)}`);
  return hit;
}

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

// A native many-column table must reach the real Work New table path. No DOM
// columns or semantic replies are injected to manufacture this geometry.
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
  for (let i = 1; i < 20; i++) await dialog.getByRole("button", { name: "Add column", exact: true }).click();
  await dialog.getByRole("button", { name: "Create table", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ts-column-header").length === 20);
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const headers = page.locator(".ts-column-header");
  const text = await page.locator('.ts-grid th[scope="col"]').allTextContents();
  const observations = [];
  for (const profile of ["Tachiko", "Familiar Spreadsheet", "Minimal-Focus"]) {
    for (const density of ["Compact", "Comfortable"]) {
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await page.locator(".ts-appearance-profile-option").filter({ hasText: profile }).click();
      await page.locator(".ts-appearance-density-option").filter({ hasText: density }).click();
      await page.keyboard.press("Escape");
      const desktop = await page.locator(".ts-grid thead").evaluate(node => node.getBoundingClientRect().height);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const forcedColors of ["none", "active"]) {
        await page.emulateMedia({ forcedColors });
        const label = `${profile}/${density}/${forcedColors}/20 columns`;
        const compact = await page.locator(".ts-grid thead").evaluate(node => node.getBoundingClientRect().height);
        assert.ok(compact <= 36 && Math.abs(compact - desktop) <= 2, `${label}: header stays one line`);
        assert.deepEqual(await page.locator('.ts-grid th[scope="col"]').allTextContents(), text);
        const controls = [];
        for (let index = 0; index < 20; index++) {
          const header = headers.nth(index);
          // Centre each header in the existing scroll viewport, clear of the
          // sticky row-number gutter, before probing both adjacent boundaries.
          await header.evaluate(node => node.scrollIntoView({ block: "nearest", inline: "center" }));
          for (const control of await header.locator("summary, .ts-column-add").all()) controls.push(await touchTarget(control, `${label}/${index}`));
          const edges = await header.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return [rect.left + 1, rect.right - 1].map(x => {
              const hit = document.elementFromPoint(x, rect.top + rect.height / 2);
              return { x, ownHeader: hit?.closest("th") === node, hit: hit?.outerHTML.slice(0, 150) };
            });
          });
          assert.ok(edges.every(edge => edge.ownHeader), `${label}/${index}: header edges never hit another column: ${JSON.stringify(edges)}`);
          if ([0, 10, 19].includes(index)) {
            const action = header.locator("summary");
            await action.click();
            const menu = header.locator(".ts-command-menu");
            const visible = await menu.evaluate(node => {
              const rect = node.getBoundingClientRect();
              const scroll = node.closest(".ts-grid-scroll").getBoundingClientRect();
              return rect.left >= Math.max(0, scroll.left) && rect.right <= Math.min(innerWidth, scroll.right) && rect.top >= scroll.top && rect.bottom <= Math.min(innerHeight, scroll.bottom) && [...node.querySelectorAll("button")].every(button => {
                const box = button.getBoundingClientRect();
                return box.width >= 44 && box.height >= 44 && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
              });
            });
            assert.ok(visible, `${label}/${index}: first/middle/last menus fit and their actions receive input`);
            if (profile === "Tachiko" && density === "Compact" && forcedColors === "none") await page.screenshot({ path: path.join(screens, `many-columns-menu-${index}-390x844.png`) });
            await menu.getByRole("button", { name: "Rename…", exact: true }).click();
            await page.getByRole("dialog", { name: "Rename column", exact: true }).waitFor();
            await page.keyboard.press("Escape");
          }
        }
        observations.push({ profile, density, forcedColors, desktop, compact, controls });
      }
      await page.emulateMedia({ forcedColors: "none" });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  return observations;
}
