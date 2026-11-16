// #376.1: real XLSX import/export; ZIP/XML readback is independent of Work's codec.
// Scope: seven supported Date formats, horizontal alignment, wrap and widths.
// Fonts, fills, borders, sorting and filters are outside this preservation claim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { LOCAL_ORIGIN, installDistRoutes } from "./dist-routes.mjs";
import { homeImportInput, waitForColdHome } from "./home-entry.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "sheet-presentation-"));
const source = path.join(dir, "presentation.xlsx");
const formats = ["yyyy-mm-dd", "m/d/yyyy", "d/m/yyyy", "yyyy/m/d", 'yyyy"年"m"月"d"日"', "mmm d, yyyy", "d mmm yyyy"];
const headers = [...formats.map((_, i) => `Date${i + 1}`), "Left", "Center", "Right"];
const alignments = headers.map((_, i) => ["left", "center", "right"][i % 3]);
const widths = headers.map((_, i) => 20 + i * 2);
let context;
try {
  execFileSync("python3", ["-I", "-c", String.raw`
import sys, json, zipfile, xml.etree.ElementTree as E
file, formats, headers, aligns, widths = sys.argv[1], *map(json.loads, sys.argv[2:])
n = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
p = 'http://schemas.openxmlformats.org/package/2006/relationships'
def sub(parent, name, **attrs): return E.SubElement(parent, '{'+n+'}'+name, {k:str(v) for k,v in attrs.items()})
styles = E.Element('{'+n+'}styleSheet')
fmts = sub(styles, 'numFmts', count=len(formats))
for i, fmt in enumerate(formats): sub(fmts, 'numFmt', numFmtId=164+i, formatCode=fmt)
for name, child in [('fonts','font'), ('fills','fill'), ('borders','border'), ('cellStyleXfs','xf')]: sub(sub(styles, name, count=1), child)
xfs = sub(styles, 'cellXfs', count=len(headers)+1)
sub(xfs, 'xf', numFmtId=0)
for i in range(len(headers)):
 xf = sub(xfs, 'xf', numFmtId=164+i if i<len(formats) else 0, applyNumberFormat=1, applyAlignment=1)
 sub(xf, 'alignment', horizontal=aligns[i], wrapText=i%2)
sheet = E.Element('{'+n+'}worksheet')
cols = sub(sheet, 'cols')
for i, width in enumerate(widths): sub(cols, 'col', min=i+1, max=i+1, width=width, customWidth=1)
data = sub(sheet, 'sheetData')
for row_index in (1,2,3):
 row = sub(data, 'row', r=row_index)
 for i, header in enumerate(headers):
  cell = sub(row, 'c', r=chr(65+i)+str(row_index), s=0 if row_index==1 else i+1,
             t='d' if row_index>1 and i<len(formats) else 'inlineStr')
  value = header if row_index==1 else ('2026-11-07' if row_index==2 else '2025-12-31') if i<len(formats) else header+' '+str(row_index)
  if cell.get('t')=='d': sub(cell, 'v').text=value
  else: sub(sub(cell, 'is'), 't').text=value
with zipfile.ZipFile(file, 'w', zipfile.ZIP_DEFLATED) as z:
 z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
 z.writestr('_rels/.rels', f'<Relationships xmlns="{p}"><Relationship Id="workbook" Type="{r}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
 z.writestr('xl/workbook.xml', f'<workbook xmlns="{n}" xmlns:r="{r}"><sheets><sheet name="Presentation" sheetId="1" r:id="sheet"/></sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels', f'<Relationships xmlns="{p}"><Relationship Id="sheet" Type="{r}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/></Relationships>')
 z.writestr('xl/styles.xml', E.tostring(styles))
 z.writestr('xl/worksheets/sheet1.xml', E.tostring(sheet))
`, source, ...[formats, headers, alignments, widths].map(value => JSON.stringify(value))]);

  // Resolve style and shared-string indices, sparse cell addresses and column
  // ranges; comparing style indices alone would miss a lost/replaced definition.
  const parse = file => JSON.parse(execFileSync("python3", ["-I", "-c", String.raw`
import sys, json, zipfile, posixpath, datetime, xml.etree.ElementTree as E
n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
with zipfile.ZipFile(sys.argv[1]) as z:
 workbook=E.fromstring(z.read('xl/workbook.xml'))
 sheets=workbook.findall('s:sheets/s:sheet',n)
 assert len(sheets)==1
 rels={x.get('Id'):x.get('Target') for x in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
 target=rels[sheets[0].get(r)]
 sheet=E.fromstring(z.read(target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)))
 styles=E.fromstring(z.read('xl/styles.xml'))
 formats={int(x.get('numFmtId')):x.get('formatCode') for x in styles.findall('s:numFmts/s:numFmt',n)}
 formats.update({0:'General',14:'mm-dd-yy'})
 xfs=styles.findall('s:cellXfs/s:xf',n)
 strings=[]
 if 'xl/sharedStrings.xml' in z.namelist():
  strings=[''.join(t.text or '' for t in si.findall('.//s:t',n)) for si in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',n)]
 widths={}
 for col in sheet.findall('s:cols/s:col',n):
  for i in range(int(col.get('min')),int(col.get('max'))+1): widths[chr(64+i)]=float(col.get('width'))
 cells={}
 for c in sheet.findall('s:sheetData/s:row/s:c',n):
  ref=c.get('r'); xf=xfs[int(c.get('s','0'))]; alignment=xf.find('s:alignment',n)
  fmt=formats.get(int(xf.get('numFmtId','0')))
  value=c.findtext('s:v',default='',namespaces=n)
  typ=c.get('t','n')
  if typ=='s': value=strings[int(value)]
  elif typ=='inlineStr': value=''.join(t.text or '' for t in c.findall('.//s:t',n))
  elif typ=='n' and fmt not in ('General',None): value=(datetime.date(1899,12,30)+datetime.timedelta(days=float(value))).isoformat()
  cells[ref]={'value':value,'format':fmt,'alignment':alignment.get('horizontal') if alignment is not None else None,
              'wrap':alignment is not None and alignment.get('wrapText','0') in ('1','true')}
 print(json.dumps({'cells':cells,'widths':widths}))
`, file], { encoding: "utf8" }));
  const original = parse(source);
  context = await chromium.launchPersistentContext(path.join(dir, "profile"), { headless: true,
    ...(process.env.WORK_CHROMIUM ? { executablePath: process.env.WORK_CHROMIUM } : {}),
    ...(process.env.TACHIKO_TEST_SINGLE_PROCESS === "1" ? { args: ["--single-process"] } : {}) });
  await installDistRoutes(context, process.env.WORK_DIST ?? "dist-acceptance");
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(LOCAL_ORIGIN); await waitForColdHome(page);
  await (await homeImportInput(page)).setInputFiles(source);
  const preview = page.getByRole("dialog", { name: "Review import preview", exact: true });
  await preview.waitFor();
  for (let i = 0; i < formats.length; i++) await preview.locator(".ts-import-column select").nth(i).selectOption("date");
  await preview.getByRole("button", { name: "Import file", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  assert.equal(await page.locator("tbody tr.ts-row").count(), 2, "real imported rows are visible");
  await page.getByRole("tab", { name: "Import & export", exact: true }).click();
  await page.getByRole("button", { name: "Prepare XLSX", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm download", exact: true });
  await confirm.waitFor();
  // Imported workbooks use their own fidelity ledger. The preservation oracle
  // below reads actual styles and values, independently of disclosure wording.
  const downloaded = page.waitForEvent("download");
  await confirm.getByRole("button", { name: "Download", exact: true }).click();
  const exported = path.join(dir, "exported.xlsx"); await (await downloaded).saveAs(exported);
  const actual = parse(exported);
  assert.deepEqual(Object.keys(actual.cells).sort(), Object.keys(original.cells).sort(), "every source cell survives");
  for (const [ref, expected] of Object.entries(original.cells)) {
    assert.equal(actual.cells[ref].value, expected.value, `${ref} scalar value`);
    if (!ref.endsWith("1")) assert.deepEqual(actual.cells[ref], expected, `${ref} supported format/alignment/wrap`);
  }
  for (const [column, width] of Object.entries(original.widths)) {
    assert.ok(Math.abs(actual.widths[column] - width) <= 1 / 256, `${column} width: ${width} → ${actual.widths[column]}`);
  }
  console.log("PASS: XLSX import→export preserves all values, seven Date formats, left/center/right alignment, wrap on/off and ten widths by independent XML parsing; other presentation remains outside this claim");
} finally {
  await context?.close();
  await rm(dir, { recursive: true, force: true });
}
