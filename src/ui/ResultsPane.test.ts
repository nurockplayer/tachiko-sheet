import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KeyedGroupedSumResult, WorkbookView } from "../contracts.js";
import { ResultsPane, SalesTip } from "./ResultsPane.js";

const view: WorkbookView = {
  title: "Sheet J4 Catalog Sales", occurrence: "occurrence-1", revision: "revision-1",
  collections: [{ id: "sales", key: "sales", entity_count: 1 }],
  table: { revision: "revision-1", collection: { id: "sales", key: "sales", entity_count: 1 }, columns: [], rows: [] },
};
const report = { definitionId: "definition-1", type: "bar" as const, title: "Sales by product", categoryLabel: "Product", valueLabel: "Revenue", legendVisible: false };
const grouped: KeyedGroupedSumResult = { definitionId: "definition-1", revision: "revision-1", groups: [{ category: "PEN", value: 800 }], diagnostics: [] };

function markup(options: Partial<{ currentness: "current" | "pending" | "unknown"; results: KeyedGroupedSumResult[]; report: typeof report | null; definitionIds: string[]; busy: boolean; priorChartModes: ReadonlyMap<string, "drawn" | "deferred" | "none"> }> = {}): string {
  return renderToStaticMarkup(createElement(ResultsPane, {
    view, currentness: options.currentness ?? "current", results: options.results ?? [grouped],
    definitionIds: options.definitionIds ?? ["definition-1"], report: options.report === undefined ? report : options.report, priorChartModes: options.priorChartModes ?? new Map(),
    busy: options.busy ?? false, onChartMode: () => {}, onRefresh: async () => true,
    onOpenSummary: () => {}, onOpenReport: () => {}, onHide: () => {}, hideButtonRef: createRef<HTMLButtonElement>(), chartFontKey: "test",
  }));
}

describe("Results presentation contract", () => {
  it("keeps result values before chart material and hides the SVG from duplicate assistive output", () => {
    const html = markup();
    expect(html.indexOf('aria-label="Sales by product values"')).toBeLessThan(html.indexOf('class="ts-mini-chart-region"'));
    expect(html).toContain('class="ts-results-heading"');
    expect(html.slice(html.indexOf('class="ts-results-heading"'), html.indexOf('class="ts-result-cards"'))).toContain(">Hide results</button>");
  });

  it("gives D, E, G, and J their distinct card action grammar", () => {
    const diagnostic = { ...grouped, diagnostics: [{ code: "stale", entity: null, field: null, lookup_key: null, candidates: [] }] };
    const d = markup({ results: [diagnostic] });
    const dArticle = d.slice(d.indexOf("<article"), d.indexOf("</article>") + 10);
    expect(dArticle.match(/>Refresh this summary<\/button>/g)).toHaveLength(1);
    expect(dArticle.match(/>Open summary<\/button>/g)).toHaveLength(1);
    expect(dArticle).not.toContain("Open report");

    const e = markup({ results: [] });
    const eArticle = e.slice(e.indexOf("<article"), e.indexOf("</article>") + 10);
    expect(eArticle).toContain("Needs attention");
    expect(eArticle.match(/>Refresh this summary<\/button>/g)).toHaveLength(1);
    expect(eArticle).not.toContain("Open summary");
    expect(eArticle).not.toContain("Open report");

    const g = markup({ currentness: "unknown" });
    const gArticle = g.slice(g.indexOf("<article"), g.indexOf("</article>") + 10);
    expect(gArticle).toContain("These results can’t be confirmed. Use Refresh in the header to read the work again. Values and chart are hidden until then.");
    expect(gArticle).not.toContain("<button");

    const j = markup({ currentness: "pending", results: [], busy: true });
    const jArticle = j.slice(j.indexOf("<article"), j.indexOf("</article>") + 10);
    expect(jArticle).toContain("Updating…");
    expect(jArticle).toContain("Reading the result…");
    expect(jArticle).toContain(">Open report</button>");
    expect(jArticle).not.toContain("disabled=\"\" onClick");
  });

  it("uses discovery order for unbound Summary titles and opens Summary only for that definition", () => {
    const html = markup({ report: null, definitionIds: ["definition-1", "definition-2"] });
    const articles = html.match(/<article[\s\S]*?<\/article>/g) ?? [];
    expect(articles).toHaveLength(2);
    expect(articles[0]!).toContain(">Summary</h3>");
    expect(articles[1]!).toContain(">Summary 2</h3>");
    expect(articles[0]!.match(/>Open summary<\/button>/g)).toHaveLength(1);
    expect(articles[0]!).not.toContain("Open report");
  });

  it("uses current report title and responsive tip copy with the approved priority", () => {
    const base = { marker: { occurrence: "occurrence-1", collection: "catalog", field: "price" }, reportTitle: "Revenue by product", changed: false, currentness: "current" as const, hasAttention: false, dismiss: () => {} };
    const current = renderToStaticMarkup(createElement(SalesTip, base));
    expect(current).toContain("Change the PEN price. Revenue by product updates on the right.");
    expect(current).toContain("Change the PEN price. Revenue by product updates below the table.");
    expect(current.match(/data-tip-variant=/g)).toHaveLength(5);
    expect(current.match(/data-tip-variant=\"[^\"]+\" aria-hidden=\"true\"/g)).toHaveLength(4);
    expect(current.match(/aria-label=\"Dismiss tip\"/g)).toHaveLength(1);
    expect(current).toContain('data-tip-variant="try-it" aria-hidden="false"');
    const pending = renderToStaticMarkup(createElement(SalesTip, { ...base, changed: true, currentness: "pending", hasAttention: true }));
    expect(pending).toContain("Updating");
    expect(pending).toContain("Wait for confirmation before editing.");
    expect(pending).toContain('data-tip-variant="needs-attention" aria-hidden="true"');
    expect(pending).toContain('data-tip-variant="updating" aria-hidden="false"');
    expect(renderToStaticMarkup(createElement(SalesTip, { ...base, reportTitle: "   " }))).toContain("Results updates on the right.");
  });

  it("keeps the previous chart area empty while showing previous values", () => {
    const html = markup({ currentness: "pending", priorChartModes: new Map([[`occurrence-1${String.fromCharCode(0)}definition-1`, "drawn"]]) });
    expect(html).toContain('data-result-state="C"');
    expect(html).toContain(">PEN</td>");
    expect(html).toContain("Previous chart hidden while results update");
    expect(html).not.toContain("<svg class=\"ts-mini-chart\"");
    expect(html).toContain("The chart is hidden while the result updates.");
    expect(html).toContain(">Open report</button>");
  });
});
