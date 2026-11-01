import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { cellDisplay } from "./field-display.js";
import { PrintTableContent } from "./PrintTable.js";
import type { TableColumn, TableRow } from "./projection-access.js";

function column(id: string, field_type: TableColumn["field_type"] = "text"): TableColumn {
  return { id, key: id, display_name: `Col ${id}`, field_type, required: false };
}

function rows(columns: readonly TableColumn[], count: number): TableRow[] {
  return Array.from({ length: count }, (_, index) => {
    const entity = `e${index}`;
    const fields = columns.map((col) => ({
      target: { entity, field: col.id }, address: `${entity}.${col.id}`,
      stored: col.field_type === "number" ? { kind: "number", value: index + 0.5 } : { kind: "text", value: `${col.id}-${index}` },
      formula: null, calculated: null, diagnostics: [], editable_scalar: col.field_type,
    }) as unknown as FieldProjection);
    return { id: entity, key: entity, fields };
  });
}

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe("PrintTableContent", () => {
  it("prints every shown row with the grid's text, not only the windowed rows", () => {
    const columns = [column("a"), column("b"), column("n", "number")];
    const shown = rows(columns, 250);
    const html = renderToStaticMarkup(<PrintTableContent tableName="Spending" columns={columns} rows={shown} viewStatus="Sorted by Col a" />);
    const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    expect(count(body, /<tr>/g)).toBe(250);
    for (const col of columns) expect(html).toContain(`<th scope="col">${col.display_name}</th>`);
    expect(body).toContain(`>${cellDisplay(shown[7]!, columns[2]!).text}</td>`);
    expect(html).toContain("<h1 class=\"ts-print-title\">Spending</h1>");
    expect(html).toContain("250 rows · Sorted by Col a");
    expect(html).toContain('data-orientation="portrait"');
    expect(html).not.toContain("<tfoot>");
  });

  it("turns landscape past six columns and repeats the footer totals", () => {
    const columns = Array.from({ length: 7 }, (_, index) => column(`c${index}`, index === 6 ? "number" : "text"));
    const html = renderToStaticMarkup(<PrintTableContent tableName="Wide" columns={columns} rows={rows(columns, 2)} totals={{ c6: 1 }} />);
    expect(html).toContain('data-orientation="landscape"');
    const foot = html.slice(html.indexOf("<tfoot>"), html.indexOf("</tfoot>"));
    expect(count(foot, /<td /g)).toBe(7);
    expect(foot).toContain('data-column="c6"');
  });
});
