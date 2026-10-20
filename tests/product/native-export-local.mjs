// #225: normal UI, production bytes, real Worker/WASM; Python's standard
// CSV/ZIP/XML readers independently check the downloaded files (no JS codec).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { waitForColdHome } from "./home-entry.mjs";
import { fillDraftCell, draftActions } from "./grid-row-entry-driver.mjs";
import { runBlankDisplayCases } from "./blank-display-cases.mjs";
import { runImportedExportRefusalCases } from "./imported-export-refusal-cases.mjs";
import { runOptionalEditEntryCases } from "./optional-edit-entry-cases.mjs";

const dist = process.env.WORK_DIST;
if (!dist) throw new Error("BLOCKED: WORK_DIST must name the built product");
const output = await mkdtemp(path.join(tmpdir(), "sheet225-"));
const checks = [], downloads = [];
let context, pid;
const ready = page => page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
const parse = file => JSON.parse(execFileSync("python3", ["-I", "-c", String.raw`
import sys,json,csv,zipfile,xml.etree.ElementTree as E
p=sys.argv[1]
if p.endswith('.csv'):
 with open(p,encoding='utf-8-sig',newline='') as f: result=list(csv.reader(f))
else:
 n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(p) as z:
  w=E.fromstring(z.read('xl/workbook.xml'))
  rel=E.fromstring(z.read('xl/_rels/workbook.xml.rels'))
  targets={r.attrib['Id']:r.attrib['Target'] for r in rel}
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(el.itertext()) for el in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',n)]
  result=[]
  for s in w.findall('s:sheets/s:sheet',n):
   t=targets[s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
   t=t.lstrip('/') if t.startswith('/') else 'xl/'+t
   rows=[]
   for row in E.fromstring(z.read(t)).findall('s:sheetData/s:row',n):
    cells=[]
    for c in row.findall('s:c',n):
     typ=c.attrib.get('t','n');v=c.findtext('s:v',default='',namespaces=n)
     if typ=='inlineStr': v=''.join(c.find('s:is',n).itertext());typ='text'
     elif typ=='s':v=strings[int(v)];typ='text'
     elif typ=='b':v=v=='1';typ='boolean'
     elif typ=='n':v=float(v);typ='number'
     cells.append({'type':typ,'value':v})
    rows.append(cells)
   result.append({'name':s.attrib['name'],'rows':rows})
print(json.dumps(result,ensure_ascii=False))
`, file], { encoding: "utf8" }));
async function prepare(page, format, { cancel = false, sales = false } = {}) {
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  const trigger = page.getByRole("button", { name: `Prepare ${format.toUpperCase()}`, exact: true });
  const count = downloads.length;
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await dialog.waitFor();
  assert.equal(downloads.length, count, "preparation never downloads without acknowledgement");
  if (sales) {
    const ledger = await dialog.getByLabel("Export changes and warnings", { exact: true }).textContent();
    assert.match(ledger, /Summary settings are not included/);
    assert.match(ledger, /Calculated summary values are not included/);
    assert.match(ledger, /Reports and charts are not included/);
    assert.doesNotMatch(ledger, /keyed-grouped-sum/i);
    // A selected-table CSV does not contain every summary source table, so the copy must not claim it.
    assert.doesNotMatch(ledger, /contains the source tables used by the summary/i);
  }
  if (cancel) {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(downloads.length, count);
    // Focus returns on the next animation frame; wait for it rather than racing it.
    await page.waitForFunction(element => element === document.activeElement, await trigger.elementHandle(), { timeout: 5000 })
      .catch(() => { throw new Error("Cancel must return focus to the Prepare button"); });
    return;
  }
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(output, `download-${count}.${format}`);
  await (await downloaded).saveAs(file);
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(element => element === document.activeElement, await trigger.elementHandle());
  return parse(file);
}
async function close(page) {
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Unsaved work", exact: true });
  if (await d.count()) await d.getByRole("button", { name: "Close without saving", exact: true }).click();
  await waitForColdHome(page);
}
try {
  context = await chromium.launchPersistentContext(path.join(output, "profile"), { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  const cdp = await context.browser().newBrowserCDPSession();
  pid = (await cdp.send("SystemInfo.getProcessInfo")).processInfo.find(p => p.type === "browser")?.id;
  await cdp.detach(); assert.ok(Number.isInteger(pid), "owned browser PID required");
  await installDistRoutes(context, dist);
  await context.addInitScript(() => {
    window.__exportEvidence = { requests: [], replies: [], table: null };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          window.__exportEvidence.replies.push(structuredClone(event.data));
          if (event.data.response?.type === "table") window.__exportEvidence.table = structuredClone(event.data.response.payload);
        });
      }
      postMessage(message, ...args) { window.__exportEvidence.requests.push(structuredClone(message)); return super.postMessage(message, ...args); }
    };
  });
  const page = context.pages()[0]; page.setDefaultTimeout(10000);
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await page.getByRole("button", { name: "New table", exact: true }).click();
  const d = page.getByRole("dialog", { name: "New table", exact: true });
  await d.getByLabel("Table name", { exact: true }).fill("Expenses");
  for (const [index, name, type] of [[1,"Item","text"],[2,"Amount","number"],[3,"Paid","boolean"]]) {
    if (index > 1) await d.getByRole("button", { name: "Add column", exact: true }).click();
    await d.getByLabel(`Column ${index} name`, { exact: true }).fill(name);
    await d.getByLabel(`Column ${index} type`, { exact: true }).selectOption(type);
  }
  await d.getByRole("button", { name: "Create table", exact: true }).click(); await ready(page);
  for (const row of [["Tea 茶",4.5,true],["Train",12,false]]) {
    for (const [index,label,type] of [[0,"Item","Text"],[1,"Amount","Number"],[2,"Paid","Yes/No"]]) {
      await fillDraftCell(page, page.locator(".ts-entry-row").getByLabel(`New row ${label} (${type})`, { exact: true }), row[index]);
    }
    await draftActions(page).getByRole("button", { name: "Add row", exact: true }).click(); await ready(page);
  }
  await prepare(page,"csv",{cancel:true});
  assert.deepEqual(await prepare(page,"csv"), [["Item","Amount","Paid"],["Tea 茶","4.5","true"],["Train","12","false"]]);
  const workbook = await prepare(page,"xlsx");
  assert.deepEqual(workbook,[{name:"Expenses",rows:[
    ["Item","Amount","Paid"].map(value=>({type:"text",value})),
    [{type:"text",value:"Tea 茶"},{type:"number",value:4.5},{type:"boolean",value:true}],
    [{type:"text",value:"Train"},{type:"number",value:12},{type:"boolean",value:false}],
  ]}]);
  checks.push("new-table CSV exact lexical values; XLSX exact text/number/boolean values and types; acknowledgement/cancel/focus");

  // Downloads snapshot the published revision: an unfinished new-row draft blocks them.
  await page.getByRole("tab",{name:"Table",exact:true}).click();
  await fillDraftCell(page, page.locator(".ts-entry-row").getByLabel("New row Item (Text)", { exact: true }), "Unfinished");
  await page.getByRole("tab",{name:"Import & export",exact:true}).click();
  for (const name of ["Prepare CSV","Prepare XLSX"]) {
    const button=page.getByRole("button",{name,exact:true});
    assert.equal(await button.isDisabled(),true,`${name} is unavailable while a draft is unpublished`);
    const reason=await button.evaluate(node=>document.getElementById(node.getAttribute("aria-describedby")??"")?.textContent??"");
    assert.match(reason, /unfinished edits/i, `${name} explains why it is unavailable`);
  }
  await page.getByRole("tab",{name:"Table",exact:true}).click();
  await draftActions(page).getByRole("button",{name:"Discard",exact:true}).click();
  await page.getByRole("tab",{name:"Import & export",exact:true}).click();
  for (const name of ["Prepare CSV","Prepare XLSX"]) assert.equal(await page.getByRole("button",{name,exact:true}).isEnabled(),true,`${name} returns after the draft is discarded`);
  checks.push("unpublished new-row draft blocks CSV/XLSX preparation with an associated reason; Discard restores it");

  // A normal Text cell may contain formula-leading text, which CSV refuses.
  await page.getByRole("tab",{name:"Table",exact:true}).click();
  const cell=page.locator('table[aria-label="Table"] tbody tr.ts-row').first().locator("td").first();
  await cell.dblclick(); await page.getByTestId("cell-editor").fill("=SUM(1,2)");
  await page.getByTestId("cell-editor").press("Enter"); await ready(page);
  const before=await page.locator('table[aria-label="Table"]').textContent();
  const saveBefore=await page.getByTestId("save-status").textContent();
  const count=downloads.length;
  await page.getByRole("tab",{name:"Import & export",exact:true}).click();
  await page.getByRole("button",{name:"Prepare CSV",exact:true}).click();
  const alert=page.getByRole("region",{name:"Download spreadsheet",exact:true}).getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.textContent(), /This file cannot be prepared\./);
  assert.match(await alert.textContent(), /formula|XLSX/i);
  assert.match(await alert.textContent(), /: /, "refusal contains its location");
  assert.doesNotMatch(await alert.textContent(), /native_tables_export_refused|Details:/);
  assert.equal(await page.getByRole("dialog",{name:"Confirm download",exact:true}).count(),0);
  await page.getByRole("tab",{name:"Table",exact:true}).click();
  assert.equal(await page.locator('table[aria-label="Table"]').textContent(),before);
  assert.equal(await page.getByTestId("save-status").textContent(),saveBefore);
  assert.equal(downloads.length,count);
  checks.push("normal-UI formula-leading Text refusal is located; no download or work/save-state change");
  await close(page);
  await page.getByRole("button",{name:"Open sales example",exact:true}).click(); await ready(page);
  await page.getByTestId("results-pane").waitFor();
  const sales=await prepare(page,"xlsx",{sales:true});
  assert.equal(sales.length,2,"Sales exports exactly its two source tables, without summary snapshots");
  assert.deepEqual(sales.map(sheet=>sheet.name).sort(),["catalog","sales"]);
  const catalog = sales.find(sheet => sheet.name === "catalog");
  const orders = sales.find(sheet => sheet.name === "sales");
  assert.deepEqual(catalog.rows, [
    ["code","category","price"].map(value=>({type:"text",value})),
    [{type:"text",value:"PEN"},{type:"text",value:"PEN"},{type:"number",value:200}],
    [{type:"text",value:"NOTE"},{type:"text",value:"NOTE"},{type:"number",value:500}],
  ]);
  assert.deepEqual(orders.rows, [
    ["product_code","quantity"].map(value=>({type:"text",value})),
    [{type:"text",value:"PEN"},{type:"number",value:3}],
    [{type:"text",value:"NOTE"},{type:"number",value:2}],
    [{type:"text",value:"PEN"},{type:"number",value:1}],
  ]);
  // CSV must follow the selected second table rather than workbook order.
  await page.getByLabel("Table", { exact: true }).selectOption("sales"); await ready(page);
  assert.deepEqual(await prepare(page,"csv",{sales:true}), [["product_code","quantity"],["PEN","3"],["NOTE","2"],["PEN","1"]]);
  checks.push("Sales XLSX two source sheets; summary/settings/results/chart exclusions visible in review");
  await close(page);
  await runBlankDisplayCases(page, { output, close, checks });
  await runImportedExportRefusalCases(page, { close, prepare, downloads, checks });
  await runOptionalEditEntryCases(page, { close, checks });
  console.log(JSON.stringify({status:"PASS",checks,downloads,output}));
} finally {
  if(context) await context.close();
  if(pid) {
    let alive=true;
    const deadline=Date.now()+5000;
    while(alive&&Date.now()<deadline){try{process.kill(pid,0);await delay(50);}catch(error){if(error.code!=="ESRCH")throw error;alive=false;}}
    await writeFile(path.join(output,"process-exit.json"),JSON.stringify({pid,exitObserved:!alive}));
    assert.equal(alive,false,"owned browser actually exited");
  }
}
