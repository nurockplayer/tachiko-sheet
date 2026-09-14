import { describe, expect, it } from "vitest";

import { drawReportCanvas, reportCanvasLayout } from "./ReportCanvas.js";

const report = {
  definitionId: "summary-1",
  type: "bar" as const,
  title: "Current report",
  categoryLabel: "Category",
  valueLabel: "Value",
  legendVisible: true,
};

describe("report Canvas layout", () => {
  const measure = (text: string) => Array.from(text).length * 9;

  it("keeps a zero baseline and every signed value inside the plot", () => {
    const layout = reportCanvasLayout(report, [
      { category: "Return", value: -240 },
      { category: "Zero", value: 0 },
      { category: "Sale", value: 800 },
    ], measure);

    expect(layout.zeroY).toBeGreaterThan(layout.top);
    expect(layout.zeroY).toBeLessThan(layout.bottom);
    for (const point of layout.points) {
      expect(point.y).toBeGreaterThanOrEqual(layout.top);
      expect(point.y).toBeLessThanOrEqual(layout.bottom);
    }
  });

  it("allocates readable intrinsic width and wrapped label space for all groups", () => {
    const layout = reportCanvasLayout(report, Array.from({ length: 12 }, (_, index) => ({
      category: `長い分類ラベル${index + 1}ABCDEFGHIJKLMN`,
      value: index - 6,
    })), measure);

    expect(layout.width).toBeGreaterThan(720);
    expect(layout.height).toBeGreaterThanOrEqual(360);
    expect(layout.points).toHaveLength(12);
    expect(layout.points.every((point) => point.categoryLines.join("") === point.category)).toBe(true);
  });

  it("reserves complete configurable axis labels without borrowing plot space", () => {
    const layout = reportCanvasLayout({
      ...report,
      title: "長いタイトルABCDEFGHIJKLMN",
      valueLabel: "値の単位と説明ABCDEFGHIJKLMNABCDEFGHIJKLMN",
      categoryLabel: "分類の説明ABCDEFGHIJKLMNABCDEFGHIJKLMN",
    }, [{ category: "PEN", value: 800 }], measure, (text) => Array.from(text).length * 13);

    expect(layout.titleLines.join("")).toBe("長いタイトルABCDEFGHIJKLMN");
    expect(layout.valueLabelLines.join("")).toBe("値の単位と説明ABCDEFGHIJKLMNABCDEFGHIJKLMN");
    expect(layout.categoryLabelLines.join("")).toBe("分類の説明ABCDEFGHIJKLMNABCDEFGHIJKLMN");
    expect(layout.valueLabelTop).toBeLessThan(layout.top);
    expect(layout.categoryLabelTop).toBeGreaterThan(layout.bottom);
    expect(layout.height).toBeGreaterThan(layout.categoryLabelTop);
  });

  it("keeps intentionally empty presentation labels empty", () => {
    const layout = reportCanvasLayout({
      ...report,
      title: "",
      valueLabel: "",
      categoryLabel: "",
    }, [], measure);

    expect(layout.titleLines).toEqual([""]);
    expect(layout.valueLabelLines).toEqual([""]);
    expect(layout.categoryLabelLines).toEqual([""]);
  });

  it("uses the measured report frame for an empty result while retaining its explicit no-data state", () => {
    const drawn: Array<{ text: string; x: number; y: number }> = [];
    const drawingContext = {
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      textAlign: "start" as CanvasTextAlign,
      measureText: (text: string) => ({ width: measure(text) }),
      fillRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fill: () => {}, arc: () => {},
      fillText: (text: string, x: number, y: number) => drawn.push({ text, x, y }),
    };
    const context = drawingContext as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0, height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;

    const emptyReport = {...report, title: "", valueLabel: "", categoryLabel: ""};
    drawReportCanvas(canvas, emptyReport, []);
    const layout = reportCanvasLayout(emptyReport, [], measure);

    expect(canvas.width).toBe(layout.width);
    expect(canvas.height).toBe(layout.height);
    expect(drawn).toContainEqual({
      text: "No groups in the current result.",
      x: layout.left + (layout.width - layout.left - layout.right) / 2,
      y: layout.top + (layout.bottom - layout.top) / 2,
    });
    expect(drawn.filter(({ text }) => text === "")).toHaveLength(3);
  });

  it("draws equal-width centered bars for sparse signed data", () => {
    const bars: Array<{ x: number; y: number; width: number; height: number }> = [];
    const drawingContext = {
      font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, textAlign: "start" as CanvasTextAlign,
      measureText: (text: string) => ({ width: measure(text) }),
      fillRect(x: number, y: number, width: number, height: number) {
        if (drawingContext.fillStyle === "#2563eb" && width > 20) bars.push({ x, y, width, height });
      },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fill: () => {}, arc: () => {}, fillText: () => {},
    };
    const context = drawingContext as unknown as CanvasRenderingContext2D;
    const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    const groups = [{ category: "Long category", value: -800 }, { category: "P", value: 0 }, { category: "Sale", value: 1000 }];
    drawReportCanvas(canvas, report, groups);
    const layout = reportCanvasLayout(report, groups, measure);

    expect(bars).toHaveLength(3);
    expect(bars.every((bar) => bar.width === 56 && bar.height >= 0)).toBe(true);
    bars.forEach((bar, index) => expect(bar.x + bar.width / 2).toBe(layout.points[index]!.x));
  });

  it("refuses non-finite values instead of drawing a misleading PNG", () => {
    expect(() => reportCanvasLayout(report, [{ category: "Unknown", value: Number.NaN }], measure)).toThrow(RangeError);
  });
});
