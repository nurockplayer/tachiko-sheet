import { describe, expect, it } from "vitest";
import { requireWorkFileName, sameWorkFileOmissions, workFileOmissions } from "./work-file.js";
import { preparedDownloadIsCurrent } from "./prepared-download.js";
import type { WorkbookView } from "../contracts.js";

describe("work file host policy", () => {
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
