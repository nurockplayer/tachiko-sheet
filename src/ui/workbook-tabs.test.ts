import { describe, expect, it } from "vitest";
import { isTableSwitchShortcut, tableTabIndex, tableTabName } from "./workbook-tabs.js";

describe("workbook table navigation", () => {
  it("keeps imported mode names and duplicate table names unique", () => {
    const modes = ["Table", "Cross-table summary", "Report", "Brief", "Import & export"];
    const names = [...modes, "Table", "Report"];
    const tabs = names.map((name, index) => tableTabName(name, index, names.length));
    expect(tabs.some(name => modes.includes(name))).toBe(false);
    expect(new Set(tabs).size).toBe(names.length);
    expect(tabs[0]).toBe("Table (table 1 of 7)");
  });
  it("maps arrows and page shortcuts in workbook order with wraparound", () => {
    expect(tableTabIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(tableTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(tableTabIndex("PageUp", 2, 3)).toBe(1);
    expect(tableTabIndex("PageDown", 0, 3)).toBe(1);
    expect(tableTabIndex("Home", 2, 3)).toBe(0);
    expect(tableTabIndex("End", 0, 3)).toBe(2);
    expect(tableTabIndex("ArrowRight", 0, 1)).toBeNull();
    expect(tableTabIndex("ArrowRight", 0, 0)).toBeNull();
    expect(tableTabIndex("Enter", 0, 3)).toBeNull();
  });
  it("reserves only unmodified Ctrl+PageUp/PageDown", () => {
    const event = { key: "PageDown", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false };
    expect(isTableSwitchShortcut(event)).toBe(true);
    for (const change of [{ ctrlKey: false }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { key: "ArrowRight" }]) {
      expect(isTableSwitchShortcut({ ...event, ...change })).toBe(false);
    }
  });
});
