import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";
import { startDesignerWorker } from "../../public/core-kit/runtime/worker-runtime.js";
import * as kit from "../../public/core-kit/experimental-client.js";
import { createSheetRuntime } from "./session.js";

// Keep the actual public worker protocol, importer and WASM; only the Worker
// transport is in-process, as in a1-real-kit.test.ts.
async function realClient() {
  const wasm = await readFile(new URL("../../public/core-kit/designer_runtime.wasm", import.meta.url));
  const url = `data:application/wasm;base64,${wasm.toString("base64")}`;
  return new WorkerDesignerClient(() => {
    const scopeEvents = new EventTarget();
    const clientEvents = new EventTarget();
    const send = (target: EventTarget, data: unknown, transfer: Transferable[] = []) => {
      const copy = structuredClone(data, { transfer });
      setTimeout(() => target.dispatchEvent(new MessageEvent("message", { data: copy })), 0);
    };
    const global = globalThis as unknown as { self?: unknown };
    const saved = global.self;
    global.self = {
      addEventListener: (type: string, listener: EventListener) => scopeEvents.addEventListener(type, listener),
      postMessage: (data: unknown, transfer?: Transferable[]) => send(clientEvents, data, transfer),
    };
    try { startDesignerWorker(url); } finally { global.self = saved; }
    return {
      addEventListener: (type: string, listener: EventListener) => clientEvents.addEventListener(type, listener),
      postMessage: (data: unknown, transfer?: Transferable[]) => send(scopeEvents, data, transfer),
      terminate: () => undefined,
    } as unknown as Worker;
  });
}

const options = { delimiter: ",", header: true };
const selection = { column_types: [["text", "number", "number"]] as ("text" | "number")[][], extra_columns: [[]] };

