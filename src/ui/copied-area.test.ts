import { describe, expect, it } from "vitest";
import { copiedEdges } from "./copied-area.js";

describe("copiedEdges", () => {
  const area = { top: 1, bottom: 3, left: 2, right: 4 };
  it("identifies perimeter edges and interior cells", () => {
    expect(copiedEdges(area, 1, 2)).toEqual(["top", "left"]);
    expect(copiedEdges(area, 3, 4)).toEqual(["bottom", "right"]);
    expect(copiedEdges(area, 2, 3)).toEqual([]);
    expect(copiedEdges(area, 0, 2)).toBeNull();
    expect(copiedEdges(area, 2, 5)).toBeNull();
  });
  it("returns all four edges for a single cell", () => {
    expect(copiedEdges({ top: 1, bottom: 1, left: 2, right: 2 }, 1, 2)).toEqual(["top", "bottom", "left", "right"]);
  });
});
