import { describe, expect, it } from "vitest";
import { shortcutHelpGroups } from "./shortcut-help.js";

describe("shortcut help", () => {
  it("uses platform labels and keeps Control for formulas", () => {
    const entries = (mac: boolean) => shortcutHelpGroups({ mac, desktop: true }).flatMap(group => group.entries);
    expect(entries(true).find(entry => entry.action === "Save")?.keys).toEqual(["⌘S"]);
    expect(entries(false).find(entry => entry.action === "Save")?.keys).toEqual(["Ctrl+S"]);
    expect(entries(true).find(entry => entry.action === "Show formulas")?.keys).toEqual(["Ctrl+`"]);
    expect(entries(true).find(entry => entry.action === "Paste Special")?.keys).toEqual(["Ctrl+⌘V"]);
    expect(entries(true).find(entry => entry.action === "Redo")?.keys).toEqual(["⌘Shift+Z"]);
  });
  it("filters desktop commands and does not repeat keys within a group", () => {
    for (const mac of [false, true]) for (const desktop of [false, true]) {
      const groups = shortcutHelpGroups({ mac, desktop });
      expect(groups.flatMap(group => group.entries).some(entry => entry.action === "Quit")).toBe(desktop);
      for (const group of groups) {
        const keys = group.entries.flatMap(entry => entry.keys);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});
