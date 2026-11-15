// One real-host journey shared by the three packaged-app drivers. No kit calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function formulaPersistence({ evaluate, downloads, coldOpen, quit }) {
  const platform = process.platform;
  const pass = (group) => console.log(`PASS: ${platform} ${group}`);
  const template = fileURLToPath(new URL("../../public/templates/invoice.ro", import.meta.url));
  const bytes = (await readFile(template)).toString("base64");
  await evaluate(`
    const input = await waitFor(() => document.querySelector('[data-testid="open-work-file"]'), "work file input");
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))], "invoice.ro"));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => current() && cellAt(0, 3), "Invoice ready");
    return true;
  `);
  const edit = async (column, source) => evaluate(`
    click(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(t => nameOf(t) === "Table"), "Table tab"));
    dblclick(await waitFor(() => cellAt(0, ${column}), "dependency cell"));
    const input = await waitFor(() => textbox("Edit cell"), "cell editor");
    fill(input, ${JSON.stringify(source)});
    press(input, "Enter");
    await waitFor(() => !textbox("Edit cell") && current(), "published formula edit");
    return true;
  `);
  // Reuse Invoice's plain values, names and formulas; extend its first row
  // with a chain Qty -> Unit price -> Amount, all via the ordinary editor.
  await edit(2, "=[.{Qty}]*2");
  await edit(3, "=[.{Unit price}]+1");
  const snapshot = () => evaluate(`
    click(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(t => nameOf(t) === "Table"), "Table tab"));
    await waitFor(() => current() && cellAt(4, 3), "all Invoice rows");
    const names = [...document.querySelectorAll("#ts-active-table option")].map(el => el.textContent);
    const columns = [...grid().querySelectorAll(".ts-col-head")].map(el => el.textContent);
    const values = [...grid().querySelectorAll("tbody tr.ts-row")].map(row => [...row.querySelectorAll("td")].map(el => el.textContent.trim()));
    const formulas = [];
    for (const [row, column] of [[0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3]]) {
      dblclick(cellAt(row, column));
      const editor = await waitFor(() => textbox("Edit cell"), "formula source editor");
      formulas.push(editor.value);
      press(editor, "Escape");
      await waitFor(() => !textbox("Edit cell") && current(), "source inspection closed");
    }
    return { names, columns, values, formulas };
  `);
  const expectedValues = (edited) => [
    ["Paper", edited ? "12" : "10", edited ? "$24.00" : "$20.00", edited ? "$25.00" : "$21.00"],
    ["Toner", "2", "$48.00", "$96.00"], ["Pens", "30", "$0.80", "$24.00"],
    ["Stapler", "1", "$12.90", "$12.90"], ["Folders", "25", "$1.20", "$30.00"],
  ];
  const initial = await snapshot();
  assert.deepEqual(initial.names, ["Invoice"]);
  assert.deepEqual(initial.columns, ["Item", "Qty", "Unit price", "Amount"]);
  assert.deepEqual(initial.values, expectedValues(false));
  assert.match(initial.formulas[0], /\*\s*2/);
  assert.match(initial.formulas[1], /\+\s*1/);
  for (const source of initial.formulas.slice(2)) assert.match(source, /\*/);
  pass("formula fixture: names, columns, plain values and chained results");

  const download = async (format) => {
    // The real host uses create-new-file semantics. Only remove this journey's
    // previous export; the second save must use the identical external path.
    for (const name of await readdir(downloads)) {
      if (name.endsWith(`.${format}`)) await rm(path.join(downloads, name));
    }
    await evaluate(`
      click(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(t => nameOf(t) === "Import & export"), "export tab"));
      click(await waitFor(() => button(${JSON.stringify(format === "ro" ? "Download work file (.ro)" : "Prepare XLSX")}), "export ready"));
      const consent = await waitFor(() => dialog("Confirm download"), "download consent");
      click(await waitFor(() => button("Download", consent), "Download"));
      await waitFor(() => !dialog("Confirm download"), "consent closed");
      return true;
    `);
    for (let attempt = 0; attempt < 600; attempt++) {
      const names = await readdir(downloads);
      const name = names.find(name => name.endsWith(`.${format}`) && !name.startsWith("."));
      if (name && !names.some(name => name.startsWith("."))) return path.join(downloads, name);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${platform}: host did not finish ${format} export in ${downloads}`);
  };
  const saveAndQuit = async () => {
    const file = await download("ro");
    // Export keeps the current project dirty; the bytes above are the saved
    // external artifact. Leave that project, then fully quit the process.
    await evaluate(`
      click(await waitFor(() => button("Close project"), "Close project"));
      await waitFor(() => dialog("Unsaved work") || document.querySelector('.ts-app[data-view="home"]'), "close outcome");
      const unsaved = dialog("Unsaved work");
      if (unsaved) click(button("Close without saving", unsaved));
      await waitFor(() => document.querySelector('.ts-app[data-view="home"]'), "Home");
      return true;
    `);
    await quit();
    return file;
  };
  const external = await saveAndQuit();
  await coldOpen(external);
  assert.deepEqual(await snapshot(), initial, "first cold external reopen: exact names, columns, values, sources and results");
  pass("cold external .ro reopen: exact names, columns, values, formula sources and results");
  await edit(1, "12");
  const edited = { ...initial, values: expectedValues(true) };
  assert.deepEqual(await snapshot(), edited, "dependency edit recalculates both links and retains sources");
  pass("dependency edit: both chained formula results recalculate");
  assert.equal(await saveAndQuit(), external, "second save uses the same external path");
  await coldOpen(external);
  assert.deepEqual(await snapshot(), edited, "second cold external reopen preserves the edited dependency and formulas");
  pass("second cold external .ro reopen: edited dependency, exact sources and recalculated results");
  const xlsx = await download("xlsx");
  const expected = { Invoice: {
    A1: { value: "Item" }, B1: { value: "Qty" }, C1: { value: "Unit price" }, D1: { value: "Amount" },
    A2: { value: "Paper" }, B2: { value: 12 },
    C2: { formula: "(B2*2)", value: 24 }, D2: { formula: "(C2+1)", value: 25 },
    D3: { formula: "(B3*C3)", value: 96 }, D4: { formula: "(B4*C4)", value: 24 },
    D5: { formula: "(B5*C5)", value: 12.9 }, D6: { formula: "(B6*C6)", value: 30 },
  } };
  execFileSync(platform === "win32" ? "python" : "python3", ["-I",
    fileURLToPath(new URL("./xlsx-formula-check.py", import.meta.url)), xlsx, JSON.stringify(expected)], { stdio: "inherit" });
  pass("XLSX export: independent exact formula text and cached values for every formula cell");
  await evaluate(`
    click(await waitFor(() => button("Close project"), "Close project"));
    await waitFor(() => dialog("Unsaved work") || document.querySelector('.ts-app[data-view="home"]'), "close outcome");
    const unsaved = dialog("Unsaved work");
    if (unsaved) click(button("Close without saving", unsaved));
    await waitFor(() => document.querySelector('.ts-app[data-view="home"]'), "Home");
    return true;
  `);
  await quit();
}
