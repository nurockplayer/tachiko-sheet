import { describe, expect, it, vi } from "vitest";
import { readWorkFile, requireWorkFileName, sameWorkFileOmissions, workFileOmissions } from "./work-file.js";
import { WORK_FILE_MAX_BYTES } from "../contracts.js";
import { workFileOpenRefusal } from "../ui/work-file-copy.js";
import { preparedDownloadIsCurrent } from "./prepared-download.js";
import type { WorkbookView } from "../contracts.js";

describe("work file host policy", () => {
  it("refuses oversized File metadata without reading any bytes", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const refusal = await readWorkFile({ size: WORK_FILE_MAX_BYTES + 1, arrayBuffer }).catch(error => error);
    expect(refusal).toBeInstanceOf(Error);
    expect(workFileOpenRefusal(refusal)).toMatch(/^This work file exceeds the supported size or content limits\. The current work was kept\./);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("reads and accepts the exact byte-limit boundary", async () => {
    const bytes = new ArrayBuffer(WORK_FILE_MAX_BYTES);
    const arrayBuffer = vi.fn(async () => bytes);
    expect(await readWorkFile({ size: WORK_FILE_MAX_BYTES, arrayBuffer })).toBe(bytes);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("also refuses oversized bytes when File metadata understates their size", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(WORK_FILE_MAX_BYTES + 1));
    await expect(readWorkFile({ size: 1, arrayBuffer })).rejects.toThrow(/resource_limit/);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("discloses only attachments actually present", () => {
    expect(workFileOmissions({ importedSource: false, report: false })).toEqual([]);
    const source = workFileOmissions({ importedSource: true, report: false });
    const report = workFileOmissions({ importedSource: false, report: true });
    expect(source).toHaveLength(1);
    expect(source[0]).toMatch(/import information, changes and warnings/);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatch(/Report settings/);
    expect(workFileOmissions({ importedSource: true, report: true })).toEqual([...source, ...report]);
    expect(sameWorkFileOmissions(source, [...source, ...report])).toBe(false);
    expect(sameWorkFileOmissions(source, source.slice())).toBe(true);
  });

  it("checks the filename without trusting it as content admission", () => {
    expect(() => requireWorkFileName("plan.RO")).not.toThrow();
    for (const name of ["plan.csv", "plan.ro.csv", "plan", "plan.ro "]) {
      expect(() => requireWorkFileName(name)).toThrow(/ending in .ro/);
    }
    expect(() => requireWorkFileName("csv-renamed.ro")).not.toThrow(); // Work must verify the bytes.
  });

  it("keeps whole-work consent across selection but rejects edits, replacements and absent preparation", () => {
    const live = { occurrence: "o1", revision: "r1", table: { collection: { id: "a" } } } as WorkbookView;
    const prepared = { format: "ro" as const, occurrence: "o1", revision: "r1", collectionId: "a", bytes: new ArrayBuffer(1) };
    expect(preparedDownloadIsCurrent(prepared, live, "ro")).toBe(true);
    expect(preparedDownloadIsCurrent(prepared, { ...live, table: { ...live.table, collection: { ...live.table.collection, id: "b" } } }, "ro")).toBe(true);
    expect(preparedDownloadIsCurrent(prepared, { ...live, revision: "r2" }, "ro")).toBe(false);
    expect(preparedDownloadIsCurrent(prepared, { ...live, occurrence: "o2" }, "ro")).toBe(false);
    expect(preparedDownloadIsCurrent(null, live, "ro")).toBe(false);
  });
});