describe("working-size imported sessions with the vendored kit", () => {
  it("exports the published worksheet mapping after rename, undo and redo", async () => {
    const client = await realClient();
    const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => client }));
    try {
      const bytes = new TextEncoder().encode("Name,Qty,Total\nCoffee,2,20\n").buffer;
      const imported = await runtime.importSpreadsheet(bytes, "csv", options, selection);
      let view = imported.view;
      let metadata = imported.metadata;
      const renamed = await runtime.renameTable(view, view.table.collection.key, "Renamed");
      expect(renamed.publication.import_metadata).toBeDefined();
      await expect(runtime.exportSpreadsheet(renamed.view, metadata, "xlsx")).rejects.toThrow(/metadata is stale/i);
      for (const result of [renamed, await runtime.trackerHistory(renamed.view, "undo")]) {
        view = result.view;
        metadata = result.publication.import_metadata!;
        expect(metadata).toBeDefined();
        await expect(runtime.exportSpreadsheet(view, metadata, "xlsx")).resolves.toHaveProperty("bytes");
      }
      const redone = await runtime.trackerHistory(view, "redo");
      expect(redone.publication.import_metadata).toBeDefined();
      await expect(runtime.exportSpreadsheet(redone.view, redone.publication.import_metadata!, "xlsx")).resolves.toHaveProperty("bytes");
    } finally { client.close(); }
  }, 30_000);

  it("keeps full-fidelity metadata while imported edits reach Work's stored-text bound", async () => {
    const client = await realClient();
    const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => client }));
    try {
      const bytes = new TextEncoder().encode("Name,Qty,Total\nCoffee,2,20\nBus,3,40\n").buffer;
      const imported = await runtime.importSpreadsheet(bytes, "csv", options, selection);
      expect(imported.metadata.version).toBe(1);
      expect(imported.metadata.sheets[0]!.columns[0]).toHaveProperty("width", null);
      expect(imported.metadata.sheets[0]!).toHaveProperty("rows");
      expect(runtime.requestByteLimit).toBeGreaterThan(69_000);
      const before = await runtime.read();
      const occurrence = await client.observeOccurrence();
      await expect(runtime.editCells(before, [{
        target: { entity: before.table.rows[0]!.id, field: before.table.columns[0]!.id },
        input: { kind: "text", value: "雪".repeat(23_000) },
      }])).rejects.toThrow("stored text exceeds the bounded 65536-byte projection maximum");
      expect(await runtime.read()).toEqual(before);
      expect(await client.observeOccurrence()).toEqual(occurrence);
      // Original producer metadata remains usable for export after reopening.
      await expect(client.exportSpreadsheet(before.revision, imported.metadata, "xlsx", before.table.collection.id))
        .resolves.toHaveProperty("bytes");
    } finally { client.close(); }
  }, 30_000);

  it("admits a 129-row XLSX with a formula through application inspection and import", async () => {
    const client = await realClient();
    const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => client }));
    try {
      // Produce a real XLSX with the kit, including a formula so ordinary
      // inspection cannot admit it through the special text-only profile.
      const csv = new TextEncoder().encode("Name,Qty,Total\n" + Array.from({ length: 129 }, (_, i) => `Item ${i},2,0`).join("\n"));
      const seed = await client.importSpreadsheetWorkingSize(csv.buffer, "csv", options, selection);
      const table = seed.opened.window;
      const formula = await client.updateFormula(table.revision, { entity: table.rows[0]!.id, field: table.columns[2]!.id }, "1 + 1");
      const xlsx = await client.exportSpreadsheet(formula.resulting_revision, seed.metadata, "xlsx", table.collection.id);
      await expect(client.inspectSpreadsheet(xlsx.bytes.slice(0), "xlsx", options)).rejects.toThrow(/capacity|limit|128/i);

      const preview = await runtime.inspectSpreadsheet(xlsx.bytes, "xlsx", options);
      expect(preview.sheets[0]!.rows).toHaveLength(129);
      expect(preview.sheets[0]!.rows.some(row => row.some(cell => cell.formula !== null))).toBe(true);
      const imported = await runtime.importSpreadsheet(xlsx.bytes, "xlsx", options, selection);
      expect(imported.metadata.sheets[0]!.schema_id).toBe(imported.view.table.collection.id);
      expect(imported.view.table.collection.entity_count).toBe(129);
    } finally { client.close(); }
  }, 30_000);

  it("preserves full-fidelity metadata and refuses a styled capacity fallback without replacing work", async () => {
    const client = await realClient();
    const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => client }));
    const textSelection = { column_types: [["text" as const]], extra_columns: [[]] };
    try {
      const csv = new TextEncoder().encode("Name\n" + Array.from({ length: 200 }, (_, i) => `Item ${i}`).join("\n")).buffer;
      const imported = await runtime.importSpreadsheet(csv, "csv", options, textSelection);
      expect(imported.metadata.version).toBe(1);
      if (imported.metadata.version !== 1) throw new Error("Expected full-fidelity metadata");
      expect(imported.metadata.sheets[0]!.columns[0]).toHaveProperty("width", null);
      expect(imported.metadata.sheets[0]!.rows).toHaveLength(200);
      expect(imported.metadata.sheets[0]!.rows[0]!.styles).toHaveLength(1);
      const before = await runtime.read();
      const occurrence = await client.observeOccurrence();
      for (const kind of ["width", "style", "format", "header", "plain"] as const) {
        // Build the source directly: capacity-profile export correctly refuses
        // presentation, so it cannot manufacture this admission regression.
        const file = execFileSync("python3", ["-I", "-c", String.raw`
import io, sys, zipfile
kind = sys.argv[1]
ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
rel = "http://schemas.openxmlformats.org/package/2006/relationships"
width = '<cols><col min="1" max="1" width="12"/></cols>' if kind == "width" else ""
xf = 'fontId="1" applyFont="1"' if kind in ("style", "header") else 'numFmtId="2" applyNumberFormat="1"'
rows = ''.join('<row r="%d"><c r="A%d" t="str" s="%d"><v>%s</v></c></row>' % (i + 1, i + 1, int((i == 0 and kind == "header") or (i > 0 and kind in ("style", "format"))), "Name" if i == 0 else "Item %d" % i) for i in range(201))
parts = {
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
  "_rels/.rels": '<Relationships xmlns="%s"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' % rel,
  "xl/workbook.xml": '<workbook xmlns="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>' % ns,
  "xl/_rels/workbook.xml.rels": '<Relationships xmlns="%s"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' % rel,
  "xl/worksheets/sheet1.xml": '<worksheet xmlns="%s">%s<sheetData>%s</sheetData></worksheet>' % (ns, width, rows),
  "xl/styles.xml": '<styleSheet xmlns="%s"><fonts count="2"><font/><font><b/></font></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0"/><xf %s/></cellXfs></styleSheet>' % (ns, xf),
}
if kind == "plain":
  del parts["xl/styles.xml"]
  parts["xl/_rels/workbook.xml.rels"] = '<Relationships xmlns="%s"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' % rel
  # A formula forces the ordinary 128-row profile without adding presentation.
  rows = '<row r="1"><c r="A1" t="str"><v>Name</v></c></row>' + ''.join('<row r="%d"><c r="A%d">%s<v>%d</v></c></row>' % (i + 1, i + 1, '<f>1+1</f>' if i == 1 else '', 2 if i == 1 else i) for i in range(1, 201))
  parts["xl/worksheets/sheet1.xml"] = '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>' % (ns, rows)
output = io.BytesIO()
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
  for name, content in parts.items(): archive.writestr(name, content)
sys.stdout.buffer.write(output.getvalue())
`, kind]);
        const bytes = Uint8Array.from(file).buffer;
        const preview = await client.inspectSpreadsheet(bytes, "xlsx", options, "working_size");
        expect(preview.sheets[0]!.rows).toHaveLength(200);
        await expect(client.inspectSpreadsheet(bytes, "xlsx", options)).rejects.toMatchObject({ failure: { code: "capacity_exceeded" } });
        if (kind === "plain") {
          expect(preview.ledger.some(finding => finding.category === "lossy_on_export")).toBe(false);
          expect(await runtime.inspectSpreadsheet(bytes, "xlsx", options)).toEqual(preview);
          const plain = await runtime.importSpreadsheet(bytes, "xlsx", options,
            { column_types: [["number"]], extra_columns: [[]] });
          expect(plain.metadata.version).toBe(2);
          expect(plain.view.table.collection.entity_count).toBe(200);
          continue;
        }
        if (kind === "width") expect(preview.sheets[0]!.columns[0]!.width).toBe(12);
        if (kind === "style") expect(preview.sheets[0]!.rows[0]![0]!.style.bold).toBe(true);
        if (kind === "format") expect(preview.sheets[0]!.rows[0]![0]!.style.number_format).toBe("0.00");
        if (kind === "header") {
          expect(preview.sheets[0]!.rows.every(row => row.every(cell => !cell.style.bold))).toBe(true);
          expect(preview.ledger).toContainEqual(expect.objectContaining({ code: "header_style_not_preserved" }));
        }
        await expect(runtime.inspectSpreadsheet(bytes, "xlsx", options)).rejects.toMatchObject({ failure: { code: "capacity_exceeded" } });
        await expect(runtime.importSpreadsheet(bytes, "xlsx", options, textSelection)).rejects.toMatchObject({ failure: { code: "capacity_exceeded" } });
        expect(await client.observeOccurrence()).toEqual(occurrence);
        expect(await runtime.read()).toEqual(before);
      }
    } finally { client.close(); }
  }, 30_000);

  it("admits 8,407 and 10,000 rows and preserves resident work after a 10,001-row refusal", async () => {
    const client = await realClient();
    const runtime = createSheetRuntime(async () => ({ ...kit, createExperimentalDesignerClient: () => client }));
    const source = await readFile(new URL("../../acceptance/web-save-closure/fixtures/rows-10001.csv", import.meta.url), "utf8");
    const lines = source.trimEnd().split("\n");
    const textSelection = { column_types: [["text" as const]], extra_columns: [[]] };
    try {
      for (const rows of [8407, 10000]) {
        const bytes = new TextEncoder().encode(lines.slice(0, rows + 1).join("\n") + "\n").buffer;
        expect((await runtime.inspectSpreadsheet(bytes, "csv", options)).sheets[0]!.rows).toHaveLength(rows);
        const imported = await runtime.importSpreadsheet(bytes, "csv", options, textSelection);
        expect(imported.view.table.rows).toHaveLength(rows);
        expect(imported.view.table.collection.entity_count).toBe(rows);
      }
      const before = await runtime.read();
      const occurrence = await client.observeOccurrence();
      const bytes = new TextEncoder().encode(source).buffer;
      await expect(runtime.inspectSpreadsheet(bytes, "csv", options)).rejects.toMatchObject({ failure: { code: "capacity_exceeded" } });
      await expect(runtime.importSpreadsheet(bytes, "csv", options, textSelection)).rejects.toMatchObject({ failure: { code: "capacity_exceeded" } });
      expect(await client.observeOccurrence()).toEqual(occurrence);
      expect(await runtime.read()).toEqual(before);
    } finally { client.close(); }
  }, 30_000);

  it.each(["csv", "xlsx"] as const)("qualifies %s import, changed cells, save and imported reopen", async format => {
    const client = await realClient();
    try {
      const source = await readFile(new URL(`../../acceptance/j3-interop/fixtures/messy.${format}`, import.meta.url));
      const imported = await client.importSpreadsheetWorkingSize(Uint8Array.from(source).buffer, format, options, selection);
      expect(imported.opened.profile).toBe("working_size");
      const metadata = imported.metadata;
      const retainedMetadata = structuredClone(metadata);
      expect(metadata.sheets).toHaveLength(1);
      expect(metadata.sheets[0]!.columns).toHaveLength(3);
      const table = imported.opened.window;
      const collection = table.collection.key;
      const target = { entity: table.rows[0]!.id, field: table.columns[1]!.id };
      const edited = await client.editNumber(table.revision, target, "42");
      expect(edited.base_revision).toBe(table.revision);
      expect(edited.many).toBeUndefined();
      expect(edited.changed).toHaveLength(1);
      expect(edited.changed![0]).toMatchObject({ target, stored: { kind: "number", value: 42 } });

      const saved = await client.exportProjectV3(edited.resulting_revision);
      expect(saved.revision).toBe(edited.resulting_revision);
      expect(saved.bytes.byteLength).toBeGreaterThan(0);
      await client.closeProject();
      const inspected = await client.inspectImportedProjectWorkingSize(saved.bytes.slice(0), metadata);
      expect(inspected.profile).toBe("working_size");
      expect(inspected.window.rows[0]!.fields).toContainEqual(expect.objectContaining({ target, stored: { kind: "number", value: 42 } }));
      const reopened = await client.openImportedProjectWorkingSize(saved.bytes.slice(0), metadata);
      expect(reopened.profile).toBe("working_size");
      const reedited = await client.editNumber(reopened.window.revision, target, "43");
      expect(reedited.many).toBeUndefined();
      expect(reedited.changed).toHaveLength(1);
      expect(reedited.changed![0]).toMatchObject({ target, stored: { kind: "number", value: 43 } });
      const exported = await client.exportSpreadsheet(reedited.resulting_revision, metadata, format, table.collection.id);
      expect(exported.bytes.byteLength).toBeGreaterThan(0);
      expect(metadata).toEqual(retainedMetadata);

      // A parser refusal must leave both the occurrence and its edited data intact.
      const before = await client.observeOccurrence();
      const beforeTable = await client.queryTableWindow(before.revision, collection, {}, 0, 10);
      await expect(client.importSpreadsheetWorkingSize(new Uint8Array([1, 2, 3]).buffer, "xlsx", options, selection)).rejects.toBeDefined();
      expect(await client.observeOccurrence()).toEqual(before);
      expect(await client.queryTableWindow(before.revision, collection, {}, 0, 10)).toEqual(beforeTable);
    } finally { client.close(); }
  }, 30_000);
});
