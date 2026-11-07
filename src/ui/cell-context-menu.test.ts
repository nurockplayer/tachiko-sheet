import { describe, expect, it } from "vitest";
import { menuShortcut, nextMenuIndex, type CellMenuItem } from "./cell-context-menu.js";

const run = (): void => {};
const item = (label: string, disabled = false): CellMenuItem => ({ label, disabled, run });

// 0 Cut · 1 separator · 2 Copy · 3 disabled · 4 separator · 5 Paste
const items: CellMenuItem[] = [item("Cut"), "separator", item("Copy"), item("Blocked", true), "separator", item("Paste")];

describe("cell context menu keyboard movement", () => {
  it("moves down and up past separators and disabled rows", () => {
    expect(nextMenuIndex(items, 0, "ArrowDown")).toBe(2);
    expect(nextMenuIndex(items, 2, "ArrowDown")).toBe(5);
    expect(nextMenuIndex(items, 5, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(items, 2, "ArrowUp")).toBe(0);
  });
  it("wraps at both ends", () => {
    expect(nextMenuIndex(items, 5, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(items, 0, "ArrowUp")).toBe(5);
  });
  it("reaches the first and last enabled rows with Home and End", () => {
    expect(nextMenuIndex(items, 5, "Home")).toBe(0);
    expect(nextMenuIndex(items, 0, "End")).toBe(5);
  });
  it("starts from the first enabled row when nothing is focused yet", () => {
    expect(nextMenuIndex(items, -1, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(items, -1, "ArrowUp")).toBe(5);
  });
  it("keeps the current row for a key it does not handle", () => {
    expect(nextMenuIndex(items, 2, "Enter")).toBe(2);
    expect(nextMenuIndex(items, 2, "a")).toBe(2);
  });
  it("answers -1 when no row can be focused", () => {
    expect(nextMenuIndex(["separator", item("Blocked", true)], 0, "ArrowDown")).toBe(-1);
  });
});

describe("cell context menu shortcuts", () => {
  it("writes Ctrl on other platforms and the command symbol on a Mac", () => {
    expect(menuShortcut("C", false)).toBe("Ctrl+C");
    expect(menuShortcut("C", true)).toBe("⌘C");
    expect(menuShortcut("X", false)).toBe("Ctrl+X");
    expect(menuShortcut("V", true)).toBe("⌘V");
  });
});
