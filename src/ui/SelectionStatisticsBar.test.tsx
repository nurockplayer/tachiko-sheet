import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SelectionStatisticsProjection } from "../../public/core-kit/runtime/protocol.js";
import { SelectionStatisticsBar } from "./SelectionStatisticsBar.js";
import { formatNumberFor } from "./field-display.js";

const statistics: SelectionStatisticsProjection = {
  revision: "r1", count: 4, numerical_count: 2, sum: 6, average: 3, min: 2, max: 4, error_count: 0,
};
const render = (overrides: Partial<SelectionStatisticsProjection> = {}) => renderToStaticMarkup(<SelectionStatisticsBar statistics={{ ...statistics, ...overrides }} />);

describe("SelectionStatisticsBar", () => {
  it("presents Work's six statistics as selectable text, keeping Count distinct", () => {
    const html = render();
    for (const [key, value] of [["count", 4], ["numerical-count", 2], ["sum", 6], ["average", 3], ["min", 2], ["max", 4]]) {
      expect(html).toContain(`data-testid="selection-${key}">${value}</span>`);
    }
    expect(html).not.toContain("<button");
  });
  it("shows only Count for text-only and all-blank replies", () => {
    for (const count of [0, 2]) {
      const html = render({ count, numerical_count: 0, sum: 0, average: null, min: null, max: null });
      expect(html).toContain(`data-testid="selection-count">${count}</span>`);
      expect(html).not.toContain('data-testid="selection-sum"');
      expect(html).not.toContain('data-testid="selection-numerical-count"');
    }
  });
  it("keeps counts and explains unavailable aggregates without showing partial numbers", () => {
    const html = render({ error_count: 2, sum: null, average: null, min: null, max: null });
    expect(html.match(/>Unavailable</g)).toHaveLength(4);
    expect(html).toContain('title="2 cells have formula errors"');
    expect(html).toContain('selection-count">4<');
    expect(html).toContain('selection-numerical-count">2<');
    expect(render({ error_count: 1 })).toContain('title="1 cell has formula errors"');
  });
  it("shows a dash for null without formula errors and preserves numeric zero", () => {
    const html = render({ sum: null, min: 0 });
    expect(html).toContain('selection-sum">—<');
    expect(html).toContain('selection-min">0<');
    expect(html).not.toContain("Unavailable");
  });
  it("uses the supplied one-column format; otherwise it uses General", () => {
    const format = { kind: { type: "percent" as const }, decimals: 1, thousands_separator: false };
    const html = renderToStaticMarkup(<SelectionStatisticsBar statistics={statistics} format={format} />);
    expect(html).toContain(`selection-sum">${formatNumberFor(6, format)}<`);
    expect(html).toContain('selection-count">4<');
    expect(render()).toContain('selection-sum">6<');
  });
});
